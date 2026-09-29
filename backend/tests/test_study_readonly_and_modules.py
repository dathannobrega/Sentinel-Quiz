"""Read-only GETs (M-B7), inactive questions (M-A2), study modules (M-A7) and
plan/readiness message codes (M-C7)."""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

KEY = "device-readonly"
HEADERS = {"X-Client-Key": KEY}


def _seed(db, *, count=3, exam_id="cissp", certification="CISSP", domain="Asset Security", active=True):
    from app.models import Exam, Explanation, Option, Question

    if not db.get(Exam, exam_id):
        db.add(Exam(id=exam_id, title=exam_id, question_count=count))
        db.flush()
    ids = []
    for index in range(count):
        qid = f"{exam_id}-{uuid.uuid4().hex[:6]}-{index}"
        db.add(Question(
            id=qid, exam_id=exam_id, prompt=f"Needle prompt {index}", multi_select=False,
            domain=domain, certification=certification, is_active=active,
        ))
        db.flush()
        db.add_all([
            Option(question_id=qid, key="A", text="right", is_correct=True),
            Option(question_id=qid, key="B", text="wrong", is_correct=False),
        ])
        db.add(Explanation(question_id=qid, justification="Justification."))
        ids.append(qid)
    db.commit()
    return ids


@contextmanager
def capture_writes():
    from app.db.session import engine

    statements: list[str] = []

    def _listener(conn, cursor, statement, parameters, context, executemany):
        verb = statement.lstrip().split(" ", 1)[0].upper()
        if verb in {"INSERT", "UPDATE", "DELETE"}:
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", _listener)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _listener)


def _finish_exam(client, db, *, total=2):
    from app.models import SessionQuestion

    session_id = client.post("/api/sessions", json={"exam_id": "cissp", "total_questions": total}, headers=HEADERS).json()["id"]
    for row in db.query(SessionQuestion).filter_by(session_id=session_id):
        row.option_order_json = None
    db.commit()
    for position in range(total):
        qid = client.get(f"/api/sessions/{session_id}/questions/{position}", headers=HEADERS).json()["question"]["id"]
        client.put(
            f"/api/sessions/{session_id}/questions/{qid}/response",
            json={"question_id": qid, "selected_keys": ["B" if position == 0 else "A"]},
            headers=HEADERS,
        )
    assert client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS).status_code == 200
    return session_id


def _finish_study(client, total=2):
    session_id = client.post("/api/study/sessions", json={"exam_id": "cissp", "total_questions": total}, headers=HEADERS).json()["id"]
    for _ in range(total):
        question = client.get(f"/api/study/sessions/{session_id}/next", headers=HEADERS).json()["question"]
        client.post(
            f"/api/study/sessions/{session_id}/answer",
            json={"question_id": question["id"], "selected_keys": ["A"], "confidence_level": "not_sure"},
            headers=HEADERS,
        )
    return session_id


# ---------------------------------------------------------------- M-B7

def test_get_endpoints_do_not_write(make_client, db):
    _seed(db, count=4)
    client = make_client()
    exam_id = _finish_exam(client, db)
    study_id = _finish_study(client)
    active_study = client.post("/api/study/sessions", json={"exam_id": "cissp", "total_questions": 1}, headers=HEADERS).json()["id"]
    active_question = client.get(f"/api/study/sessions/{active_study}/next", headers=HEADERS).json()["question"]["id"]

    urls = [
        f"/api/sessions/{exam_id}",
        f"/api/sessions/{exam_id}/review",
        f"/api/sessions/{exam_id}/review-screen",
        "/api/analytics/engagement",
        "/api/analytics/readiness",
        "/api/analytics/weak-areas",
        "/api/sessions/history",
        "/api/study/plan",
        "/api/study/overview",
        "/api/study/review/queue",
        "/api/study/analytics/weekly",
        "/api/study/modules",
        f"/api/study/sessions/{study_id}",
        f"/api/study/sessions/{study_id}/review",
        f"/api/study/sessions/{active_study}/questions/{active_question}/hint?level=2",
    ]
    for url in urls:
        with capture_writes() as statements:
            response = client.get(url, headers=HEADERS)
        assert response.status_code == 200, (url, response.text)
        assert statements == [], (url, statements)


def test_engagement_get_is_read_only_but_submit_persists_state(make_client, db):
    from app.models import AdaptiveProfile, UserGoal, UserStreak

    _seed(db, count=2)
    client = make_client()
    snapshot = client.get("/api/analytics/engagement", headers=HEADERS)
    assert snapshot.status_code == 200
    db.expire_all()
    assert db.query(UserGoal).count() == 0 and db.query(UserStreak).count() == 0
    _finish_exam(client, db)
    db.expire_all()
    assert db.query(UserGoal).count() == 1
    assert db.query(UserStreak).one().current_streak_days == 1
    assert db.query(AdaptiveProfile).count() == 1


def test_study_completion_records_placement_and_snapshot(make_client, db):
    from app.models import UserExamMetricsSnapshot

    _seed(db, count=2)
    client = make_client()
    session_id = _finish_study(client)
    db.expire_all()
    assert db.query(UserExamMetricsSnapshot).filter_by(session_id=session_id, mode="study").count() == 1
    result = client.get(f"/api/study/sessions/{session_id}/review", headers=HEADERS).json()["result"]
    assert result["placement_completed"] is False  # 2 answers < placement minimum


