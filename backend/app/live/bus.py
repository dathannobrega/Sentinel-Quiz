"""Room event bus (PLANO §10.4): fan-out of room events to every process.

- ``InMemoryLiveBus``: single process (tests, dev, one uvicorn worker).
- ``RedisLiveBus``: Redis Pub/Sub on ``live:room:{session_id}:ev``; one pub/sub
  connection per process, a room is SUBSCRIBEd while it has local connections.

Delivery is at-most-once; clients recover from any gap with the authoritative
``room.snapshot`` the server sends on (re)connect, and state transitions carry ``seq``.
Handlers must be fast (they only enqueue frames).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Protocol

from app.core.config import Settings

logger = logging.getLogger("app.live.bus")

Handler = Callable[[dict[str, Any]], Awaitable[None]]


def channel_name(session_id: str) -> str:
    return f"live:room:{session_id}:ev"


class LiveBus(Protocol):
    async def publish(self, session_id: str, message: dict[str, Any]) -> None: ...

    async def subscribe(self, session_id: str, handler: Handler) -> None: ...

    async def unsubscribe(self, session_id: str, handler: Handler) -> None: ...

    async def ping(self) -> bool: ...

    async def close(self) -> None: ...


class InMemoryLiveBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = {}

    async def publish(self, session_id: str, message: dict[str, Any]) -> None:
        # Round-trip through JSON so both backends deliver identical, detached payloads.
        payload = json.loads(json.dumps(message, default=str))
        for handler in list(self._handlers.get(session_id, [])):
            try:
                await handler(payload)
            except Exception:  # pragma: no cover - a broken handler must not stop fan-out
                logger.exception("live bus handler failed", extra={"event": "live_bus_handler_error"})

    async def subscribe(self, session_id: str, handler: Handler) -> None:
        self._handlers.setdefault(session_id, []).append(handler)

    async def unsubscribe(self, session_id: str, handler: Handler) -> None:
        handlers = self._handlers.get(session_id, [])
        if handler in handlers:
            handlers.remove(handler)
        if not handlers:
            self._handlers.pop(session_id, None)

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        self._handlers.clear()


class RedisLiveBus:
    def __init__(self, url: str) -> None:
        from redis import asyncio as redis_asyncio

        # No socket_timeout: the pub/sub connection blocks while waiting for messages.
        self._redis = redis_asyncio.from_url(url, decode_responses=True, health_check_interval=30)
        self._pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
        self._handlers: dict[str, list[Handler]] = {}
        self._reader: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def publish(self, session_id: str, message: dict[str, Any]) -> None:
        await self._redis.publish(channel_name(session_id), json.dumps(message, default=str, separators=(",", ":")))

    async def subscribe(self, session_id: str, handler: Handler) -> None:
        async with self._lock:
            first = session_id not in self._handlers
            self._handlers.setdefault(session_id, []).append(handler)
            if first:
                await self._pubsub.subscribe(channel_name(session_id))
            if self._reader is None or self._reader.done():
                self._reader = asyncio.create_task(self._read_loop(), name="live-bus-reader")

    async def unsubscribe(self, session_id: str, handler: Handler) -> None:
        async with self._lock:
            handlers = self._handlers.get(session_id, [])
            if handler in handlers:
                handlers.remove(handler)
            if not handlers and session_id in self._handlers:
                self._handlers.pop(session_id, None)
                await self._pubsub.unsubscribe(channel_name(session_id))

    async def _read_loop(self) -> None:
        backoff = 0.5
        while True:
            try:
                if not self._handlers:
                    await asyncio.sleep(0.2)
                    continue
                message = await self._pubsub.get_message(timeout=1.0)
                backoff = 0.5
                if not message or message.get("type") != "message":
                    continue
                channel = str(message.get("channel") or "")
                session_id = channel.split(":")[2] if channel.count(":") >= 3 else ""
                payload = json.loads(message.get("data") or "{}")
                for handler in list(self._handlers.get(session_id, [])):
                    try:
                        await handler(payload)
                    except Exception:  # pragma: no cover
                        logger.exception("live bus handler failed", extra={"event": "live_bus_handler_error"})
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("live bus read failed; retrying", extra={"event": "live_bus_read_error"}, exc_info=True)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 5.0)
                try:
                    channels = [channel_name(sid) for sid in self._handlers]
                    if channels:
                        await self._pubsub.subscribe(*channels)
                except Exception:  # pragma: no cover
                    pass

    async def ping(self) -> bool:
        try:
            return bool(await self._redis.ping())
        except Exception:
            return False

    async def close(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
        try:
            await self._pubsub.aclose()
        finally:
            await self._redis.aclose()


def build_live_bus(app_settings: Settings) -> LiveBus:
    if app_settings.normalized_live_bus_backend() == "redis":
        return RedisLiveBus(app_settings.effective_live_redis_url())
    return InMemoryLiveBus()
