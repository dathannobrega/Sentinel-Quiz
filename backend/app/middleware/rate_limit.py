from __future__ import annotations

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
            window_seconds=max(int(settings.rate_limit_public_window_seconds or 0), 1),
        )
        self._admin_policy = RateLimitPolicy(
            limit=max(int(settings.rate_limit_admin_requests or 0), 1),
            window_seconds=max(int(settings.rate_limit_public_window_seconds or 0), 1),
        )
        self._max_keys = max(int(settings.rate_limit_cache_size or 0), 1000)
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}

    async def dispatch(self, request: Request, call_next) -> Response:
        if not self._enabled:
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        if path in {"/api/health"}:
            return await call_next(request)

        bucket_name, policy = self._resolve_policy(path)
        identity = self._resolve_identity(request)
        key = f"{bucket_name}:{identity}"
        now = time.monotonic()

        with self._lock:
            retry_after = self._register_and_check(key, policy, now)

        if retry_after is not None:
            return JSONResponse(
                status_code=429,
                content={
                    "code": "rate_limit_exceeded",
                    "message": "Too many requests. Please slow down and retry shortly.",
                    "details": f"Retry after {retry_after} second(s).",
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

    def _resolve_identity(self, request: Request) -> str:
        client_key = str(request.headers.get("x-client-key") or "").strip()
        if client_key:
            return f"client:{client_key[:64]}"

        authorization = str(request.headers.get("authorization") or "").strip()
        if authorization.lower().startswith("bearer "):
            token_hint = authorization[7:23].strip()
            if token_hint:
                return f"token:{token_hint}"

        forwarded = str(request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if forwarded:
            return f"ip:{forwarded}"

        if request.client and request.client.host:
            return f"ip:{request.client.host}"
        return "anonymous"

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
