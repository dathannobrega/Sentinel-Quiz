from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ExamSession, Option, Question, SessionAnswer, SessionQuestion
from app.services.learning import upsert_question_progress
from app.services.metrics import record_question_attempt_metrics
from app.services.quiz import (
    _analyze_session,
    _get_correct_keys,
    _get_session_rows,
    compute_result,
    get_question_for_session,
    sync_exam_session_state,
)
from app.services.reference_resolver import build_feedback_summary, build_official_reference_summaries


def _answered_count(session: ExamSession) -> int:
    return max(len(session.answers), int(session.correct_count or 0) + int(session.wrong_count or 0))


def _marked_for_review_count(session: ExamSession) -> int:
    return sum(1 for item in session.questions if item.marked_for_review)


def _find_session_question(session: ExamSession, *, question_id: str | None = None, position: int | None = None) -> SessionQuestion | None:
    for item in session.questions:
        if question_id is not None and item.question_id == question_id:
            return item
        if position is not None and item.position == position:
            return item
    return None


def _current_question_payload(db: Session, session: ExamSession, position: int) -> dict[str, Any] | None:
    row = _find_session_question(session, position=position)
    if not row:
        return None
    payload = get_question_for_session(db, session, position)
    if not payload:
        return None
    answer = next((item for item in session.answers if item.question_id == row.question_id), None)
    payload["selected_keys"] = [key for key in (answer.selected_keys.split(",") if answer and answer.selected_keys else []) if key]
    payload["is_answered"] = bool(answer)
    payload["marked_for_review"] = bool(row.marked_for_review)
    payload["elapsed_seconds"] = answer.elapsed_seconds if answer else None
    return payload


def _set_position(session: ExamSession, position: int) -> None:
    safe_position = max(0, min(position, max(session.total_questions - 1, 0)))
    session.current_position = safe_position
    session.current_index = safe_position


def get_exam_question_state(
    db: Session,
    session: ExamSession,
    *,
    position: int | None = None,
) -> dict[str, Any]:
    sync_exam_session_state(db, session)
    if session.completed_at is not None:
        return {"finished": True}

    target_position = session.current_position if position is None else position
    if target_position < 0 or target_position >= session.total_questions:
        return {"finished": True}

    session_row = _find_session_question(session, position=target_position)
    if not session_row:
        return {"finished": True}

    _set_position(session, target_position)
    session_row.last_viewed_at = datetime.utcnow()
    db.commit()
    db.refresh(session)

    payload = _current_question_payload(db, session, session.current_position)
    if not payload:
        return {"finished": True}

    return {
        "finished": session.completed_at is not None,
        "question": payload,
        "progress_index": session.current_position,
        "current_position": session.current_position,
        "total_questions": session.total_questions,
        "answered_count": _answered_count(session),
        "marked_for_review_count": _marked_for_review_count(session),
        "experience_mode": session.experience_mode or "standard",
    }


