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
    from app.models import DomainCatalog, Exam, Question, QuestionBank, QuestionReference, QuestionVersion
    from app.services.reference_resolver import (
        _normalize_explicit_reference_label,
        _normalize_explicit_reference_text,
        build_feedback_summary,
        build_official_reference_summaries,
    )
except ModuleNotFoundError as exc:
    DEPENDENCIES_AVAILABLE = False
    DEPENDENCY_MESSAGE = str(exc)


def make_session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


@unittest.skipUnless(DEPENDENCIES_AVAILABLE, f"Backend dependencies are unavailable in this interpreter: {DEPENDENCY_MESSAGE}")
class ReferenceResolverTests(unittest.TestCase):
    def test_domain_map_reference_uses_specific_match_and_stays_neutral(self) -> None:
        db = make_session()
        try:
            exam = Exam(id="cissp", title="CISSP")
            question = Question(
                id="q-cissp-1",
                exam_id="cissp",
                prompt="Which control best supports governance oversight?",
                multi_select=False,
                domain="Security and Risk Management",
                certification="CISSP",
            )
            bank = QuestionBank(stable_question_id="q-cissp-1", review_status="published")
            version = QuestionVersion(
                question_bank_id="q-cissp-1",
                version_number=1,
                status="published",
                exam_id="cissp",
                prompt=question.prompt,
                multi_select=False,
                domain="Security and Risk Management",
                certification="CISSP",
                subdomain="Governance",
                objective_code="1.1",
                blueprint_code="D1",
                correct_rationale="Correct Answer: B. Governance ownership stays with leadership.",
            )
            generic_catalog = DomainCatalog(
                certification="CISSP",
                domain="Security and Risk Management",
                title="Security and Risk Management",
                description="Correct Answer: A. This is leaked content from another question.",
            )
            specific_catalog = DomainCatalog(
                certification="CISSP",
                domain="Security and Risk Management",
                subdomain="Governance",
                objective_code="1.1",
                blueprint_code="D1",
                title="Governance and compliance",
                description="Formal governance concepts only.",
            )

            db.add_all([exam, question, bank, version, generic_catalog, specific_catalog])
            db.flush()
            bank.published_version_id = version.id
            db.flush()

            references = build_official_reference_summaries(db, question.id, limit=4)
        finally:
            db.close()

        domain_map = next(item for item in references if item["source_kind"] == "domain_map")
        self.assertEqual(domain_map["label"], "Dominio Governance and compliance")
        self.assertNotIn("Correct Answer", domain_map["reference"] or "")
        self.assertIn("CISSP", domain_map["reference"] or "")
        self.assertIn("1.1", domain_map["reference"] or "")

    def test_explicit_reference_text_does_not_repeat_label(self) -> None:
        reference = QuestionReference(
            question_version_id=1,
            source="Official Study Guide",
            reference="Official Study Guide",
            chapter="Chapter 5",
            locator="Section 5.1",
        )

        label = _normalize_explicit_reference_label(reference)
        reference_text = _normalize_explicit_reference_text(reference, label)

        self.assertEqual(label, "Official Study Guide")
        self.assertEqual(reference_text, "Chapter 5 | Section 5.1")

    def test_feedback_summary_strips_answer_markers(self) -> None:
        db = make_session()
        try:
            exam = Exam(id="cissp", title="CISSP")
            question = Question(
                id="q-cissp-2",
                exam_id="cissp",
                prompt="Which action reduces risk first?",
                multi_select=False,
            )
            bank = QuestionBank(stable_question_id="q-cissp-2", review_status="published")
            version = QuestionVersion(
                question_bank_id="q-cissp-2",
                version_number=1,
                status="published",
                exam_id="cissp",
                prompt=question.prompt,
                multi_select=False,
                correct_rationale=(
                    "Correct Answer: C\n"
                    "Risk treatment starts by validating the business need before selecting controls.\n"
                    "While the other options sound plausible, they skip governance approval."
                ),
            )
            db.add_all([exam, question, bank, version])
            db.flush()
            bank.published_version_id = version.id
            db.flush()

            summary = build_feedback_summary(db, question.id, is_correct=False)
        finally:
            db.close()

        self.assertTrue(summary.startswith("Revise este conceito: "))
        self.assertNotIn("Correct Answer", summary)
        self.assertNotIn("While the other options", summary)


if __name__ == "__main__":
    unittest.main()
