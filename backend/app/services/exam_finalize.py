"""Exam session lifecycle: timer sync/expiry, locking, completion, pause/resume and the
one-time finalization that records progress, metrics and SRS (split from quiz.py, M-C6).

Progress/metrics/SRS for an exam are recorded exactly once, when the session is
completed (submit, or timer expiry) - see :func:`finalize_exam_session` (M-C2).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.models import (
    ExamSession,
    Question,
    SessionAnswer,
)
from app.services.engagement import refresh_engagement_state
from app.services.learning import record_question_progress_batch
from app.services.metrics import (
    record_question_attempt_metrics_batch,
    record_session_metrics,
    refresh_weekly_backlog_counts,
    week_start,
)
from app.services.review_queue import schedule_exam_answers_for_review
from app.services.serialization import parse_session_payload as _parse_session_payload
from app.services.serialization import serialize_session_payload as _serialize_session_payload
from app.services.exam_timing import _build_exam_timing_metadata, _effective_session_config, _parse_iso_datetime
from app.services.exam_results import _analyze_session, _get_session_rows, _pass_threshold_from_rows


def sync_exam_session_state(
    db: Session,
    session: ExamSession,
) -> dict[str, Any]:
    """Bring the session state up to date *in memory* (pause rollover, timer expiry).

    Never commits: mutating flows (answer, pause, resume, submit) call it and commit
    their own transaction. Read-only endpoints use :func:`expire_exam_session_if_due`.
    """
    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    config = _effective_session_config(session, raw_config)
    changed = False
    now = datetime.utcnow()

    paused_at = _parse_iso_datetime(config.get("paused_at"))
    if paused_at and session.completed_at is None:
        elapsed_pause = max(int((now - paused_at).total_seconds()), 0)
        max_pause_seconds = int(config["max_pause_seconds"])
        if elapsed_pause >= max_pause_seconds:
            config["paused_total_seconds"] = max(int(config["paused_total_seconds"]), 0) + max_pause_seconds
            config["paused_at"] = None
            changed = True

    if changed:
        session.selection_mix_json = _serialize_session_payload(
            selection_mix,
            session_config=config,
            active_filters=active_filters,
        )

    timing = _build_exam_timing_metadata(session, now=now, config=config)
    if session.completed_at is None and timing["remaining_seconds"] <= 0:
        complete_exam_session(db, session, completed_at=now, auto_submitted=True)
        timing = _build_exam_timing_metadata(session, now=now)

    timing["selection_mix"] = selection_mix
    timing["active_filters"] = active_filters
    return timing


def exam_session_expired(session: ExamSession, *, now: datetime | None = None) -> bool:
    if session.completed_at is not None:
        return False
    timing = _build_exam_timing_metadata(session, now=now or datetime.utcnow())
    return timing["remaining_seconds"] <= 0


def expire_exam_session_if_due(db: Session, session: ExamSession) -> bool:
    """The only write allowed on exam GET endpoints (M-B7).

    A timed exam whose clock ran out must be auto-submitted even if the learner never
    comes back to press "submit": otherwise the session would stay open forever and its
    results would never reach progress/metrics/SRS. Reads therefore finalise an expired
    session (once) and commit; in every other case they persist nothing.
    """
    if not exam_session_expired(session):
        return False
    lock_exam_session(db, session)
    if not exam_session_expired(session):
        # A concurrent request auto-submitted it while we waited for the lock.
        db.commit()
        return False
    now = datetime.utcnow()
    complete_exam_session(db, session, completed_at=now, auto_submitted=True)
    db.commit()
    db.refresh(session)
    return True


def lock_exam_session(db: Session, session: ExamSession) -> ExamSession:
    """Serialize mutating flows on one exam session (answer, pause, submit, expiry).

    Takes a row lock (``SELECT ... FOR UPDATE``; a no-op on SQLite, whose writers are
    already serialized) and reloads the row so the caller sees the state committed by
    a concurrent request that held the lock before it (e.g. ``completed_at`` and the
    ``finalized_at`` marker of a parallel submit). Must be called before modifying the
    session in the current transaction.
    """
    db.execute(
        select(ExamSession)
        .where(ExamSession.id == session.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    return session


def _claim_completion(db: Session, session: ExamSession, completed_at: datetime) -> bool:
    """Atomically mark the session completed; False when another request already did.

    ``UPDATE ... WHERE completed_at IS NULL`` is the idempotency guard of the
    finalization (M-C2): only the request whose update matched a row records progress,
    metrics and SRS, even without the row lock of :func:`lock_exam_session`.
    """
    result = db.execute(
        update(ExamSession)
        .where(ExamSession.id == session.id, ExamSession.completed_at.is_(None))
        .values(completed_at=completed_at)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 1:
        set_committed_value(session, "completed_at", completed_at)
        return True
    db.refresh(session, attribute_names=["completed_at", "selection_mix_json"])
    return False


def complete_exam_session(
    db: Session,
    session: ExamSession,
    *,
    completed_at: datetime | None = None,
    auto_submitted: bool = False,
) -> None:
    """Mark the session completed and record its learning signals once (no commit)."""
    if session.completed_at is None:
        if not _claim_completion(db, session, completed_at or datetime.utcnow()):
            # A concurrent request completed (and finalized) the session first.
            return
        if auto_submitted:
            selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
            config = _effective_session_config(session, raw_config)
            config["auto_submitted"] = True
            session.selection_mix_json = _serialize_session_payload(
                selection_mix,
                session_config=config,
                active_filters=active_filters,
            )
    finalize_exam_session(db, session)


def finalize_exam_session(db: Session, session: ExamSession) -> bool:
    """Record progress, domain metrics, SRS scheduling and the session snapshot (M-C2).

    Runs once per session (guarded by ``finalized_at`` in the session config): each
    question counts as a single attempt with its final answer, however many times the
    learner changed it during the exam. Wrong answers enter the review queue.

    All rows are loaded and written in bulk (a constant number of statements however
    many questions the exam has).
    """
    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    if raw_config.get("finalized_at"):
        return False
    db.flush()
    owner_user_id, owner_client_key = session.user_id, None if session.user_id else session.client_key
    rows = db.execute(
        select(
            SessionAnswer.question_id,
            SessionAnswer.is_correct,
            SessionAnswer.answered_at,
            SessionAnswer.elapsed_seconds,
            Question.exam_id,
            Question.certification,
            Question.domain,
        )
        .join(Question, Question.id == SessionAnswer.question_id)
        .where(SessionAnswer.session_id == session.id)
        .order_by(SessionAnswer.answered_at.asc(), SessionAnswer.id.asc())
    ).all()
    fallback_time = session.completed_at or datetime.utcnow()
    attempts = [
        {
            "question_id": question_id,
            "is_correct": bool(is_correct),
            "attempted_at": answered_at or fallback_time,
            "elapsed_seconds": elapsed_seconds,
            "exam_id": exam_id,
            "certification": certification,
            "domain": domain,
            "confidence_level": None,
        }
        for question_id, is_correct, answered_at, elapsed_seconds, exam_id, certification, domain in rows
    ]
    if attempts:
        record_question_progress_batch(
            db,
            attempts,
            mode="exam",
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
        record_question_attempt_metrics_batch(
            db,
            attempts,
            mode="exam",
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            selection_strategy=session.selection_strategy,
            refresh_backlog=False,
        )
        schedule_exam_answers_for_review(
            db,
            attempts,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            refresh_backlog=False,
        )
        last_attempt_at = max(item["attempted_at"] for item in attempts)
        if session.completed_at is None or week_start(last_attempt_at) != week_start(session.completed_at):
            # record_session_metrics() below refreshes the backlog counters of the
            # completion week; only an exam spanning two weeks needs this extra refresh.
            refresh_weekly_backlog_counts(
                db,
                owner_user_id=owner_user_id,
                owner_client_key=owner_client_key,
                observed_at=last_attempt_at,
            )

    rows_for_result = _get_session_rows(db, session.id)
    threshold, threshold_cert = _pass_threshold_from_rows(rows_for_result)
    result = _analyze_session(session, rows_for_result, pass_threshold=threshold, pass_threshold_certification=threshold_cert)
    record_session_metrics(
        db,
        session_id=session.id,
        mode="exam",
        exam_id=session.exam_id,
        selection_strategy=session.selection_strategy,
        total_questions=session.total_questions,
        answered_count=session.correct_count + session.wrong_count,
        correct_count=session.correct_count,
        wrong_count=session.wrong_count,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        completed_at=session.completed_at,
        created_at=session.created_at,
        weakest_domains=((result.get("insight") or {}).get("weakest_domains") or []),
    )
    refresh_engagement_state(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)

    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    config = dict(raw_config)
    config["finalized_at"] = datetime.utcnow().isoformat()
    session.selection_mix_json = _serialize_session_payload(
        selection_mix,
        session_config=config,
        active_filters=active_filters,
    )
    db.flush()
    return True


def pause_exam_session(db: Session, session: ExamSession) -> ExamSession:
    lock_exam_session(db, session)
    timing = sync_exam_session_state(db, session)
    if session.completed_at is not None:
        db.commit()
        raise ValueError("Session already completed.")
    if timing["paused"]:
        raise ValueError("Session is already paused.")

    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    config = _effective_session_config(session, raw_config)
    if int(config["pause_count"]) >= int(config["pause_limit"]):
        raise ValueError("Pause limit reached for this exam session.")

    config["paused_at"] = datetime.utcnow().isoformat()
    config["pause_count"] = int(config["pause_count"]) + 1
    session.selection_mix_json = _serialize_session_payload(
        selection_mix,
        session_config=config,
        active_filters=active_filters,
    )
    db.commit()
    db.refresh(session)
    return session


def resume_exam_session(db: Session, session: ExamSession) -> ExamSession:
    lock_exam_session(db, session)
    sync_exam_session_state(db, session)
    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    config = _effective_session_config(session, raw_config)
    paused_at = _parse_iso_datetime(config.get("paused_at"))
    if not paused_at:
        db.commit()
        raise ValueError("Session is not paused.")

    now = datetime.utcnow()
    elapsed_pause = max(int((now - paused_at).total_seconds()), 0)
    config["paused_total_seconds"] = max(int(config["paused_total_seconds"]), 0) + min(
        elapsed_pause,
        int(config["max_pause_seconds"]),
    )
    config["paused_at"] = None
    session.selection_mix_json = _serialize_session_payload(
        selection_mix,
        session_config=config,
        active_filters=active_filters,
    )
    sync_exam_session_state(db, session)
    db.commit()
    db.refresh(session)
    return session
