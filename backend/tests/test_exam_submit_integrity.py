"""Exam submission integrity: idempotent finalization under concurrency, batched
finalization (query budget), exam-day answer secrecy and weak-area payloads."""
from __future__ import annotations

import os
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest

HEADERS = {"X-Client-Key": "device-submit"}
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "").strip()


def _seed_questions(db, *, count, exam_id="secplus", certification="Security+", domains=("General", "Network")):
    from app.models import Exam, Explanation, Option, Question

    if not db.get(Exam, exam_id):
        db.add(Exam(id=exam_id, title=exam_id, question_count=count))
        db.flush()
    ids = []
    for index in range(count):
        qid = f"{exam_id}-{uuid.uuid4().hex[:8]}-{index}"
        db.add(Question(
            id=qid,
            exam_id=exam_id,
            prompt=f"Prompt {index}",
            multi_select=False,
            domain=domains[index % len(domains)],
            certification=certification,
        ))
        db.flush()
        db.add_all([
            Option(question_id=qid, key="A", text="right", is_correct=True),
            Option(question_id=qid, key="B", text="wrong", is_correct=False),
        ])
        db.add(Explanation(question_id=qid, justification="Because A is right."))
        ids.append(qid)
    db.commit()
    return ids


def _make_answered_session(db, question_ids, *, client_key="device-submit", experience_mode="standard", wrong_every=3):
    """An open exam session with every question answered (A right, B wrong)."""
    from app.models import ExamSession, SessionAnswer, SessionQuestion

    session = ExamSession(
        id=str(uuid.uuid4()),
        client_key=client_key,
        exam_id="secplus",
        total_questions=len(question_ids),
        experience_mode=experience_mode,
    )
    db.add(session)
    db.flush()
    correct = wrong = 0
    for position, qid in enumerate(question_ids):
        db.add(SessionQuestion(session_id=session.id, question_id=qid, position=position))
        is_correct = position % wrong_every != 0
        db.add(SessionAnswer(
            session_id=session.id,
            question_id=qid,
            selected_keys="A" if is_correct else "B",
            is_correct=is_correct,
            elapsed_seconds=30,
        ))
        correct += int(is_correct)
        wrong += int(not is_correct)
    session.correct_count = correct
    session.wrong_count = wrong
    db.commit()
    return session.id, correct, wrong


@contextmanager
def _count_statements(engine):
    from sqlalchemy import event

    statements: list[str] = []

    def _before(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _before)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _before)


# ------------------------------------------------------------ batched finalization


@pytest.mark.parametrize("count", [50, 90])
def test_submit_stays_within_query_budget(make_client, db, count):
    from app.db.session import engine
    from app.models import ReviewQueueItem, ReviewSchedule, UserDomainMetricDaily, UserExamMetricsSnapshot, UserQuestionProgress

    ids = _seed_questions(db, count=count)
    session_id, correct, wrong = _make_answered_session(db, ids)
    client = make_client()

    with _count_statements(engine) as statements:
        response = client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS)
    assert response.status_code == 200, response.text
    # Was 647 statements for 50 questions with per-question upserts (N+1); the
    # batched finalization issues a constant number of statements.
    print(f"submit of {count} questions: {len(statements)} SQL statements")
    assert len(statements) < 60, f"{len(statements)} statements for a {count}-question submit"

    db.expire_all()
    progress = db.query(UserQuestionProgress).all()
    assert len(progress) == count
    assert all(row.exam_attempts == 1 and row.total_attempts == 1 for row in progress)
    assert sum(row.correct_count for row in progress) == correct
    metrics = db.query(UserDomainMetricDaily).all()
    assert {row.domain for row in metrics} == {"General", "Network"}
    assert sum(row.attempts_total for row in metrics) == count
    assert sum(row.wrong_count for row in metrics) == wrong
    assert sum(row.timed_attempts for row in metrics) == count
    assert db.query(ReviewQueueItem).count() == wrong
    assert db.query(ReviewSchedule).count() == wrong
    assert db.query(UserExamMetricsSnapshot).filter_by(session_id=session_id).count() == 1