def save_exam_response(
    db: Session,
    session: ExamSession,
    *,
    question_id: str,
    selected_keys: list[str],
    elapsed_seconds: int | None = None,
    auto_advance: bool = False,
    auto_submit_when_complete: bool = False,
) -> dict[str, Any]:
    timing = sync_exam_session_state(db, session)
    if session.completed_at is not None and timing["remaining_seconds"] <= 0:
        raise ValueError("Session time limit expired. The exam was auto-submitted.")
    if timing["paused"]:
        raise ValueError("Session is paused. Resume it before submitting an answer.")

    session_row = _find_session_question(session, question_id=question_id)
    if not session_row:
        raise ValueError("Question does not belong to this session.")

    question = db.get(Question, question_id)
    if not question:
        raise ValueError("Question not found.")

    option_keys = [row[0] for row in db.execute(select(Option.key).where(Option.question_id == question_id)).all()]
    if not option_keys:
        raise ValueError("Question options not found.")

    selected_set = {key.strip() for key in selected_keys if key and key.strip()}
    invalid = sorted(set(selected_set) - set(option_keys))
    if invalid:
        raise ValueError(f"Invalid option key(s): {', '.join(invalid)}")

    correct_set = set(_get_correct_keys(db, question_id))
    is_correct = selected_set == correct_set
    existing = db.execute(
        select(SessionAnswer).where(
            SessionAnswer.session_id == session.id,
            SessionAnswer.question_id == question_id,
        )
    ).scalar_one_or_none()

    if existing is None:
        db.add(
            SessionAnswer(
                session_id=session.id,
                question_id=question_id,
                selected_keys=",".join(sorted(selected_set)),
                is_correct=is_correct,
                elapsed_seconds=elapsed_seconds,
            )
        )
        if is_correct:
            session.correct_count += 1
        else:
            session.wrong_count += 1
    else:
        if existing.is_correct != is_correct:
            if existing.is_correct:
                session.correct_count -= 1
                session.wrong_count += 1
            else:
                session.wrong_count -= 1
                session.correct_count += 1
        existing.selected_keys = ",".join(sorted(selected_set))
        existing.is_correct = is_correct
        existing.elapsed_seconds = elapsed_seconds
        existing.answered_at = datetime.utcnow()

    session_row.last_viewed_at = datetime.utcnow()
    if auto_advance:
        _set_position(session, min(session_row.position + 1, max(session.total_questions - 1, 0)))
    else:
        _set_position(session, session_row.position)

    answered_count = _answered_count(session)
    if auto_submit_when_complete and answered_count >= session.total_questions:
        session.completed_at = datetime.utcnow()

    official_references = build_official_reference_summaries(db, question_id, limit=4)
    feedback_summary = build_feedback_summary(db, question_id, is_correct=is_correct)
    upsert_question_progress(
        db,
        question_id=question_id,
        mode="exam",
        is_correct=is_correct,
        owner_user_id=session.user_id,
        owner_client_key=session.client_key,
        confidence_level=None,
    )
    record_question_attempt_metrics(
        db,
        question_id=question_id,
        mode="exam",
        exam_id=question.exam_id,
        certification=question.certification,
        domain=question.domain,
        is_correct=is_correct,
        owner_user_id=session.user_id,
        owner_client_key=session.client_key,
        confidence_level=None,
        elapsed_seconds=elapsed_seconds,
        selection_strategy=session.selection_strategy,
    )
    db.flush()
    result_snapshot = _analyze_session(session, _get_session_rows(db, session.id))
    db.commit()
    db.refresh(session)

    return {
        "is_correct": is_correct,
        "justification": feedback_summary,
        "feedback_summary": feedback_summary,
        "progress_index": session.current_position,
        "current_position": session.current_position,
        "total_questions": session.total_questions,
        "answered_count": answered_count,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "finished": session.completed_at is not None,
        "official_references": official_references,
        "insight": result_snapshot["insight"]["live"],
        "marked_for_review_count": _marked_for_review_count(session),
    }


def toggle_mark_for_review(
    db: Session,
    session: ExamSession,
    *,
    question_id: str,
) -> dict[str, Any]:
    session_row = _find_session_question(session, question_id=question_id)
    if not session_row:
        raise ValueError("Question does not belong to this session.")
    session_row.marked_for_review = not bool(session_row.marked_for_review)
    session_row.last_viewed_at = datetime.utcnow()
    if session_row.position != session.current_position:
        _set_position(session, session_row.position)
    db.commit()
    db.refresh(session)
    return {
        "question_id": question_id,
        "marked_for_review": bool(session_row.marked_for_review),
        "marked_for_review_count": _marked_for_review_count(session),
        "current_position": session.current_position,
    }


def navigate_exam_session(
    db: Session,
    session: ExamSession,
    *,
    position: int,
) -> dict[str, Any]:
    if position < 0 or position >= session.total_questions:
        raise ValueError("Navigation target is outside the current session.")
    return get_exam_question_state(db, session, position=position)


def build_exam_review_screen(
    db: Session,
    session: ExamSession,
) -> dict[str, Any]:
    sync_exam_session_state(db, session)
    answer_map = {
        item.question_id: item
        for item in session.answers
    }
    items: list[dict[str, Any]] = []
    for session_row in sorted(session.questions, key=lambda item: item.position):
        answer = answer_map.get(session_row.question_id)
        items.append(
            {
                "position": session_row.position,
                "question_id": session_row.question_id,
                "answered": bool(answer),
                "selected_keys": [key for key in (answer.selected_keys.split(",") if answer and answer.selected_keys else []) if key],
                "marked_for_review": bool(session_row.marked_for_review),
                "is_current": session_row.position == session.current_position,
            }
        )
    answered = sum(1 for item in items if item["answered"])
    marked = sum(1 for item in items if item["marked_for_review"])
    return {
        "session_id": session.id,
        "total_questions": session.total_questions,
        "answered_count": answered,
        "unanswered_count": max(session.total_questions - answered, 0),
        "marked_for_review_count": marked,
        "current_position": session.current_position,
        "items": items,
    }


def submit_exam_session(
    db: Session,
    session: ExamSession,
) -> dict[str, Any]:
    sync_exam_session_state(db, session)
    if session.completed_at is None:
        session.completed_at = datetime.utcnow()
        db.commit()
        db.refresh(session)
    return compute_result(db, session)
