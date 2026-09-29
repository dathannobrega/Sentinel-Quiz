"""Exam finalisation (M-C2), pass thresholds (M-C3), blueprint weights (M-A6),
per-certification quotas (M-C5) and question version tracking (M-A3)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

HEADERS = {"X-Client-Key": "device-exam"}


def _seed(db, *, count=2, exam_id="secplus", certification="Security+", domain="General", with_version=False):
    from app.models import Exam, Explanation, Option, Question, QuestionBank, QuestionVersion

    if not db.get(Exam, exam_id):
        db.add(Exam(id=exam_id, title=exam_id, question_count=count))
        db.flush()
    ids = []
    for index in range(count):
        qid = f"{exam_id}-{uuid.uuid4().hex[:6]}-{index}"
        db.add(Question(id=qid, exam_id=exam_id, prompt=f"Prompt {index}", multi_select=False, domain=domain, certification=certification))
        db.flush()
        db.add_all([
            Option(question_id=qid, key="A", text="right", is_correct=True),
            Option(question_id=qid, key="B", text="wrong", is_correct=False),
        ])
        db.add(Explanation(question_id=qid, justification="Justification."))
        if with_version:
            db.add(QuestionBank(stable_question_id=qid, review_status="published"))
            db.flush()
            version = QuestionVersion(question_bank_id=qid, version_number=1, status="published", exam_id=exam_id, prompt=f"Prompt {index}")
            db.add(version)
            db.flush()
            db.get(QuestionBank, qid).published_version_id = version.id
        ids.append(qid)
    db.commit()
    return ids


def _identity_orders(db, session_id):
    from app.models import SessionQuestion

    for row in db.query(SessionQuestion).filter_by(session_id=session_id):
        row.option_order_json = None
    db.commit()


def _answer(client, session_id, qid, key):
    response = client.put(
        f"/api/sessions/{session_id}/questions/{qid}/response",
        json={"question_id": qid, "selected_keys": [key]},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------- M-C2

def test_exam_answer_changes_are_counted_once_at_submit(make_client, db):
    from app.models import ReviewQueueItem, SessionQuestion, UserDomainMetricDaily, UserExamMetricsSnapshot, UserQuestionProgress

    _seed(db, count=2)
    client = make_client()
    session_id = client.post("/api/sessions", json={"exam_id": "secplus", "total_questions": 2}, headers=HEADERS).json()["id"]
    _identity_orders(db, session_id)
    rows = sorted(db.query(SessionQuestion).filter_by(session_id=session_id), key=lambda row: row.position)
    wrong_qid, right_qid = rows[0].question_id, rows[1].question_id

    for key in ("B", "A", "B"):  # change the answer twice
        _answer(client, session_id, wrong_qid, key)
    _answer(client, session_id, right_qid, "A")

    db.expire_all()
    assert db.query(UserQuestionProgress).count() == 0
    assert db.query(UserDomainMetricDaily).count() == 0

    result = client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS)
    assert result.status_code == 200, result.text
    db.expire_all()
    progress = {row.question_id: row for row in db.query(UserQuestionProgress)}
    assert progress[wrong_qid].total_attempts == 1 and progress[wrong_qid].exam_attempts == 1
    assert progress[wrong_qid].wrong_count == 1
    assert progress[right_qid].total_attempts == 1 and progress[right_qid].correct_count == 1
    metrics = db.query(UserDomainMetricDaily).all()
    assert sum(row.attempts_total for row in metrics) == 2
    assert sum(row.exam_attempts for row in metrics) == 2
    assert db.query(UserExamMetricsSnapshot).filter_by(session_id=session_id).count() == 1

    # Wrong exam answers feed the SRS queue (due soon); correct ones don't flood it.
    queue = {row.question_id: row for row in db.query(ReviewQueueItem)}
    assert set(queue) == {wrong_qid}
    assert queue[wrong_qid].client_key == "device-exam"
    assert queue[wrong_qid].due_at <= datetime.now(timezone.utc) + timedelta(days=2, minutes=1)
    assert queue[wrong_qid].last_outcome == "wrong"

    # Submitting again / reading the result never records anything twice.
    assert client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS).status_code == 200
    assert client.get(f"/api/sessions/{session_id}/review", headers=HEADERS).status_code == 200
    db.expire_all()
    assert sum(row.attempts_total for row in db.query(UserDomainMetricDaily)) == 2
    assert db.query(UserQuestionProgress).filter_by(question_id=wrong_qid).one().total_attempts == 1


def test_answering_a_completed_exam_is_refused(make_client, db):
    _seed(db, count=1)
    client = make_client()
    session_id = client.post("/api/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS).json()["id"]
    _identity_orders(db, session_id)
    qid = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()["question"]["id"]
    _answer(client, session_id, qid, "A")
    client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS)
    response = client.put(
        f"/api/sessions/{session_id}/questions/{qid}/response",
        json={"question_id": qid, "selected_keys": ["B"]},
        headers=HEADERS,
    )
    assert response.status_code == 400


def test_expired_exam_is_auto_submitted_once_on_read(make_client, db):
    from app.models import ExamSession, UserQuestionProgress

    _seed(db, count=1)
    client = make_client()
    session_id = client.post("/api/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS).json()["id"]
    _identity_orders(db, session_id)
    qid = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()["question"]["id"]
    _answer(client, session_id, qid, "B")
    session = db.get(ExamSession, session_id)
    session.created_at = datetime.now(timezone.utc) - timedelta(hours=3)
    db.commit()

    state = client.get(f"/api/sessions/{session_id}", headers=HEADERS).json()
    assert state["finished"] is True and state["auto_submitted"] is True
    client.get(f"/api/sessions/{session_id}", headers=HEADERS)
    db.expire_all()
    assert db.query(UserQuestionProgress).filter_by(question_id=qid).one().total_attempts == 1


# ---------------------------------------------------------------- M-A3

def test_answers_store_published_question_version(make_client, db):
    from app.models import QuestionBank, SessionAnswer, StudyAttempt

    ids = _seed(db, count=1, with_version=True)
    version_id = db.get(QuestionBank, ids[0]).published_version_id
    client = make_client()
    session_id = client.post("/api/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS).json()["id"]
    _identity_orders(db, session_id)
    _answer(client, session_id, ids[0], "A")
    study_id = client.post("/api/study/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS).json()["id"]
    client.post(
        f"/api/study/sessions/{study_id}/answer",
        json={"question_id": ids[0], "selected_keys": ["A"], "confidence_level": "confident"},
        headers=HEADERS,
    )
    db.expire_all()
    assert db.query(SessionAnswer).one().question_version_id == version_id
    assert db.query(StudyAttempt).one().question_version_id == version_id


# ---------------------------------------------------------------- M-C3

def test_pass_threshold_mapping():
    from app.services.exam_policy import DEFAULT_PASS_THRESHOLD, pass_threshold_for, resolve_pass_threshold

    assert pass_threshold_for("CISSP") == 70.0
    assert pass_threshold_for("Security+") == 83.0
    assert pass_threshold_for("securityplus") == 83.0
    assert pass_threshold_for("Unknown cert") == DEFAULT_PASS_THRESHOLD == 70.0
    assert resolve_pass_threshold({"Security+": 10}) == (83.0, "Security+")
    threshold, cert = resolve_pass_threshold({"Security+": 1, "CISSP": 1})
    assert cert is None and threshold == 76.5


def test_result_exposes_certification_threshold(make_client, db):
    _seed(db, count=1, exam_id="cissp", certification="CISSP")
    client = make_client()
    session_id = client.post("/api/sessions", json={"exam_id": "cissp", "total_questions": 1}, headers=HEADERS).json()["id"]
    _identity_orders(db, session_id)
    qid = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()["question"]["id"]
    _answer(client, session_id, qid, "A")
    result = client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS).json()
    assert result["pass_threshold_percent"] == 70.0
    assert result["pass_threshold_certification"] == "CISSP"
    assert result["passed"] is True


# ---------------------------------------------------------------- M-A6 / M-C5

def test_blueprint_weights_come_from_domain_blueprint(db):
    from app.models import DomainBlueprint
    from app.services.question_pool import FALLBACK_BLUEPRINT_WEIGHTS, blueprint_weights_for_certification

    assert blueprint_weights_for_certification(db, "CISSP") == FALLBACK_BLUEPRINT_WEIGHTS["cissp"]
    db.add_all([
        DomainBlueprint(certification="CISSP", blueprint_code="X-D1", domain="Alpha", weight=90.0),
        DomainBlueprint(certification="CISSP", blueprint_code="X-D2", domain="Beta", weight=10.0),
    ])
    db.commit()
    assert blueprint_weights_for_certification(db, "cissp") == {"Alpha": 90.0, "Beta": 10.0}


def test_exam_quotas_follow_database_weights(db):
    from app.models import DomainBlueprint
    from app.services.quiz import _build_exam_question_pool

    _seed(db, count=10, exam_id="cissp", certification="CISSP", domain="Alpha")
    _seed(db, count=10, exam_id="cissp", certification="CISSP", domain="Beta")
    db.add_all([
        DomainBlueprint(certification="CISSP", blueprint_code="X-D1", domain="Alpha", weight=80.0),
        DomainBlueprint(certification="CISSP", blueprint_code="X-D2", domain="Beta", weight=20.0),
    ])
    db.commit()
    selected, strategy, mix = _build_exam_question_pool(
        db, exam_id="cissp", total_questions=10, question_ids=None, domains=None, difficulties=None, tags=None,
        bookmarked_only=False, notes_only=False, incorrect_only=False, unseen_only=False, low_confidence_only=False,
        strategy="standard", owner_user_id=None, owner_client_key="device-exam",
    )
    from app.models import Question

    domains = [db.get(Question, qid).domain for qid in selected]
    assert mix == {"blueprint_weighted": 10}
    assert domains.count("Alpha") == 8 and domains.count("Beta") == 2


def test_mixed_pool_keeps_homonymous_domains_apart(db):
    from app.services.question_pool import resolve_quota_buckets

    rows = [
        ("c1", "Security Operations", "CISSP"),
        ("c2", "Asset Security", "CISSP"),
        ("s1", "Security Operations", "Security+"),
        ("s2", "General Security Concepts", "Security+"),
    ]
    buckets, weights = resolve_quota_buckets(db, rows, apply_weights=True)
    labels = dict(buckets)
    assert labels["c1"] != labels["s1"]
    assert labels["c1"].startswith("CISSP") and labels["s1"].startswith("Security+")
    # Security+ weighs Security Operations 28/100, CISSP 13/100; each certification owns half the pool.
    assert weights[labels["s1"]] > weights[labels["c1"]]
    assert round(sum(weights.values()), 2) == 100.0
