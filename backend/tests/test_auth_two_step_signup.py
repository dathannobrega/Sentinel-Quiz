"""M-B2 + L-B2: two-step sign-up (REGISTRATION_EMAIL_VERIFICATION)."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models import ExamSession, User
from app.services import auth as auth_service

from conftest import TEST_PASSWORD, make_exam_session, seed_question


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


@pytest.fixture()
def verification_on(monkeypatch):
    monkeypatch.setattr(settings, "registration_email_verification", True)


def _token_from_email(email) -> str:
    link = next(line for line in email.body_lines if "token=" in line)
    return link.split("token=", 1)[1]


def _register(client, email="two.step@example.com", password=TEST_PASSWORD, **kwargs):
    return client.post("/api/auth/register", json={"email": email, "password": password}, **kwargs)


# ----------------------------------------------------------------- setting default

def test_setting_defaults_to_production_only(monkeypatch):
    monkeypatch.setattr(settings, "registration_email_verification", None)
    monkeypatch.setattr(settings, "environment", "production")
    assert settings.requires_email_verification() is True
    monkeypatch.setattr(settings, "environment", "development")
    assert settings.requires_email_verification() is False
    monkeypatch.setattr(settings, "registration_email_verification", True)
    assert settings.requires_email_verification() is True


# ----------------------------------------------------------------- setting = true

def test_register_new_email_returns_202_without_cookie(client, db, captured_emails, verification_on):
    response = _register(client)
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "verification_required"
    assert body["code"] == "verification_required"
    assert isinstance(body["detail"], str) and body["detail"]
    assert "set-cookie" not in response.headers
    assert client.get("/api/auth/me").status_code == 401

    user = db.execute(select(User).where(User.email == "two.step@example.com")).scalar_one()
    assert user.email_verified is False
    assert auth_service.verify_password(TEST_PASSWORD, user.password_hash)
    assert len(captured_emails) == 1
    assert captured_emails[0].challenge_type == auth_service.EMAIL_VERIFICATION_CHALLENGE


def test_register_existing_email_is_indistinguishable(client, make_user, captured_emails, verification_on, monkeypatch):
    existing = make_user("taken@example.com", verified=True)
    hashes: list[str] = []
    real_hash = auth_service.hash_password

    def _counting_hash(password):
        hashes.append(password)
        return real_hash(password)

    import app.api.auth as auth_api

    monkeypatch.setattr(auth_api, "hash_password", _counting_hash)

    new = _register(client, "fresh@example.com")
    dup = _register(client, "taken@example.com", password="another-password-1")
    assert new.status_code == dup.status_code == 202
    assert new.json() == dup.json()
    assert "set-cookie" not in dup.headers
    # The password is hashed on both paths (same cost, no timing oracle).
    assert len(hashes) == 2
    # Existing verified account: notice e-mail, password untouched.
    notices = [email for email in captured_emails if email.to_email == "taken@example.com"]
    assert len(notices) == 1
    assert notices[0].challenge_type == auth_service.REGISTRATION_ATTEMPT_NOTICE
    assert not any("token=" in line for line in notices[0].body_lines)
    db_user = existing
    assert auth_service.verify_password(TEST_PASSWORD, db_user.password_hash)


def test_register_existing_unverified_email_resends_link_with_cooldown(client, db, captured_emails, verification_on):
    assert _register(client, "pending@example.com").status_code == 202
    assert _register(client, "pending@example.com", password="other-password-2").status_code == 202
    # Second attempt is within the resend cooldown: no second link, password unchanged.
    assert len(captured_emails) == 1
    user = db.execute(select(User).where(User.email == "pending@example.com")).scalar_one()
    assert auth_service.verify_password(TEST_PASSWORD, user.password_hash)


def test_register_validation_errors_still_400(client, captured_emails, verification_on):
    assert _register(client, "not-an-email").status_code in (400, 422)
    assert _register(client, "short@example.com", password="short").status_code in (400, 422)
    assert captured_emails == []


def test_login_unverified_correct_password_is_403_wrong_password_401(client, make_user, verification_on):
    user = make_user("unverified@example.com", verified=False)
    wrong = client.post("/api/auth/login", json={"email": user.email, "password": "wrong-password"})
    assert wrong.status_code == 401
    assert wrong.json()["code"] == "invalid_credentials"
    right = client.post("/api/auth/login", json={"email": user.email, "password": TEST_PASSWORD})
    assert right.status_code == 403
    assert right.json()["code"] == "email_not_verified"
    assert isinstance(right.json()["detail"], str)
    assert "set-cookie" not in right.headers


def test_login_verified_user_works(login_client, verification_on):
    client, user = login_client(verified=True)
    assert client.get("/api/auth/me").json()["email"] == user.email


def test_verify_email_logs_in_and_claims_anonymous_sessions(client, db, captured_emails, verification_on):
    qid = seed_question(db)
    session_id = make_exam_session(db, question_ids=[qid], client_key="device-verify")
    assert _register(client, "claim.me@example.com", headers={"X-Client-Key": "device-verify"}).status_code == 202
    db.expire_all()
    # Nothing is claimed before the address is verified.
    assert db.get(ExamSession, session_id).client_key == "device-verify"

    token = _token_from_email(captured_emails[0])
    verified = client.post("/api/auth/verify-email", json={"token": token}, headers={"X-Client-Key": "device-verify"})
    assert verified.status_code == 200, verified.text
    body = verified.json()
    assert body["token"] is None
    assert body["user"]["email"] == "claim.me@example.com"
    assert body["user"]["email_verified"] is True
    assert settings.auth_cookie_name in verified.headers["set-cookie"]
    assert client.get("/api/auth/me").json()["email"] == "claim.me@example.com"

    db.expire_all()
    session = db.get(ExamSession, session_id)
    user = db.execute(select(User).where(User.email == "claim.me@example.com")).scalar_one()
    assert session.user_id == user.id and session.client_key is None

    # Now the password login works, and the link is single-use.
    client.cookies.clear()
    login = client.post("/api/auth/login", json={"email": "claim.me@example.com", "password": TEST_PASSWORD})
    assert login.status_code == 200
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400


def test_request_email_verification_is_generic(client, make_user, captured_emails, verification_on):
    make_user("resend@example.com", verified=False)
    known = client.post("/api/auth/request-email-verification", json={"email": "resend@example.com"})
    unknown = client.post("/api/auth/request-email-verification", json={"email": "ghost@example.com"})
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert len(captured_emails) == 1


# ----------------------------------------------------------------- setting = false

def test_setting_false_keeps_immediate_signup(client, make_user, captured_emails, monkeypatch):
    monkeypatch.setattr(settings, "registration_email_verification", False)
    created = _register(client, "instant@example.com")
    assert created.status_code == 200
    assert settings.auth_cookie_name in created.headers["set-cookie"]
    assert created.json()["user"]["email_verified"] is False
    duplicate = _register(client, "instant@example.com")
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "registration_unavailable"
    # Unverified users can log in when verification is not required.
    client.cookies.clear()
    login = client.post("/api/auth/login", json={"email": "instant@example.com", "password": TEST_PASSWORD})
    assert login.status_code == 200
