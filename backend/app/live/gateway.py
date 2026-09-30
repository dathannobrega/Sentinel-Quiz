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
import weakref
from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketState

from app.core.config import settings
from app.live.db import live_db
from app.live.metrics import BATCH_BUCKETS, loop_lag_sampler, metrics
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
LOBBY_INTERVAL_S = 0.5
PRESENCE_FLUSH_S = 3.0
DIRTY_COALESCE_S = 0.1
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
            metrics.inc("live_slow_consumer_total", {"role": self.role})
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
        self.lobby_dirty = False
        self.lobby_sent_at = 0.0
        self.bots_task: asyncio.Task | None = None
        self.presence_dirty = False
        self.lock_at_ms: int | None = None
        self.task: asyncio.Task | None = None

    async def on_bus(self, message: dict[str, Any]) -> None:
        control = message.get("control")
        if control == "dirty":
            self.dirty = True
            return
        if control == "lobby":
            self.lobby_dirty = True
            return
        if control == "presence":
            self.presence_dirty = True
            return
        if control == "resnapshot":
            await self.resnapshot_all()
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
        if broadcast["type"] in {"question.locked", "question.reveal", "podium.show", "session.ended", "leaderboard.show", "question.paused"}:
            self.lock_at_ms = None
        if meta.get("clear_lock"):
            self.lock_at_ms = None
        if "lock_at_ms" in meta:
            self.lock_at_ms = meta["lock_at_ms"]
        await self.deliver(runtime.Broadcast(**broadcast))
        self._drive_bots(broadcast["type"], broadcast.get("data") or {})

    def _drive_bots(self, type_: str, data: dict[str, Any]) -> None:
        """Rehearsal bots (RF-513) are driven by the process holding the host socket."""
        if type_ in {"question.locked", "question.reveal", "question.paused", "podium.show", "session.ended"} and self.bots_task:
            self.bots_task.cancel()
            self.bots_task = None
        if type_ in {"question.intro", "question.timer"} and any(c.role == "host" for c in self.connections):
            if self.bots_task is not None:
                self.bots_task.cancel()
            self.bots_task = asyncio.create_task(self._run_bots(int(data.get("qi", -1))), name=f"live-bots-{self.session_id[:8]}")

    async def _run_bots(self, qi: int) -> None:
        try:
            plan = await run_in_threadpool(_with_db, runtime.bot_plan, self.session_id, qi)
            started = time.monotonic()
            pending = list(plan)
            while pending:
                bot = pending.pop(0)
                await asyncio.sleep(max(0.0, bot.delay_s - (time.monotonic() - started)))
                result = await self.hub.submit_answer(bot.answer)
                if result.status == "paused":  # answer again after the host resumes
                    bot.delay_s = time.monotonic() - started + 1.0
                    pending.append(bot)
                    continue
                if result.status == "accepted":
                    await self.hub.mark_dirty(self.session_id)
                await self.hub.publish_outcome(self.session_id, result.outcome)
                if result.status in {"late", "closed"}:
                    return
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("live bots failed", extra={"event": "live_bots_error", "session_id": self.session_id})

    async def deliver(self, broadcast: runtime.Broadcast) -> None:
        started = time.perf_counter()
        targets = [c for c in self.connections if _wants(c, broadcast)]
        if not targets:
            return
        staff_data = {k: v for k, v in broadcast.data.items() if k != "hide_correct_on_device"}
        staff_frame = protocol.dumps(protocol.envelope(broadcast.type, staff_data, seq=broadcast.seq))
        participants = [c for c in targets if c.role == "participant"]
        public_data = _participant_view(broadcast)
        personal: dict[str, str] = {}
        if broadcast.personalize and participants:
            pids = sorted({c.participant_id for c in participants if c.participant_id})
            # Blocks AND their JSON are built in a worker thread: 1,000 dumps on the event
            # loop would stall every other room for ~100 ms (RNF-106/RNF-108).
            personal = await run_in_threadpool(
                _personal_frames, self.session_id, broadcast.personalize, pids, broadcast.type, public_data, broadcast.seq
            )
        shared_participant_frame = protocol.dumps(protocol.envelope(broadcast.type, public_data, seq=broadcast.seq))
        for conn in targets:
            if conn.role != "participant":
                conn.send(staff_frame)
            else:
                conn.send(personal.get(conn.participant_id or "", shared_participant_frame))
        # RNF-101: from publish to the last local enqueue (the writers drain concurrently).
        metrics.observe("live_broadcast_seconds", time.perf_counter() - started, {"type": broadcast.type})
        metrics.inc("live_frames_out_total", {"type": broadcast.type}, len(targets))
        hosts = [c for c in self.connections if c.role == "host"]
        if hosts and (broadcast.seq is not None or broadcast.type in {"lobby.update", "room.locked"}):
            # State changed: hosts get a fresh authoritative snapshot (answer key, notes,
            # next item, participants) — events alone never carry presenter-only data.
            frame = await run_in_threadpool(_snapshot, Identity(role="host", session_id=self.session_id))
            text = protocol.dumps(frame)
            for conn in hosts:
                conn.send(text)

    async def resnapshot_all(self) -> None:
        """Moderation removed content: every local connection gets a fresh snapshot."""
        targets = [c for c in list(self.connections) if not c.closed]
        if not targets:
            return
        identities = {(c.role, c.participant_id) for c in targets}

        def _build() -> dict[tuple[str, str | None], str]:
            return {
                key: protocol.dumps(_snapshot(Identity(role=key[0], session_id=self.session_id, participant_id=key[1])))
                for key in identities
            }

        frames = await run_in_threadpool(_build)
        for conn in targets:
            conn.send(frames[(conn.role, conn.participant_id)])

    async def refresh_hosts(self) -> None:
        hosts = [c for c in self.connections if c.role == "host"]
        if not hosts:
            return
        text = protocol.dumps(await run_in_threadpool(_snapshot, Identity(role="host", session_id=self.session_id)))
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
                if self.presence_dirty:
                    self.presence_dirty = False
                    await self.refresh_hosts()
                if self.lobby_dirty and time.monotonic() - self.lobby_sent_at >= LOBBY_INTERVAL_S:
                    # Joins are coalesced: one lobby.update (and one host snapshot) per
                    # interval, not one per join (a 1,000-person join storm is O(N) frames).
                    self.lobby_dirty = False
                    self.lobby_sent_at = time.monotonic()
                    lobby = await run_in_threadpool(_with_db, runtime.lobby_state, self.session_id)
                    await self.deliver(runtime.Broadcast("lobby.update", lobby))
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


