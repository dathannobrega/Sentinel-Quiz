from __future__ import annotations

import logging
import math
import threading
import time
from collections import deque
from dataclasses import dataclass

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import Settings
from app.middleware.observability import resolve_request_identity


logger = logging.getLogger("app.security.rate_limit")


@dataclass(frozen=True)
class RateLimitPolicy:
    limit: int
    window_seconds: int


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings):
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
        self._admin_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_admin_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_admin_window_seconds or 0), 1),
        )
        self._max_keys = max(int(settings.rate_limit_cache_size or 0), 1000)
        self._abuse_enabled = bool(settings.abuse_signal_enabled)
        self._abuse_window_seconds = max(int(settings.abuse_signal_window_seconds or 0), 1)
        self._abuse_distinct_path_threshold = max(int(settings.abuse_distinct_path_threshold or 0), 2)
        self._abuse_rate_limit_breach_threshold = max(int(settings.abuse_rate_limit_breach_threshold or 0), 1)
        self._abuse_signal_cooldown_seconds = max(int(settings.abuse_signal_cooldown_seconds or 0), 1)
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}
        self._activity: dict[str, deque[tuple[float, str, bool]]] = {}
        self._signal_cooldowns: dict[str, float] = {}

    async def dispatch(self, request: Request, call_next) -> Response:
        if not self._enabled:
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        if path in {"/api/health"}:
            return await call_next(request)

        bucket_name, policy = self._resolve_policy(path)
        identity = resolve_request_identity(request)
        request.state.rate_limit_bucket = bucket_name
        request.state.identity_hint = getattr(request.state, "identity_hint", None) or identity
        key = f"{bucket_name}:{identity}"
        now = time.monotonic()

        with self._lock:
            retry_after = self._register_and_check(key, policy, now)
            abuse_signal = self._register_activity(identity, path, now, retry_after is not None, bucket_name)

        if abuse_signal:
            request.state.abuse_signal = abuse_signal["reason"]
            abuse_signal["request_id"] = getattr(request.state, "request_id", None)
            logger.warning("Suspicious request pattern detected", extra=abuse_signal)

        if retry_after is not None:
            logger.warning(
                "Rate limit exceeded",
                extra={
                    "event": "rate_limit_exceeded",
                    "request_id": getattr(request.state, "request_id", None),
                    "bucket": bucket_name,
                    "path": path,
                    "identity": identity,
                    "retry_after_seconds": retry_after,
                },
            )
            return JSONResponse(
                status_code=429,
                content={
                    "code": "rate_limit_exceeded",
                    "message": "Too many requests. Please slow down and retry shortly.",
                    "details": f"Retry after {retry_after} second(s).",
                    "request_id": getattr(request.state, "request_id", None),
                },
                headers={"Retry-After": str(retry_after)},
            )

        return await call_next(request)

    def _resolve_policy(self, path: str) -> tuple[str, RateLimitPolicy]:
        if path.startswith("/api/admin"):
            return "admin", self._admin_policy
        if path.startswith("/api/auth"):
            return "auth", self._auth_policy
        return "public", self._public_policy

    def _register_and_check(self, key: str, policy: RateLimitPolicy, now: float) -> int | None:
        window_start = now - policy.window_seconds
        hits = self._hits.get(key)
        if hits is None:
            hits = deque()
            self._hits[key] = hits

        while hits and hits[0] <= window_start:
            hits.popleft()

        if len(hits) >= policy.limit:
            retry_after = max(policy.window_seconds - (now - hits[0]), 1)
            return int(math.ceil(retry_after))

        hits.append(now)
        self._prune_if_needed(now)
        return None

    def _register_activity(
        self,
        identity: str,
        path: str,
        now: float,
        rate_limited: bool,
        bucket_name: str,
    ) -> dict[str, object] | None:
        if not self._abuse_enabled:
            return None

        activity = self._activity.get(identity)
        if activity is None:
            activity = deque()
            self._activity[identity] = activity

        window_start = now - self._abuse_window_seconds
        while activity and activity[0][0] <= window_start:
            activity.popleft()

        activity.append((now, path, rate_limited))

        distinct_paths = len({item_path for _, item_path, _ in activity})
        rate_limited_hits = sum(1 for _, _, limited in activity if limited)

        reason = ""
        if bucket_name == "public" and distinct_paths >= self._abuse_distinct_path_threshold:
            reason = "high_path_fanout"
        elif rate_limited_hits >= self._abuse_rate_limit_breach_threshold:
            reason = "repeated_rate_limit_breach"

        signal = None
        if reason:
            last_signal_at = self._signal_cooldowns.get(identity)
            if last_signal_at is None or (now - last_signal_at) >= self._abuse_signal_cooldown_seconds:
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
                    "window_seconds": self._abuse_window_seconds,
                }

        self._prune_activity_if_needed(now)
        return signal

    def _prune_if_needed(self, now: float) -> None:
        if len(self._hits) <= self._max_keys:
            return

        stale_before = now - max(
            self._public_policy.window_seconds,
            self._auth_policy.window_seconds,
            self._admin_policy.window_seconds,
        )
        removable = []
        for key, hits in self._hits.items():
            while hits and hits[0] <= stale_before:
                hits.popleft()
            if not hits:
                removable.append(key)

        for key in removable:
            self._hits.pop(key, None)

    def _prune_activity_if_needed(self, now: float) -> None:
        if len(self._activity) <= self._max_keys:
            return

        stale_before = now - self._abuse_window_seconds
        removable = []
        for key, activity in self._activity.items():
            while activity and activity[0][0] <= stale_before:
                activity.popleft()
            if not activity:
                removable.append(key)

        for key in removable:
            self._activity.pop(key, None)
            self._signal_cooldowns.pop(key, None)
