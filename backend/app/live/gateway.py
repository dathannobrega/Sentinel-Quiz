"""WebSocket gateway of Sentinel Arena (``/api/live/ws``, protocol ``sq.live.v1``).

Transport only: authentication, per-connection bounded send queue, heartbeat with
server-measured RTT (DC-27), token-bucket rate limit and fan-out of room events.
Every state change is delegated to :mod:`app.live.runtime` (run in the threadpool,
sync SQLAlchemy) and the resulting broadcasts go through the :mod:`bus`, so all
processes/replicas deliver the same events to their local connections.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketState

from app.core.config import settings
from app.live.db import live_db
from app.live import protocol, runtime
from app.live.bus import LiveBus
from app.models import LiveParticipant, LiveSession
from app.services.auth import resolve_auth_token
from app.services.live_tokens import LiveTokenError, jti_hash, verify_token

logger = logging.getLogger("app.live.gateway")

router = APIRouter()

HELLO_TIMEOUT_S = 5.0
SEND_QUEUE_MAX = 64
TICK_INTERVAL_S = 0.25
RTT_WINDOW = 8


# ----------------------------------------------------------------------------- connection

@dataclass(eq=False)  # identity semantics: connections live in sets
class Connection:
    websocket: WebSocket
    role: str
    session_id: str
    participant_id: str | None = None
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=SEND_QUEUE_MAX))
    rtts: list[int] = field(default_factory=list)
    last_frame_at: float = field(default_factory=time.monotonic)
    tokens: float = 0.0
    token_ts: float = field(default_factory=time.monotonic)
    closed: bool = False
    close_code: int | None = None
    violations: int = 0

    @property
    def rtt_min(self) -> int | None:
        return min(self.rtts) if self.rtts else None

    def allow(self) -> bool:
        now = time.monotonic()
        rate, burst = settings.live_ws_rate_per_second, settings.live_ws_rate_burst
        self.tokens = min(float(burst), self.tokens + (now - self.token_ts) * rate)
        self.token_ts = now
        if self.tokens < 1.0:
            return False
        self.tokens -= 1.0
        return True

    def send(self, frame: dict[str, Any] | str) -> None:
        if self.closed:
            return
        text = frame if isinstance(frame, str) else protocol.dumps(frame)
        try:
            self.queue.put_nowait(text)
        except asyncio.QueueFull:
            # Slow consumer: drop the connection; it reconnects and gets a fresh snapshot.
            logger.info("live slow consumer closed", extra={"event": "live_slow_consumer", "role": self.role})
            self.close(1013)

    def close(self, code: int) -> None:
        if self.closed:
            return
        self.closed = True
        self.close_code = code
        try:
            self.queue.put_nowait(None)
        except asyncio.QueueFull:
            pass


# ----------------------------------------------------------------------------- per-room channel

class RoomChannel:
    """Local connections of one room in this process + its tick loop."""

    def __init__(self, hub: "LiveHub", session_id: str) -> None:
        self.hub = hub
        self.session_id = session_id
        self.connections: set[Connection] = set()
        self.dirty = False
        self.lock_at_ms: int | None = None
        self.task: asyncio.Task | None = None

    async def on_bus(self, message: dict[str, Any]) -> None:
        control = message.get("control")
        if control == "dirty":
            self.dirty = True
            return
        if control == "kick":
            pid = message.get("participant_id")
            banned = bool(message.get("banned"))
            for conn in list(self.connections):
                if conn.participant_id == pid:
                    conn.send(protocol.envelope("participant.kicked", {"banned": banned}))
                    conn.close(protocol.CLOSE_BANNED if banned else protocol.CLOSE_KICKED)
            return
        broadcast = message.get("broadcast")
        if not broadcast:
            return
        meta = message.get("meta") or {}
        if "lock_at_ms" in meta:
            self.lock_at_ms = meta["lock_at_ms"]
        if broadcast["type"] in {"question.locked", "question.reveal", "podium.show", "session.ended", "leaderboard.show"}:
            self.lock_at_ms = None
        await self.deliver(runtime.Broadcast(**broadcast))

    async def deliver(self, broadcast: runtime.Broadcast) -> None:
        targets = [c for c in self.connections if _wants(c, broadcast)]
        if not targets:
            return
        staff_data = {k: v for k, v in broadcast.data.items() if k != "hide_correct_on_device"}
        staff_frame = protocol.dumps(protocol.envelope(broadcast.type, staff_data, seq=broadcast.seq))
        participants = [c for c in targets if c.role == "participant"]
        public_data = _participant_view(broadcast)
        personal: dict[str, dict] = {}
        if broadcast.personalize and participants:
            pids = sorted({c.participant_id for c in participants if c.participant_id})
            personal = await run_in_threadpool(_personal_blocks, self.session_id, broadcast.personalize, pids)
        shared_participant_frame = protocol.dumps(protocol.envelope(broadcast.type, public_data, seq=broadcast.seq))
        for conn in targets:
            if conn.role != "participant":
                conn.send(staff_frame)
            elif conn.participant_id in personal:
                conn.send(protocol.envelope(broadcast.type, {**public_data, "my": personal[conn.participant_id]}, seq=broadcast.seq))
            else:
                conn.send(shared_participant_frame)
        hosts = [c for c in self.connections if c.role == "host"]
        if hosts and (broadcast.seq is not None or broadcast.type in {"lobby.update", "room.locked"}):
            # State changed: hosts get a fresh authoritative snapshot (answer key, notes,
            # next item, participants) — events alone never carry presenter-only data.
            frame = await run_in_threadpool(_snapshot, Identity(role="host", session_id=self.session_id))
            text = protocol.dumps(frame)
            for conn in hosts:
                conn.send(text)

    async def run(self) -> None:
        try:
            while self.connections:
                await asyncio.sleep(TICK_INTERVAL_S)
                if self.lock_at_ms is not None and protocol.now_ms() >= self.lock_at_ms:
                    self.lock_at_ms = None
                    outcome = await run_in_threadpool(_with_db, runtime.auto_lock_if_due, self.session_id)
                    await self.hub.publish_outcome(self.session_id, outcome)
                if self.dirty:
                    self.dirty = False
                    ticks = await run_in_threadpool(_with_db, runtime.results_tick, self.session_id)
                    for tick in ticks:
                        await self.deliver(tick)
        except asyncio.CancelledError:
            pass
        except Exception:  # pragma: no cover - keep the room alive, log and restart on next join
            logger.exception("live room loop failed", extra={"event": "live_room_loop_error", "session_id": self.session_id})


def _wants(conn: Connection, broadcast: runtime.Broadcast) -> bool:
    if broadcast.participant_id:
        return conn.participant_id == broadcast.participant_id
    audience = broadcast.audience
    if audience == runtime.ALL:
        return True
    if audience == runtime.STAFF:
        return conn.role in {"host", "display"}
    if audience == runtime.PARTICIPANTS:
        return conn.role == "participant"
    return conn.role == audience


def _participant_view(broadcast: runtime.Broadcast) -> dict[str, Any]:
    """Participants never see presenter-only data; respect show_correct_on_device."""
    data = dict(broadcast.data)
    if broadcast.type == "question.reveal" and data.get("hide_correct_on_device"):
        data["correct_option_ids"] = []
        data["accepted_answers"] = []
    data.pop("hide_correct_on_device", None)
    return data


def _with_db(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    with live_db() as db:
        return fn(db, *args, **kwargs)


def _personal_blocks(session_id: str, kind: str, pids: list[str]) -> dict[str, dict]:
    with live_db() as db:
        room = runtime.load_room(db, session_id)
        return runtime.personal_blocks(db, room, kind, pids)


# ----------------------------------------------------------------------------- hub

class LiveHub:
    def __init__(self, bus: LiveBus) -> None:
        self.bus = bus
        self.rooms: dict[str, RoomChannel] = {}
        self._lock = asyncio.Lock()

    async def attach(self, conn: Connection) -> RoomChannel:
        async with self._lock:
            channel = self.rooms.get(conn.session_id)
            if channel is None:
                channel = RoomChannel(self, conn.session_id)
                self.rooms[conn.session_id] = channel
                await self.bus.subscribe(conn.session_id, channel.on_bus)
                channel.lock_at_ms = await run_in_threadpool(_with_db, runtime.pending_lock_at_ms, conn.session_id)
            channel.connections.add(conn)
            if channel.task is None or channel.task.done():
                channel.task = asyncio.create_task(channel.run(), name=f"live-room-{conn.session_id[:8]}")
            return channel

    async def detach(self, conn: Connection) -> None:
        async with self._lock:
            channel = self.rooms.get(conn.session_id)
            if channel is None:
                return
            channel.connections.discard(conn)
            if not channel.connections:
                self.rooms.pop(conn.session_id, None)
                if channel.task is not None:
                    channel.task.cancel()
                await self.bus.unsubscribe(conn.session_id, channel.on_bus)

    async def publish_outcome(self, session_id: str, outcome: runtime.Outcome) -> None:
        meta: dict[str, Any] = {}
        if outcome.lock_at is not None:
            meta["lock_at_ms"] = int(outcome.lock_at[1].timestamp() * 1000)
        for broadcast in outcome.broadcasts:
            message: dict[str, Any] = {"broadcast": broadcast.__dict__}
            if meta and broadcast.type == "question.intro":
                message["meta"] = meta
            await self.bus.publish(session_id, message)
        if outcome.kicked_participant:
            pid, banned = outcome.kicked_participant
            await self.bus.publish(session_id, {"control": "kick", "participant_id": pid, "banned": banned})

    async def mark_dirty(self, session_id: str) -> None:
        await self.bus.publish(session_id, {"control": "dirty"})

    def connection_count(self) -> int:
        return sum(len(channel.connections) for channel in self.rooms.values())


def get_hub(websocket_or_app: Any) -> LiveHub:
    app = getattr(websocket_or_app, "app", websocket_or_app)
    return app.state.live_hub


# ----------------------------------------------------------------------------- authentication

@dataclass
class Identity:
    role: str
    session_id: str
    participant_id: str | None = None
    me: dict[str, Any] | None = None


class AuthFailure(Exception):
    def __init__(self, code: int) -> None:
        super().__init__(str(code))
        self.code = code


def _authenticate(hello: protocol.HelloData, cookie_token: str | None, origin_ok: bool) -> Identity:
    with live_db() as db:
        if hello.token:
            try:
                claims = verify_token(hello.token)
            except LiveTokenError as exc:
                raise AuthFailure(protocol.CLOSE_TOKEN_EXPIRED if exc.code == "expired" else protocol.CLOSE_AUTH) from None
            session = db.get(LiveSession, claims.session_id)
            if session is None:
                raise AuthFailure(protocol.CLOSE_AUTH)
            if claims.role == "display":
                return Identity(role="display", session_id=session.id)
            participant = db.get(LiveParticipant, claims.participant_id)
            if participant is None or participant.session_id != session.id:
                raise AuthFailure(protocol.CLOSE_AUTH)
            if participant.banned:
                raise AuthFailure(protocol.CLOSE_BANNED)
            if participant.kicked_at is not None:
                raise AuthFailure(protocol.CLOSE_KICKED)
            if participant.token_hash != jti_hash(claims.jti):
                raise AuthFailure(protocol.CLOSE_AUTH)  # superseded (rejoin elsewhere) or revoked
            return Identity(
                role="participant",
                session_id=session.id,
                participant_id=participant.id,
                me={"participant_id": participant.id, "display_name": participant.display_name, "avatar_seed": participant.avatar_seed},
            )
        if hello.role == "host" and hello.session_id:
            if not origin_ok or not cookie_token:
                raise AuthFailure(protocol.CLOSE_AUTH)
            user, _renewed = resolve_auth_token(db, cookie_token)
            session = db.get(LiveSession, hello.session_id)
            if user is None or session is None:
                raise AuthFailure(protocol.CLOSE_AUTH)
            if session.owner_user_id != user.id and user.role != "admin":
                raise AuthFailure(protocol.CLOSE_AUTH)
            return Identity(role="host", session_id=session.id)
        raise AuthFailure(protocol.CLOSE_AUTH)


def _origin_allowed(websocket: WebSocket) -> tuple[bool, bool]:
    """(accept_connection, origin_is_trusted). Browsers always send Origin; non-browser
    clients may omit it and can then only use bearer-style tokens (never the cookie)."""
    origin = (websocket.headers.get("origin") or "").rstrip("/")
    if not origin:
        return True, False
    allowed = set(settings.live_allowed_origin_list())
    host = websocket.headers.get("host") or ""
    same_origin = origin.split("://", 1)[-1] == host
    trusted = origin in allowed or same_origin
    return trusted, trusted


def _snapshot(identity: Identity) -> dict[str, Any]:
    with live_db() as db:
        room = runtime.load_room(db, identity.session_id)
        if identity.participant_id:
            runtime.touch_participant(db, identity.participant_id)
            room = runtime.load_room(db, identity.session_id)
        role = "participant" if identity.role == "participant" else identity.role
        data = runtime.snapshot(db, room, role=role, participant_id=identity.participant_id)
        return protocol.envelope("room.snapshot", data, seq=room.session.state_seq)


# ----------------------------------------------------------------------------- endpoint

async def _writer(conn: Connection) -> None:
    ws = conn.websocket
    try:
        while True:
            item = await conn.queue.get()
            if item is None:
                break
            await ws.send_text(item)
    except Exception:
        pass
    finally:
        conn.closed = True
        if ws.application_state == WebSocketState.CONNECTED:
            try:
                await ws.close(code=conn.close_code or 1000)
            except Exception:
                pass


async def _heartbeat(conn: Connection) -> None:
    interval = max(settings.live_ws_heartbeat_ms, 1000) / 1000.0
    while not conn.closed:
        await asyncio.sleep(interval)
        if time.monotonic() - conn.last_frame_at > 2 * interval + 5:
            conn.close(1001)
            return
        conn.send(protocol.envelope("srv.ping", {"ts": protocol.now_ms()}))
        if conn.participant_id:
            await run_in_threadpool(_with_db, runtime.touch_participant, conn.participant_id)


HOST_ACTIONS: dict[str, Callable[..., runtime.Outcome]] = {
    "host.start": lambda db, sid, d: runtime.start(db, sid),
    "host.next": lambda db, sid, d: runtime.next_step(db, sid, expected_qi=d.expected_qi),
    "host.lock": lambda db, sid, d: runtime.lock(db, sid, expected_qi=d.expected_qi, reason="host"),
    "host.reveal": lambda db, sid, d: runtime.reveal(db, sid, expected_qi=d.expected_qi),
    "host.leaderboard": lambda db, sid, d: runtime.show_leaderboard(db, sid),
    "host.end": lambda db, sid, d: runtime.end_session(db, sid),
    "host.kick": lambda db, sid, d: runtime.kick(db, sid, participant_id=d.participant_id, ban=d.ban),
    "host.room_lock": lambda db, sid, d: runtime.set_room_lock(db, sid, locked=d.locked),
    "host.accept_answer": lambda db, sid, d: runtime.accept_typed_answer(db, sid, qi=d.qi, text=d.text),
}


async def _handle(conn: Connection, hub: LiveHub, frame: protocol.ClientFrame, data: Any) -> None:
    kind = frame.type
    if kind not in protocol.ROLE_COMMANDS.get(conn.role, frozenset()):
        conn.send(protocol.envelope("error", {"code": "forbidden", "ref_mid": frame.mid}))
        return
    if kind == "time.sync":
        t1 = protocol.now_ms()
        conn.send(protocol.envelope("time.sync.reply", {"t0": data.t0, "t1": t1, "t2": protocol.now_ms()}))
        return
    if kind == "pong":
        rtt = protocol.now_ms() - int(data.ts)
        if 0 <= rtt < 60_000:
            conn.rtts = (conn.rtts + [rtt])[-RTT_WINDOW:]
        return
    if kind == "answer.submit":
        result = await run_in_threadpool(
            _with_db,
            runtime.submit_answer,
            conn.session_id,
            participant_id=conn.participant_id,
            answer_id=data.answer_id,
            qi=data.qi,
            choice=data.choice,
            text=data.text,
            client_elapsed_ms=data.client_elapsed_ms,
            rtt_min_ms=conn.rtt_min,
        )
        conn.send(protocol.envelope("answer.ack", {"answer_id": data.answer_id, "qi": data.qi, "status": result.status}))
        if result.status == "accepted":
            await hub.mark_dirty(conn.session_id)
        await hub.publish_outcome(conn.session_id, result.outcome)
        return
    action = HOST_ACTIONS.get(kind)
    if action is None:  # pragma: no cover - ROLE_COMMANDS and HOST_ACTIONS are in sync
        return
    outcome = await run_in_threadpool(_with_db, action, conn.session_id, data)
    if outcome.error:
        conn.send(protocol.envelope("error", {"code": outcome.error, "ref_mid": frame.mid}))
        return
    logger.info("live host command", extra={"event": "live_host_command", "command": kind, "session_id": conn.session_id})
    await hub.publish_outcome(conn.session_id, outcome)


@router.websocket("/api/live/ws")
async def live_ws(websocket: WebSocket) -> None:
    if not settings.live_enabled:
        await websocket.close(code=protocol.CLOSE_POLICY)
        return
    accept, origin_trusted = _origin_allowed(websocket)
    if not accept:
        await websocket.close(code=protocol.CLOSE_POLICY)
        return
    offered = [p.strip() for p in (websocket.headers.get("sec-websocket-protocol") or "").split(",") if p.strip()]
    if protocol.SUBPROTOCOL not in offered:
        await websocket.accept()
        await websocket.close(code=protocol.CLOSE_PROTOCOL)
        return
    await websocket.accept(subprotocol=protocol.SUBPROTOCOL)
    hub = get_hub(websocket)

    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=HELLO_TIMEOUT_S)
        if len(raw.encode("utf-8")) > settings.live_ws_max_message_bytes:
            await websocket.close(code=protocol.CLOSE_TOO_BIG)
            return
        frame, hello = protocol.parse_frame(raw)
        if frame.type != "hello":
            raise protocol.FrameError("invalid", "hello expected")
        cookie_token = websocket.cookies.get(settings.auth_cookie_name)
        identity = await run_in_threadpool(_authenticate, hello, cookie_token, origin_trusted)
    except (asyncio.TimeoutError, protocol.FrameError):
        await websocket.close(code=protocol.CLOSE_PROTOCOL)
        return
    except AuthFailure as exc:
        await websocket.close(code=exc.code)
        return
    except WebSocketDisconnect:
        return

    conn = Connection(websocket=websocket, role=identity.role, session_id=identity.session_id, participant_id=identity.participant_id)
    conn.tokens = float(settings.live_ws_rate_burst)
    writer = asyncio.create_task(_writer(conn))
    welcome = {"role": identity.role, "session_id": identity.session_id, "hb_ms": settings.live_ws_heartbeat_ms, "proto": protocol.PROTOCOL_VERSION}
    if identity.me:
        welcome["me"] = identity.me
    conn.send(protocol.envelope("welcome", welcome))
    await hub.attach(conn)
    conn.send(await run_in_threadpool(_snapshot, identity))
    heartbeat = asyncio.create_task(_heartbeat(conn))
    logger.info("live connection opened", extra={"event": "live_ws_open", "role": identity.role, "session_id": identity.session_id})

    try:
        while not conn.closed:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            conn.last_frame_at = time.monotonic()
            if len(raw.encode("utf-8")) > settings.live_ws_max_message_bytes:
                conn.close(protocol.CLOSE_TOO_BIG)
                break
            if not conn.allow():
                conn.violations += 1
                if conn.violations > settings.live_ws_rate_burst:
                    conn.close(protocol.CLOSE_RATE_LIMITED)
                    break
                conn.send(protocol.envelope("error", {"code": "rate_limited"}))
                continue
            conn.violations = 0
            try:
                frame, data = protocol.parse_frame(raw)
            except protocol.FrameError as exc:
                conn.send(protocol.envelope("error", {"code": "invalid", "ref_mid": exc.mid, "detail": exc.detail[:200]}))
                continue
            try:
                await _handle(conn, hub, frame, data)
            except runtime.RoomNotFound:
                conn.send(protocol.envelope("error", {"code": "not_found", "ref_mid": frame.mid}))
            except Exception:
                logger.exception("live command failed", extra={"event": "live_command_error", "type": frame.type})
                conn.send(protocol.envelope("error", {"code": "invalid", "ref_mid": frame.mid, "detail": "internal error"}))
    finally:
        heartbeat.cancel()
        await hub.detach(conn)
        conn.close(conn.close_code or 1000)
        try:
            await asyncio.wait_for(writer, timeout=2.0)
        except (asyncio.TimeoutError, Exception):
            writer.cancel()
        logger.info("live connection closed", extra={"event": "live_ws_close", "role": identity.role, "code": conn.close_code})
