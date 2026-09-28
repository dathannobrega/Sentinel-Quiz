"""Model-level integrity tests (M-A1, M-A3, L-A2). SQLite always; PostgreSQL when TEST_DATABASE_URL is set."""
from __future__ import annotations

import os
import sys
import unittest
import uuid
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import create_engine, event, func, select, text  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.models import (  # noqa: E402
    Exam,
    ExamSession,
    Question,
    ReviewQueueItem,
    SessionAnswer,
    SessionQuestion,
    StudyAttempt,
    StudySession,
    StudySessionQuestion,
    User,
    UserBookmark,
    UserExamMetricsSnapshot,
    UserQuestionProgress,
)
from app.services.editorial import _clean_payload  # noqa: E402

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "").strip()


def sqlite_engine():
    engine = create_engine("sqlite+pysqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_connection, _record):  # noqa: ANN001
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    return engine


class _IntegrityMixin:
    engine = None

    def make_engine(self):  # pragma: no cover - overridden
        raise NotImplementedError

    def setUp(self) -> None:
        self.engine = self.make_engine()
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.cleanup()

    def cleanup(self) -> None:
        self.engine.dispose()

    def _seed(self) -> User:
        user = User(email=f"{uuid.uuid4()}@example.com", password_hash="x", role="student")
        self.db.add_all([user, Exam(id="ex", title="Exam")])
        self.db.flush()
        self.db.add(Question(id="q1", exam_id="ex", prompt="Prompt one", multi_select=False))
        self.db.add(ExamSession(id="s1", user_id=user.id, exam_id="ex", total_questions=1))
        self.db.add(StudySession(id="st1", user_id=user.id, total_questions=1))
        self.db.flush()
        self.db.add_all([
            SessionQuestion(session_id="s1", question_id="q1", position=0, option_order_json='["B","A"]'),
            SessionAnswer(session_id="s1", question_id="q1", selected_keys="A", is_correct=True),
            StudySessionQuestion(session_id="st1", question_id="q1", position=0),
            StudyAttempt(session_id="st1", question_id="q1", selected_keys="A", is_correct=True),
            UserQuestionProgress(user_id=user.id, question_id="q1"),
            ReviewQueueItem(user_id=user.id, question_id="q1", due_at=datetime.utcnow()),
            UserBookmark(user_id=user.id, question_id="q1"),
            UserExamMetricsSnapshot(user_id=user.id, session_id="s1"),
        ])
        self.db.commit()
        return user

    def test_delete_user_with_sessions_and_progress(self) -> None:
        user = self._seed()
        self.db.delete(user)
        self.db.commit()
        for model in (ExamSession, StudySession, SessionAnswer, StudyAttempt, UserQuestionProgress, ReviewQueueItem):
            self.assertEqual(self.db.scalar(select(func.count()).select_from(model)), 0, model.__name__)
        self.assertIsNotNone(self.db.get(Question, "q1"))

    def test_delete_user_with_raw_sql(self) -> None:
        user = self._seed()
        self.db.execute(text("DELETE FROM users WHERE id = :id"), {"id": user.id})
        self.db.commit()
        self.assertEqual(self.db.scalar(select(func.count()).select_from(ExamSession)), 0)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(StudySession)), 0)

    def test_hard_delete_of_question_with_history_is_blocked(self) -> None:
        self._seed()
        with self.assertRaises(IntegrityError):
            self.db.execute(text("DELETE FROM questions WHERE id = 'q1'"))
            self.db.flush()
        self.db.rollback()

    def test_role_check_constraint(self) -> None:
        self.db.add(User(email="bad@example.com", password_hash="x", role="superuser"))
        with self.assertRaises(IntegrityError):
            self.db.flush()
        self.db.rollback()

    def test_difficulty_check_constraint(self) -> None:
        self.db.add(Exam(id="ex2", title="Exam"))
        self.db.flush()
        self.db.add(Question(id="qx", exam_id="ex2", prompt="p", multi_select=False, difficulty="easy"))
        with self.assertRaises(IntegrityError):
            self.db.flush()
        self.db.rollback()


class SqliteIntegrityTests(_IntegrityMixin, unittest.TestCase):
    def make_engine(self):
        return sqlite_engine()


@unittest.skipUnless(TEST_DATABASE_URL.startswith("postgresql"), "TEST_DATABASE_URL (PostgreSQL) not set")
class PostgresIntegrityTests(_IntegrityMixin, unittest.TestCase):
    def make_engine(self):
        self.schema = f"test_models_{uuid.uuid4().hex[:10]}"
        admin = create_engine(TEST_DATABASE_URL)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        admin.dispose()
        return create_engine(TEST_DATABASE_URL, connect_args={"options": f"-csearch_path={self.schema}"})

    def cleanup(self) -> None:
        self.engine.dispose()
        admin = create_engine(TEST_DATABASE_URL)
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE'))
        admin.dispose()


class EditorialNormalizationTests(unittest.TestCase):
    def test_difficulty_is_canonicalized_or_rejected(self) -> None:
        base = {"id": "q", "exam_id": "e", "prompt": "p", "options": []}
        self.assertEqual(_clean_payload({**base, "difficulty": "hard"})["difficulty"], "Hard")
        self.assertIsNone(_clean_payload({**base, "difficulty": " "})["difficulty"])
        with self.assertRaises(ValueError):
            _clean_payload({**base, "difficulty": "impossible"})


if __name__ == "__main__":
    unittest.main()
