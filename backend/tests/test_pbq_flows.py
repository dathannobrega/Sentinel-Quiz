"""PBQ end to end: ingest (public/private split, multi-file exam), exam and study flows
with ``pbq_count``, exam_day withholding, review, metrics/SRS and the admin document."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

BANK = Path(__file__).resolve().parents[2] / "questions" / "pbq_securityplus.json"
KEY = "device-pbq"
HEADERS = {"X-Client-Key": KEY}
PBQ_IDS = {f"sq_pbq_701_000{i}" for i in range(1, 7)}


def _mcq_bank(count: int = 6) -> dict:
    questions = []
    for index in range(count):
        questions.append({
            "id": f"mcq-{index}",
            "question": f"Qual controle mitiga o risco número {index} descrito no cenário?",
            "language": "pt-BR",
            "domain": "Security Operations",
            "difficulty": "Medium",
            "certification": "Security+",
            "options": [{"key": "A", "text": "Certo"}, {"key": "B", "text": "Errado"}],
            "correct_options": ["A"],
            "justification": "A é o controle correto.",
        })
    return {"exam": {"id": "securityplus", "title": "CompTIA Security+ - Banco de Questoes", "source": "test",
                     "certification": "Security+"}, "questions": questions}


@pytest.fixture()
def bank_dir(tmp_path):
    qdir = tmp_path / "questions"
    qdir.mkdir()
    (qdir / "securityplus.json").write_text(json.dumps(_mcq_bank(), ensure_ascii=False), encoding="utf-8")
    shutil.copy(BANK, qdir / "pbq_securityplus.json")
    (tmp_path / "material").mkdir()
    return qdir


@pytest.fixture()
def seeded(db, bank_dir):
    from app.services.ingest import ingest_questions_from_dir

    result = ingest_questions_from_dir(db, str(bank_dir), material_dir=str(bank_dir.parent / "material"))
    assert result["errors"] == [], result["errors"]
    return result


def _solutions(db, question_id):
    from app.models import Question
    from app.services.pbq_grading import parse_json_object, solutions_and_explanations

    question = db.get(Question, question_id)
    return solutions_and_explanations(parse_json_object(question.pbq_answer_json))[0]


# --------------------------------------------------------------------------- ingest

def test_ingest_splits_public_payload_and_answer_key(db, seeded):
    from app.models import Exam, Option, Question, QuestionBank, QuestionVersion

    assert seeded["questions_imported"] == 12
    exam = db.get(Exam, "securityplus")
    assert exam.question_count == 12  # union of both files
    assert exam.title == "CompTIA Security+ - Banco de Questoes"
    question = db.get(Question, "sq_pbq_701_0002")
    assert question.question_format == "pbq" and question.multi_select is False
    assert db.query(Option).filter(Option.question_id == question.id).count() == 0
    public = json.loads(question.pbq_payload_json)
    answer = json.loads(question.pbq_answer_json)
    assert "solution" not in question.pbq_payload_json
    assert public["title"].startswith("Configurar a ACL")
    assert set(answer["tasks"]) == {"t1", "t2"} and answer["points"] == 3.0
    # AI-authored PBQs ship with explanations but stay flagged for SME review.
    assert question.explanation_missing is False and question.needs_review is True
    version = db.get(QuestionVersion, db.get(QuestionBank, question.id).published_version_id)
    assert version.question_format == "pbq" and version.pbq_answer_json == question.pbq_answer_json
    assert db.get(Question, "mcq-0").question_format == "mcq"


def test_reingest_is_idempotent_and_supplement_file_removal_deactivates_pbqs(db, seeded, bank_dir):
    from app.models import Question
    from app.services.ingest import ingest_questions_from_dir

    again = ingest_questions_from_dir(db, str(bank_dir), material_dir=str(bank_dir.parent / "material"))
    assert again["imported"] == 0 and again["skipped"] == 2 and again["deactivated"] == 0

    (bank_dir / "pbq_securityplus.json").unlink()
    result = ingest_questions_from_dir(db, str(bank_dir), material_dir=str(bank_dir.parent / "material"))
    assert result["deactivated"] == 6
    assert db.get(Question, "mcq-0").is_active is True
    assert db.get(Question, "sq_pbq_701_0001").is_active is False


def test_invalid_pbq_is_reported_and_broken_file_never_deactivates(db, seeded, bank_dir):
    from app.models import Question
    from app.services.ingest import ingest_questions_from_dir

    payload = json.loads((bank_dir / "pbq_securityplus.json").read_text(encoding="utf-8"))
    payload["questions"][0]["tasks"][0]["weight"] = 0
    (bank_dir / "pbq_securityplus.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    result = ingest_questions_from_dir(db, str(bank_dir), material_dir=str(bank_dir.parent / "material"))
    assert result["rejected_invalid_pbq"] == 1
    assert any("weight must be a number > 0" in error for error in result["errors"])
    assert db.get(Question, "sq_pbq_701_0001").is_active is True  # keeps its last valid version

    (bank_dir / "pbq_securityplus.json").write_text("{ broken", encoding="utf-8")
    (bank_dir / "securityplus.json").write_text(json.dumps(_mcq_bank(5), ensure_ascii=False), encoding="utf-8")
    result = ingest_questions_from_dir(db, str(bank_dir), material_dir=str(bank_dir.parent / "material"))
    assert any(error.startswith("pbq_securityplus.json") for error in result["errors"])
    assert result["deactivated"] == 0
    assert db.get(Question, "sq_pbq_701_0003").is_active is True


def test_imports_subdirectory_is_ingested(db, bank_dir):
    from app.models import Question
    from app.services.ingest import ingest_questions_from_dir

    imports = bank_dir / "imports"
    imports.mkdir()
    extra = _mcq_bank(2)
    for question in extra["questions"]:
        question["id"] = "imp-" + question["id"]
        question["question"] = "Importada: " + question["question"]
    (imports / "example-source.json").write_text(json.dumps(extra, ensure_ascii=False), encoding="utf-8")
    result = ingest_questions_from_dir(db, str(bank_dir), material_dir=str(bank_dir.parent / "material"))
    assert result["errors"] == []
    assert db.get(Question, "imp-mcq-0") is not None
    assert result["imported"] == 3


# --------------------------------------------------------------------------- exam flow

def _start_exam(client, **extra):
    # Security Operations PBQs (0001, 0002, 0005) all have two tasks: answering only the
    # first one always yields partial credit.
    body = {"exam_id": "securityplus", "total_questions": 5, "pbq_count": 2, "domains": ["Security Operations"], **extra}
    response = client.post("/api/sessions", json=body, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def test_exam_session_places_pbqs_first_and_serves_public_payload(client, db, seeded):
    from app.models import SessionQuestion

    session = _start_exam(client)
    assert session["total_questions"] == 5
    assert session["selection_mix"]["pbq"] == 2
    rows = db.query(SessionQuestion).filter_by(session_id=session["id"]).order_by(SessionQuestion.position).all()
    assert [row.question_id in PBQ_IDS for row in rows] == [True, True, False, False, False]
    shuffled = {"sq_pbq_701_0001"}  # the only Security Operations PBQ with ordering/categorization/matching
    for row in rows[:2]:
        assert bool(row.pbq_order_json) == (row.question_id in shuffled)
    assert rows[2].pbq_order_json is None

    first = client.get(f"/api/sessions/{session['id']}/questions/0", headers=HEADERS).json()["question"]
    assert first["format"] == "pbq" and first["options"] == [] and first["pbq_response"] is None
    assert "solution" not in json.dumps(first["pbq"]) and "explanation" not in json.dumps(first["pbq"])
    again = client.get(f"/api/sessions/{session['id']}/questions/0", headers=HEADERS).json()["question"]
    assert again["pbq"] == first["pbq"]  # stable per-session shuffle
    order = json.loads(rows[0].pbq_order_json or "{}")
    for task in first["pbq"]["tasks"]:
        if task["type"] in {"ordering", "categorization"}:
            assert [item["id"] for item in task["items"]] == order[task["id"]]
        if task["type"] == "matching":
            assert [item["id"] for item in task["right"]] == order[task["id"]]
    # Ordering tasks are never served in the solution order.
    for row in rows[:2]:
        payload = client.get(f"/api/sessions/{session['id']}/questions/{row.position}", headers=HEADERS).json()
        for task in payload["question"]["pbq"]["tasks"]:
            if task["type"] == "ordering":
                assert [item["id"] for item in task["items"]] != _solutions(db, row.question_id)[task["id"]]
    mcq = client.get(f"/api/sessions/{session['id']}/questions/2", headers=HEADERS).json()["question"]
    assert mcq["format"] == "mcq" and mcq["pbq"] is None and len(mcq["options"]) == 2


def test_exam_pbq_answer_partial_credit_feedback_and_result(client, db, seeded):
    from app.models import SessionAnswer, SessionQuestion

    session = _start_exam(client)
    rows = db.query(SessionQuestion).filter_by(session_id=session["id"]).order_by(SessionQuestion.position).all()
    pbq_id = rows[0].question_id
    solutions = _solutions(db, pbq_id)
    first_task = sorted(solutions)[0]
    url = f"/api/sessions/{session['id']}/questions/{pbq_id}/response"

    bad = client.put(url, json={"question_id": pbq_id, "selected_keys": ["A"]}, headers=HEADERS)
    assert bad.status_code == 400
    bad = client.put(url, json={"question_id": pbq_id, "pbq_response": {"t9": []}}, headers=HEADERS)
    assert bad.status_code == 400
    mcq_id = rows[2].question_id
    bad = client.put(f"/api/sessions/{session['id']}/questions/{mcq_id}/response",
                     json={"question_id": mcq_id, "selected_keys": ["A"], "pbq_response": {}}, headers=HEADERS)
    assert bad.status_code == 400

    partial = {first_task: solutions[first_task]}
    feedback = client.put(url, json={"question_id": pbq_id, "pbq_response": partial}, headers=HEADERS)
    assert feedback.status_code == 200, feedback.text
    body = feedback.json()
    assert body["format"] == "pbq" and 0 < body["score"] < 1 and body["is_correct"] is False
    assert body["points_possible"] == 3.0 and body["points_earned"] == pytest.approx(body["score"] * 3, abs=0.01)
    assert {r["task_id"] for r in body["task_results"]} == set(solutions)
    assert body["pbq_solution"] == solutions and set(body["pbq_explanations"]) == set(solutions)
    assert body["pbq_response"] == partial and body["selected_keys"] == []
    assert body["wrong_count"] == 1

    state = client.get(f"/api/sessions/{session['id']}/questions/0", headers=HEADERS).json()["question"]
    assert state["is_answered"] is True and state["pbq_response"] == partial

    full = client.put(url, json={"question_id": pbq_id, "pbq_response": solutions}, headers=HEADERS).json()
    assert full["score"] == 1.0 and full["is_correct"] is True and full["correct_count"] == 1
    answer = db.query(SessionAnswer).filter_by(session_id=session["id"], question_id=pbq_id).one()
    db.refresh(answer)
    assert answer.score == 1.0 and json.loads(answer.response_json) == solutions and answer.selected_keys == ""

    second_pbq = rows[1].question_id
    second_solutions = _solutions(db, second_pbq)
    task = sorted(second_solutions)[0]
    half = client.put(f"/api/sessions/{session['id']}/questions/{second_pbq}/response",
                      json={"question_id": second_pbq, "pbq_response": {task: second_solutions[task]}},
                      headers=HEADERS).json()
    partial_score = half["score"]
    for row in rows[2:]:
        client.put(f"/api/sessions/{session['id']}/questions/{row.question_id}/response",
                   json={"question_id": row.question_id, "selected_keys": []}, headers=HEADERS)

    screen = client.get(f"/api/sessions/{session['id']}/review-screen", headers=HEADERS).json()
    assert [item["format"] for item in screen["items"]] == ["pbq", "pbq", "mcq", "mcq", "mcq"]

    result = client.post(f"/api/sessions/{session['id']}/submit", headers=HEADERS).json()
    expected = round((1.0 + partial_score) / 5 * 100, 2)
    assert result["score_percent"] == pytest.approx(expected, abs=0.01)
    assert result["correct_count"] == 1 and result["insight"]["by_type"]["pbq"]["total"] == 2

    review = client.get(f"/api/sessions/{session['id']}/review", headers=HEADERS).json()
    first = review["questions"][0]
    assert first["format"] == "pbq" and first["score"] == 1.0 and first["pbq_response"] == solutions
    assert first["pbq_solution"] == solutions and first["pbq"]["tasks"]
    assert review["questions"][1]["score"] == pytest.approx(partial_score)
    assert review["questions"][2]["format"] == "mcq"
    assert review["session"]["score_percent"] == pytest.approx(expected, abs=0.01)
    history = client.get("/api/sessions/history", headers=HEADERS).json()
    assert history[0]["score_percent"] == pytest.approx(expected, abs=0.01)


def test_exam_day_withholds_pbq_grading_until_completion(client, db, seeded):
    from app.models import ReviewQueueItem, SessionQuestion, UserExamMetricsSnapshot

    session = _start_exam(client, experience_mode="exam_day", pbq_count=1, total_questions=3)
    rows = db.query(SessionQuestion).filter_by(session_id=session["id"]).order_by(SessionQuestion.position).all()
    pbq_id = rows[0].question_id
    solutions = _solutions(db, pbq_id)
    task = sorted(solutions)[0]
    body = client.put(f"/api/sessions/{session['id']}/questions/{pbq_id}/response",
                      json={"question_id": pbq_id, "pbq_response": {task: solutions[task]}}, headers=HEADERS).json()
    assert body["format"] == "pbq" and body["is_correct"] is None
    for key in ("score", "points_earned", "task_results", "pbq_solution", "pbq_explanations", "correct_keys",
                "justification", "correct_count"):
        assert body[key] is None, key
    assert body["pbq_response"] == {task: solutions[task]}

    client.post(f"/api/sessions/{session['id']}/submit", headers=HEADERS)
    review = client.get(f"/api/sessions/{session['id']}/review", headers=HEADERS).json()
    assert review["questions"][0]["pbq_solution"] == solutions
    assert 0 < review["questions"][0]["score"] < 1
    # SRS: score < 1 -> review queue; metrics snapshot weighs the PBQ by its score.
    item = db.query(ReviewQueueItem).filter_by(client_key=KEY, question_id=pbq_id).one()
    assert item.last_outcome == "wrong"
    snapshot = db.query(UserExamMetricsSnapshot).filter_by(session_id=session["id"]).one()
    assert snapshot.score_percent == pytest.approx(review["questions"][0]["score"] / 3 * 100, abs=0.01)


def test_pbq_count_is_capped_by_available_pbqs_and_total(client, db, seeded):
    session = _start_exam(client, pbq_count=5, total_questions=3)
    assert session["total_questions"] == 3 and session["selection_mix"]["pbq"] == 3
    too_many = client.post("/api/sessions", json={"exam_id": "securityplus", "pbq_count": 6}, headers=HEADERS)
    assert too_many.status_code == 422
    plain = _start_exam(client, pbq_count=0, total_questions=12, domains=None)
    from app.models import SessionQuestion

    ids = {row.question_id for row in db.query(SessionQuestion).filter_by(session_id=plain["id"]).all()}
    assert not ids & PBQ_IDS and plain["total_questions"] == 6  # PBQs never enter the MCQ pool


# --------------------------------------------------------------------------- study flow

def test_study_session_with_pbqs(client, db, seeded):
    from app.models import ReviewQueueItem, StudyAttempt

    created = client.post("/api/study/sessions",
                          json={"exam_id": "securityplus", "total_questions": 3, "pbq_count": 1,
                                "domains": ["Security Operations"]}, headers=HEADERS)
    assert created.status_code == 200, created.text
    session = created.json()
    assert session["selection_mix"]["pbq"] == 1
    nxt = client.get(f"/api/study/sessions/{session['id']}/next", headers=HEADERS).json()
    question = nxt["question"]
    assert question["format"] == "pbq" and question["options"] == [] and question["pbq"]["tasks"]
    solutions = _solutions(db, question["id"])
    task = sorted(solutions)[0]
    hint = client.get(f"/api/study/sessions/{session['id']}/questions/{question['id']}/hint?level=3", headers=HEADERS)
    assert hint.status_code == 200, hint.text
    assert "solution" not in hint.text

    bad = client.post(f"/api/study/sessions/{session['id']}/answer",
                      json={"question_id": question["id"], "selected_keys": ["A"]}, headers=HEADERS)
    assert bad.status_code == 400
    answer = client.post(
        f"/api/study/sessions/{session['id']}/answer",
        json={"question_id": question["id"], "pbq_response": {task: solutions[task]}, "confidence_level": "medium"},
        headers=HEADERS,
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["format"] == "pbq" and 0 < body["score"] < 1 and body["is_correct"] is False
    assert body["pbq_solution"] == solutions and body["pbq_explanations"][task]
    item = db.query(ReviewQueueItem).filter_by(client_key=KEY, question_id=question["id"]).one()
    assert item.last_outcome == "wrong"  # score < 1 -> review
    attempt = db.query(StudyAttempt).filter_by(session_id=session["id"], question_id=question["id"]).one()
    assert attempt.score == body["score"]

    for _ in range(2):
        mcq = client.get(f"/api/study/sessions/{session['id']}/next", headers=HEADERS).json()["question"]
        assert mcq["format"] == "mcq"
        client.post(f"/api/study/sessions/{session['id']}/answer",
                    json={"question_id": mcq["id"], "selected_keys": [mcq["options"][0]["key"]]}, headers=HEADERS)
    review = client.get(f"/api/study/sessions/{session['id']}/review", headers=HEADERS).json()
    pbq_review = review["questions"][0]
    assert pbq_review["format"] == "pbq" and pbq_review["score"] == body["score"]
    assert pbq_review["pbq_response"] == {task: solutions[task]} and pbq_review["pbq_solution"] == solutions
    correct_mcq = sum(1 for q in review["questions"][1:] if q["is_correct"])
    assert review["result"]["score_percent"] == pytest.approx(round((body["score"] + correct_mcq) / 3 * 100, 2), abs=0.01)


def test_tutor_is_unavailable_for_pbq(login_client, db, seeded):
    from app.models import SessionQuestion

    client, _user = login_client()
    session = client.post("/api/sessions", json={"exam_id": "securityplus", "total_questions": 2, "pbq_count": 1}).json()
    pbq_id = db.query(SessionQuestion).filter_by(session_id=session["id"], position=0).one().question_id
    response = client.post(f"/api/sessions/{session['id']}/questions/{pbq_id}/tutor", json={"mode": "help"})
    assert response.status_code == 409


# --------------------------------------------------------------------------- admin

def test_admin_document_shows_pbq_read_only(login_client, seeded):
    client, _user = login_client(role="admin")
    document = client.get("/api/admin/questions/sq_pbq_701_0003")
    assert document.status_code == 200, document.text
    body = document.json()
    assert body["read_only"] is True and body["question_format"] == "pbq" and body["options"] == []
    assert body["pbq"]["tasks"][0]["type"] == "categorization"
    assert body["pbq_answer"]["tasks"]["t1"]["solution"]["assignment"]["k1"] == "prev"
    mcq = client.get("/api/admin/questions/mcq-0").json()
    assert mcq["read_only"] is False and mcq["pbq"] is None

    edit = client.post("/api/admin/questions", json={
        "id": "sq_pbq_701_0003", "exam_id": "securityplus", "prompt": "x" * 30,
        "options": [{"key": "A", "text": "a"}, {"key": "B", "text": "b"}], "correct_keys": ["A"],
    })
    assert edit.status_code == 400
    assert "read-only" in edit.text
