from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Optional

from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.models import UserQuestionProgress
from app.services.auth import normalize_client_key


def _progress_query(question_id: str, owner_user_id: Optional[str], owner_client_key: Optional[str]):
    stmt = select(UserQuestionProgress).where(UserQuestionProgress.question_id == question_id)
    if owner_user_id:
        return stmt.where(UserQuestionProgress.user_id == owner_user_id)
    normalized_client_key = normalize_client_key(owner_client_key)
    if normalized_client_key:
        return stmt.where(
            UserQuestionProgress.user_id.is_(None),
            UserQuestionProgress.client_key == normalized_client_key,
        )
    raise ValueError("Owner scope is required for progress tracking.")


def _mastery_score(
    *,
    total_attempts: int,
    correct_count: int,
    wrong_count: int,
    correct_streak: int,
    confidence_level: str | None,
    mode: str,
) -> float:
    if total_attempts <= 0:
        return 0.0

    accuracy = correct_count / total_attempts
    confidence_bonus = 0.0
    if confidence_level == "high":
        confidence_bonus = 0.08
    elif confidence_level == "medium":
        confidence_bonus = 0.03
    elif confidence_level == "low":
        confidence_bonus = -0.04

    mode_bonus = 0.03 if mode == "study" else 0.0
    streak_bonus = min(correct_streak * 0.025, 0.2)
    error_penalty = min((wrong_count / max(total_attempts, 1)) * 0.2, 0.2)

    raw_score = (accuracy * 0.72) + confidence_bonus + mode_bonus + streak_bonus - error_penalty
    return round(max(0.0, min(raw_score, 1.0)) * 100.0, 2)


def _normalize_mode(mode: str | None) -> str:
    return "study" if str(mode or "").strip().lower() == "study" else "exam"


def _new_progress(
    *,
    question_id: str,
    owner_user_id: Optional[str],
    normalized_client_key: Optional[str],
    normalized_mode: str,
    normalized_confidence: Optional[str],
    is_correct: bool,
    timestamp: datetime,
) -> UserQuestionProgress:
    return UserQuestionProgress(
        user_id=owner_user_id,
        client_key=normalized_client_key,
        question_id=question_id,
        first_seen_at=timestamp,
        last_seen_at=timestamp,
        total_attempts=0,
        exam_attempts=0,
        study_attempts=0,
        correct_count=0,
        wrong_count=0,
        correct_streak=0,
        wrong_streak=0,
        mastery_score=0.0,
        last_mode=normalized_mode,
        last_confidence_level=normalized_confidence,
        last_is_correct=is_correct,
        created_at=timestamp,
        updated_at=timestamp,
    )


def _apply_attempt(
    progress: UserQuestionProgress,
    *,
    normalized_mode: str,
    normalized_confidence: Optional[str],
    is_correct: bool,
    timestamp: datetime,
) -> None:
    progress.last_seen_at = timestamp
    progress.total_attempts += 1
    if normalized_mode == "study":
        progress.study_attempts += 1
    else:
        progress.exam_attempts += 1

    if is_correct:
        progress.correct_count += 1
        progress.correct_streak += 1
        progress.wrong_streak = 0
    else:
        progress.wrong_count += 1
        progress.wrong_streak += 1
        progress.correct_streak = 0

    progress.last_mode = normalized_mode
    progress.last_confidence_level = normalized_confidence
    progress.last_is_correct = is_correct
    progress.mastery_score = _mastery_score(
        total_attempts=progress.total_attempts,
        correct_count=progress.correct_count,
        wrong_count=progress.wrong_count,
        correct_streak=progress.correct_streak,
        confidence_level=normalized_confidence,
        mode=normalized_mode,
    )
    progress.updated_at = timestamp


def upsert_question_progress(
    db: Session,
    *,
    question_id: str,
    mode: str,
    is_correct: bool,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    confidence_level: str | None = None,
    attempted_at: Optional[datetime] = None,
) -> UserQuestionProgress:
    timestamp = attempted_at or datetime.utcnow()
    normalized_mode = _normalize_mode(mode)
    normalized_confidence = str(confidence_level or "").strip().lower() or None
    normalized_client_key = None if owner_user_id else normalize_client_key(owner_client_key)

    progress = db.execute(
        _progress_query(question_id, owner_user_id, normalized_client_key)
    ).scalar_one_or_none()
    if not progress:
        progress = _new_progress(
            question_id=question_id,
            owner_user_id=owner_user_id,
            normalized_client_key=normalized_client_key,
            normalized_mode=normalized_mode,
            normalized_confidence=normalized_confidence,
            is_correct=is_correct,
            timestamp=timestamp,
        )
        db.add(progress)
        db.flush()

    _apply_attempt(
        progress,
        normalized_mode=normalized_mode,
        normalized_confidence=normalized_confidence,
        is_correct=is_correct,
        timestamp=timestamp,
    )
    return progress


def record_question_progress_batch(
    db: Session,
    attempts: Iterable[dict[str, Any]],
    *,
    mode: str,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> dict[str, UserQuestionProgress]:
    """Bulk :func:`upsert_question_progress`: one SELECT plus one multi-row INSERT.

    Existing rows are updated through the unit of work; new rows are inserted
    immediately, so the returned objects for new questions are transient snapshots.

    ``attempts`` are processed in order; each item has ``question_id``,
    ``is_correct``, ``attempted_at`` and optionally ``confidence_level``.
    """
    items = list(attempts)
    if not items:
        return {}
    normalized_mode = _normalize_mode(mode)
    normalized_client_key = None if owner_user_id else normalize_client_key(owner_client_key)
    if not owner_user_id and not normalized_client_key:
        raise ValueError("Owner scope is required for progress tracking.")
    question_ids = sorted({str(item["question_id"]) for item in items})
    stmt = select(UserQuestionProgress).where(UserQuestionProgress.question_id.in_(question_ids))
    if owner_user_id:
        stmt = stmt.where(UserQuestionProgress.user_id == owner_user_id)
    else:
        stmt = stmt.where(
            UserQuestionProgress.user_id.is_(None),
            UserQuestionProgress.client_key == normalized_client_key,
        )
    progress_by_question = {row.question_id: row for row in db.execute(stmt).scalars().all()}
    new_rows: list[UserQuestionProgress] = []

    for item in items:
        question_id = str(item["question_id"])
        is_correct = bool(item["is_correct"])
        timestamp = item.get("attempted_at") or datetime.utcnow()
        normalized_confidence = str(item.get("confidence_level") or "").strip().lower() or None
        progress = progress_by_question.get(question_id)
        if progress is None:
            progress = _new_progress(
                question_id=question_id,
                owner_user_id=owner_user_id,
                normalized_client_key=normalized_client_key,
                normalized_mode=normalized_mode,
                normalized_confidence=normalized_confidence,
                is_correct=is_correct,
                timestamp=timestamp,
            )
            # Transient: inserted below with one executemany (no per-row RETURNING).
            new_rows.append(progress)
            progress_by_question[question_id] = progress
        _apply_attempt(
            progress,
            normalized_mode=normalized_mode,
            normalized_confidence=normalized_confidence,
            is_correct=is_correct,
            timestamp=timestamp,
        )
    if new_rows:
        db.execute(insert(UserQuestionProgress), [_column_values(row) for row in new_rows])
    return progress_by_question


def _column_values(row: UserQuestionProgress) -> dict[str, Any]:
    return {
        column.key: getattr(row, column.key)
        for column in UserQuestionProgress.__table__.columns
        if column.key != "id"
    }
