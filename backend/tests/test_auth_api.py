from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models import AuthChallenge, AuthToken, User
from app.services import auth as auth_service

from conftest import TEST_PASSWORD


def _register(client, email="new.user@example.com", password=TEST_PASSWORD, **extra):
    return client.post("/api/auth/register", json={"email": email, "password": password, **extra})


@pytest.fixture()
def captured_emails(monkeypatch):
    sent: list = []

    def _capture(email):
        if email is not None:
            sent.append(email)
            return True
        return False

    monkeypatch.setattr(auth_service, "deliver_email_safely", _capture)
    import app.api.auth as auth_api

    monkeypatch.setattr(auth_api, "deliver_email_safely", _capture)
    return sent


def _token_from_email(email) -> str:
    link = next(line for line in email.body_lines if "token=" in line)
    return link.split("token=", 1)[1]


def test_register_sets_http_only_cookie_and_omits_token(client, captured_emails):
    response = _register(client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token"] is None
    assert body["user"]["email"] == "new.user@example.com"
    assert body["user"]["email_verified"] is False
    # L-B9: created_at is always an ISO string
    datetime.fromisoformat(body["user"]["created_at"])
    cookie_header = response.headers["set-cookie"]
    assert settings.auth_cookie_name in cookie_header
    assert "httponly" in cookie_header.lower()
    # verification e-mail prepared and delivered in the background
    assert len(captured_emails) == 1
    assert captured_emails[0].challenge_type == "email_verification"

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "new.user@example.com"


def test_token_returned_in_body_only_when_enabled(client, monkeypatch, make_user):
    user = make_user()
    monkeypatch.setattr(settings, "auth_return_token_in_body", True)
    response = client.post("/api/auth/login", json={"email": user.email, "password": TEST_PASSWORD})
    assert response.status_code == 200
    token = response.json()["token"]
    assert token
    client.cookies.clear()
    # Bearer header is still accepted by the backend.
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_cookie_is_secure_when_configured(client, monkeypatch, make_user):
    user = make_user()
    monkeypatch.setattr(settings, "auth_cookie_secure", True)
    response = client.post("/api/auth/login", json={"email": user.email, "password": TEST_PASSWORD})
    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()


def test_register_duplicate_email_is_generic(client, make_user, captured_emails):
    make_user("taken@example.com")
    response = _register(client, email="taken@example.com")
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "registration_unavailable"
    assert "already registered" not in body["detail"].lower()
    assert "taken@example.com" not in body["detail"]


@pytest.mark.parametrize("email", ["bad\r\nBcc: x@evil.com@example.com", "no-at-sign", "user@localhost", "a@b"])
def test_register_rejects_invalid_emails(client, email, captured_emails):
    response = _register(client, email=email)
    assert response.status_code in {400, 422}
    body = response.json()
    assert isinstance(body["detail"], str)


def test_login_invalid_credentials_same_response_for_unknown_user(client, make_user):
    user = make_user()
    wrong_password = client.post("/api/auth/login", json={"email": user.email, "password": "wrong-password"})
    unknown_user = client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "wrong-password"})
    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json()["detail"] == unknown_user.json()["detail"]
    assert wrong_password.json()["code"] == unknown_user.json()["code"] == "invalid_credentials"


def test_login_unknown_or_inactive_user_still_runs_password_hash(client, make_user, monkeypatch):
    calls: list[str] = []
    original = auth_service.verify_password

    def _spy(password, stored_hash):
        calls.append(stored_hash)
        return original(password, stored_hash)

    monkeypatch.setattr(auth_service, "verify_password", _spy)
    client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "whatever-123"})
    assert len(calls) == 1 and calls[0].startswith("scrypt$")

    inactive = make_user(active=False)
    client.post("/api/auth/login", json={"email": inactive.email, "password": TEST_PASSWORD})
    assert len(calls) == 2
    assert calls[1] != inactive.password_hash  # dummy hash, not the real one


def test_logout_revokes_token_and_clears_cookie(login_client):
    client, _user = login_client()
    assert client.get("/api/auth/me").status_code == 200
    response = client.post("/api/auth/logout")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    me = client.get("/api/auth/me")
    assert me.status_code == 401
    assert me.json()["code"] == "auth_required"


