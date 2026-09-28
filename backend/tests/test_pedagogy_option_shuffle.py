"""Per-session option shuffle (M-C1): display keys <-> original keys."""
from __future__ import annotations

import json
import random
import uuid

import pytest

HEADERS = {"X-Client-Key": "device-shuffle"}


def _seed(db, *, count=3, exam_id="secplus", certification="Security+", domain="General"):
    from app.models import Exam, Explanation, Option, Question

    if not db.get(Exam, exam_id):
        db.add(Exam(id=exam_id, title=exam_id, question_count=count))
        db.flush()
    ids = []
    for index in range(count):
        qid = f"{exam_id}-{uuid.uuid4().hex[:6]}-{index}"
        db.add(Question(id=qid, exam_id=exam_id, prompt=f"Prompt {index}", multi_select=False, domain=domain, certification=certification))
        db.flush()
        db.add_all([
            Option(question_id=qid, key="A", text="Option A: right answer", is_correct=True),
            Option(question_id=qid, key="B", text="wrong one", is_correct=False),
            Option(question_id=qid, key="C", text="wrong two", is_correct=False),
            Option(question_id=qid, key="D", text="wrong three", is_correct=False),
        ])
        db.add(Explanation(question_id=qid, justification="Because it is right."))
        ids.append(qid)
    db.commit()
    return ids


def _force_order(db, model, session_id, order):
    rows = db.query(model).filter(model.session_id == session_id).all()
    for row in rows:
        row.option_order_json = json.dumps(order)
    db.commit()


# ---------------------------------------------------------------- pure mapping

def test_option_mapping_round_trip():
    from app.services.option_order import OptionMapping

    mapping = OptionMapping.build(json.dumps(["C", "A", "D", "B"]), ["A", "B", "C", "D"])
    assert mapping.shuffled
    assert mapping.display_to_original == {"A": "C", "B": "A", "C": "D", "D": "B"}
    assert mapping.to_original(["B"]) == ["A"]
    assert mapping.to_original(["A", "D"]) == ["B", "C"]
    assert mapping.to_display(["A"]) == ["B"]
    options = [{"key": key, "text": f"Option {key}: text {key}"} for key in "ABCD"]
    rendered = mapping.display_options(options)
    assert [item["key"] for item in rendered] == ["A", "B", "C", "D"]
    assert [item["text"] for item in rendered] == ["text C", "text A", "text D", "text B"]
    with pytest.raises(ValueError, match="Invalid option key"):
        mapping.to_original(["Z"])


def test_option_mapping_null_order_is_identity_and_stale_order_is_ignored():
    from app.services.option_order import OptionMapping

    legacy = OptionMapping.build(None, ["B", "A", "C"])
    assert not legacy.shuffled
    assert legacy.to_original(["B"]) == ["B"]
    assert [item["key"] for item in legacy.display_options([{"key": k, "text": k} for k in "CBA"])] == ["A", "B", "C"]
    # The option set changed after the session was created: fall back to the original order.
    stale = OptionMapping.build(json.dumps(["B", "A"]), ["A", "B", "C"])
    assert not stale.shuffled


def test_generated_orders_are_permutations(db):
    from app.services.option_order import build_option_orders

    ids = _seed(db, count=5)
    orders = build_option_orders(db, ids, rng=random.Random(7))
    assert set(orders) == set(ids)
    for order in orders.values():
        assert sorted(json.loads(order)) == ["A", "B", "C", "D"]


# ---------------------------------------------------------------- exam flow

def test_exam_answers_are_graded_with_shuffled_keys(make_client, db):
    from app.models import SessionAnswer, SessionQuestion

    _seed(db, count=2)
    client = make_client()
    created = client.post("/api/sessions", json={"exam_id": "secplus", "total_questions": 2}, headers=HEADERS)
    assert created.status_code == 200, created.text
    session_id = created.json()["id"]

    stored_orders = [json.loads(row.option_order_json) for row in db.query(SessionQuestion).filter_by(session_id=session_id)]
    assert len(stored_orders) == 2 and all(sorted(order) == ["A", "B", "C", "D"] for order in stored_orders)

    _force_order(db, SessionQuestion, session_id, ["C", "A", "D", "B"])
    state = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()
    question = state["question"]
    assert [option["text"] for option in question["options"]] == ["wrong two", "right answer", "wrong three", "wrong one"]
    qid = question["id"]

    # Display "B" is the original correct "A".
    feedback = client.put(
        f"/api/sessions/{session_id}/questions/{qid}/response",
        json={"question_id": qid, "selected_keys": ["B"]},
        headers=HEADERS,
    ).json()
    assert feedback["is_correct"] is True
    assert feedback["correct_keys"] == ["B"]
    assert feedback["selected_keys"] == ["B"]
    db.expire_all()
    answer = db.query(SessionAnswer).filter_by(session_id=session_id, question_id=qid).one()
    assert answer.selected_keys == "A" and answer.is_correct is True

    # Display "A" is the original wrong "C".
    feedback = client.put(
        f"/api/sessions/{session_id}/questions/{qid}/response",
        json={"question_id": qid, "selected_keys": ["A"]},
        headers=HEADERS,
    ).json()
    assert feedback["is_correct"] is False
    assert feedback["correct_keys"] == ["B"]
    db.expire_all()
    assert db.query(SessionAnswer).filter_by(session_id=session_id, question_id=qid).one().selected_keys == "C"

    again = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()
    assert again["question"]["selected_keys"] == ["A"]
    screen = client.get(f"/api/sessions/{session_id}/review-screen", headers=HEADERS).json()
    assert screen["items"][0]["selected_keys"] == ["A"]

    submitted = client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS)
    assert submitted.status_code == 200, submitted.text
    review = client.get(f"/api/sessions/{session_id}/review", headers=HEADERS).json()
    first = next(item for item in review["questions"] if item["id"] == qid)
    assert [option["text"] for option in first["options"]] == ["wrong two", "right answer", "wrong three", "wrong one"]
    assert first["correct_keys"] == ["B"]
    assert first["selected_keys"] == ["A"]


