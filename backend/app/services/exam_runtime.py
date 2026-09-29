"""Exam runtime (navigation, answers, review screen, submission).

Answers are exchanged in the session's display keys (per-session option shuffle,
M-C1) and stored with the original keys. Saving/changing an answer only updates the
session row; learning signals are recorded once at completion (M-C2, see
:func:`app.services.quiz.finalize_exam_session`).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ExamSession, Option, Question, SessionAnswer, SessionQuestion
from app.services.option_order import OptionMapping, option_keys_by_question, split_keys
from app.services.question_data import correct_option_keys, published_version_id
from app.services.quiz import (
    _analyze_session,
    _get_session_rows,
    complete_exam_session,
    compute_result,
    exam_answers_are_hidden,
    expire_exam_session_if_due,
    get_question_for_session,
    lock_exam_session,
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


def _mapping_for(db: Session, row: SessionQuestion, option_keys: list[str] | None = None) -> OptionMapping:
    keys = option_keys
    if keys is None:
        keys = option_keys_by_question(db, [row.question_id]).get(row.question_id, [])
    return OptionMapping.build(row.option_order_json, keys)


def _current_question_payload(db: Session, session: ExamSession, position: int) -> dict[str, Any] | None:
    row = _find_session_question(session, position=position)
    if not row:
        return None
    payload = get_question_for_session(db, session, position)
    if not payload:
        return None
    answer = next((item for item in session.answers if item.question_id == row.question_id), None)
    mapping = _mapping_for(db, row)
    payload["selected_keys"] = mapping.to_display(split_keys(answer.selected_keys)) if answer else []
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
    """Question at ``position`` and move the server-side cursor there.

    Moving the cursor (``current_position``/``last_viewed_at``) is the documented
    purpose of this call (the runner resumes from it), so it commits that navigation
    state; results/progress are never touched here.
    """
    expire_exam_session_if_due(db, session)
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
) -> dict[str, Any]:
    lock_exam_session(db, session)
    timing = sync_exam_session_state(db, session)
    if session.completed_at is not None:
        # Persist a timer auto-submission detected just now before refusing the answer.
        db.commit()
        if timing["remaining_seconds"] <= 0:
            raise ValueError("Session time limit expired. The exam was auto-submitted.")
        raise ValueError("Session already completed.")
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

    mapping = _mapping_for(db, session_row, option_keys)
    # Display keys -> original keys: grading, storage and analytics use original keys.
    original_selected = mapping.to_original(selected_keys)
    stored_keys = ",".join(original_selected)

    correct_keys = correct_option_keys(db, question_id)
    is_correct = set(original_selected) == set(correct_keys)
    question_version_id = published_version_id(db, question_id)
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
                question_version_id=question_version_id,
                selected_keys=stored_keys,
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
        existing.selected_keys = stored_keys
        existing.is_correct = is_correct
        existing.question_version_id = question_version_id
        existing.elapsed_seconds = elapsed_seconds
        existing.answered_at = datetime.utcnow()

    session_row.last_viewed_at = datetime.utcnow()
    _set_position(session, session_row.position)

    answered_count = _answered_count(session)

    db.flush()
    hidden = exam_answers_are_hidden(session)
    if hidden:
        # Exam-day mode (M-B4/audit): nothing that reveals correctness before the
        # session is completed - no verdict, key, justification, score or accuracy.
        db.commit()
        db.refresh(session)
        return {
            "is_correct": None,
            "justification": None,
            "feedback_summary": None,
            "progress_index": session.current_position,
            "current_position": session.current_position,
            "total_questions": session.total_questions,
            "answered_count": answered_count,
            "correct_count": None,
            "wrong_count": None,
            "finished": False,
            "official_references": [],
            "insight": None,
            "marked_for_review_count": _marked_for_review_count(session),
            "correct_keys": None,
            "selected_keys": mapping.to_display(original_selected),
        }

    official_references = build_official_reference_summaries(db, question_id, limit=4)
    feedback_summary = mapping.remap_text(build_feedback_summary(db, question_id, is_correct=is_correct))
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
        # Answer key in this session's display keys.
        "correct_keys": mapping.to_display(correct_keys),
        "selected_keys": mapping.to_display(original_selected),
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


def build_exam_review_screen(
    db: Session,
    session: ExamSession,
) -> dict[str, Any]:
    """Read-only overview of answered/marked questions (display keys)."""
    expire_exam_session_if_due(db, session)
    answer_map = {
        item.question_id: item
        for item in session.answers
    }
    ordered_rows = sorted(session.questions, key=lambda item: item.position)
    keys_map = option_keys_by_question(db, [row.question_id for row in ordered_rows])
    items: list[dict[str, Any]] = []
    for session_row in ordered_rows:
        answer = answer_map.get(session_row.question_id)
        mapping = OptionMapping.build(session_row.option_order_json, keys_map.get(session_row.question_id, []))
        items.append(
            {
                "position": session_row.position,
                "question_id": session_row.question_id,
                "answered": bool(answer),
                "selected_keys": mapping.to_display(split_keys(answer.selected_keys)) if answer else [],
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
    """Complete the exam (once): records progress/metrics/SRS, then returns the result.

    Concurrent submits are serialized by the row lock and the conditional
    ``completed_at`` update (see :func:`app.services.quiz.complete_exam_session`): only
    one of them finalizes; the others return the same result.
    """
    lock_exam_session(db, session)
    sync_exam_session_state(db, session)
    if session.completed_at is None:
        complete_exam_session(db, session)
    db.commit()
    db.refresh(session)
    return compute_result(db, session)
