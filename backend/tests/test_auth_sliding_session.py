"""Sliding session renewal (L-B1): AUTH_SLIDING_SESSION extends tokens past half-life."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select

from app.core.config import settings
from app.models import AuthToken

from conftest import TEST_PASSWORD


def _token_row(db, user):
    db.expire_all()
    return db.execute(select(AuthToken).where(AuthToken.user_id == user.id)).scalar_one()


def _age_token(db, user, *, remaining: timedelta, last_used_ago: timedelta | None = None):
    row = _token_row(db, user)
    now = datetime.utcnow()
    row.expires_at = now + remaining
    row.last_used_at = None if last_used_ago is None else now - last_used_ago
    db.commit()


def _ttl() -> timedelta:
    return timedelta(hours=max(int(settings.auth_token_ttl_hours), 1))


def test_token_past_half_life_is_extended_and_cookie_refreshed(login_client, db):
    client, user = login_client()
    _age_token(db, user, remaining=_ttl() / 2 - timedelta(hours=1))

    response = client.get("/api/auth/me")
    assert response.status_code == 200
    row = _token_row(db, user)
    assert row.expires_at >= datetime.utcnow() + _ttl() - timedelta(minutes=5)
    set_cookie = response.headers.get("set-cookie", "")
    assert settings.auth_cookie_name in set_cookie
    assert "httponly" in set_cookie.lower()


def test_token_before_half_life_is_not_extended(login_client, db):
    client, user = login_client()
    _age_token(db, user, remaining=_ttl() / 2 + timedelta(hours=1))
    before = _token_row(db, user).expires_at

    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert _token_row(db, user).expires_at == before
    assert settings.auth_cookie_name not in response.headers.get("set-cookie", "")


def test_renewal_shares_the_last_used_throttle(login_client, db):
    client, user = login_client()
    # Past half-life, but last_used_at was written inside the throttle window: no write.
    _age_token(db, user, remaining=timedelta(hours=1), last_used_ago=timedelta(seconds=5))
    before = _token_row(db, user).expires_at

    assert client.get("/api/auth/me").status_code == 200
    assert _token_row(db, user).expires_at == before


def test_sliding_session_can_be_disabled(login_client, db, monkeypatch):
    monkeypatch.setattr(settings, "auth_sliding_session", False)
    client, user = login_client()
    _age_token(db, user, remaining=timedelta(hours=1))
    before = _token_row(db, user).expires_at

    assert client.get("/api/auth/me").status_code == 200
    row = _token_row(db, user)
    assert row.expires_at == before
    assert row.last_used_at is not None


def test_bearer_token_is_extended_without_setting_cookie(client, db, make_user, monkeypatch):
    monkeypatch.setattr(settings, "auth_return_token_in_body", True)
    user = make_user()
    token = client.post("/api/auth/login", json={"email": user.email, "password": TEST_PASSWORD}).json()["token"]
    client.cookies.clear()
    _age_token(db, user, remaining=timedelta(hours=1))

    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert _token_row(db, user).expires_at >= datetime.utcnow() + _ttl() - timedelta(minutes=5)
    assert settings.auth_cookie_name not in response.headers.get("set-cookie", "")


def test_expired_token_is_never_revived(login_client, db):
    client, user = login_client()
    _age_token(db, user, remaining=timedelta(seconds=-1))
    assert client.get("/api/auth/me").status_code == 401