def test_exam_rejects_unknown_display_keys(make_client, db):
    _seed(db, count=1)
    client = make_client()
    session_id = client.post("/api/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS).json()["id"]
    qid = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()["question"]["id"]
    response = client.put(
        f"/api/sessions/{session_id}/questions/{qid}/response",
        json={"question_id": qid, "selected_keys": ["Z"]},
        headers=HEADERS,
    )
    assert response.status_code == 400
    assert "Invalid option key" in response.json()["detail"]


def test_exam_day_withholds_correct_keys(make_client, db):
    _seed(db, count=1)
    client = make_client()
    session_id = client.post(
        "/api/sessions",
        json={"exam_id": "secplus", "total_questions": 1, "experience_mode": "exam_day"},
        headers=HEADERS,
    ).json()["id"]
    qid = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()["question"]["id"]
    feedback = client.put(
        f"/api/sessions/{session_id}/questions/{qid}/response",
        json={"question_id": qid, "selected_keys": ["A"]},
        headers=HEADERS,
    ).json()
    assert feedback["correct_keys"] is None


def test_legacy_exam_session_without_order_keeps_original_keys(make_client, db):
    from app.models import SessionAnswer, SessionQuestion

    _seed(db, count=1)
    client = make_client()
    session_id = client.post("/api/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS).json()["id"]
    for row in db.query(SessionQuestion).filter_by(session_id=session_id):
        row.option_order_json = None
    db.commit()
    question = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()["question"]
    assert [option["key"] for option in question["options"]] == ["A", "B", "C", "D"]
    assert question["options"][0]["text"] == "Option A: right answer"
    feedback = client.put(
        f"/api/sessions/{session_id}/questions/{question['id']}/response",
        json={"question_id": question["id"], "selected_keys": ["A"]},
        headers=HEADERS,
    ).json()
    assert feedback["is_correct"] is True and feedback["correct_keys"] == ["A"]
    db.expire_all()
    assert db.query(SessionAnswer).filter_by(session_id=session_id).one().selected_keys == "A"


# ---------------------------------------------------------------- study flow

def test_study_answers_are_graded_with_shuffled_keys(make_client, db):
    from app.models import StudyAttempt, StudySessionQuestion

    _seed(db, count=1)
    client = make_client()
    created = client.post("/api/study/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS)
    assert created.status_code == 200, created.text
    session_id = created.json()["id"]
    _force_order(db, StudySessionQuestion, session_id, ["D", "B", "A", "C"])

    question = client.get(f"/api/study/sessions/{session_id}/next", headers=HEADERS).json()["question"]
    assert [option["text"] for option in question["options"]] == ["wrong three", "wrong one", "right answer", "wrong two"]

    feedback = client.post(
        f"/api/study/sessions/{session_id}/answer",
        json={"question_id": question["id"], "selected_keys": ["C"], "confidence_level": "confident"},
        headers=HEADERS,
    )
    assert feedback.status_code == 200, feedback.text
    body = feedback.json()
    assert body["is_correct"] is True
    assert body["correct_keys"] == ["C"]
    assert body["selected_keys"] == ["C"]
    db.expire_all()
    attempt = db.query(StudyAttempt).filter_by(session_id=session_id).one()
    assert attempt.selected_keys == "A"

    review = client.get(f"/api/study/sessions/{session_id}/review", headers=HEADERS)
    assert review.status_code == 200, review.text
    item = review.json()["questions"][0]
    assert item["correct_keys"] == ["C"]
    assert item["selected_keys"] == ["C"]
    assert item["options"][2]["text"] == "right answer"
