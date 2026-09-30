"""Shared pytest configuration for backend tests.

The environment is forced to APP_ENV=test with an in-memory SQLite database (shared
through a StaticPool, see app/db/session.py) BEFORE any application module is
imported. Tests written by other workstreams are self-contained and do not depend on
the fixtures defined here.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from typing import Callable, Iterator

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_TEST_ENV = {
    "APP_ENV": "test",
    "DATABASE_URL": "sqlite://",
    "BOOTSTRAP_SCHEMA": "false",
    "INGEST_ON_STARTUP": "false",
    "AUTH_COOKIE_SECURE": "false",
    "LOG_JSON": "false",
    "LOG_LEVEL": "WARNING",
    "RATE_LIMIT_BACKEND": "memory",
    "RATE_LIMIT_PUBLIC_REQUESTS": "100000",
    "RATE_LIMIT_AUTH_REQUESTS": "100000",
    "RATE_LIMIT_AUTH_SENSITIVE_REQUESTS": "100000",
    "RATE_LIMIT_ADMIN_REQUESTS": "100000",
    "RATE_LIMIT_AI_REQUESTS": "100000",
    "ABUSE_SIGNAL_ENABLED": "false",
    "GEMINI_API_KEY": "",
    "SMTP_HOST": "",
    "SMTP_FROM_EMAIL": "",
    "TRUST_FORWARDED_FOR_HEADER": "false",
    "CORS_ORIGINS": "http://localhost:3000",
}
os.environ.update(_TEST_ENV)

import pytest  # noqa: E402

try:  # noqa: E402
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.db.base import Base
    from app.db.session import SessionLocal, engine
    from app.middleware.rate_limit import InMemoryRateLimitStore
    from app.models import User
    from app.services.auth import hash_password

    APP_AVAILABLE = True
except ModuleNotFoundError:  # pragma: no cover - dependencies missing
    APP_AVAILABLE = False


TEST_PASSWORD = "correct-horse-battery"


@pytest.fixture()
def app():
    if not APP_AVAILABLE:
        pytest.skip("backend dependencies unavailable")
    from app.main import app as fastapi_app

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    # Fresh counters (tutor quota) for every test. Request rate limits are effectively
    # disabled for the shared app via the huge limits above; rate-limit tests build
    # their own app with create_app().
    fastapi_app.state.rate_limit_store = InMemoryRateLimitStore()
    yield fastapi_app
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db(app) -> Iterator["Session"]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(app) -> Iterator["TestClient"]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def make_client(app) -> Iterator[Callable[..., "TestClient"]]:
    clients: list[TestClient] = []

    def _factory(**kwargs) -> TestClient:
        test_client = TestClient(app, **kwargs)
        test_client.__enter__()
        clients.append(test_client)
        return test_client

    yield _factory
    for test_client in clients:
        test_client.__exit__(None, None, None)


@pytest.fixture()
def make_user(db) -> Callable[..., "User"]:
    def _factory(
        email: str | None = None,
        *,
        role: str = "student",
        password: str = TEST_PASSWORD,
        verified: bool = True,
        active: bool = True,
    ) -> User:
        user = User(
            email=email or f"user-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password(password),
            role=role,
            is_active=active,
            email_verified=verified,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    return _factory


@pytest.fixture()
def login_client(make_client, make_user) -> Callable[..., tuple["TestClient", "User"]]:
    """Create a user and a TestClient already authenticated via the session cookie."""

    def _factory(role: str = "student", **user_kwargs) -> tuple[TestClient, User]:
        user = make_user(role=role, **user_kwargs)
        test_client = make_client()
        response = test_client.post(
            "/api/auth/login",
            json={"email": user.email, "password": user_kwargs.get("password", TEST_PASSWORD)},
        )
        assert response.status_code == 200, response.text
        return test_client, user

    return _factory


def seed_question(db, *, exam_id: str = "secplus", question_id: str | None = None, justification: str = "Official justification text."):
    from app.models import Exam, Explanation, Option, Question

    if not db.get(Exam, exam_id):
        db.add(Exam(id=exam_id, title="Security+", question_count=1))
        db.flush()
    qid = question_id or f"q-{uuid.uuid4().hex[:8]}"
    db.add(Question(id=qid, exam_id=exam_id, prompt="Which control mitigates phishing?", multi_select=False, domain="General", certification="Security+"))
    db.flush()
    db.add_all([
        Option(question_id=qid, key="A", text="Awareness training", is_correct=True),
        Option(question_id=qid, key="B", text="Open relay", is_correct=False),
    ])
    db.add(Explanation(question_id=qid, justification=justification))
    db.commit()
    return qid


def make_exam_session(db, *, question_ids, user_id=None, client_key=None, completed=False, answers=None, experience_mode="standard"):
    from datetime import datetime, timezone

    from app.models import ExamSession, SessionAnswer, SessionQuestion

    session = ExamSession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        client_key=client_key,
        exam_id="secplus",
        total_questions=len(question_ids),
        experience_mode=experience_mode,
        completed_at=datetime.now(timezone.utc) if completed else None,
    )
    db.add(session)
    db.flush()
    for position, qid in enumerate(question_ids):
        db.add(SessionQuestion(session_id=session.id, question_id=qid, position=position))
    for qid, (selected, is_correct) in (answers or {}).items():
        db.add(SessionAnswer(session_id=session.id, question_id=qid, selected_keys=selected, is_correct=is_correct))
    db.commit()
    return session.id


def make_study_session(db, *, question_ids, user_id=None, client_key=None):
    from app.models import StudySession, StudySessionQuestion

    session = StudySession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        client_key=client_key,
        exam_id="secplus",
        total_questions=len(question_ids),
    )
    db.add(session)
    db.flush()
    for position, qid in enumerate(question_ids):
        db.add(StudySessionQuestion(session_id=session.id, question_id=qid, position=position))
    db.commit()
    return session.id
