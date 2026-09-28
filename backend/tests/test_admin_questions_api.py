"""Admin question lifecycle API (phase 2 / workstream F).

- soft delete ("Desativar") -> hidden from the active list -> POST .../reactivate
- list/overview filters: status=active|inactive|all, needs_review, explanation_missing
- POST /admin/ingest response keys
- GET /admin/questions/{id} and /versions are read-only (no bank seeding, no flush)
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import EditorialAuditLog, Explanation, Option, Question, QuestionBank, QuestionVersion

from conftest import seed_question


def _ids(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()]


# ------------------------------------------------------------------ reactivate
def test_deactivate_then_reactivate_flow(login_client, db):
    q1 = seed_question(db, question_id="q-life-1")
    q2 = seed_question(db, question_id="q-life-2")
    client, _admin = login_client(role="admin")

    deleted = client.delete(f"/api/admin/questions/{q1}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"ok": True, "id": q1, "status": "deleted"}

    # Default listing = active only.
    assert _ids(client.get("/api/admin/questions")) == [q2]
    inactive = client.get("/api/admin/questions", params={"status": "inactive"})
    assert _ids(inactive) == [q1]
    row = inactive.json()[0]
    assert row["is_active"] is False
    assert row["deactivated_reason"] == "deleted"
    assert sorted(_ids(client.get("/api/admin/questions", params={"status": "all"}))) == [q1, q2]

    overview = client.get("/api/admin/overview").json()
    assert overview["question_count"] == 1
    assert overview["inactive_question_count"] == 1
    assert overview["question_breakdown"] == {"Security+": 1}

    document = client.get(f"/api/admin/questions/{q1}").json()
    assert document["is_active"] is False
    assert document["deactivated_reason"] == "deleted"
    assert document["editorial_status"] == "archived"

    reactivated = client.post(f"/api/admin/questions/{q1}/reactivate", json={"reason": "Fixed the key"})
    assert reactivated.status_code == 200, reactivated.text
    assert reactivated.json() == {"ok": True, "id": q1, "status": "published"}

    assert sorted(_ids(client.get("/api/admin/questions"))) == [q1, q2]
    assert _ids(client.get("/api/admin/questions", params={"status": "inactive"})) == []
    document = client.get(f"/api/admin/questions/{q1}").json()
    assert document["is_active"] is True
    assert document["deactivated_reason"] is None
    assert document["editorial_status"] == "published"

    db.expire_all()
    question = db.get(Question, q1)
    assert question.is_active is True and question.deactivated_at is None
    actions = client.get("/api/admin/audit/logs", params={"question_id": q1}).json()
    reactivation = [item for item in actions if item["action"] == "reactivated"]
    assert reactivation and reactivation[0]["reason"] == "Fixed the key"
    assert any(item["action"] == "deleted" for item in actions)


def test_reactivate_without_body_and_errors(login_client, db):
    qid = seed_question(db, question_id="q-life-3")
    admin, _ = login_client(role="admin")
    assert admin.delete(f"/api/admin/questions/{qid}").status_code == 200
    assert admin.post(f"/api/admin/questions/{qid}/reactivate").status_code == 200

    missing = admin.post("/api/admin/questions/does-not-exist/reactivate")
    assert missing.status_code == 404
    assert missing.json()["code"] == "http_404"

    for role in ("editor", "reviewer"):
        client, _ = login_client(role=role)
        assert client.post(f"/api/admin/questions/{qid}/reactivate").status_code == 403


# ------------------------------------------------------------------ filters
def _flag(db, qid: str, *, needs_review: bool = False, explanation_missing: bool = False) -> None:
    question = db.get(Question, qid)
    question.needs_review = needs_review
    question.explanation_missing = explanation_missing
    db.commit()


def test_question_list_filters_by_editorial_flags(login_client, db):
    plain = seed_question(db, question_id="q-flag-plain")
    review = seed_question(db, question_id="q-flag-review")
    missing = seed_question(db, question_id="q-flag-missing")
    inactive = seed_question(db, question_id="q-flag-inactive")
    _flag(db, review, needs_review=True)
    _flag(db, missing, needs_review=True, explanation_missing=True)
    _flag(db, inactive, needs_review=True)
    question = db.get(Question, inactive)
    question.is_active = False
    question.deactivated_reason = "removed_from_source"
    db.commit()

    client, _ = login_client(role="editor")
    # A draft-only question (no projection yet) is listed without flag filters only.
    client.post("/api/admin/exams", json={"id": "secplus", "title": "Security+"})
    created = client.post(
        "/api/admin/questions",
        json={
            "id": "q-flag-draft",
            "exam_id": "secplus",
            "prompt": "Draft only question?",
            "options": [{"key": "A", "text": "Yes"}, {"key": "B", "text": "No"}],
            "correct_keys": ["A"],
        },
    )
    assert created.status_code == 200, created.text

    everything = client.get("/api/admin/questions").json()
    assert [item["id"] for item in everything] == [missing, plain, review, "q-flag-draft"]
    flags = {item["id"]: (item["needs_review"], item["explanation_missing"]) for item in everything}
    assert flags == {
        plain: (False, False),
        review: (True, False),
        missing: (True, True),
        "q-flag-draft": (False, False),
    }

    assert _ids(client.get("/api/admin/questions", params={"needs_review": "true"})) == [missing, review]
    assert _ids(client.get("/api/admin/questions", params={"needs_review": "false"})) == [plain]
    assert _ids(client.get("/api/admin/questions", params={"explanation_missing": "true"})) == [missing]
    assert _ids(
        client.get("/api/admin/questions", params={"needs_review": "true", "status": "all"})
    ) == [inactive, missing, review]
    assert _ids(
        client.get("/api/admin/questions", params={"needs_review": "true", "status": "inactive"})
    ) == [inactive]

    invalid = client.get("/api/admin/questions", params={"status": "deleted"})
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "validation_error"

    overview = client.get("/api/admin/overview").json()
    assert overview["question_count"] == 3
    assert overview["inactive_question_count"] == 1
    assert overview["needs_review_count"] == 2
    assert overview["explanation_missing_count"] == 1

    document = client.get(f"/api/admin/questions/{missing}").json()
    assert document["needs_review"] is True and document["explanation_missing"] is True


def test_quality_reports_placeholder_rationale(login_client, db):
    from app.services.question_quality import FALLBACK_RATIONALE_MARKERS

    qid = seed_question(db, question_id="q-placeholder", justification=f"Answer A. {FALLBACK_RATIONALE_MARKERS['en']}")
    client, _ = login_client(role="editor")
    document = client.get(f"/api/admin/questions/{qid}").json()
    assert document["quality"]["field_status"]["correct_rationale"] == "placeholder"


# ------------------------------------------------------------------ ingest
def _bank(questions: list[dict]) -> dict:
    return {
        "exam": {"id": "secplus-admin", "title": "Security+ admin test", "source": "test", "certification": "Security+"},
        "questions": questions,
    }


def _raw_question(qid: str, prompt: str, *, justification: str | None = "Because A is right.") -> dict:
    return {
        "id": qid,
        "question": prompt,
        "language": "en",
        "multi_select": False,
        "domain": "General Security Concepts",
        "difficulty": "Medium",
        "certification": "Security+",
        "tags": ["t"],
        "citations": [],
        "options": [
            {"key": "A", "text": f"{qid} option A"},
            {"key": "B", "text": f"{qid} option B"},
        ],
        "correct_options": ["A"],
        "justification": justification,
        "needs_review": False,
    }


INGEST_KEYS = {
    "imported",
    "skipped",
    "errors",
    "questions_imported",
    "skipped_deleted",
    "skipped_editorial",
    "reactivated",
    "deactivated",
    "domain_weights_updated",
    "study_modules",
}


def test_ingest_response_exposes_lifecycle_counters(login_client, db, tmp_path: Path, monkeypatch):
    qdir = tmp_path / "questions"
    qdir.mkdir()
    material = tmp_path / "material"
    material.mkdir()
    monkeypatch.setattr(settings, "question_json_dir", str(qdir))
    monkeypatch.setattr(settings, "material_dir", str(material))
    bank_file = qdir / "bank.json"

    client, _ = login_client(role="admin")
    bank_file.write_text(
        json.dumps(_bank([
            _raw_question("ing-1", "Which control mitigates phishing best?"),
            _raw_question("ing-2", "Which protocol encrypts web traffic?", justification=None),
        ])),
        encoding="utf-8",
    )
    first = client.post("/api/admin/ingest")
    assert first.status_code == 200, first.text
    body = first.json()
    assert INGEST_KEYS <= set(body)
    assert body["imported"] == 1
    assert body["questions_imported"] == 2
    assert body["errors"] == []
    assert body["domain_weights_updated"] > 0

    # The question without explanation is flagged and filterable.
    assert _ids(client.get("/api/admin/questions", params={"explanation_missing": "true"})) == ["ing-2"]
    assert _ids(client.get("/api/admin/questions", params={"needs_review": "true"})) == ["ing-2"]

    # Removed from the source file -> deactivated.
    bank_file.write_text(
        json.dumps(_bank([_raw_question("ing-1", "Which control mitigates phishing best?")])), encoding="utf-8"
    )
    second = client.post("/api/admin/ingest").json()
    assert second["deactivated"] == 1
    inactive = client.get("/api/admin/questions", params={"status": "inactive"}).json()
    assert [(item["id"], item["deactivated_reason"]) for item in inactive] == [("ing-2", "removed_from_source")]

    # Deleted by an editor -> never resurrected by the import.
    assert client.delete("/api/admin/questions/ing-1").status_code == 200
    bank_file.write_text(
        json.dumps(_bank([_raw_question("ing-1", "Which control mitigates phishing attacks best?")])),
        encoding="utf-8",
    )
    third = client.post("/api/admin/ingest").json()
    assert third["skipped_deleted"] == 1
    assert _ids(client.get("/api/admin/questions")) == []


# ------------------------------------------------------------------ read-only GETs
EDITORIAL_MODELS = (Question, Option, Explanation, QuestionBank, QuestionVersion, EditorialAuditLog)


@pytest.fixture()
def editorial_writes():
    """Records every flush that would add/change/delete editorial rows."""
    writes: list[str] = []

    def _before_flush(session, _flush_context, _instances):  # noqa: ANN001
        for obj in list(session.new) + list(session.dirty) + list(session.deleted):
            if isinstance(obj, EDITORIAL_MODELS) and (obj in session.new or session.is_modified(obj)):
                writes.append(f"{type(obj).__name__}")

    event.listen(Session, "before_flush", _before_flush)
    try:
        yield writes
    finally:
        event.remove(Session, "before_flush", _before_flush)


def _row_counts(db) -> dict[str, int]:
    db.expire_all()
    return {
        model.__tablename__: int(db.execute(select(func.count()).select_from(model)).scalar_one())
        for model in (QuestionBank, QuestionVersion, EditorialAuditLog)
    }


def test_admin_question_gets_are_read_only(login_client, db, editorial_writes):
    # A legacy projection (pre-editorial import): no question_bank row.
    qid = seed_question(db, question_id="q-legacy")
    client, _ = login_client(role="editor")
    editorial_writes.clear()  # ignore the seeding above
    before = _row_counts(db)
    assert before == {"question_bank": 0, "question_versions": 0, "editorial_audit_log": 0}

    document = client.get(f"/api/admin/questions/{qid}")
    assert document.status_code == 200, document.text
    body = document.json()
    assert body["loaded_from"] == "published"
    assert body["version_id"] is None
    assert body["correct_keys"] == ["A"]
    assert body["quality"]["field_status"]["correct_rationale"] == "ok"

    versions = client.get(f"/api/admin/questions/{qid}/versions")
    assert versions.status_code == 200
    assert versions.json() == []

    for path in ("/api/admin/questions", "/api/admin/overview", f"/api/admin/audit/logs?question_id={qid}"):
        assert client.get(path).status_code == 200

    assert client.get("/api/admin/questions/unknown").status_code == 404
    assert editorial_writes == []
    assert _row_counts(db) == before

    # Write paths still seed the bank from the projection when needed.
    assert client.post(f"/api/admin/questions/{qid}/submit-review", json={}).status_code in {200, 400}


def test_admin_question_get_with_draft_is_read_only(login_client, db, editorial_writes):
    client, _ = login_client(role="editor")
    client.post("/api/admin/exams", json={"id": "secplus", "title": "Security+"})
    created = client.post(
        "/api/admin/questions",
        json={
            "id": "q-draft-ro",
            "exam_id": "secplus",
            "prompt": "What does MFA stand for?",
            "options": [{"key": "A", "text": "Multi-factor"}, {"key": "B", "text": "Single"}],
            "correct_keys": ["A"],
        },
    )
    assert created.status_code == 200, created.text
    editorial_writes.clear()
    before = _row_counts(db)

    document = client.get("/api/admin/questions/q-draft-ro").json()
    assert document["loaded_from"] == "draft"
    assert document["is_active"] is True
    versions = client.get("/api/admin/questions/q-draft-ro/versions").json()
    assert [item["status"] for item in versions] == ["draft"]

    assert editorial_writes == []
    assert _row_counts(db) == before
