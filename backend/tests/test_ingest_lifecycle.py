"""Ingest regression tests (C1, M-A2, M-A3, M-A5, M-A6, M-A7). Self-contained: SQLite in memory."""
from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import create_engine, event, func, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.models import (  # noqa: E402
    DomainBlueprint,
    Exam,
    ExamSession,
    Option,
    Question,
    QuestionBank,
    QuestionVersion,
    SessionAnswer,
    StudyModule,
    User,
)
from app.services.editorial import (  # noqa: E402
    approve_question,
    delete_question_with_history,
    publish_question,
    reactivate_question,
    save_question_draft,
    submit_question_for_review,
)
from app.services.ingest import get_domain_blueprint_weights, ingest_questions_from_dir  # noqa: E402
from app.services.question_quality import FALLBACK_RATIONALE_MARKERS  # noqa: E402


def make_session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_connection, _record):  # noqa: ANN001
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    return Session(engine)


def _question(qid: str, prompt: str, *, language: str = "en", justification: str | None = "Because it is right.",
              domain: str = "General Security Concepts", correct: list[str] | None = None) -> dict:
    return {
        "id": qid,
        "question": prompt,
        "language": language,
        "multi_select": False,
        "domain": domain,
        "difficulty": "Medium",
        "certification": "Security+",
        "tags": ["t"],
        "cross_domain_tags": [],
        "question_type": "single_response",
        "cognitive_level": None,
        "format_type": "scenario_based",
        "citations": [],
        "source_materials": [],
        "question_set": None,
        "quality_score": None,
        "source_exam_id": None,
        "source_exam_title": None,
        "legacy_source_file": None,
        "options": [
            {"key": "A", "text": f"{qid} option A"},
            {"key": "B", "text": f"{qid} option B"},
            {"key": "C", "text": f"{qid} option C"},
            {"key": "D", "text": f"{qid} option D"},
        ],
        "correct_options": correct or ["A"],
        "justification": justification,
        "needs_review": False,
        "review_notes": None,
    }


def _bank(questions: list[dict], *, declared_count: int = 999) -> dict:
    return {
        "exam": {
            "id": "secplus-test",
            "title": "Security+ test bank",
            "source": "test",
            "question_count": declared_count,
            "certification": "Security+",
            "language": None,
            "schema_version": 3,
            "notes": None,
        },
        "questions": questions,
    }


class IngestTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.qdir = self.tmp / "questions"
        self.qdir.mkdir()
        self.material = self.tmp / "material"
        self.material.mkdir()
        self.db = make_session()

    def tearDown(self) -> None:
        self.db.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_bank(self, payload: dict, name: str = "bank.json") -> Path:
        path = self.qdir / name
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def ingest(self) -> dict:
        result = ingest_questions_from_dir(self.db, str(self.qdir), material_dir=str(self.material))
        self.assertEqual(result["errors"], [], result["errors"][:5])
        return result