def _personal_frames(
    session_id: str, kind: str, pids: list[str], type_: str, public_data: dict[str, Any], seq: int | None
) -> dict[str, str]:
    with live_db() as db:
        room = runtime.load_room(db, session_id)
        blocks = runtime.personal_blocks(db, room, kind, pids)
    return {pid: protocol.dumps(protocol.envelope(type_, {**public_data, "my": block}, seq=seq)) for pid, block in blocks.items()}


# ----------------------------------------------------------------------------- answers

class AnswerBatcher:
    """Group commit for ``answer.submit`` (RNF-103/RNF-204).

    Answers that arrive while a batch is being written wait for the next one, so under
    load a burst of 1,000 answers becomes a few multi-row INSERTs with one commit each
    instead of 1,000 transactions competing for the pool. Each caller still waits for
    its own commit before it is acked.
    """

    MAX_BATCH = 500
    IDLE_EXIT_S = 30.0

    def __init__(self) -> None:
        self._pending: list[tuple[runtime.AnswerIn, asyncio.Future]] = []
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def submit(self, answer: runtime.AnswerIn) -> runtime.AnswerResult:
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending.append((answer, future))
        self._wake.set()
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="live-answer-writer")
        return await future

    async def _run(self) -> None:
        while True:
            if not self._pending:
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=self.IDLE_EXIT_S)
                except asyncio.TimeoutError:
                    return  # restarted by the next submit
                continue
            batch = self._pending[: self.MAX_BATCH]
            del self._pending[: self.MAX_BATCH]
            metrics.observe("live_answer_batch_size", float(len(batch)), buckets=BATCH_BUCKETS)
            try:
                results = await run_in_threadpool(_with_db, runtime.submit_answers, [answer for answer, _ in batch])
            except Exception as exc:
                logger.exception("live answer batch failed", extra={"event": "live_answer_batch_error", "size": len(batch)})
                for _, future in batch:
                    if not future.done():
                        future.set_exception(exc)
                continue
            for (_, future), result in zip(batch, results):
                if not future.done():
                    future.set_result(result)


