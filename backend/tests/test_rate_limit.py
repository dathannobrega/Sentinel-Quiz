from __future__ import annotations

import asyncio
import logging
import time

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.core.config import Settings
from app.middleware.observability import resolve_client_ip
from app.middleware.rate_limit import (
    InMemoryRateLimitStore,
    RateLimitPolicy,
    RedisRateLimitStore,
    build_rate_limit_store,
)


def _limited_app(**overrides):
    from app.main import create_app

    values = {
        "_env_file": None,
        "RATE_LIMIT_PUBLIC_REQUESTS": 2,
        "RATE_LIMIT_PUBLIC_WINDOW_SECONDS": 60,
        "RATE_LIMIT_AUTH_SENSITIVE_REQUESTS": 2,
        "ABUSE_SIGNAL_ENABLED": False,
        "CORS_ORIGINS": "http://localhost:3000",
    }
    values.update(overrides)
    return create_app(Settings(**values))


def _request(headers: dict[str, str], client_host: str = "10.0.0.2") -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/exams",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (client_host, 1234),
        "query_string": b"",
    }
    return Request(scope)


# ------------------------------------------------------------------ client IP
def test_forwarded_headers_ignored_unless_trusted():
    request = _request({"X-Forwarded-For": "6.6.6.6"})
    assert resolve_client_ip(request, trust_forwarded=False) == "10.0.0.2"


def test_rightmost_forwarded_entry_is_used_when_trusted():
    request = _request({"X-Forwarded-For": "6.6.6.6, 203.0.113.9"})
    assert resolve_client_ip(request, trust_forwarded=True) == "203.0.113.9"


def test_real_ip_fallback_and_invalid_values():
    assert resolve_client_ip(_request({"X-Real-IP": "198.51.100.7"}), trust_forwarded=True) == "198.51.100.7"
    assert resolve_client_ip(_request({"X-Forwarded-For": "not-an-ip"}), trust_forwarded=True) == "10.0.0.2"


def test_forged_leftmost_xff_cannot_change_identity(app):
    limited = _limited_app(TRUST_FORWARDED_FOR_HEADER=True)
    with TestClient(limited) as client:
        statuses = [
            client.get("/api/exams", headers={"X-Forwarded-For": f"1.2.3.{i}, 203.0.113.50"}).status_code
            for i in range(4)
        ]
    assert statuses[:2] == [200, 200]
    assert statuses[2:] == [429, 429]


def test_xff_ignored_when_not_trusted(app):
    limited = _limited_app(TRUST_FORWARDED_FOR_HEADER=False)
    with TestClient(limited) as client:
        statuses = [
            client.get("/api/exams", headers={"X-Forwarded-For": f"9.9.9.{i}"}).status_code for i in range(3)
        ]
    assert statuses == [200, 200, 429]


# ------------------------------------------------------------ 429 contract
def test_429_envelope_has_retry_after_and_cors_headers(app):
    limited = _limited_app()
    with TestClient(limited) as client:
        for _ in range(2):
            client.get("/api/exams", headers={"Origin": "http://localhost:3000"})
        response = client.get("/api/exams", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 429
    body = response.json()
    assert body["code"] == "rate_limited"
    assert body["detail"] == body["message"]
    assert isinstance(body["details"], dict)
    assert body["request_id"] == response.headers["x-request-id"]
    assert int(response.headers["retry-after"]) >= 1
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    exposed = response.headers["access-control-expose-headers"].lower()
    for header in ("retry-after", "content-disposition", "x-request-id"):
        assert header in exposed


def test_preflight_requests_are_not_rate_limited(app):
    limited = _limited_app()
    preflight_headers = {
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
    }
    with TestClient(limited) as client:
        for _ in range(5):
            assert client.options("/api/exams", headers=preflight_headers).status_code == 200
        assert client.get("/api/exams").status_code == 200


def test_sensitive_auth_bucket_is_separate(app):
    limited = _limited_app(RATE_LIMIT_PUBLIC_REQUESTS=100)
    with TestClient(limited) as client:
        statuses = [
            client.post("/api/auth/login", json={"email": "a@example.com", "password": "x"}).status_code
            for _ in range(3)
        ]
        assert client.get("/api/exams").status_code == 200
    assert statuses[:2] == [401, 401]
    assert statuses[2] == 429


# ------------------------------------------------------------------- stores
def test_memory_store_sliding_window_uses_wall_clock():
    store = InMemoryRateLimitStore()
    policy = RateLimitPolicy(limit=1, window_seconds=10)
    now = time.time()
    assert asyncio.run(store.register_hit(key="k", policy=policy, now=now, max_keys=1000, max_window_seconds=10)) is None
    retry = asyncio.run(store.register_hit(key="k", policy=policy, now=now + 1, max_keys=1000, max_window_seconds=10))
    assert retry == 9
    assert asyncio.run(store.register_hit(key="k", policy=policy, now=now + 11, max_keys=1000, max_window_seconds=10)) is None


def test_memory_store_counter_expires():
    store = InMemoryRateLimitStore()
    assert asyncio.run(store.increment_counter(key="c", ttl_seconds=60)) == 1
    assert asyncio.run(store.increment_counter(key="c", ttl_seconds=60)) == 2


def test_redis_store_is_fail_open_and_logs(caplog):
    settings = Settings(_env_file=None, RATE_LIMIT_BACKEND="redis", REDIS_URL="redis://127.0.0.1:6399/9")
    store = build_rate_limit_store(settings)
    assert isinstance(store, RedisRateLimitStore)

    async def _exercise():
        policy = RateLimitPolicy(limit=1, window_seconds=10)
        first = await store.register_hit(key="k", policy=policy, now=time.time(), max_keys=1000, max_window_seconds=10)
        counter = await store.increment_counter(key="c", ttl_seconds=10)
        await store.close()
        return first, counter

    with caplog.at_level(logging.ERROR, logger="app.security.rate_limit"):
        first, counter = asyncio.run(_exercise())
    assert first is None and counter is None
    assert any(getattr(r, "event", "") == "rate_limit_backend_error" for r in caplog.records)


def test_production_requires_redis_unless_overridden():
    base = {
        "_env_file": None,
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql+psycopg://sentinel:Str0ng-Secret@db:5432/sentinel_quiz",
        "CORS_ORIGINS": "https://quiz.example.com",
        "AUTH_COOKIE_SECURE": True,
    }
    with pytest.raises(ValueError, match="RATE_LIMIT_BACKEND=redis"):
        Settings(**base, RATE_LIMIT_BACKEND="memory").validate_runtime()
    Settings(**base, RATE_LIMIT_BACKEND="memory", RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION=True).validate_runtime()
    Settings(**base, RATE_LIMIT_BACKEND="redis", REDIS_URL="redis://redis:6379/0").validate_runtime()