def test_batched_finalization_matches_incremental_srs_semantics(make_client, db):
    """A correct exam answer only advances an item already in the review queue."""
    from app.models import ReviewQueueItem, WeeklyProgressSnapshot

    ids = _seed_questions(db, count=3)
    already_queued = ids[1]  # answered correctly below
    db.add(ReviewQueueItem(client_key="device-submit", question_id=already_queued, due_at=datetime.now(timezone.utc) - timedelta(days=1), repetition_count=0))
    db.commit()
    session_id, _correct, wrong = _make_answered_session(db, ids)  # position 0 wrong, 1-2 right
    client = make_client()
    assert client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS).status_code == 200

    db.expire_all()
    queue = {row.question_id: row for row in db.query(ReviewQueueItem)}
    assert set(queue) == {ids[0], already_queued}
    assert queue[ids[0]].last_outcome == "wrong"
    assert queue[already_queued].last_outcome == "correct"
    assert queue[already_queued].repetition_count == 1
    weekly = db.query(WeeklyProgressSnapshot).one()
    assert weekly.questions_answered == 3
    assert weekly.scheduled_reviews == 2
    assert weekly.review_total_count == 2
    assert weekly.completed_exam_sessions == 1


# ------------------------------------------------------------ exam-day secrecy


def _start_exam_day(client, db, count=2):
    from app.models import SessionQuestion

    _seed_questions(db, count=count)
    response = client.post(
        "/api/sessions",
        json={"exam_id": "secplus", "total_questions": count, "experience_mode": "exam_day"},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    session_id = response.json()["id"]
    for row in db.query(SessionQuestion).filter_by(session_id=session_id):
        row.option_order_json = None
    db.commit()
    return session_id


def test_exam_day_answer_response_withholds_correctness(make_client, db):
    client = make_client()
    session_id = _start_exam_day(client, db)
    state = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()
    qid = state["question"]["id"]
    assert "is_correct" not in state["question"]

    response = client.put(
        f"/api/sessions/{session_id}/questions/{qid}/response",
        json={"question_id": qid, "selected_keys": ["B"]},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    for field in ("is_correct", "justification", "feedback_summary", "correct_keys", "correct_count", "wrong_count", "insight"):
        assert body[field] is None, field
    assert body["official_references"] == []
    assert body["selected_keys"] == ["B"]
    assert body["answered_count"] == 1

    session_state = client.get(f"/api/sessions/{session_id}", headers=HEADERS).json()
    assert session_state["correct_count"] is None and session_state["wrong_count"] is None
    assert session_state["answered_count"] == 1

    review = client.get(f"/api/sessions/{session_id}/review-screen", headers=HEADERS).json()
    assert all("is_correct" not in item for item in review["items"])
    # The review endpoint must not reveal the score before submission.
    assert client.get(f"/api/sessions/{session_id}/review", headers=HEADERS).status_code in (400, 409)

    result = client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS)
    assert result.status_code == 200
    assert result.json()["wrong_count"] == 1
    finished_state = client.get(f"/api/sessions/{session_id}", headers=HEADERS).json()
    assert finished_state["wrong_count"] == 1


def test_standard_mode_answer_response_keeps_feedback(make_client, db):
    from app.models import SessionQuestion

    client = make_client()
    _seed_questions(db, count=1)
    session_id = client.post("/api/sessions", json={"exam_id": "secplus", "total_questions": 1}, headers=HEADERS).json()["id"]
    for row in db.query(SessionQuestion).filter_by(session_id=session_id):
        row.option_order_json = None
    db.commit()
    qid = client.get(f"/api/sessions/{session_id}/questions/0", headers=HEADERS).json()["question"]["id"]
    body = client.put(
        f"/api/sessions/{session_id}/questions/{qid}/response",
        json={"question_id": qid, "selected_keys": ["B"]},
        headers=HEADERS,
    ).json()
    assert body["is_correct"] is False
    assert body["correct_keys"] == ["A"]
    assert body["correct_count"] == 0 and body["wrong_count"] == 1
    assert body["feedback_summary"]


# ------------------------------------------------------------ weak areas


def test_weak_areas_expose_score_codes_and_params(make_client, db):
    ids = _seed_questions(db, count=4, domains=("General",))
    session_id, correct, _wrong = _make_answered_session(db, ids, wrong_every=2)  # 2 right / 2 wrong
    client = make_client()
    assert client.post(f"/api/sessions/{session_id}/submit", headers=HEADERS).status_code == 200

    payload = client.get("/api/analytics/weak-areas", headers=HEADERS).json()
    track = next(item for item in payload["certifications"] if item["certification"] == "Security+")
    domain = track["domains"][0]
    assert domain["label"] == "General"
    assert domain["score_percent"] == 50.0
    assert domain["code"] == "weak_area.low_accuracy"
    assert domain["params"] == {"domain": "General", "accuracy": 50.0, "total": 4, "correct": 2, "wrong": 2}
    assert track["code"] == "weak_area.focus_domain"
    assert track["params"]["domain"] == "General"
    assert "questões" in track["message"]


def test_weak_areas_without_history_use_no_data_code(make_client, db):
    _seed_questions(db, count=1)
    client = make_client()
    payload = client.get("/api/analytics/weak-areas", headers=HEADERS).json()
    track = payload["certifications"][0]
    assert track["domains"] == []
    assert track["code"] == "weak_area.no_data"
    assert track["message"] == "Sem histórico suficiente para este track."


# ------------------------------------------------------------ concurrency (PostgreSQL)


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL (PostgreSQL) not set")
def test_concurrent_submits_finalize_exactly_once_on_postgres():
    from sqlalchemy import create_engine, func, select, text
    from sqlalchemy.orm import Session, sessionmaker

    from app.db.base import Base
    from app.models import (
        ExamSession,
        ReviewQueueItem,
        ReviewSchedule,
        UserDomainMetricDaily,
        UserExamMetricsSnapshot,
        UserQuestionProgress,
        WeeklyProgressSnapshot,
    )
    from app.services.exam_runtime import submit_exam_session

    schema = f"t_submit_{uuid.uuid4().hex[:8]}"
    admin_engine = create_engine(TEST_DATABASE_URL)
    with admin_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(
        TEST_DATABASE_URL,
        pool_size=12,
        connect_args={"options": f"-csearch_path={schema}"},
    )
    try:
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        with factory() as db:
            ids = _seed_questions(db, count=12)
            session_id, correct, wrong = _make_answered_session(db, ids, client_key="device-race")

        workers = 8
        barrier = threading.Barrier(workers)
        errors: list[BaseException] = []
        results: list[dict] = []

        def _submit():
            try:
                with factory() as db:
                    session = db.get(ExamSession, session_id)
                    barrier.wait(timeout=10)
                    results.append(submit_exam_session(db, session))
            except BaseException as exc:  # pragma: no cover - reported below
                errors.append(exc)

        threads = [threading.Thread(target=_submit) for _ in range(workers)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)
        assert not errors, errors
        assert len(results) == workers
        assert all(item["correct_count"] == correct for item in results)

        with Session(engine) as db:
            assert db.scalar(select(func.count(UserExamMetricsSnapshot.id))) == 1
            progress = db.execute(select(UserQuestionProgress)).scalars().all()
            assert len(progress) == len(ids)
            assert all(row.exam_attempts == 1 for row in progress)
            assert db.scalar(select(func.sum(UserDomainMetricDaily.attempts_total))) == len(ids)
            assert db.scalar(select(func.count(ReviewQueueItem.id))) == wrong
            assert db.scalar(select(func.count(ReviewSchedule.id))) == wrong
            weekly = db.execute(select(WeeklyProgressSnapshot)).scalars().one()
            assert weekly.questions_answered == len(ids)
            assert weekly.completed_exam_sessions == 1
    finally:
        engine.dispose()
        with admin_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()
