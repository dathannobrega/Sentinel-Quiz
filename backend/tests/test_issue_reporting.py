from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEPENDENCIES_AVAILABLE = True
DEPENDENCY_MESSAGE = ""

try:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.db.base import Base
    from app.models import Exam, Question, QuestionBank, QuestionVersion, User
    from app.services.issue_reporting import (
        assign_issue_current_version,
        create_question_issue,
        update_question_issue,
    )
except ModuleNotFoundError as exc:
    DEPENDENCIES_AVAILABLE = False
    DEPENDENCY_MESSAGE = str(exc)


def make_session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


@unittest.skipUnless(DEPENDENCIES_AVAILABLE, f"Backend dependencies are unavailable in this interpreter: {DEPENDENCY_MESSAGE}")
class IssueReportingTests(unittest.TestCase):
    def test_issue_status_progression_and_version_assignment(self) -> None:
        db = make_session()
        try:
            user = User(email="admin@example.com", password_hash="hash", role="admin")
            exam = Exam(id="secplus", title="Security+")
            question = Question(id="q-1", exam_id="secplus", prompt="Test prompt", multi_select=False, domain="Domain 1")
            bank = QuestionBank(stable_question_id="q-1", review_status="published")
            version = QuestionVersion(
                question_bank_id="q-1",
                version_number=1,
                status="published",
                exam_id="secplus",
                prompt="Test prompt",
                multi_select=False,
                correct_rationale="Because.",
            )
            db.add_all([user, exam, question, bank, version])
            db.flush()
            bank.published_version_id = version.id
            db.commit()

            issue = create_question_issue(
                db,
                question_id="q-1",
                session_id=None,
                mode="study",
                category="clareza",
                message="Texto com ambiguidade na segunda linha.",
                question_version_id=None,
                owner_user_id=user.id,
                owner_client_key=None,
            )

            triaged = update_question_issue(
                db,
                issue_id=issue["id"],
                status="triaged",
                internal_note="Reproduzido por editorial.",
                actor_user_id=user.id,
            )
            self.assertEqual(triaged["status"], "triaged")
            self.assertEqual(triaged["internal_note"], "Reproduzido por editorial.")
            self.assertEqual(triaged["triaged_by_user_id"], user.id)

            assigned = assign_issue_current_version(
                db,
                issue_id=issue["id"],
                actor_user_id=user.id,
            )
            self.assertEqual(assigned["resolved_version_id"], version.id)

            released = update_question_issue(
                db,
                issue_id=issue["id"],
                status="fix_in_progress",
                actor_user_id=user.id,
            )
            released = update_question_issue(
                db,
                issue_id=issue["id"],
                status="verified",
                actor_user_id=user.id,
            )
            released = update_question_issue(
                db,
                issue_id=issue["id"],
                status="released",
                actor_user_id=user.id,
            )
            self.assertEqual(released["status"], "released")
        finally:
            db.close()

    def test_invalid_issue_transition_is_rejected(self) -> None:
        db = make_session()
        try:
            user = User(email="reviewer@example.com", password_hash="hash", role="reviewer")
            exam = Exam(id="secplus", title="Security+")
            question = Question(id="q-2", exam_id="secplus", prompt="Another prompt", multi_select=False)
            db.add_all([user, exam, question])
            db.commit()

            issue = create_question_issue(
                db,
                question_id="q-2",
                session_id=None,
                mode="study",
                category="gabarito",
                message="A alternativa correta parece inconsistente.",
                question_version_id=None,
                owner_user_id=user.id,
                owner_client_key=None,
            )

            with self.assertRaisesRegex(ValueError, "Invalid issue status transition"):
                update_question_issue(
                    db,
                    issue_id=issue["id"],
                    status="released",
                    actor_user_id=user.id,
                )
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
