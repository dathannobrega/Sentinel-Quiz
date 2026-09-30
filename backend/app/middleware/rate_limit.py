"""Request rate limiting and abuse signals.

* Identity = client IP resolved by ``resolve_client_ip`` (forwarded headers are only
  trusted when TRUST_FORWARDED_FOR_HEADER=true, and then the right-most entry).
* Backends: ``memory`` (per process, for development/tests) and ``redis`` (shared
  between replicas, required in production unless
  RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION=true). The Redis backend uses
  ``redis.asyncio`` (never blocks the event loop), wall-clock ``time.time()`` scores
  and atomic operations (Lua script / MULTI pipelines).
* Redis failures are fail-open: the request is allowed and an error is logged.
* CORS preflight (OPTIONS) requests are never counted.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import Settings
from app.middleware.observability import resolve_rate_limit_identity, resolve_request_identity


logger = logging.getLogger("app.security.rate_limit")

RATE_LIMIT_MESSAGE = "Too many requests. Please slow down and retry shortly."
INVALID_CODES_MESSAGE = "Too many invalid room codes. Check the code and retry later."

# Live participant endpoints (DC-22). ``/rooms/{code}`` (lookup, join, rejoin) is keyed by
# the room code and ``/me/*`` by the participant token: never by IP, because a whole
# auditorium can sit behind one NAT address (RNF-205).
_LIVE_ROOM_PATH = re.compile(r"^/api/live/rooms/(?P<code>[^/]{1,32})(?:/(?:join|rejoin))?$")
_LIVE_TOKEN_PATH = re.compile(r"^/api/live/me/")
_LIVE_PUBLIC_PATHS = frozenset({"/api/live/names/suggest", "/api/live/capabilities", "/api/live/healthz"})
# SSE fallback (RNF-309): the stream (token in the query string) and its commands
# (token as Bearer) are limited per participant token; the host (cookie) per IP.
_LIVE_TRANSPORT_PATHS = frozenset({"/api/live/sse", "/api/live/cmd"})

AUTH_SENSITIVE_PATHS = frozenset(
    {
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/request-password-reset",
        "/api/auth/request-email-verification",
        "/api/auth/reset-password",
        "/api/auth/verify-email",
    }
)

# Atomic sliding-window hit registration. Returns nil when the hit is accepted,
# otherwise the number of seconds (as a string) until a slot frees up.
_SLIDING_WINDOW_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = window
  if oldest[2] then
    retry = window - (now - tonumber(oldest[2]))
  end
  return tostring(retry)
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, math.ceil(window))
return nil
"""