# ---------------------------------------------------------------- M-A2

def test_inactive_questions_are_never_selected_or_listed(make_client, db):
    from app.models import ReviewQueueItem

    active = _seed(db, count=2)
    inactive = _seed(db, count=3, active=False)
    client = make_client()

    for _ in range(5):
        exam = client.post("/api/sessions", json={"exam_id": "cissp", "total_questions": 10}, headers=HEADERS).json()
        assert exam["total_questions"] == 2
        study = client.post("/api/study/sessions", json={"exam_id": "cissp", "total_questions": 10}, headers=HEADERS).json()
        assert study["total_questions"] == 2

    manual = client.post("/api/sessions", json={"exam_id": "cissp", "total_questions": 5}, headers=HEADERS)
    assert manual.status_code == 200

    search = client.get("/api/questions/search", params={"query": "needle"}, headers=HEADERS).json()
    assert {item["id"] for item in search["items"]} == set(active)
    catalog = client.get("/api/domains", params={"exam_id": "cissp"}).json()
    assert catalog["domains"][0]["question_count"] == 2

    db.add(ReviewQueueItem(client_key=KEY, question_id=inactive[0], due_at=datetime.now(timezone.utc) - timedelta(hours=1)))
    db.commit()
    queue = client.get("/api/study/review/queue", headers=HEADERS).json()
    assert inactive[0] not in {item["question_id"] for item in queue["items"]}
    with pytest.raises(ValueError, match="unavailable"):
        from app.services.question_pool import validate_requested_question_ids

        validate_requested_question_ids(db, [inactive[1]], empty_message="none")


def test_history_of_deactivated_questions_still_renders(make_client, db):
    from app.models import Question

    _seed(db, count=2)
    client = make_client()
    session_id = _finish_exam(client, db)
    for question in db.query(Question).all():
        question.is_active = False
    db.commit()
    review = client.get(f"/api/sessions/{session_id}/review", headers=HEADERS)
    assert review.status_code == 200, review.text
    assert len(review.json()["questions"]) == 2


# ---------------------------------------------------------------- M-A7 / M-C7

def _modules(db):
    from app.models import StudyModule

    db.add_all([
        StudyModule(certification="CISSP", code="D2", position=2, title="Asset Security", domain="Asset Security", source_file="material/cissp_domain.json"),
        StudyModule(certification="CISSP", code="D1", position=1, title="Security and Risk Management", domain="Security and Risk Management", source_file="material/cissp_domain.json"),
        StudyModule(certification="Security+", code="M01", position=1, title="Fundamentos", domain=None, source_file="material/Modulos_sec+.md"),
    ])
    db.commit()


def test_modules_endpoint_returns_ordered_track(make_client, db):
    _modules(db)
    client = make_client()
    body = client.get("/api/study/modules", params={"certification": "cissp"}).json()
    assert body["certification"] == "cissp"
    assert [item["code"] for item in body["modules"]] == ["D1", "D2"]
    assert set(body["modules"][0]) == {"id", "certification", "code", "position", "title", "description", "domain"}
    everything = client.get("/api/study/modules").json()["modules"]
    assert len(everything) == 3


def test_study_plan_codes_and_next_module_for_weakest_domain(make_client, db):


    from app.models import UserDomainMetricDaily

    _modules(db)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    for domain, correct in (("Security and Risk Management", 18), ("Asset Security", 9)):
        db.add(UserDomainMetricDaily(
            client_key=KEY, metric_date=today, exam_id="cissp", certification="CISSP", domain=domain,
            attempts_total=20, study_attempts=20, correct_count=correct, wrong_count=20 - correct,
        ))
    db.commit()
    client = make_client()
    plan = client.get("/api/study/plan", headers=HEADERS).json()
    assert plan["placement_required"] is False
    assert plan["primary_task"]["code"] == "study_plan.risk_domain"
    assert plan["primary_task"]["params"]["domain"] == "Asset Security"
    assert plan["primary_task"]["certification"] == "CISSP"
    assert plan["risk_domain_details"][0] == {"certification": "CISSP", "domain": "Asset Security", "score_percent": 45.0}
    assert plan["recommended_module"]["code"] == "D2"
    assert all(task["code"].startswith("study_plan.") for task in plan["secondary_tasks"])


def test_plan_tie_breaks_equal_scores_by_module_order(db):


    from app.models import UserDomainMetricDaily
    from app.services.study_plan import build_study_plan

    _modules(db)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    for domain in ("Asset Security", "Security and Risk Management"):
        db.add(UserDomainMetricDaily(
            client_key=KEY, metric_date=today, exam_id="cissp", certification="CISSP", domain=domain,
            attempts_total=20, study_attempts=20, correct_count=10, wrong_count=10,
        ))
    db.commit()
    plan = build_study_plan(db, owner_user_id=None, owner_client_key=KEY)
    assert plan["risk_domains"][0] == "Security and Risk Management"  # module position 1 < 2
    assert plan["recommended_module"]["code"] == "D1"
