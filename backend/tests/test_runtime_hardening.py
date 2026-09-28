from __future__ import annotations

import logging

import pytest

from app.core.config import Settings
from app.middleware.rate_limit import InMemoryRateLimitStore, RateLimitMiddleware, RedisRateLimitStore
from app.services import auth as auth_service
from app.services.auth import _deliver_auth_email, settings as auth_settings


STRONG_PROD = {
    "_env_file": None,
    "APP_ENV": "production",
    "DATABASE_URL": "postgresql+psycopg://sentinel:Str0ng-Secret@db:5432/sentinel_quiz",
    "RATE_LIMIT_BACKEND": "redis",
    "REDIS_URL": "redis://redis:6379/0",
    "CORS_ORIGINS": "https://quiz.example.com",
    "AUTH_COOKIE_SECURE": True,
    "BOOTSTRAP_SCHEMA": False,
}


def test_production_auth_email_requires_smtp(monkeypatch):
    monkeypatch.setattr(auth_settings, "environment", "production")
    monkeypatch.setattr(auth_settings, "smtp_host", "")
    monkeypatch.setattr(auth_settings, "smtp_from_email", "")
    with pytest.raises(RuntimeError):
        _deliver_auth_email(
            to_email="user@example.com",
            subject="Reset",
            body_lines=["line"],
            fallback_log_context={"challenge_type": "password_reset", "challenge_id": 1},
        )


def test_development_without_smtp_does_not_log_links(monkeypatch, caplog):
    monkeypatch.setattr(auth_settings, "environment", "development")
    monkeypatch.setattr(auth_settings, "smtp_host", "")
    with caplog.at_level(logging.DEBUG):
        _deliver_auth_email(
            to_email="user@example.com",
            subject="Reset",
            body_lines=["http://127.0.0.1:3000/reset-password?token=SECRET"],
            fallback_log_context={
                "challenge_type": "password_reset",
                "challenge_id": 7,
                "reset_url": "http://127.0.0.1:3000/reset-password?token=SECRET",
            },
        )
    rendered = " ".join(record.getMessage() + str(record.__dict__) for record in caplog.records)
    assert "SECRET" not in rendered
    assert "user@example.com" not in rendered


def test_delivery_failures_are_swallowed(monkeypatch):
    def _boom(**kwargs):
        raise OSError("smtp down")

    monkeypatch.setattr(auth_service, "_deliver_auth_email", _boom)
    email = auth_service.OutgoingEmail(to_email="a@example.com", subject="s", body_lines=("x",), challenge_type="password_reset")
    assert auth_service.deliver_email_safely(email) is False


def test_rate_limit_redis_backend_uses_async_store_without_silent_fallback():
    async def app(scope, receive, send):
        return None

    settings = Settings(_env_file=None, RATE_LIMIT_BACKEND="redis", REDIS_URL="redis://127.0.0.1:6399/9")
    middleware = RateLimitMiddleware(app, settings=settings)
    assert isinstance(middleware.store, RedisRateLimitStore)

    memory = RateLimitMiddleware(app, settings=Settings(_env_file=None, RATE_LIMIT_BACKEND="memory"))
    assert isinstance(memory.store, InMemoryRateLimitStore)


def test_app_env_defaults_to_production(monkeypatch):
    for name in ("APP_ENV", "AUTH_COOKIE_SECURE", "BOOTSTRAP_SCHEMA", "EXPOSE_API_DOCS"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    assert settings.environment == "production"
    assert settings.is_production() is True
    assert settings.api_docs_enabled() is False
    assert settings.auth_cookie_secure is True
    assert settings.bootstrap_schema is False


@pytest.mark.parametrize("env", ["test", "development", "dev", "local"])
def test_non_production_environments(env):
    assert Settings(_env_file=None, APP_ENV=env).is_production() is False


def test_unknown_environment_fails_closed():
    assert Settings(_env_file=None, APP_ENV="staging").is_production() is True


def test_strong_production_configuration_is_accepted():
    Settings(**STRONG_PROD).validate_runtime()


@pytest.mark.parametrize(
    "override,expected",
    [
        ({"DATABASE_URL": "sqlite:///./prod.db"}, "SQLite"),
        ({"DATABASE_URL": "postgresql+psycopg://sentinel:sentinel@db:5432/sentinel_quiz"}, "password"),
        ({"BOOTSTRAP_SCHEMA": True}, "BOOTSTRAP_SCHEMA"),
        ({"CORS_ORIGINS": "*"}, "CORS_ORIGINS"),
        ({"CORS_ORIGINS": "https://quiz.example.com,*"}, "CORS_ORIGINS"),
        ({"AUTH_COOKIE_SECURE": False}, "AUTH_COOKIE_SECURE"),
        ({"RATE_LIMIT_BACKEND": "memory"}, "RATE_LIMIT_BACKEND"),
        ({"AUTH_COOKIE_SAMESITE": "bogus"}, "AUTH_COOKIE_SAMESITE"),
    ],
)
def test_production_rejects_unsafe_configuration(override, expected):
    values = {**STRONG_PROD, **override}
    with pytest.raises(ValueError, match=expected):
        Settings(**values).validate_runtime()


def test_cookie_insecure_only_outside_production():
    assert Settings(_env_file=None, APP_ENV="development", AUTH_COOKIE_SECURE=False).effective_cookie_secure() is False
    prod = Settings(**{**STRONG_PROD, "AUTH_COOKIE_SECURE": False})
    assert prod.effective_cookie_secure() is True


def test_pool_settings_are_applied_for_server_databases():
    from app.db.session import build_engine_kwargs

    kwargs = build_engine_kwargs("postgresql+psycopg://u:p@db/x")
    assert kwargs["pool_size"] == 10 and kwargs["max_overflow"] == 10 and kwargs["pool_timeout"] == 10
    assert kwargs["pool_pre_ping"] is True
    sqlite_kwargs = build_engine_kwargs("sqlite://")
    assert "pool_size" not in sqlite_kwargs


def test_get_db_rolls_back_on_error():
    from app.db import session as db_session

    events: list[str] = []

    class FakeSession:
        def rollback(self):
            events.append("rollback")

        def close(self):
            events.append("close")

        def commit(self):  # pragma: no cover - must never be called implicitly
            events.append("commit")

    original = db_session.SessionLocal
    db_session.SessionLocal = FakeSession
    try:
        generator = db_session.get_db()
        next(generator)
        with pytest.raises(RuntimeError):
            generator.throw(RuntimeError("boom"))
        ok_generator = db_session.get_db()
        next(ok_generator)
        with pytest.raises(StopIteration):
            next(ok_generator)
    finally:
        db_session.SessionLocal = original
    assert events == ["rollback", "close", "close"]