# ----------------------------------------------------------------------------- hub

class LiveHub:
    def __init__(self, bus: LiveBus) -> None:
        self.bus = bus
        self.rooms: dict[str, RoomChannel] = {}
        self._lock = asyncio.Lock()
        self._lag_task: asyncio.Task | None = None
        self._presence_task: asyncio.Task | None = None
        self._seen: set[str] = set()
        self._dirty_pending: set[str] = set()
        self._background: set[asyncio.Task] = set()
        # One group-commit writer per event loop (tests run one loop per client).
        self._batchers: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, AnswerBatcher]" = weakref.WeakKeyDictionary()
        metrics.gauge("live_connections", self._connections_by_role)
        metrics.gauge("live_rooms_active", lambda: {(): float(len(self.rooms))})

    async def start(self) -> None:
        if self._lag_task is None:
            self._lag_task = asyncio.create_task(loop_lag_sampler(), name="live-loop-lag")
        if self._presence_task is None:
            self._presence_task = asyncio.create_task(self._presence_loop(), name="live-presence")

    async def close(self) -> None:
        for task in (self._lag_task, self._presence_task):
            if task is not None:
                task.cancel()
        self._lag_task = self._presence_task = None
        await self.flush_presence()
        await self.bus.close()

    def mark_seen(self, participant_id: str) -> None:
        self._seen.add(participant_id)

    async def flush_presence(self) -> None:
        if not self._seen:
            return
        seen, self._seen = list(self._seen), set()
        try:
            sessions = await run_in_threadpool(_with_db, runtime.touch_participants, seen)
        except Exception:
            logger.exception("live presence flush failed", extra={"event": "live_presence_error", "size": len(seen)})
            return
        for session_id in sessions:  # hosts see "online" without waiting for the next state change
            await self.bus.publish(session_id, {"control": "presence"})

    async def _presence_loop(self) -> None:
        # One UPDATE every few seconds instead of a commit per heartbeat/connect.
        while True:
            await asyncio.sleep(PRESENCE_FLUSH_S)
            await self.flush_presence()

    def _connections_by_role(self) -> dict[tuple[tuple[str, str], ...], float]:
        counts: dict[str, int] = {"host": 0, "display": 0, "participant": 0}
        for channel in list(self.rooms.values()):
            for conn in list(channel.connections):
                counts[conn.role] = counts.get(conn.role, 0) + 1
        return {(("role", role),): float(n) for role, n in counts.items()}

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
        if outcome.clear_lock:
            meta["clear_lock"] = True
        # The auto-lock schedule rides on the broadcast that changed it, so every
        # process updates its room loop in the same order as the event.
        carrier = next(
            (b for b in outcome.broadcasts if b.type in {"question.intro", "question.timer"}),
            outcome.broadcasts[0] if outcome.broadcasts else None,
        )
        for broadcast in outcome.broadcasts:
            message: dict[str, Any] = {"broadcast": broadcast.__dict__}
            if meta and broadcast is carrier:
                message["meta"] = meta
            await self.bus.publish(session_id, message)
        if outcome.kicked_participant:
            pid, banned = outcome.kicked_participant
            await self.bus.publish(session_id, {"control": "kick", "participant_id": pid, "banned": banned})
        if outcome.resnapshot:
            await self.bus.publish(session_id, {"control": "resnapshot"})

    async def submit_answer(self, answer: runtime.AnswerIn) -> runtime.AnswerResult:
        loop = asyncio.get_running_loop()
        batcher = self._batchers.get(loop)
        if batcher is None:
            batcher = self._batchers[loop] = AnswerBatcher()
        return await batcher.submit(answer)

    async def mark_dirty(self, session_id: str) -> None:
        """Counters changed. Coalesced per process: at most one bus message per session per
        DIRTY_COALESCE_S (the room tick reads the counters anyway), never one per answer."""
        if session_id in self._dirty_pending:
            return
        self._dirty_pending.add(session_id)
        asyncio.get_running_loop().call_later(DIRTY_COALESCE_S, self._flush_dirty, session_id)

    def _flush_dirty(self, session_id: str) -> None:
        self._dirty_pending.discard(session_id)
        task = asyncio.create_task(self.bus.publish(session_id, {"control": "dirty"}))
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def mark_lobby_dirty(self, session_id: str) -> None:
        await self.bus.publish(session_id, {"control": "lobby"})

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
                me={
                    "participant_id": participant.id,
                    "display_name": participant.display_name,
                    "avatar_seed": participant.avatar_seed,
                    "time_multiplier": 1.0 if participant.time_multiplier is None else float(participant.time_multiplier),
                },
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
    started = time.perf_counter()
    try:
        return _build_snapshot(identity)
    finally:
        metrics.observe("live_snapshot_seconds", time.perf_counter() - started, {"role": identity.role})


