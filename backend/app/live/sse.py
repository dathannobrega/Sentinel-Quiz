"""Server-Sent Events + POST fallback for ``sq.live.v1`` (RNF-309).

Some networks (corporate proxies, captive portals) break WebSockets. The client then
switches to:

* ``GET /api/live/sse`` — the same server frames, one per ``data:`` line, from the same
  room channel as a socket (welcome, snapshot, broadcasts). ``event: close`` carries
  the close code (kicked, banned, slow consumer) before the stream ends.
* ``POST /api/live/cmd`` — one client frame per request. It is stateless: it
  authenticates on every call, so it can land on any worker/replica. Replies addressed
  to the sender (``answer.ack``, ``error``, ``time.sync.reply``) come back in the HTTP
  response; room broadcasts reach every stream through the bus.

Authentication mirrors ``hello``: a participant/display token (query string for the
stream, since ``EventSource`` cannot send headers; body for commands) or, for the host,
the session cookie plus a trusted ``Origin``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator, Literal, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.live import protocol
from app.live.gateway import (
    AuthFailure,
    Connection,
    Identity,
    _authenticate,
    _handle,
    _origin_allowed,
    _snapshot,
    get_hub,
)
from app.live import runtime
from app.live.metrics import metrics

logger = logging.getLogger("app.live.sse")

router = APIRouter()

KEEPALIVE_S = 15.0
RETRY_MS = 2000


def _auth_error(exc: AuthFailure) -> JSONResponse:
    status = 403 if exc.code in {protocol.CLOSE_BANNED, protocol.CLOSE_KICKED, protocol.CLOSE_POLICY} else 401
    return JSONResponse(
        status_code=status,
        content={"code": "live_auth", "message": "Live authentication failed.", "details": {"close_code": exc.code}},
    )


async def _identify(request: Request, hello: protocol.HelloData) -> Identity | JSONResponse:
    if not settings.live_enabled:
        return JSONResponse(status_code=404, content={"code": "live_disabled", "message": "Live quizzes are not enabled."})
    accept, origin_trusted = _origin_allowed(request)  # only reads headers
    if not accept:
        return _auth_error(AuthFailure(protocol.CLOSE_POLICY))
    cookie_token = request.cookies.get(settings.auth_cookie_name)
    try:
        return await run_in_threadpool(_authenticate, hello, cookie_token, origin_trusted)
    except AuthFailure as exc:
        return _auth_error(exc)


@router.get("/api/live/sse", include_in_schema=False)
async def live_sse(
    request: Request,
    token: Optional[str] = Query(default=None, max_length=1024),
    session_id: Optional[str] = Query(default=None, max_length=36),
    role: Optional[Literal["host"]] = Query(default=None),
) -> Any:
    identity = await _identify(request, protocol.HelloData(token=token, session_id=session_id, role=role))
    if isinstance(identity, JSONResponse):
        return identity
    hub = get_hub(request.app)
    conn = Connection(websocket=None, role=identity.role, session_id=identity.session_id, participant_id=identity.participant_id)  # type: ignore[arg-type]

    async def stream() -> AsyncIterator[str]:
        welcome: dict[str, Any] = {
            "role": identity.role,
            "session_id": identity.session_id,
            "hb_ms": int(KEEPALIVE_S * 1000),
            "proto": protocol.PROTOCOL_VERSION,
            "transport": "sse",
        }
        if identity.me:
            welcome["me"] = identity.me
        await hub.attach(conn)
        metrics.inc("live_ws_connects_total", {"role": identity.role, "transport": "sse"})
        try:
            yield f"retry: {RETRY_MS}\n\n"
            yield _event(protocol.dumps(protocol.envelope("welcome", welcome)))
            yield _event(protocol.dumps(await run_in_threadpool(_snapshot, identity)))
            # Streams are recycled (EventSource reconnects by itself and resumes from a
            # fresh snapshot): long-lived HTTP responses rebalance across replicas.
            ends_at = time.monotonic() + max(float(settings.live_sse_max_seconds), 0.1)
            while True:
                if conn.participant_id:
                    hub.mark_seen(conn.participant_id)
                remaining = ends_at - time.monotonic()
                if remaining <= 0:
                    yield f"event: close\ndata: {json.dumps({'code': protocol.CLOSE_RESTART})}\n\n"
                    break
                try:
                    item = await asyncio.wait_for(conn.queue.get(), timeout=min(KEEPALIVE_S, remaining))
                except asyncio.TimeoutError:
                    if time.monotonic() >= ends_at:
                        continue
                    if await request.is_disconnected():
                        break
                    yield ": keepalive\n\n"  # proxies (nginx 75 s) never see an idle stream
                    continue
                if item is None:
                    yield f"event: close\ndata: {json.dumps({'code': conn.close_code or 1000})}\n\n"
                    break
                yield _event(item)
        finally:
            conn.closed = True
            await hub.detach(conn)
            metrics.inc("live_ws_closes_total", {"role": identity.role, "code": conn.close_code or 1000, "transport": "sse"})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


def _event(text: str) -> str:
    # Frames are compact JSON (no raw newlines), so one data line per frame.
    return f"data: {text}\n\n"


class CmdAuth(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: Optional[str] = Field(default=None, max_length=1024)
    session_id: Optional[str] = Field(default=None, max_length=36)
    role: Optional[Literal["host"]] = None


class CmdIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    auth: CmdAuth
    frame: dict[str, Any]


@router.post("/api/live/cmd", include_in_schema=False)
async def live_cmd(request: Request, body: CmdIn) -> Any:
    size = int(request.headers.get("content-length") or 0)
    if size > settings.live_ws_max_message_bytes + 2048:
        return JSONResponse(status_code=413, content={"code": "too_big", "message": "Frame too large."})
    auth = body.auth.model_dump()
    if not auth.get("token"):  # the token may come as a Bearer header (rate limit key)
        header = request.headers.get("authorization") or ""
        if header.lower().startswith("bearer "):
            auth["token"] = header[7:].strip() or None
    identity = await _identify(request, protocol.HelloData(**auth))
    if isinstance(identity, JSONResponse):
        return identity
    conn = Connection(websocket=None, role=identity.role, session_id=identity.session_id, participant_id=identity.participant_id)  # type: ignore[arg-type]
    try:
        frame, data = protocol.parse_frame(json.dumps(body.frame))
    except protocol.FrameError as exc:
        return {"frames": [protocol.envelope("error", {"code": "invalid", "ref_mid": exc.mid, "detail": exc.detail[:200]})]}
    if frame.type == "hello":
        return {"frames": [protocol.envelope("error", {"code": "invalid", "ref_mid": frame.mid, "detail": "hello is implicit"})]}
    metrics.inc("live_messages_in_total", {"type": frame.type, "transport": "sse"})
    started = time.perf_counter()
    try:
        await _handle(conn, get_hub(request.app), frame, data)
    except runtime.RoomNotFound:
        conn.send(protocol.envelope("error", {"code": "not_found", "ref_mid": frame.mid}))
    except Exception:
        logger.exception("live command failed", extra={"event": "live_command_error", "type": frame.type, "transport": "sse"})
        conn.send(protocol.envelope("error", {"code": "invalid", "ref_mid": frame.mid, "detail": "internal error"}))
    metrics.observe("live_cmd_seconds", time.perf_counter() - started, {"type": frame.type})
    frames: list[dict[str, Any]] = []
    while not conn.queue.empty():
        item = conn.queue.get_nowait()
        if item is not None:
            frames.append(json.loads(item))
    return {"frames": frames}