def test_me_requires_authentication(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required.", "code": "auth_required", "request_id": response.headers["x-request-id"]}


def test_last_used_at_is_throttled(login_client, db):
    client, user = login_client()
    client.get("/api/auth/me")
    token_row = db.execute(select(AuthToken).where(AuthToken.user_id == user.id)).scalar_one()
    first_seen = token_row.last_used_at
    assert first_seen is not None
    client.get("/api/auth/me")
    db.expire_all()
    token_row = db.execute(select(AuthToken).where(AuthToken.user_id == user.id)).scalar_one()
    assert token_row.last_used_at == first_seen


def test_password_reset_generic_and_single_use(client, make_user, captured_emails, db):
    user = make_user("reset.me@example.com")
    existing = client.post("/api/auth/request-password-reset", json={"email": user.email})
    missing = client.post("/api/auth/request-password-reset", json={"email": "nobody@example.com"})
    assert existing.status_code == missing.status_code == 200
    assert existing.json() == missing.json()
    assert len(captured_emails) == 1

    token = _token_from_email(captured_emails[0])
    ok = client.post("/api/auth/reset-password", json={"token": token, "new_password": "brand-new-password"})
    assert ok.status_code == 200
    reused = client.post("/api/auth/reset-password", json={"token": token, "new_password": "another-password"})
    assert reused.status_code == 400
    assert reused.json()["code"] == "http_400"

    login = client.post("/api/auth/login", json={"email": user.email, "password": "brand-new-password"})
    assert login.status_code == 200


def test_password_reset_token_expires(client, make_user, captured_emails, db):
    user = make_user()
    client.post("/api/auth/request-password-reset", json={"email": user.email})
    token = _token_from_email(captured_emails[0])
    challenge = db.execute(select(AuthChallenge).where(AuthChallenge.user_id == user.id)).scalar_one()
    challenge.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    response = client.post("/api/auth/reset-password", json={"token": token, "new_password": "brand-new-password"})
    assert response.status_code == 400


def test_password_reset_revokes_existing_sessions(login_client, captured_emails, make_client):
    client, user = login_client()
    anon = make_client()
    anon.post("/api/auth/request-password-reset", json={"email": user.email})
    token = _token_from_email(captured_emails[0])
    assert anon.post("/api/auth/reset-password", json={"token": token, "new_password": "brand-new-password"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_password_reset_smtp_failure_is_not_exposed(client, make_user, monkeypatch):
    user = make_user()
    monkeypatch.setattr(settings, "smtp_host", "smtp.invalid")
    monkeypatch.setattr(settings, "smtp_from_email", "noreply@example.com")

    def _boom(message):
        raise OSError("connection refused")

    monkeypatch.setattr(auth_service, "_send_email_message", _boom)
    existing = client.post("/api/auth/request-password-reset", json={"email": user.email})
    missing = client.post("/api/auth/request-password-reset", json={"email": "nobody@example.com"})
    assert existing.status_code == missing.status_code == 200
    assert existing.json() == missing.json()


def test_auth_links_are_never_logged(client, make_user, caplog):
    user = make_user()
    with caplog.at_level(logging.DEBUG):
        client.post("/api/auth/request-password-reset", json={"email": user.email})
    for record in caplog.records:
        rendered = record.getMessage() + " " + " ".join(str(v) for v in record.__dict__.values())
        assert "token=" not in rendered
        assert "reset-password?" not in rendered


def test_email_verification_generic_and_cooldown(client, make_user, captured_emails, db):
    user = make_user("verify.me@example.com", verified=False)
    first = client.post("/api/auth/request-email-verification", json={"email": user.email})
    second = client.post("/api/auth/request-email-verification", json={"email": user.email})
    unknown = client.post("/api/auth/request-email-verification", json={"email": "nobody@example.com"})
    assert first.json() == second.json() == unknown.json()
    # second request is inside the resend cooldown => nothing new was sent
    assert len(captured_emails) == 1
    challenges = db.execute(select(AuthChallenge).where(AuthChallenge.user_id == user.id)).scalars().all()
    assert len(challenges) == 1

    token = _token_from_email(captured_emails[0])
    verified = client.post("/api/auth/verify-email", json={"token": token})
    assert verified.status_code == 200
    body = verified.json()
    assert body["user"]["email_verified"] is True
    assert body["token"] is None
    # verify-email signs the user in (session cookie).
    assert settings.auth_cookie_name in verified.headers["set-cookie"]
    assert client.get("/api/auth/me").json()["email"] == user.email


def test_validate_email_address_rejects_header_injection():
    with pytest.raises(ValueError):
        auth_service.validate_email_address("victim@example.com\r\nBcc: attacker@example.com")
    assert auth_service.validate_email_address("  User@Example.COM ") == "user@example.com"


def test_claimed_anonymous_sessions_move_to_user(client, db, captured_emails):
    from conftest import make_exam_session, seed_question
    from app.models import ExamSession

    qid = seed_question(db)
    session_id = make_exam_session(db, question_ids=[qid], client_key="device-key-1")
    response = client.post(
        "/api/auth/register",
        json={"email": "claimer@example.com", "password": TEST_PASSWORD},
        headers={"X-Client-Key": "device-key-1"},
    )
    assert response.status_code == 200
    db.expire_all()
    session = db.get(ExamSession, session_id)
    user = db.execute(select(User).where(User.email == "claimer@example.com")).scalar_one()
    assert session.user_id == user.id and session.client_key is None