# Atomic counter with TTL set on first increment.
_COUNTER_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
"""


@dataclass(frozen=True)
class RateLimitPolicy:
    limit: int
    window_seconds: int


def _retry_after_seconds(value: float) -> int:
    return max(int(math.ceil(value)), 1)


def _classify_abuse(
    *,
    bucket_name: str,
    distinct_paths: int,
    rate_limited_hits: int,
    abuse_distinct_path_threshold: int,
    abuse_rate_limit_breach_threshold: int,
) -> str:
    if bucket_name == "public" and distinct_paths >= abuse_distinct_path_threshold:
        return "high_path_fanout"
    if rate_limited_hits >= abuse_rate_limit_breach_threshold:
        return "repeated_rate_limit_breach"
    return ""


class RateLimitStore:
    backend_name = "abstract"

    async def register_hit(self, *, key: str, policy: RateLimitPolicy, now: float, max_keys: int, max_window_seconds: int) -> int | None:
        raise NotImplementedError

    async def register_activity(
        self,
        *,
        identity: str,
        path: str,
        now: float,
        rate_limited: bool,
        bucket_name: str,
        max_keys: int,
        abuse_window_seconds: int,
        abuse_signal_cooldown_seconds: int,
        abuse_distinct_path_threshold: int,
        abuse_rate_limit_breach_threshold: int,
    ) -> dict[str, object] | None:
        raise NotImplementedError

    async def increment_counter(self, *, key: str, ttl_seconds: int) -> int | None:
        """Atomically increment a counter that expires after ``ttl_seconds``.

        Returns the new value, or ``None`` when the backend is unavailable (fail-open).
        """
        raise NotImplementedError

    async def peek_counter(self, *, key: str) -> int | None:
        """Current value of a counter (0 when absent), ``None`` when unavailable."""
        raise NotImplementedError

    async def close(self) -> None:
        return None


class InMemoryRateLimitStore(RateLimitStore):
    backend_name = "memory"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}
        self._activity: dict[str, deque[tuple[float, str, bool]]] = {}
        self._signal_cooldowns: dict[str, float] = {}
        self._counters: dict[str, tuple[int, float]] = {}

    async def register_hit(self, *, key: str, policy: RateLimitPolicy, now: float, max_keys: int, max_window_seconds: int) -> int | None:
        return self.register_hit_sync(key=key, policy=policy, now=now, max_keys=max_keys, max_window_seconds=max_window_seconds)

    def register_hit_sync(self, *, key: str, policy: RateLimitPolicy, now: float, max_keys: int, max_window_seconds: int) -> int | None:
        with self._lock:
            window_start = now - policy.window_seconds
            hits = self._hits.get(key)
            if hits is None:
                hits = deque()
                self._hits[key] = hits

            while hits and hits[0] <= window_start:
                hits.popleft()

            if len(hits) >= policy.limit:
                return _retry_after_seconds(policy.window_seconds - (now - hits[0]))

            hits.append(now)
            self._prune_hits_if_needed(now=now, max_keys=max_keys, max_window_seconds=max_window_seconds)
            return None

    async def register_activity(
        self,
        *,
        identity: str,
        path: str,
        now: float,
        rate_limited: bool,
        bucket_name: str,
        max_keys: int,
        abuse_window_seconds: int,
        abuse_signal_cooldown_seconds: int,
        abuse_distinct_path_threshold: int,
        abuse_rate_limit_breach_threshold: int,
    ) -> dict[str, object] | None:
        with self._lock:
            activity = self._activity.get(identity)
            if activity is None:
                activity = deque()
                self._activity[identity] = activity

            window_start = now - abuse_window_seconds
            while activity and activity[0][0] <= window_start:
                activity.popleft()

            activity.append((now, path, rate_limited))

            distinct_paths = len({item_path for _, item_path, _ in activity})
            rate_limited_hits = sum(1 for _, _, limited in activity if limited)
            reason = _classify_abuse(
                bucket_name=bucket_name,
                distinct_paths=distinct_paths,
                rate_limited_hits=rate_limited_hits,
                abuse_distinct_path_threshold=abuse_distinct_path_threshold,
                abuse_rate_limit_breach_threshold=abuse_rate_limit_breach_threshold,
            )

            signal = None
            if reason:
                last_signal_at = self._signal_cooldowns.get(identity)
                if last_signal_at is None or (now - last_signal_at) >= abuse_signal_cooldown_seconds:
                    self._signal_cooldowns[identity] = now
                    signal = {
                        "event": "abuse_signal",
                        "reason": reason,
                        "identity": identity,
                        "bucket": bucket_name,
                        "path": path,
                        "request_count": len(activity),
                        "distinct_paths": distinct_paths,
                        "rate_limited_hits": rate_limited_hits,
                        "window_seconds": abuse_window_seconds,
                    }

            self._prune_activity_if_needed(now=now, max_keys=max_keys, abuse_window_seconds=abuse_window_seconds)
            return signal

    async def increment_counter(self, *, key: str, ttl_seconds: int) -> int | None:
        now = time.time()
        with self._lock:
            value, expires_at = self._counters.get(key, (0, 0.0))
            if expires_at <= now:
                value, expires_at = 0, now + max(int(ttl_seconds), 1)
            value += 1
            self._counters[key] = (value, expires_at)
            if len(self._counters) > 10000:
                for stale_key in [k for k, (_, exp) in self._counters.items() if exp <= now]:
                    self._counters.pop(stale_key, None)
            return value

    async def peek_counter(self, *, key: str) -> int | None:
        with self._lock:
            value, expires_at = self._counters.get(key, (0, 0.0))
            return value if expires_at > time.time() else 0

    def _prune_hits_if_needed(self, *, now: float, max_keys: int, max_window_seconds: int) -> None:
        if len(self._hits) <= max_keys:
            return

        stale_before = now - max_window_seconds
        removable = []
        for key, hits in self._hits.items():
            while hits and hits[0] <= stale_before:
                hits.popleft()
            if not hits:
                removable.append(key)

        for key in removable:
            self._hits.pop(key, None)

    def _prune_activity_if_needed(self, *, now: float, max_keys: int, abuse_window_seconds: int) -> None:
        if len(self._activity) <= max_keys:
            return

        stale_before = now - abuse_window_seconds
        removable = []
        for key, activity in self._activity.items():
            while activity and activity[0][0] <= stale_before:
                activity.popleft()
            if not activity:
                removable.append(key)

        for key in removable:
            self._activity.pop(key, None)
            self._signal_cooldowns.pop(key, None)


class RedisRateLimitStore(RateLimitStore):
    """Async Redis store. Every operation is fail-open (errors are logged, request allowed)."""

    backend_name = "redis"
    _ERROR_LOG_INTERVAL_SECONDS = 30.0

    def __init__(self, settings: Settings, client: Any | None = None) -> None:
        self._redis_url = str(settings.redis_url or "").strip()
        self._client: Any = client
        self._client_lock = threading.Lock()
        self._last_error_logged_at = 0.0

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        with self._client_lock:
            if self._client is None:
                import redis.asyncio as redis_asyncio

                self._client = redis_asyncio.from_url(
                    self._redis_url,
                    decode_responses=True,
                    socket_connect_timeout=1.0,
                    socket_timeout=1.0,
                    health_check_interval=30,
                )
        return self._client

    def _log_failure(self, operation: str, exc: Exception) -> None:
        now = time.time()
        if now - self._last_error_logged_at < self._ERROR_LOG_INTERVAL_SECONDS:
            return
        self._last_error_logged_at = now
        logger.error(
            "Redis rate limit backend failed; allowing request (fail-open).",
            extra={
                "event": "rate_limit_backend_error",
                "operation": operation,
                "error_type": type(exc).__name__,
            },
        )

    async def register_hit(self, *, key: str, policy: RateLimitPolicy, now: float, max_keys: int, max_window_seconds: int) -> int | None:
        try:
            client = self._get_client()
            result = await client.eval(
                _SLIDING_WINDOW_LUA,
                1,
                f"rate-limit:hits:{key}",
                repr(float(now)),
                str(int(policy.window_seconds)),
                str(int(policy.limit)),
                f"{now:.6f}:{uuid.uuid4().hex}",
            )
        except Exception as exc:  # fail-open
            self._log_failure("register_hit", exc)
            return None
        if result is None:
            return None
        try:
            return _retry_after_seconds(float(result))
        except (TypeError, ValueError):
            return policy.window_seconds

    async def register_activity(
        self,
        *,
        identity: str,
        path: str,
        now: float,
        rate_limited: bool,
        bucket_name: str,
        max_keys: int,
        abuse_window_seconds: int,
        abuse_signal_cooldown_seconds: int,
        abuse_distinct_path_threshold: int,
        abuse_rate_limit_breach_threshold: int,
    ) -> dict[str, object] | None:
        activity_key = f"rate-limit:activity:{identity}"
        payload = f"{path}|{1 if rate_limited else 0}|{uuid.uuid4().hex}"
        try:
            client = self._get_client()
            async with client.pipeline(transaction=True) as pipe:
                pipe.zremrangebyscore(activity_key, "-inf", now - abuse_window_seconds)
                pipe.zadd(activity_key, {payload: now})
                pipe.expire(activity_key, max(int(abuse_window_seconds), 1))
                pipe.zrange(activity_key, 0, -1)
                _, _, _, raw_items = await pipe.execute()
        except Exception as exc:  # fail-open
            self._log_failure("register_activity", exc)
            return None

        items = [str(item).split("|", 2) for item in raw_items or []]
        distinct_paths = len({item[0] for item in items if item})
        rate_limited_hits = sum(1 for item in items if len(item) > 1 and item[1] == "1")
        reason = _classify_abuse(
            bucket_name=bucket_name,
            distinct_paths=distinct_paths,
            rate_limited_hits=rate_limited_hits,
            abuse_distinct_path_threshold=abuse_distinct_path_threshold,
            abuse_rate_limit_breach_threshold=abuse_rate_limit_breach_threshold,
        )
        if not reason:
            return None

        cooldown_key = f"rate-limit:cooldown:{identity}:{reason}"
        try:
            acquired = await client.set(cooldown_key, "1", nx=True, ex=max(int(abuse_signal_cooldown_seconds), 1))
        except Exception as exc:  # fail-open
            self._log_failure("register_activity_cooldown", exc)
            return None
        if not acquired:
            return None

        return {
            "event": "abuse_signal",
            "reason": reason,
            "identity": identity,
            "bucket": bucket_name,
            "path": path,
            "request_count": len(items),
            "distinct_paths": distinct_paths,
            "rate_limited_hits": rate_limited_hits,
            "window_seconds": abuse_window_seconds,
        }

    async def increment_counter(self, *, key: str, ttl_seconds: int) -> int | None:
        try:
            client = self._get_client()
            value = await client.eval(_COUNTER_LUA, 1, f"rate-limit:counter:{key}", str(max(int(ttl_seconds), 1)))
            return int(value)
        except Exception as exc:  # fail-open
            self._log_failure("increment_counter", exc)
            return None

    async def peek_counter(self, *, key: str) -> int | None:
        try:
            value = await self._get_client().get(f"rate-limit:counter:{key}")
            return int(value or 0)
        except Exception as exc:  # fail-open
            self._log_failure("peek_counter", exc)
            return None

    async def close(self) -> None:
        client = self._client
        self._client = None
        if client is None:
            return
        try:
            closer = getattr(client, "aclose", None) or getattr(client, "close", None)
            if closer is not None:
                await closer()
        except Exception:
            pass


def build_rate_limit_store(settings: Settings) -> RateLimitStore:
    backend = settings.normalized_rate_limit_backend()
    if backend == "redis":
        if str(settings.redis_url or "").strip():
            return RedisRateLimitStore(settings=settings)
        logger.error(
            "RATE_LIMIT_BACKEND=redis but REDIS_URL is empty; using the per-process memory store.",
            extra={"event": "rate_limit_backend_misconfigured", "requested_backend": "redis"},
        )
    if settings.is_production():
        logger.warning(
            "In-memory rate limiting is per process and is not shared between replicas.",
            extra={"event": "rate_limit_memory_backend_in_production"},
        )
    return InMemoryRateLimitStore()


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings, store: RateLimitStore | None = None):
        super().__init__(app)
        self._enabled = bool(settings.rate_limit_enabled)
        self._public_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_public_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_public_window_seconds or 0), 1),
        )
        self._auth_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_auth_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_auth_window_seconds or 0), 1),
        )
        self._auth_sensitive_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_auth_sensitive_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_auth_sensitive_window_seconds or 0), 1),
        )
        self._admin_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_admin_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_admin_window_seconds or 0), 1),
        )
        # Job-creating AI calls (POST /api/ai/...): expensive upstream, tight budget.
        self._ai_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_ai_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_ai_window_seconds or 0), 1),
        )
        self._live_room_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_live_room_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_live_room_window_seconds or 0), 1),
        )
        self._live_token_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_live_token_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_live_token_window_seconds or 0), 1),
        )
        self._live_ip_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_live_ip_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_live_ip_window_seconds or 0), 1),
        )
        self._live_cmd_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_live_cmd_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_live_cmd_window_seconds or 0), 1),
        )
        self._invalid_code_limit = max(int(settings.live_invalid_code_limit or 0), 1)
        self._invalid_code_window_seconds = max(int(settings.live_invalid_code_window_seconds or 0), 1)
        self._max_window_seconds = max(
            self._live_cmd_policy.window_seconds,
            self._live_room_policy.window_seconds,
            self._live_token_policy.window_seconds,
            self._live_ip_policy.window_seconds,
            self._ai_policy.window_seconds,
            self._public_policy.window_seconds,
            self._auth_policy.window_seconds,
            self._auth_sensitive_policy.window_seconds,
            self._admin_policy.window_seconds,
        )
        self._max_keys = max(int(settings.rate_limit_cache_size or 0), 1000)
        self._abuse_enabled = bool(settings.abuse_signal_enabled)
        self._abuse_window_seconds = max(int(settings.abuse_signal_window_seconds or 0), 1)
        self._abuse_distinct_path_threshold = max(int(settings.abuse_distinct_path_threshold or 0), 2)
        self._abuse_rate_limit_breach_threshold = max(int(settings.abuse_rate_limit_breach_threshold or 0), 1)
        self._abuse_signal_cooldown_seconds = max(int(settings.abuse_signal_cooldown_seconds or 0), 1)
        self._store = store if store is not None else build_rate_limit_store(settings)

    @property
    def store(self) -> RateLimitStore:
        return self._store

    async def dispatch(self, request: Request, call_next) -> Response:
        if not self._enabled:
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        if path in {"/api/health"}:
            return await call_next(request)

        bucket_name, policy, scope = self._resolve_policy(
            path, request.method, request.headers.get("authorization"), request.query_params.get("token")
        )
        identity = resolve_rate_limit_identity(request)
        request.state.rate_limit_bucket = bucket_name
        request.state.identity_hint = getattr(request.state, "identity_hint", None) or resolve_request_identity(request)
        key = f"{bucket_name}:{scope or identity}"
        now = time.time()

        if bucket_name == "live_room" and await self._code_guessing_blocked(identity, scope or ""):
            return self._too_many(
                request, bucket_name, path, identity, self._invalid_code_window_seconds,
                RateLimitPolicy(self._invalid_code_limit, self._invalid_code_window_seconds),
                code="too_many_invalid_codes", message=INVALID_CODES_MESSAGE,
            )

        retry_after = await self._store.register_hit(
            key=key,
            policy=policy,
            now=now,
            max_keys=self._max_keys,
            max_window_seconds=self._max_window_seconds,
        )
        if self._abuse_enabled and bucket_name not in {"live_room", "live_token", "live_cmd"}:
            # Live buckets have their own guards (invalid codes per IP, per-token limit);
            # a join storm would make the per-IP activity scan O(n) per request.
            abuse_signal = await self._store.register_activity(
                identity=identity,
                path=path,
                now=now,
                rate_limited=retry_after is not None,
                bucket_name=bucket_name,
                max_keys=self._max_keys,
                abuse_window_seconds=self._abuse_window_seconds,
                abuse_signal_cooldown_seconds=self._abuse_signal_cooldown_seconds,
                abuse_distinct_path_threshold=self._abuse_distinct_path_threshold,
                abuse_rate_limit_breach_threshold=self._abuse_rate_limit_breach_threshold,
            )
            if abuse_signal:
                request.state.abuse_signal = abuse_signal["reason"]
                abuse_signal["request_id"] = getattr(request.state, "request_id", None)
                logger.warning("Suspicious request pattern detected", extra=abuse_signal)

        if retry_after is not None:
            return self._too_many(request, bucket_name, path, identity, retry_after, policy)

        response = await call_next(request)
        if bucket_name == "live_room":
            await self._track_room_code(identity, scope or "", response.status_code)
        return response

    async def _code_guessing_blocked(self, identity: str, room_key: str) -> bool:
        """True when this IP guessed too many invalid codes and does not already know this room.

        An address that reached a room successfully keeps access to it, so a classroom
        behind one NAT is not locked out by a few typos or by one bad actor on the network.
        """
        invalid = await self._store.peek_counter(key=f"live-invalid-code:{identity}")
        if invalid is None or invalid < self._invalid_code_limit:
            return False
        known = await self._store.peek_counter(key=f"live-known-code:{identity}:{room_key}")
        return not known

    async def _track_room_code(self, identity: str, room_key: str, status_code: int) -> None:
        if status_code == 404:
            await self._store.increment_counter(key=f"live-invalid-code:{identity}", ttl_seconds=self._invalid_code_window_seconds)
        elif 200 <= status_code < 300:
            await self._store.increment_counter(key=f"live-known-code:{identity}:{room_key}", ttl_seconds=6 * 3600)

    def _too_many(
        self,
        request: Request,
        bucket_name: str,
        path: str,
        identity: str,
        retry_after: int,
        policy: RateLimitPolicy,
        *,
        code: str = "rate_limited",
        message: str = RATE_LIMIT_MESSAGE,
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.warning(
            "Rate limit exceeded",
            extra={
                "event": "rate_limit_exceeded",
                "request_id": request_id,
                "bucket": bucket_name,
                "path": path,
                "identity": identity,
                "identity_hint": getattr(request.state, "identity_hint", None),
                "retry_after_seconds": retry_after,
                "reason": code,
            },
        )
        return JSONResponse(
            status_code=429,
            content={
                "detail": message,
                "message": message,
                "code": code,
                "details": {
                    "bucket": bucket_name,
                    "retry_after_seconds": retry_after,
                    "limit": policy.limit,
                    "window_seconds": policy.window_seconds,
                },
                "request_id": request_id,
            },
            headers={"Retry-After": str(retry_after)},
        )

    def _resolve_policy(
        self, path: str, method: str = "GET", authorization: str | None = None, query_token: str | None = None
    ) -> tuple[str, RateLimitPolicy, str | None]:
        """Bucket name, policy and key scope (``None`` = the client IP)."""
        if path in _LIVE_TRANSPORT_PATHS:
            token = str(authorization or "").removeprefix("Bearer ").strip() or str(query_token or "").strip()
            if token:
                return "live_cmd", self._live_cmd_policy, hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
            return "live_ip", self._live_ip_policy, None
        if path.startswith("/api/live/"):
            room = _LIVE_ROOM_PATH.match(path)
            if room:
                return "live_room", self._live_room_policy, "".join(room.group("code").split()).upper()
            if _LIVE_TOKEN_PATH.match(path):
                token = str(authorization or "").removeprefix("Bearer ").strip()
                if token:
                    return "live_token", self._live_token_policy, hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
                return "live_ip", self._live_ip_policy, None
            if path in _LIVE_PUBLIC_PATHS:
                return "live_ip", self._live_ip_policy, None
        if path.startswith("/api/ai/") and method == "POST" and not path.endswith(("/apply", "/suggest-format")):
            return "ai", self._ai_policy, None
        if path.startswith("/api/admin"):
            return "admin", self._admin_policy, None
        if path in AUTH_SENSITIVE_PATHS:
            return "auth_sensitive", self._auth_sensitive_policy, None
        if path.startswith("/api/auth"):
            return "auth", self._auth_policy, None
        return "public", self._public_policy, None
