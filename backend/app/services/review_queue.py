"""Spaced-repetition review queue (SM-2 style policy) and its snapshot."""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ReviewQueueItem, ReviewSchedule
from app.services.auth import normalize_client_key
from app.services.metrics import record_review_schedule_event
from app.services.owner_scope import require_owner_filters
from app.services.pedagogy import normalize_confidence_level as normalize_pedagogical_confidence
from app.services.question_pool import (
    normalize_domain_filters,
    owner_bookmark_question_ids,
    owner_note_question_ids,
    review_queue_candidates,
)
from app.services.serialization import truncate_text


REVIEW_FORECAST_DAYS = 7


def _classify_review_queue_item(
    *,
    due_at: datetime | None,
    repetition_count: int,
    stability_score: float,
    ease_factor: float,
    now: datetime,
) -> tuple[str, int, bool]:
    overdue_days = 0
    is_overdue = False
    state = "scheduled"
    if due_at and due_at <= now:
        state = "due_now"
        overdue_days = max(int((now - due_at).total_seconds() // 86400), 0)
        is_overdue = overdue_days > 0
    elif due_at and (due_at - now) <= timedelta(days=2):
        state = "at_risk"
    elif repetition_count >= 5 and stability_score >= 18 and ease_factor >= 2.55:
        state = "mastered"
    return state, overdue_days, is_overdue


def _normalize_review_state_filters(states: list[str] | None) -> list[str]:
    allowed = {"due_today", "overdue", "at_risk", "scheduled", "mastered", "due_now"}
    normalized: list[str] = []
    seen: set[str] = set()
    for value in states or []:
        label = str(value or "").strip().lower()
        if label not in allowed or label in seen:
            continue
        seen.add(label)
        normalized.append(label)
    return normalized


def _normalize_confidence_level(value: str | None) -> str:
    return normalize_pedagogical_confidence(value)


def _quality_from_attempt(is_correct: bool, confidence_level: str, elapsed_seconds: int | None = None) -> int:
    if not is_correct:
        return 1 if confidence_level == "high" else 2
    quality = 5
    if confidence_level == "low":
        quality = 3
    elif confidence_level == "medium":
        quality = 4

    if elapsed_seconds is not None:
        if elapsed_seconds >= 150:
            quality = max(quality - 2, 3)
        elif elapsed_seconds >= 90:
            quality = max(quality - 1, 3)
        elif elapsed_seconds <= 20 and confidence_level == "high":
            quality = min(quality + 1, 5)
    return quality


def _review_policy(
    is_correct: bool,
    confidence_level: str,
    previous_item: ReviewQueueItem | None = None,
    elapsed_seconds: int | None = None,
) -> dict[str, Any]:
    quality = _quality_from_attempt(is_correct, confidence_level, elapsed_seconds)
    previous_interval = max(int(previous_item.interval_days), 1) if previous_item and previous_item.interval_days else 1
    previous_repetitions = max(int(previous_item.repetition_count), 0) if previous_item else 0
    previous_lapses = max(int(previous_item.lapse_count), 0) if previous_item else 0
    previous_ease = float(previous_item.ease_factor) if previous_item and previous_item.ease_factor else 2.5
    previous_stability = float(previous_item.stability_score) if previous_item and previous_item.stability_score else 0.0

    if quality < 3:
        lapse_count = previous_lapses + 1
        repetition_count = 0
        ease_factor = max(1.3, round(previous_ease - 0.2 - (0.15 * lapse_count), 2))
        interval_days = 1 if quality <= 1 else 2
        stability_score = max(0.4, round(previous_stability * 0.55 + (quality * 0.25), 2))
        trigger_reason = "srs_relearn"
    else:
        repetition_count = previous_repetitions + 1
        lapse_count = previous_lapses
        ease_delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
        ease_factor = max(1.3, round(previous_ease + ease_delta, 2))
        if repetition_count == 1:
            interval_days = 1
        elif repetition_count == 2:
            interval_days = 3 if quality == 3 else 4
        else:
            growth = ease_factor + (previous_stability / 10.0)
            if quality == 3:
                growth *= 0.85
            elif quality == 5:
                growth *= 1.08
            interval_days = max(int(round(previous_interval * growth)), previous_interval + 1)
        interval_days = min(max(interval_days, 1), 60)
        stability_gain = 0.9 + (quality - 2) * 0.55 + (repetition_count * 0.15)
        stability_score = round(max(previous_stability + stability_gain, float(interval_days)), 2)
        trigger_reason = "srs_review"

    return {
        "quality": quality,
        "interval_days": interval_days,
        "repetition_count": repetition_count,
        "lapse_count": lapse_count,
        "ease_factor": ease_factor,
        "stability_score": stability_score,
        "trigger_reason": trigger_reason,
    }


def _owner_review_item_query(
    question_id: str,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
):
    stmt = select(ReviewQueueItem).where(ReviewQueueItem.question_id == question_id)
    return require_owner_filters(stmt, ReviewQueueItem, owner_user_id, owner_client_key)


def _upsert_review_queue_item(
    db: Session,
    *,
    question_id: str,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    is_correct: bool,
    confidence_level: str,
    attempted_at: datetime,
    elapsed_seconds: int | None = None,
) -> ReviewQueueItem:
    item = db.execute(
        _owner_review_item_query(question_id, owner_user_id, owner_client_key)
    ).scalar_one_or_none()
    srs_state = _review_policy(is_correct, confidence_level, item, elapsed_seconds)
    interval_days = int(srs_state["interval_days"])
    quality = int(srs_state["quality"])
    trigger_reason = str(srs_state["trigger_reason"])
    due_at = attempted_at + timedelta(days=interval_days)

    if not item:
        item = ReviewQueueItem(
            user_id=owner_user_id,
            client_key=None if owner_user_id else normalize_client_key(owner_client_key),
            question_id=question_id,
            due_at=due_at,
            interval_days=interval_days,
            repetition_count=int(srs_state["repetition_count"]),
            lapse_count=int(srs_state["lapse_count"]),
            ease_factor=float(srs_state["ease_factor"]),
            stability_score=float(srs_state["stability_score"]),
            last_quality=quality,
            last_outcome="correct" if is_correct else "wrong",
            confidence_level=confidence_level,
            last_attempt_at=attempted_at,
            created_at=attempted_at,
            updated_at=attempted_at,
        )
        db.add(item)
        db.flush()
    else:
        item.due_at = due_at
        item.interval_days = interval_days
        item.repetition_count = int(srs_state["repetition_count"])
        item.lapse_count = int(srs_state["lapse_count"])
        item.ease_factor = float(srs_state["ease_factor"])
        item.stability_score = float(srs_state["stability_score"])
        item.last_quality = quality
        item.last_outcome = "correct" if is_correct else "wrong"
        item.confidence_level = confidence_level
        item.last_attempt_at = attempted_at
        item.updated_at = attempted_at

    db.add(
        ReviewSchedule(
            review_queue_id=item.id,
            scheduled_for=due_at,
            interval_days=interval_days,
            trigger_reason=trigger_reason,
            created_at=attempted_at,
        )
    )
    record_review_schedule_event(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        scheduled_at=attempted_at,
    )
    return item


def build_review_queue_snapshot(
    db: Session,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
    exam_id: Optional[str] = None,
    domains: Optional[list[str]] = None,
    review_states: Optional[list[str]] = None,
    bookmarked_only: bool = False,
    notes_only: bool = False,
    limit: int = 12,
) -> dict[str, Any]:
    normalized_domains = normalize_domain_filters(domains)
    normalized_states = _normalize_review_state_filters(review_states)
    queue_rows = review_queue_candidates(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    )
    all_bookmark_ids = owner_bookmark_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    )
    all_note_ids = owner_note_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    )
    bookmark_ids = all_bookmark_ids if bookmarked_only else set()
    note_ids = all_note_ids if notes_only else set()
    now = datetime.utcnow()
    state_breakdown = {
        "due_now": 0,
        "overdue": 0,
        "at_risk": 0,
        "scheduled": 0,
        "mastered": 0,
    }
    forecast_days: list[dict[str, Any]] = []
    today = now.date()

    filtered_rows: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    for row in queue_rows:
        due_at = row.get("due_at")
        repetition_count = int(row.get("repetition_count") or 0)
        stability_score = float(row.get("stability_score") or 0.0)
        ease_factor = float(row.get("ease_factor") or 2.5)
        state, overdue_days, is_overdue = _classify_review_queue_item(
            due_at=due_at,
            repetition_count=repetition_count,
            stability_score=stability_score,
            ease_factor=ease_factor,
            now=now,
        )
        if bookmarked_only and row["question_id"] not in bookmark_ids:
            continue
        if notes_only and row["question_id"] not in note_ids:
            continue
        if normalized_states:
            matched = False
            for requested_state in normalized_states:
                if requested_state == "overdue" and is_overdue:
                    matched = True
                    break
                if requested_state == "due_today" and state == "due_now" and not is_overdue:
                    matched = True
                    break
                if requested_state == state:
                    matched = True
                    break
            if not matched:
                continue
        filtered_rows.append(row)
        state_breakdown[state] = int(state_breakdown.get(state, 0)) + 1
        if is_overdue:
            state_breakdown["overdue"] = int(state_breakdown.get("overdue", 0)) + 1
        if len(items) >= max(limit, 1):
            continue
        items.append({
            "question_id": row["question_id"],
            "prompt": truncate_text(row.get("prompt") or "", 120),
            "due_at": due_at.isoformat() if due_at else None,
            "state": state,
            "is_overdue": is_overdue,
            "overdue_days": overdue_days,
            "domain": row.get("domain"),
            "certification": row.get("certification"),
            "repetition_count": repetition_count,
            "stability_score": round(stability_score, 2),
            "ease_factor": round(ease_factor, 2),
            "bookmarked": row["question_id"] in all_bookmark_ids,
            "has_note": row["question_id"] in all_note_ids,
        })

    due_rows = [row for row in filtered_rows if row.get("due_at") and row["due_at"] <= now]
    next_due_at = None
    if filtered_rows:
        first_due = filtered_rows[0].get("due_at")
        next_due_at = first_due.isoformat() if first_due else None

    due_count = len(due_rows)
    at_risk_count = int(state_breakdown["at_risk"])
    recommended_batch_size = min(max(due_count, 0), 20)
    if recommended_batch_size == 0 and filtered_rows:
        recommended_batch_size = min(len(filtered_rows), 10)

    for offset in range(REVIEW_FORECAST_DAYS):
        target_date = today + timedelta(days=offset)
        at_risk_window_end = target_date + timedelta(days=2)
        due_for_day = 0
        at_risk_for_day = 0

        for row in filtered_rows:
            due_at = row.get("due_at")
            if not due_at:
                continue
            due_date = due_at.date()
            effective_due_date = today if due_at <= now else due_date
            if effective_due_date == target_date:
                due_for_day += 1
                continue
            if due_date > target_date and due_date <= at_risk_window_end:
                at_risk_for_day += 1

        forecast_days.append({
            "date": target_date.isoformat(),
            "label": target_date.strftime("%d/%m"),
            "due_count": due_for_day,
            "at_risk_count": at_risk_for_day,
        })

    daily_review_target = 0
    weekly_review_target = 0
    new_question_budget = 0
    if filtered_rows:
        daily_review_target = min(max(due_count + math.ceil(at_risk_count / 2), 6), 25)
        weekly_review_target = min(max(due_count + at_risk_count + math.ceil(len(filtered_rows) * 0.15), daily_review_target), 140)
        new_question_budget = max(min(weekly_review_target - max(due_count + at_risk_count, 0), 30), 0)

    return {
        "due_count": due_count,
        "total_count": len(filtered_rows),
        "next_due_at": next_due_at,
        "recommended_batch_size": recommended_batch_size,
        "state_breakdown": state_breakdown,
        "upcoming_load": forecast_days,
        "goals": {
            "daily_review_target": daily_review_target,
            "weekly_review_target": weekly_review_target,
            "new_question_budget": new_question_budget,
        },
        "applied_filters": {
            "review_states": normalized_states,
            "bookmarked_only": bool(bookmarked_only),
            "notes_only": bool(notes_only),
        },
        "items": items,
    }


def schedule_exam_answer_for_review(
    db: Session,
    *,
    question_id: str,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    is_correct: bool,
    attempted_at: datetime,
    elapsed_seconds: int | None = None,
) -> ReviewQueueItem | None:
    """Feed a finished exam answer into the SRS queue (M-C2).

    Exams collect no confidence signal, so the answer is graded as ``medium``
    confidence with the same SM-2 policy used for study answers: a wrong answer becomes
    a relearn item due in 1-2 days; a correct answer only advances an item that is
    already queued (a long exam must not flood the queue with known items).
    """
    if is_correct:
        existing = db.execute(
            _owner_review_item_query(question_id, owner_user_id, owner_client_key)
        ).scalar_one_or_none()
        if existing is None:
            return None
    return _upsert_review_queue_item(
        db,
        question_id=question_id,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        is_correct=is_correct,
        confidence_level="medium",
        attempted_at=attempted_at,
        elapsed_seconds=elapsed_seconds,
    )