class ReimportTests(IngestTestCase):
    def test_reimport_after_editing_real_securityplus_prompt_has_no_errors(self) -> None:
        """C1: editing one prompt and re-importing used to fail with uq_option_question_key (726 errors)."""
        source = REPO / "questions" / "securityplus.json"
        shutil.copy(source, self.qdir / "securityplus.json")
        first = self.ingest()
        self.assertEqual(first["imported"], 1)
        total = self.db.scalar(select(func.count(Question.id)))
        self.assertGreater(total, 700)
        versions_before = self.db.scalar(select(func.count(QuestionVersion.id)))

        data = json.loads((self.qdir / "securityplus.json").read_text(encoding="utf-8"))
        target = data["questions"][0]
        target["question"] = target["question"] + " (editado)"
        target["options"][1]["text"] = target["options"][1]["text"] + " v2"
        (self.qdir / "securityplus.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        second = self.ingest()
        self.assertEqual(second["imported"], 1)
        self.db.expire_all()
        question = self.db.get(Question, target["id"])
        self.assertTrue(question.prompt.endswith("(editado)"))
        option_b = self.db.execute(
            select(Option).where(Option.question_id == target["id"], Option.key == "B")
        ).scalar_one()
        self.assertTrue(option_b.text.endswith(" v2"))
        # Only the edited question got a new version.
        self.assertEqual(self.db.scalar(select(func.count(QuestionVersion.id))), versions_before + 1)

    def test_option_keys_are_updated_in_place(self) -> None:
        self.write_bank(_bank([_question("q1", "What is the first sample prompt here?")]))
        self.ingest()
        ids_before = {o.key: o.id for o in self.db.execute(select(Option).where(Option.question_id == "q1")).scalars()}

        payload = _bank([_question("q1", "What is the first sample prompt here?")])
        payload["questions"][0]["options"] = payload["questions"][0]["options"][:3]  # D removed
        payload["questions"][0]["options"][2]["text"] = "changed C"
        payload["questions"][0]["correct_options"] = ["C"]
        self.write_bank(payload)
        self.ingest()
        self.db.expire_all()
        rows = {o.key: o for o in self.db.execute(select(Option).where(Option.question_id == "q1")).scalars()}
        self.assertEqual(sorted(rows), ["A", "B", "C"])
        self.assertEqual(rows["A"].id, ids_before["A"])
        self.assertEqual(rows["C"].text, "changed C")
        self.assertTrue(rows["C"].is_correct)
        self.assertFalse(rows["A"].is_correct)

    def test_question_count_is_computed_not_trusted(self) -> None:
        self.write_bank(_bank([
            _question("q1", "What is the first sample prompt here?"),
            _question("q2", "What is the second sample prompt here?"),
        ], declared_count=995))
        self.ingest()
        self.assertEqual(self.db.get(Exam, "secplus-test").question_count, 2)


class EditorialProtectionTests(IngestTestCase):
    def _publish_editorial_edit(self, qid: str, new_prompt: str) -> None:
        admin = User(email="admin@example.com", password_hash="x", role="admin")
        self.db.add(admin)
        self.db.flush()
        payload = {
            "id": qid,
            "exam_id": "secplus-test",
            "prompt": new_prompt,
            "multi_select": False,
            "domain": "General Security Concepts",
            "difficulty": "Medium",
            "certification": "Security+",
            "tags": ["t"],
            "citations": [],
            "options": [
                {"key": "A", "text": "edited A", "is_correct": True},
                {"key": "B", "text": "edited B", "is_correct": False},
            ],
            "justification": "Editor wrote a real explanation.",
            "change_summary": "editorial fix",
        }
        save_question_draft(self.db, payload, actor_user_id=admin.id, actor_role="admin")
        submit_question_for_review(self.db, qid, actor_user_id=admin.id, actor_role="admin")
        approve_question(self.db, qid, actor_user_id=admin.id, actor_role="admin")
        publish_question(self.db, qid, actor_user_id=admin.id, actor_role="admin")
        self.db.commit()

    def test_reimport_does_not_overwrite_editorial_publication(self) -> None:
        self.write_bank(_bank([_question("q1", "What is the original imported prompt?")]))
        self.ingest()
        self._publish_editorial_edit("q1", "What is the prompt after an editor fixed it?")

        changed = _bank([_question("q1", "What is the prompt changed in the JSON file?")])
        self.write_bank(changed)
        result = self.ingest()
        self.assertEqual(result["skipped_editorial"], 1)
        self.db.expire_all()
        question = self.db.get(Question, "q1")
        self.assertEqual(question.prompt, "What is the prompt after an editor fixed it?")
        self.assertEqual(sorted(o.text for o in question.options), ["edited A", "edited B"])
        bank = self.db.get(QuestionBank, "q1")
        published = self.db.get(QuestionVersion, bank.published_version_id)
        self.assertIsNone(published.import_hash)
        self.assertIsNotNone(bank.last_import_hash)

    def test_removed_from_json_is_deactivated_and_comes_back_when_readded(self) -> None:
        q1 = _question("q1", "What is the first sample prompt here?")
        q2 = _question("q2", "What is the second sample prompt here?")
        self.write_bank(_bank([q1, q2]))
        self.ingest()

        self.write_bank(_bank([q1]))
        result = self.ingest()
        self.assertEqual(result["deactivated"], 1)
        self.db.expire_all()
        self.assertFalse(self.db.get(Question, "q2").is_active)
        self.assertEqual(self.db.get(Question, "q2").deactivated_reason, "removed_from_source")

        self.write_bank(_bank([q1, q2]))
        result = self.ingest()
        self.assertEqual(result["reactivated"], 1)
        self.db.expire_all()
        self.assertTrue(self.db.get(Question, "q2").is_active)

    def test_editorial_questions_are_not_deactivated_by_ingest(self) -> None:
        q1 = _question("q1", "What is the first sample prompt here?")
        self.write_bank(_bank([q1]))
        self.ingest()
        admin = User(email="ed@example.com", password_hash="x", role="editor")
        self.db.add(admin)
        self.db.flush()
        payload = {
            "id": "editor-only", "exam_id": "secplus-test", "prompt": "Which prompt only exists in the editor?",
            "multi_select": False, "domain": "Security Operations", "difficulty": "Easy", "certification": "Security+",
            "options": [{"key": "A", "text": "a", "is_correct": True}, {"key": "B", "text": "b", "is_correct": False}],
            "justification": "Real explanation.",
        }
        save_question_draft(self.db, payload, actor_user_id=admin.id, actor_role="admin")
        submit_question_for_review(self.db, "editor-only", actor_user_id=admin.id, actor_role="admin")
        approve_question(self.db, "editor-only", actor_user_id=admin.id, actor_role="admin")
        publish_question(self.db, "editor-only", actor_user_id=admin.id, actor_role="admin")
        self.db.commit()

        self.write_bank(_bank([q1, _question("q9", "What is a brand new imported prompt?")]))
        result = self.ingest()
        self.assertEqual(result["deactivated"], 0)
        self.assertTrue(self.db.get(Question, "editor-only").is_active)

    def test_soft_delete_keeps_history_and_is_not_resurrected(self) -> None:
        q1 = _question("q1", "What is the first sample prompt here?")
        self.write_bank(_bank([q1]))
        self.ingest()
        user = User(email="student@example.com", password_hash="x", role="student")
        self.db.add(user)
        self.db.flush()
        self.db.add(ExamSession(id="s1", user_id=user.id, exam_id="secplus-test", total_questions=1))
        self.db.flush()
        self.db.add(SessionAnswer(session_id="s1", question_id="q1", selected_keys="A", is_correct=True))
        self.db.commit()

        result = delete_question_with_history(self.db, "q1", actor_user_id=None, actor_role="admin")
        self.assertEqual(result, {"ok": True, "id": "q1", "status": "deleted"})
        self.db.commit()
        self.assertFalse(self.db.get(Question, "q1").is_active)
        self.assertEqual(self.db.scalar(select(func.count(SessionAnswer.id))), 1)
        self.assertEqual(self.db.get(QuestionBank, "q1").review_status, "archived")

        changed = copy.deepcopy(q1)
        changed["question"] = "What is the first sample prompt, changed after delete?"
        self.write_bank(_bank([changed]))
        result = self.ingest()
        self.assertEqual(result["skipped_deleted"], 1)
        self.db.expire_all()
        question = self.db.get(Question, "q1")
        self.assertFalse(question.is_active)
        self.assertEqual(question.prompt, "What is the first sample prompt here?")

        reactivate_question(self.db, "q1", actor_user_id=None, actor_role="admin")
        self.db.commit()
        self.assertTrue(self.db.get(Question, "q1").is_active)
        self.ingest()
        self.db.expire_all()
        self.assertEqual(self.db.get(Question, "q1").prompt, "What is the first sample prompt, changed after delete?")


class ContentFlagsTests(IngestTestCase):
    def test_missing_explanation_uses_localized_placeholder_and_flags(self) -> None:
        self.write_bank(_bank([
            _question("pt1", "Qual das seguintes opções descreve este cenário?", language="pt-BR", justification=None),
            _question("en1", "Which of the following best describes this scenario?", language="en", justification=""),
            _question("ok1", "Which of the following is explained correctly?", language="en"),
        ]))
        self.ingest()
        pt = self.db.get(Question, "pt1")
        en = self.db.get(Question, "en1")
        ok = self.db.get(Question, "ok1")
        self.assertEqual(pt.language, "pt-BR")
        self.assertIn(FALLBACK_RATIONALE_MARKERS["pt-BR"], pt.explanation.justification)
        self.assertIn(FALLBACK_RATIONALE_MARKERS["en"], en.explanation.justification)
        self.assertTrue(pt.explanation_missing and pt.needs_review)
        self.assertTrue(en.explanation_missing and en.needs_review)
        self.assertFalse(ok.explanation_missing or ok.needs_review)

    def test_multi_select_derived_from_answer_key(self) -> None:
        single = _question("s1", "Which single option is correct here?")
        single["multi_select"] = True
        single["question_type"] = "multiple_response"
        multi = _question("m1", "Which two options are correct here?", correct=["A", "C"])
        self.write_bank(_bank([single, multi]))
        self.ingest()
        self.assertFalse(self.db.get(Question, "s1").multi_select)
        self.assertTrue(self.db.get(Question, "m1").multi_select)


class ReferenceDataTests(IngestTestCase):
    def test_domain_weights_and_study_modules_are_loaded(self) -> None:
        shutil.copy(REPO / "material" / "Modulos_sec+.md", self.material / "Modulos_sec+.md")
        shutil.copy(REPO / "material" / "cissp_domain.json", self.material / "cissp_domain.json")
        self.write_bank(_bank([_question("q1", "What is the first sample prompt here?")]))
        result = self.ingest()
        self.assertEqual(result["study_modules"], 26 + 8)

        cissp = get_domain_blueprint_weights(self.db, "CISSP")
        secplus = get_domain_blueprint_weights(self.db, "security+")
        self.assertEqual(len(cissp), 8)
        self.assertEqual(sum(cissp.values()), 100.0)
        self.assertEqual(cissp["Security and Risk Management"], 16.0)
        self.assertEqual(secplus["Security Operations"], 28.0)
        self.assertEqual(sum(secplus.values()), 100.0)

        modules = self.db.execute(
            select(StudyModule).where(StudyModule.certification == "Security+").order_by(StudyModule.position)
        ).scalars().all()
        self.assertEqual(len(modules), 26)
        self.assertEqual((modules[0].code, modules[0].title), ("M01", "Fundamentos de Segurança"))
        self.assertIn("Principais tópicos", modules[0].description)
        cissp_modules = self.db.execute(
            select(StudyModule).where(StudyModule.certification == "CISSP").order_by(StudyModule.position)
        ).scalars().all()
        self.assertEqual([m.domain for m in cissp_modules][:2], ["Security and Risk Management", "Asset Security"])

        # Idempotent: a second run neither duplicates weights nor modules.
        self.ingest()
        self.assertEqual(self.db.scalar(select(func.count(StudyModule.id))), 34)
        self.assertEqual(
            self.db.scalar(select(func.count(DomainBlueprint.id)).where(DomainBlueprint.weight.is_not(None))), 13
        )


class StudyTrackDirTests(IngestTestCase):
    """Item 4: the study track files are found in STUDY_TRACK_DIR when material/ is empty."""

    def setUp(self) -> None:
        super().setUp()
        self.track_dir = self.tmp / "study-tracks"
        self.track_dir.mkdir()
        self.write_bank(_bank([_question("q1", "What is the first sample prompt here?")]))

    def _copy_tracks(self, target: Path, *names: str) -> None:
        for name in names or ("Modulos_sec+.md", "cissp_domain.json"):
            shutil.copy(REPO / "material" / name, target / name)

    def _module_counts(self) -> dict[str, int]:
        rows = self.db.execute(
            select(StudyModule.certification, func.count(StudyModule.id)).group_by(StudyModule.certification)
        ).all()
        return {certification: count for certification, count in rows}

    def test_empty_material_dir_falls_back_to_study_track_dir_setting(self) -> None:
        from unittest import mock

        from app.core.config import settings

        self._copy_tracks(self.track_dir)
        with mock.patch.object(settings, "study_track_dir", str(self.track_dir)):
            result = self.ingest()  # self.material exists but is empty (unpopulated volume)
        self.assertEqual(result["study_modules"], 26 + 8)
        self.assertEqual(self._module_counts(), {"CISSP": 8, "Security+": 26})
        sources = set(self.db.execute(select(StudyModule.source_file)).scalars())
        self.assertEqual(sources, {"material/Modulos_sec+.md", "material/cissp_domain.json"})

    def test_study_track_dir_wins_and_material_dir_fills_missing_files(self) -> None:
        from app.services.ingest import sync_study_modules

        self._copy_tracks(self.track_dir, "cissp_domain.json")
        self._copy_tracks(self.material, "Modulos_sec+.md")
        total = sync_study_modules(self.db, str(self.material), study_track_dir=str(self.track_dir))
        self.assertEqual(total, 26 + 8)
        self.assertEqual(self._module_counts(), {"CISSP": 8, "Security+": 26})

    def test_missing_material_dir_still_uses_study_track_dir(self) -> None:
        from app.services.ingest import sync_study_modules

        self._copy_tracks(self.track_dir)
        total = sync_study_modules(self.db, str(self.tmp / "does-not-exist"), study_track_dir=str(self.track_dir))
        self.assertEqual(total, 34)

    def test_without_any_track_file_nothing_is_synced(self) -> None:
        from unittest import mock

        from app.core.config import settings

        with mock.patch.object(settings, "study_track_dir", ""):
            result = self.ingest()
        self.assertEqual(result["study_modules"], 0)


class UnchangedReingestTests(IngestTestCase):
    """Item 6: an unchanged re-ingest checks metadata in bulk (no per-question queries)."""

    QUESTIONS = 150

    def _bank_payload(self) -> dict:
        questions = [
            _question(f"bulk-{index:04d}", f"Bulk prompt number {index} for the batched refresh check?")
            for index in range(self.QUESTIONS)
        ]
        return _bank(questions, declared_count=self.QUESTIONS)

    def _count_queries(self, fn):
        engine = self.db.get_bind()
        statements: list[str] = []

        def _before(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", _before)
        try:
            result = fn()
        finally:
            event.remove(engine, "before_cursor_execute", _before)
        return result, statements

    def test_unchanged_reingest_is_skipped_with_constant_query_count(self) -> None:
        self.write_bank(self._bank_payload())
        self.assertEqual(self.ingest()["imported"], 1)

        result, statements = self._count_queries(self.ingest)
        self.assertEqual((result["imported"], result["skipped"]), (0, 1))
        # Was ~4 queries per question (600+ here); now a handful per file + reference data.
        self.assertLess(len(statements), 60, f"{len(statements)} queries for an unchanged re-ingest")

    def test_metadata_drift_is_still_detected_with_same_file_hash(self) -> None:
        self.write_bank(self._bank_payload())
        self.ingest()
        question = self.db.get(Question, "bulk-0042")
        question.domain = "Security Operations"
        self.db.commit()

        result = self.ingest()
        self.assertEqual((result["imported"], result["skipped"]), (1, 0))
        self.db.expire_all()
        self.assertEqual(self.db.get(Question, "bulk-0042").domain, "General Security Concepts")

    def test_missing_published_version_forces_refresh(self) -> None:
        self.write_bank(self._bank_payload())
        self.ingest()
        bank = self.db.get(QuestionBank, "bulk-0007")
        bank.published_version_id = None
        self.db.commit()

        result = self.ingest()
        self.assertEqual(result["imported"], 1)
        self.db.expire_all()
        self.assertIsNotNone(self.db.get(QuestionBank, "bulk-0007").published_version_id)


if __name__ == "__main__":
    unittest.main()
