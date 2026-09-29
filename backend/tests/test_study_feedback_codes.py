"""Study answer feedback exposes an i18n code/params next to the pt-BR fallback (M-C7)."""
from __future__ import annotations

import uuid

import pytest

HEADERS = {"X-Client-Key": "device-feedback"}


def _seed(db, count):
    from app.models import Exam, Explanation, Option, Question

    if not db.get(Exam, "secplus"):
        db.add(Exam(id="secplus", title="Security+", question_count=count))
        db.flush()
    for index in range(count):
        qid = f"fb-{uuid.uuid4().hex[:8]}-{index}"
        db.add(Question(id=qid, exam_id="secplus", prompt=f"Prompt {index}", multi_select=False, domain="General", certification="Security+"))
        db.flush()
        db.add_all([
            Option(question_id=qid, key="A", text="right", is_correct=True),
            Option(question_id=qid, key="B", text="wrong", is_correct=False),
        ])
        db.add(Explanation(question_id=qid, justification="Because."))
    db.commit()


def _answer(client, db, *, correct: bool, confidence: str):
    from app.models import StudySessionQuestion

    created = client.post("/api/study/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS)
    assert created.status_code == 200, created.text
    session_id = created.json()["id"]
    for row in db.query(StudySessionQuestion).filter_by(session_id=session_id):
        row.option_order_json = None
    db.commit()
    question = client.get(f"/api/study/sessions/{session_id}/next", headers=HEADERS).json()["question"]
    response = client.post(
        f"/api/study/sessions/{session_id}/answer",
        json={"question_id": question["id"], "selected_keys": ["A" if correct else "B"], "confidence_level": confidence},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    ("correct", "confidence", "code", "fallback"),
    [
        (False, "confident", "study_feedback.wrong_review_soon", "Erro convertido em revisão. Esta questão voltará rapidamente para reforço."),
        (True, "guess", "study_feedback.correct_low_confidence", "Acerto com baixa confiança. A revisão volta cedo para consolidar."),
        (True, "not_sure", "study_feedback.correct_medium_confidence", "Bom progresso. A revisão volta em alguns dias."),
        (True, "confident", "study_feedback.correct_high_confidence", "Alta confiança registrada. Esta questão foi empurrada para uma revisão mais espaçada."),
    ],
)
def test_study_feedback_message_has_code_params_and_accented_fallback(make_client, db, correct, confidence, code, fallback):
    _seed(db, 1)
    body = _answer(make_client(), db, correct=correct, confidence=confidence)
    insight = body["insight"]
    assert insight["message_code"] == code
    assert insight["message"] == fallback
    params = insight["message_params"]
    assert params["next_review_at"] == body["next_review_at"]
    assert params["interval_days"] >= 1
    assert params["confidence_level"] in {"low", "medium", "high"}