def _build_snapshot(identity: Identity) -> dict[str, Any]:
    with live_db() as db:
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


async def _heartbeat(conn: Connection, hub: "LiveHub") -> None:
    interval = max(settings.live_ws_heartbeat_ms, 1000) / 1000.0
    while not conn.closed:
        await asyncio.sleep(interval)
        if time.monotonic() - conn.last_frame_at > 2 * interval + 5:
            conn.close(1001)
            return
        conn.send(protocol.envelope("srv.ping", {"ts": protocol.now_ms()}))
        if conn.participant_id:
            hub.mark_seen(conn.participant_id)


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
    "host.pause": lambda db, sid, d: runtime.pause(db, sid, expected_qi=d.expected_qi),
    "host.resume": lambda db, sid, d: runtime.resume(db, sid, expected_qi=d.expected_qi),
    "host.extend": lambda db, sid, d: runtime.extend(db, sid, expected_qi=d.expected_qi, seconds=d.seconds),
    "host.set_time": lambda db, sid, d: runtime.set_time_multiplier(
        db, sid, participant_id=d.participant_id, multiplier=float(d.multiplier)
    ),
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
        started = time.perf_counter()
        result = await hub.submit_answer(
            runtime.AnswerIn(
                session_id=conn.session_id,
                participant_id=conn.participant_id or "",
                answer_id=data.answer_id,
                qi=data.qi,
                choice=data.choice,
                text=data.text,
                client_elapsed_ms=data.client_elapsed_ms,
                rtt_min_ms=conn.rtt_min,
            )
        )
        conn.send(protocol.envelope("answer.ack", {"answer_id": data.answer_id, "qi": data.qi, "status": result.status}))
        metrics.observe("live_answer_accept_seconds", time.perf_counter() - started)  # RNF-103 (server side)
        metrics.inc("live_answers_total", {"status": result.status})
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
    metrics.inc("live_ws_connects_total", {"role": identity.role})
    await hub.attach(conn)
    conn.send(await run_in_threadpool(_snapshot, identity))
    if conn.participant_id:
        hub.mark_seen(conn.participant_id)
    heartbeat = asyncio.create_task(_heartbeat(conn, hub))
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
                metrics.inc("live_ws_rate_limited_total", {"role": conn.role})
                continue
            conn.violations = 0
            try:
                frame, data = protocol.parse_frame(raw)
            except protocol.FrameError as exc:
                conn.send(protocol.envelope("error", {"code": "invalid", "ref_mid": exc.mid, "detail": exc.detail[:200]}))
                continue
            metrics.inc("live_messages_in_total", {"type": frame.type})
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
        metrics.inc("live_ws_closes_total", {"role": identity.role, "code": conn.close_code or 1000})
        logger.info("live connection closed", extra={"event": "live_ws_close", "role": identity.role, "code": conn.close_code})
