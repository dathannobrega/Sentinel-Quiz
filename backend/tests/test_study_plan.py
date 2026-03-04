from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta
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
    from app.models import Exam, Question, ReviewQueueItem, UserDomainMetricDaily
    from app.services.study import build_study_plan
except ModuleNotFoundError as exc:
    DEPENDENCIES_AVAILABLE = False
    DEPENDENCY_MESSAGE = str(exc)


def make_session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


@unittest.skipUnless(DEPENDENCIES_AVAILABLE, f"Backend dependencies are unavailable in this interpreter: {DEPENDENCY_MESSAGE}")
class StudyPlanTests(unittest.TestCase):
    def test_plan_requires_placement_when_history_is_thin(self) -> None:
        db = make_session()
        try:
            payload = build_study_plan(
                db,
                owner_user_id=None,
                owner_client_key="device-a",
            )
        finally:
            db.close()

        self.assertTrue(payload["placement_required"])
        self.assertEqual(payload["primary_task"]["kind"], "placement")

    def test_review_backlog_beats_other_recommendations(self) -> None:
        db = make_session()
        try:
            exam = Exam(id="secplus", title="Security+")
            question = Question(id="q-1", exam_id="secplus", prompt="Prompt", multi_select=False, domain="IAM")
            metric = UserDomainMetricDaily(
                user_id=None,
                client_key="device-b",
                metric_date=datetime.utcnow(),
                exam_id="secplus",
                certification="Security+",
                domain="IAM",
                attempts_total=24,
                study_attempts=24,
                correct_count=16,
                wrong_count=8,
                low_confidence_count=6,
            )
            review_item = ReviewQueueItem(
                user_id=None,
                client_key="device-b",
                question_id="q-1",
                due_at=datetime.utcnow() - timedelta(hours=2),
                confidence_level="low",
            )
            db.add_all([exam, question, metric, review_item])
            db.commit()

            payload = build_study_plan(
                db,
                owner_user_id=None,
                owner_client_key="device-b",
            )
        finally:
            db.close()

        self.assertFalse(payload["placement_required"])
        self.assertEqual(payload["primary_task"]["kind"], "review_backlog")
        self.assertGreaterEqual(payload["review_backlog_due"], 1)


if __name__ == "__main__":
    unittest.main()
