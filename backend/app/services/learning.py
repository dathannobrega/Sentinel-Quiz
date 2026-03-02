from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import select
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
    normalized_mode = "study" if str(mode or "").strip().lower() == "study" else "exam"
    normalized_confidence = str(confidence_level or "").strip().lower() or None
    normalized_client_key = None if owner_user_id else normalize_client_key(owner_client_key)

    progress = db.execute(
        _progress_query(question_id, owner_user_id, normalized_client_key)
    ).scalar_one_or_none()
    if not progress:
        progress = UserQuestionProgress(
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
        db.add(progress)
        db.flush()

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
    return progress
