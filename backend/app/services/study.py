from __future__ import annotations

import json
import math
import random
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Exam,
    ExamSession,
    Explanation,
    Option,
    Question,
    ReviewQueueItem,
    ReviewSchedule,
    SessionAnswer,
    SessionQuestion,
    StudyAttempt,
    StudySession,
    StudySessionQuestion,
    User,
    UserBookmark,
    UserNote,
)
from app.services.learning import upsert_question_progress
from app.services.auth import normalize_client_key


NOTE_MAX_LENGTH = 4000
RECENT_ITEM_LIMIT = 3
QUEUE_PREVIEW_LIMIT = 5
CONFIDENCE_LEVELS = {"low", "medium", "high"}
WEEKLY_ANALYTICS_DEFAULT_WEEKS = 8
REVIEW_FORECAST_DAYS = 7
SAFE_FEEDBACK_MAX_CHARS = 240


def _scope_label(owner_user_id: Optional[str], owner_client_key: Optional[str]) -> str:
    return "user" if owner_user_id else "device"


def _apply_owner_filters(stmt, model, owner_user_id: Optional[str], owner_client_key: Optional[str]):
    if owner_user_id:
        return stmt.where(model.user_id == owner_user_id)
    normalized_client_key = normalize_client_key(owner_client_key)
    if normalized_client_key:
        return stmt.where(model.user_id.is_(None), model.client_key == normalized_client_key)
    raise ValueError("Owner scope is required.")


def _normalize_note_text(note_text: str | None) -> str | None:
    raw = str(note_text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not raw:
        return None
    if len(raw) > NOTE_MAX_LENGTH:
        raise ValueError(f"Note must be at most {NOTE_MAX_LENGTH} characters.")
    return raw


def _question_or_error(db: Session, question_id: str) -> Question:
    question = db.get(Question, question_id)
    if not question:
        raise ValueError("Question not found.")
    return question


def _state_query(db: Session, model, question_id: str, owner_user_id: Optional[str], owner_client_key: Optional[str]):
    stmt = select(model).where(model.question_id == question_id)
    stmt = _apply_owner_filters(stmt, model, owner_user_id, owner_client_key)
    return db.execute(stmt).scalar_one_or_none()


def _serialize_state(
    question_id: str,
    bookmark: UserBookmark | None,
    note: UserNote | None,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> dict[str, Any]:
    candidates = [item.updated_at for item in (bookmark, note) if item and item.updated_at]
    updated_at = max(candidates).isoformat() if candidates else None
    return {
        "question_id": question_id,
        "bookmarked": bool(bookmark),
        "note_text": note.note_text if note else None,
        "updated_at": updated_at,
        "scope": _scope_label(owner_user_id, owner_client_key),
    }


def get_question_state(
    db: Session,
    question_id: str,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> dict[str, Any]:
    _question_or_error(db, question_id)
    bookmark = _state_query(db, UserBookmark, question_id, owner_user_id, owner_client_key)
    note = _state_query(db, UserNote, question_id, owner_user_id, owner_client_key)
    return _serialize_state(question_id, bookmark, note, owner_user_id, owner_client_key)


def set_question_state(
    db: Session,
    question_id: str,
    *,
    bookmarked: bool,
    note_text: str | None = None,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> dict[str, Any]:
    _question_or_error(db, question_id)
    normalized_client_key = normalize_client_key(owner_client_key)
    normalized_note = _normalize_note_text(note_text)
    now = datetime.utcnow()

    bookmark = _state_query(db, UserBookmark, question_id, owner_user_id, normalized_client_key)
    note = _state_query(db, UserNote, question_id, owner_user_id, normalized_client_key)
    changed = False

    if bookmarked:
        if not bookmark:
            bookmark = UserBookmark(
                user_id=owner_user_id,
                client_key=None if owner_user_id else normalized_client_key,
                question_id=question_id,
                created_at=now,
                updated_at=now,
            )
            db.add(bookmark)
        else:
            bookmark.updated_at = now
        changed = True
    elif bookmark:
        db.delete(bookmark)
        bookmark = None
        changed = True

    if normalized_note:
        if not note:
            note = UserNote(
                user_id=owner_user_id,
                client_key=None if owner_user_id else normalized_client_key,
                question_id=question_id,
                note_text=normalized_note,
                created_at=now,
                updated_at=now,
            )
            db.add(note)
        else:
            note.note_text = normalized_note
            note.updated_at = now
        changed = True
    elif note:
        db.delete(note)
        note = None
        changed = True

    if changed:
        db.commit()

    return _serialize_state(question_id, bookmark, note, owner_user_id, normalized_client_key)


def _truncate_text(value: str, limit: int = 160) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: max(limit - 1, 0)].rstrip() + "..."


def _due_review_items_query(owner_user_id: Optional[str], owner_client_key: Optional[str]):
    stmt = (
        select(ReviewQueueItem.question_id, ReviewQueueItem.due_at, Question.prompt)
        .join(Question, Question.id == ReviewQueueItem.question_id)
        .order_by(ReviewQueueItem.due_at.asc())
    )
    return _apply_owner_filters(stmt, ReviewQueueItem, owner_user_id, owner_client_key)


def count_due_review_items(
    db: Session,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
    due_at_or_before: Optional[datetime] = None,
) -> int:
    due_cutoff = due_at_or_before or datetime.utcnow()
    stmt = select(func.count()).select_from(ReviewQueueItem).where(ReviewQueueItem.due_at <= due_cutoff)
    stmt = _apply_owner_filters(stmt, ReviewQueueItem, owner_user_id, owner_client_key)
    return int(db.execute(stmt).scalar_one() or 0)


def build_study_overview(
    db: Session,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> dict[str, Any]:
    bookmark_count_stmt = select(func.count()).select_from(UserBookmark)
    bookmark_count_stmt = _apply_owner_filters(bookmark_count_stmt, UserBookmark, owner_user_id, owner_client_key)
    bookmark_count = int(db.execute(bookmark_count_stmt).scalar_one() or 0)

    note_count_stmt = select(func.count()).select_from(UserNote)
    note_count_stmt = _apply_owner_filters(note_count_stmt, UserNote, owner_user_id, owner_client_key)
    note_count = int(db.execute(note_count_stmt).scalar_one() or 0)

    recent_bookmarks_stmt = (
        select(UserBookmark.question_id, UserBookmark.updated_at, Question.prompt)
        .join(Question, Question.id == UserBookmark.question_id)
        .order_by(UserBookmark.updated_at.desc())
        .limit(RECENT_ITEM_LIMIT)
    )
    recent_bookmarks_stmt = _apply_owner_filters(recent_bookmarks_stmt, UserBookmark, owner_user_id, owner_client_key)
    recent_bookmarks = [
        {
            "question_id": question_id,
            "prompt": _truncate_text(prompt, 120),
            "updated_at": updated_at.isoformat() if updated_at else None,
            "excerpt": None,
        }
        for question_id, updated_at, prompt in db.execute(recent_bookmarks_stmt).all()
    ]

    recent_notes_stmt = (
        select(UserNote.question_id, UserNote.updated_at, UserNote.note_text, Question.prompt)
        .join(Question, Question.id == UserNote.question_id)
        .order_by(UserNote.updated_at.desc())
        .limit(RECENT_ITEM_LIMIT)
    )
    recent_notes_stmt = _apply_owner_filters(recent_notes_stmt, UserNote, owner_user_id, owner_client_key)
    recent_notes = [
        {
            "question_id": question_id,
            "prompt": _truncate_text(prompt, 120),
            "updated_at": updated_at.isoformat() if updated_at else None,
            "excerpt": _truncate_text(note_text, 120),
        }
        for question_id, updated_at, note_text, prompt in db.execute(recent_notes_stmt).all()
    ]

    due_now = datetime.utcnow()
    due_review_count = count_due_review_items(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        due_at_or_before=due_now,
    )
    due_reviews_stmt = _due_review_items_query(owner_user_id, owner_client_key).limit(QUEUE_PREVIEW_LIMIT)
    due_reviews = []
    next_due_at = None
    for question_id, due_at, prompt in db.execute(due_reviews_stmt).all():
        if next_due_at is None and due_at:
            next_due_at = due_at.isoformat()
        if due_at and due_at > due_now:
            continue
        due_reviews.append({
            "question_id": question_id,
            "prompt": _truncate_text(prompt, 120),
            "updated_at": due_at.isoformat() if due_at else None,
            "excerpt": "Revisao vencida" if due_at and due_at <= due_now else "Proxima revisao agendada",
        })

    return {
        "scope": _scope_label(owner_user_id, owner_client_key),
        "bookmark_count": bookmark_count,
        "note_count": note_count,
        "due_review_count": due_review_count,
        "next_due_at": next_due_at,
        "recent_bookmarks": recent_bookmarks,
        "recent_notes": recent_notes,
        "due_reviews": due_reviews,
    }


def build_review_queue_snapshot(
    db: Session,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
    exam_id: Optional[str] = None,
    domains: Optional[list[str]] = None,
    limit: int = 12,
) -> dict[str, Any]:
    normalized_domains = _normalize_domain_filters(domains)
    queue_rows = _review_queue_candidates(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    )
    now = datetime.utcnow()
    due_rows = [row for row in queue_rows if row.get("due_at") and row["due_at"] <= now]
    next_due_at = None
    if queue_rows:
        first_due = queue_rows[0].get("due_at")
        next_due_at = first_due.isoformat() if first_due else None

    state_breakdown = {
        "due_now": 0,
        "at_risk": 0,
        "scheduled": 0,
        "mastered": 0,
    }
    forecast_days: list[dict[str, Any]] = []
    today = now.date()

    def classify_queue_state(
        *,
        due_at: datetime | None,
        repetition_count: int,
        stability_score: float,
        ease_factor: float,
    ) -> tuple[str, int]:
        overdue_days = 0
        state = "scheduled"
        if due_at and due_at <= now:
            state = "due_now"
            overdue_days = max(int((now - due_at).total_seconds() // 86400), 0)
        elif due_at and (due_at - now) <= timedelta(days=2):
            state = "at_risk"
        elif repetition_count >= 5 and stability_score >= 18 and ease_factor >= 2.55:
            state = "mastered"
        return state, overdue_days

    items: list[dict[str, Any]] = []
    for row in queue_rows:
        due_at = row.get("due_at")
        repetition_count = int(row.get("repetition_count") or 0)
        stability_score = float(row.get("stability_score") or 0.0)
        ease_factor = float(row.get("ease_factor") or 2.5)
        state, overdue_days = classify_queue_state(
            due_at=due_at,
            repetition_count=repetition_count,
            stability_score=stability_score,
            ease_factor=ease_factor,
        )
        state_breakdown[state] = int(state_breakdown.get(state, 0)) + 1
        if len(items) >= max(limit, 1):
            continue
        items.append({
            "question_id": row["question_id"],
            "prompt": _truncate_text(row.get("prompt") or "", 120),
            "due_at": due_at.isoformat() if due_at else None,
            "state": state,
            "overdue_days": overdue_days,
            "domain": row.get("domain"),
            "certification": row.get("certification"),
            "repetition_count": repetition_count,
            "stability_score": round(stability_score, 2),
            "ease_factor": round(ease_factor, 2),
        })

    due_count = len(due_rows)
    at_risk_count = int(state_breakdown["at_risk"])
    recommended_batch_size = min(max(due_count, 0), 20)
    if recommended_batch_size == 0 and queue_rows:
        recommended_batch_size = min(len(queue_rows), 10)

    for offset in range(REVIEW_FORECAST_DAYS):
        target_date = today + timedelta(days=offset)
        at_risk_window_end = target_date + timedelta(days=2)
        due_for_day = 0
        at_risk_for_day = 0

        for row in queue_rows:
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
    if queue_rows:
        daily_review_target = min(max(due_count + math.ceil(at_risk_count / 2), 6), 25)
        weekly_review_target = min(max(due_count + at_risk_count + math.ceil(len(queue_rows) * 0.15), daily_review_target), 140)
        new_question_budget = max(min(weekly_review_target - max(due_count + at_risk_count, 0), 30), 0)

    return {
        "due_count": due_count,
        "total_count": len(queue_rows),
        "next_due_at": next_due_at,
        "recommended_batch_size": recommended_batch_size,
        "state_breakdown": state_breakdown,
        "upcoming_load": forecast_days,
        "goals": {
            "daily_review_target": daily_review_target,
            "weekly_review_target": weekly_review_target,
            "new_question_budget": new_question_budget,
        },
        "items": items,
    }


def _week_start_utc(value: datetime) -> datetime:
    base = value.replace(hour=0, minute=0, second=0, microsecond=0)
    return base - timedelta(days=base.weekday())


def _week_label(week_start: datetime) -> str:
    week_end = week_start + timedelta(days=6)
    return f"{week_start.strftime('%d/%m')} - {week_end.strftime('%d/%m')}"


def build_weekly_study_analytics(
    db: Session,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
    weeks: int = WEEKLY_ANALYTICS_DEFAULT_WEEKS,
) -> dict[str, Any]:
    total_weeks = max(2, min(int(weeks or WEEKLY_ANALYTICS_DEFAULT_WEEKS), 24))
    now = datetime.utcnow()
    current_week_start = _week_start_utc(now)
    range_start = current_week_start - timedelta(days=7 * (total_weeks - 1))

    ordered_week_keys: list[str] = []
    buckets: dict[str, dict[str, Any]] = {}
    for index in range(total_weeks):
        week_start = range_start + timedelta(days=index * 7)
        week_end = week_start + timedelta(days=6)
        key = week_start.date().isoformat()
        ordered_week_keys.append(key)
        buckets[key] = {
            "week_start": week_start,
            "week_end": week_end,
            "label": _week_label(week_start),
            "study_questions": 0,
            "review_questions": 0,
            "scheduled_reviews": 0,
            "completed_sessions": 0,
            "review_sessions": 0,
            "correct_count": 0,
            "low_confidence": 0,
        }

    session_stmt = select(StudySession.selection_strategy, StudySession.completed_at).where(
        StudySession.completed_at.is_not(None),
        StudySession.completed_at >= range_start,
    )
    session_stmt = _apply_owner_filters(session_stmt, StudySession, owner_user_id, owner_client_key)
    for selection_strategy, completed_at in db.execute(session_stmt).all():
        if not completed_at:
            continue
        key = _week_start_utc(completed_at).date().isoformat()
        bucket = buckets.get(key)
        if not bucket:
            continue
        bucket["completed_sessions"] += 1
        if str(selection_strategy or "").strip().lower() == "review":
            bucket["review_sessions"] += 1

    attempt_stmt = (
        select(
            StudyAttempt.answered_at,
            StudyAttempt.is_correct,
            StudyAttempt.confidence_level,
            StudySession.selection_strategy,
        )
        .join(StudySession, StudySession.id == StudyAttempt.session_id)
        .where(StudyAttempt.answered_at >= range_start)
    )
    attempt_stmt = _apply_owner_filters(attempt_stmt, StudySession, owner_user_id, owner_client_key)
    for answered_at, is_correct, confidence_level, selection_strategy in db.execute(attempt_stmt).all():
        if not answered_at:
            continue
        key = _week_start_utc(answered_at).date().isoformat()
        bucket = buckets.get(key)
        if not bucket:
            continue
        bucket["study_questions"] += 1
        if bool(is_correct):
            bucket["correct_count"] += 1
        if str(selection_strategy or "").strip().lower() == "review":
            bucket["review_questions"] += 1
        if str(confidence_level or "medium").strip().lower() == "low":
            bucket["low_confidence"] += 1

    schedule_stmt = (
        select(ReviewSchedule.created_at)
        .join(ReviewQueueItem, ReviewQueueItem.id == ReviewSchedule.review_queue_id)
        .where(ReviewSchedule.created_at >= range_start)
    )
    schedule_stmt = _apply_owner_filters(schedule_stmt, ReviewQueueItem, owner_user_id, owner_client_key)
    for (created_at,) in db.execute(schedule_stmt).all():
        if not created_at:
            continue
        key = _week_start_utc(created_at).date().isoformat()
        bucket = buckets.get(key)
        if bucket:
            bucket["scheduled_reviews"] += 1

    week_items: list[dict[str, Any]] = []
    for key in ordered_week_keys:
        bucket = buckets[key]
        study_questions = int(bucket["study_questions"])
        accuracy_percent = round((bucket["correct_count"] / study_questions) * 100.0, 2) if study_questions else 0.0
        week_items.append({
            "week_start": bucket["week_start"].date().isoformat(),
            "week_end": bucket["week_end"].date().isoformat(),
            "label": bucket["label"],
            "study_questions": study_questions,
            "review_questions": int(bucket["review_questions"]),
            "scheduled_reviews": int(bucket["scheduled_reviews"]),
            "completed_sessions": int(bucket["completed_sessions"]),
            "review_sessions": int(bucket["review_sessions"]),
            "accuracy_percent": accuracy_percent,
            "low_confidence": int(bucket["low_confidence"]),
        })

    active_weeks = [item for item in week_items if item["study_questions"] or item["scheduled_reviews"] or item["completed_sessions"]]
    current_week = week_items[-1]
    previous_week = week_items[-2] if len(week_items) > 1 else None
    total_questions = sum(item["study_questions"] for item in week_items)
    total_review_questions = sum(item["review_questions"] for item in week_items)
    total_correct = sum(
        buckets[key]["correct_count"]
        for key in ordered_week_keys
    )
    average_accuracy = round((total_correct / total_questions) * 100.0, 2) if total_questions else 0.0
    due_snapshot = build_review_queue_snapshot(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        limit=5,
    )
    state_breakdown = due_snapshot.get("state_breakdown") or {}
    queue_goals = due_snapshot.get("goals") or {}
    upcoming_load = due_snapshot.get("upcoming_load") or []
    projected_due_next_7_days = int(sum(int(item.get("due_count") or 0) for item in upcoming_load))
    projected_at_risk_next_7_days = int(sum(int(item.get("at_risk_count") or 0) for item in upcoming_load))
    peak_load_day = 0
    peak_load_date = None
    projected_total_load = projected_due_next_7_days + projected_at_risk_next_7_days
    for item in upcoming_load:
        combined = int(item.get("due_count") or 0) + int(item.get("at_risk_count") or 0)
        if combined > peak_load_day:
            peak_load_day = combined
            peak_load_date = item.get("date")
    if projected_total_load > 35:
        pressure_level = "high"
    elif projected_total_load > 16:
        pressure_level = "medium"
    else:
        pressure_level = "stable"

    current_weekday = min(max(now.weekday() + 1, 1), 7)
    weekly_question_target = int(max(current_week["study_questions"], 30))
    if total_questions:
        recent_average = math.ceil(total_questions / max(len(active_weeks), 1))
        weekly_question_target = max(weekly_question_target, min(recent_average + 10, 120))
    weekly_review_target = int(max(queue_goals.get("weekly_review_target") or 0, current_week["review_questions"], 10 if due_snapshot["total_count"] else 0))
    weekly_new_question_target = int(
        max(
            queue_goals.get("new_question_budget") or 0,
            weekly_question_target - min(weekly_review_target, weekly_question_target),
            0,
        )
    )
    expected_progress_ratio = current_weekday / 7
    current_completion_ratio = round(
        (current_week["study_questions"] / weekly_question_target) * 100.0,
        2,
    ) if weekly_question_target else 0.0
    on_track = bool(
        not weekly_question_target
        or current_week["study_questions"] >= math.floor(weekly_question_target * max(expected_progress_ratio * 0.85, 0.25))
    )
    remaining_days = max(7 - current_weekday, 1)
    suggested_daily_question_target = int(max(math.ceil(max(weekly_question_target - current_week["study_questions"], 0) / remaining_days), 0))
    suggested_daily_review_target = int(max(math.ceil(max(weekly_review_target - current_week["review_questions"], 0) / remaining_days), 0))

    summary = {
        "weeks_tracked": total_weeks,
        "active_weeks": len(active_weeks),
        "total_questions": total_questions,
        "review_questions": total_review_questions,
        "average_accuracy_percent": average_accuracy,
        "current_week_questions": current_week["study_questions"],
        "current_week_accuracy_percent": current_week["accuracy_percent"],
        "current_week_scheduled_reviews": current_week["scheduled_reviews"],
        "current_week_review_questions": current_week["review_questions"],
        "current_week_low_confidence": current_week["low_confidence"],
        "accuracy_delta_vs_previous_week": round(
            current_week["accuracy_percent"] - (previous_week["accuracy_percent"] if previous_week else 0.0),
            2,
        ),
        "question_delta_vs_previous_week": int(
            current_week["study_questions"] - (previous_week["study_questions"] if previous_week else 0)
        ),
        "review_backlog_due": int(due_snapshot["due_count"]),
        "review_backlog_total": int(due_snapshot["total_count"]),
        "review_state_breakdown": state_breakdown,
        "weekly_goal": {
            "weekly_question_target": weekly_question_target,
            "weekly_review_target": weekly_review_target,
            "weekly_new_question_target": weekly_new_question_target,
            "completion_ratio_percent": current_completion_ratio,
            "suggested_daily_question_target": suggested_daily_question_target,
            "suggested_daily_review_target": suggested_daily_review_target,
            "on_track": on_track,
        },
        "review_forecast": {
            "projected_due_next_7_days": projected_due_next_7_days,
            "projected_at_risk_next_7_days": projected_at_risk_next_7_days,
            "peak_load_day": peak_load_day,
            "peak_load_date": peak_load_date,
            "pressure": pressure_level,
        },
    }
    if summary["review_backlog_due"] > 15:
        summary["recommendation"] = (
            f"Sua fila vencida esta alta. Foque em {queue_goals.get('daily_review_target') or 10} revisoes por dia antes de abrir muitos blocos novos."
        )
    elif not on_track:
        summary["recommendation"] = (
            f"Voce esta atrasado na meta semanal. Tente {suggested_daily_question_target} questao(oes) nova(s) e "
            f"{suggested_daily_review_target} revisao(oes) por dia no restante da semana."
        )
    elif summary["accuracy_delta_vs_previous_week"] < -8:
        summary["recommendation"] = (
            "Sua precisao caiu nesta semana. Reduza o volume novo e foque nos dominios fracos com revisao guiada."
        )
    elif projected_total_load > 20:
        summary["recommendation"] = (
            "A carga da fila vai subir nos proximos dias. Antecipe revisoes curtas agora para evitar acumulo."
        )
    else:
        summary["recommendation"] = "Ritmo estavel. Continue equilibrando blocos novos com revisoes vencidas."

    return {
        "weeks": week_items,
        "summary": summary,
    }


def list_study_history(
    db: Session,
    *,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    stmt = (
        select(StudySession, Exam.title)
        .outerjoin(Exam, Exam.id == StudySession.exam_id)
        .where(StudySession.completed_at.is_not(None))
        .order_by(StudySession.completed_at.desc())
        .offset(offset)
        .limit(limit)
    )
    stmt = _apply_owner_filters(stmt, StudySession, owner_user_id, owner_client_key)
    rows = db.execute(stmt).all()
    if not rows:
        return []

    session_ids = [session.id for session, _exam_title in rows]
    attempt_rows = db.execute(
        select(
            StudyAttempt.session_id,
            StudyAttempt.is_correct,
            StudyAttempt.elapsed_seconds,
            StudyAttempt.confidence_level,
            Question.domain,
        )
        .join(Question, Question.id == StudyAttempt.question_id)
        .where(StudyAttempt.session_id.in_(session_ids))
        .order_by(StudyAttempt.answered_at.asc())
    ).all()

    aggregates: dict[str, dict[str, Any]] = {}
    for session_id, is_correct, elapsed_seconds, confidence_level, domain in attempt_rows:
        bucket = aggregates.setdefault(session_id, {
            "timed_total": 0,
            "timed_count": 0,
            "confidence": {"low": 0, "medium": 0, "high": 0},
            "domains": {},
        })
        if elapsed_seconds is not None:
            bucket["timed_total"] += int(elapsed_seconds)
            bucket["timed_count"] += 1
        confidence_key = str(confidence_level or "medium").strip().lower()
        if confidence_key in bucket["confidence"]:
            bucket["confidence"][confidence_key] += 1
        domain_label = str(domain or "Sem dominio").strip() or "Sem dominio"
        stats = bucket["domains"].setdefault(domain_label, {"total": 0, "wrong": 0})
        stats["total"] += 1
        if is_correct is False:
            stats["wrong"] += 1

    history: list[dict[str, Any]] = []
    for session, exam_title in rows:
        total = session.total_questions
        score = round((session.correct_count / total) * 100.0, 2) if total else 0.0
        bucket = aggregates.get(session.id, {})
        timed_count = int(bucket.get("timed_count") or 0)
        timed_total = int(bucket.get("timed_total") or 0)
        confidence = bucket.get("confidence") or {}
        domain_buckets = bucket.get("domains") or {}
        weakest_domains: list[str] = []
        for label, stats in sorted(
            domain_buckets.items(),
            key=lambda item: (-item[1]["wrong"], -item[1]["total"], item[0].lower()),
        ):
            if stats["wrong"] <= 0 and stats["total"] <= 0:
                continue
            weakest_domains.append(label)
        history.append({
            "id": session.id,
            "exam_id": session.exam_id,
            "exam_title": exam_title,
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "completed_at": session.completed_at.isoformat() if session.completed_at else None,
            "selection_strategy": session.selection_strategy or "standard",
            "selection_mix": _parse_selection_mix(session.selection_mix_json),
            "total_questions": total,
            "answered_count": session.answered_count,
            "correct_count": session.correct_count,
            "wrong_count": session.wrong_count,
            "score_percent": score,
            "avg_seconds_per_question": round(timed_total / timed_count, 2) if timed_count else None,
            "confidence_low": int(confidence.get("low") or 0),
            "confidence_medium": int(confidence.get("medium") or 0),
            "confidence_high": int(confidence.get("high") or 0),
            "weakest_domains": weakest_domains[:3],
        })
    return history


def get_study_session_review(db: Session, session: StudySession) -> dict[str, Any]:
    if session.completed_at is None:
        raise ValueError("Study session not completed.")

    result = compute_study_result(db, session)
    exam = db.get(Exam, session.exam_id) if session.exam_id else None

    rows = db.execute(
        select(
            StudySessionQuestion.position,
            Question.id,
            Question.prompt,
            Question.multi_select,
            Question.domain,
            Question.difficulty,
            Question.certification,
            Question.tags_json,
            Question.citations_json,
            StudyAttempt.selected_keys,
            StudyAttempt.is_correct,
            StudyAttempt.confidence_level,
            StudyAttempt.elapsed_seconds,
            StudyAttempt.answered_at,
        )
        .join(Question, Question.id == StudySessionQuestion.question_id)
        .outerjoin(
            StudyAttempt,
            (StudyAttempt.session_id == StudySessionQuestion.session_id)
            & (StudyAttempt.question_id == StudySessionQuestion.question_id),
        )
        .where(StudySessionQuestion.session_id == session.id)
        .order_by(StudySessionQuestion.position.asc())
    ).all()

    question_ids = [row[1] for row in rows]
    option_rows = []
    explanation_rows = []
    if question_ids:
        option_rows = db.execute(
            select(Option.question_id, Option.key, Option.text, Option.is_correct)
            .where(Option.question_id.in_(question_ids))
            .order_by(Option.question_id.asc(), Option.key.asc())
        ).all()
        explanation_rows = db.execute(
            select(Explanation.question_id, Explanation.justification)
            .where(Explanation.question_id.in_(question_ids))
        ).all()

    option_map: dict[str, list[dict[str, Any]]] = {}
    for question_id, key, text, is_correct in option_rows:
        option_map.setdefault(question_id, []).append({
            "key": key,
            "text": text,
            "is_correct": bool(is_correct),
        })
    explanation_map = {question_id: justification for question_id, justification in explanation_rows}

    timed_total = 0
    timed_count = 0
    confidence_counts = {"low": 0, "medium": 0, "high": 0}
    questions: list[dict[str, Any]] = []
    for (
        position,
        question_id,
        prompt,
        multi_select,
        domain,
        difficulty,
        certification,
        tags_json,
        citations_json,
        selected_keys_raw,
        is_correct,
        confidence_level,
        elapsed_seconds,
        answered_at,
    ) in rows:
        options = option_map.get(question_id, [])
        correct_keys = [item["key"] for item in options if item["is_correct"]]
        selected_keys = [key for key in str(selected_keys_raw or "").split(",") if key]
        normalized_confidence = str(confidence_level or "").strip().lower() or None
        if normalized_confidence in confidence_counts:
            confidence_counts[normalized_confidence] += 1
        if elapsed_seconds is not None:
            timed_total += int(elapsed_seconds)
            timed_count += 1
        questions.append({
            "id": question_id,
            "question_number": int(position) + 1,
            "prompt": prompt,
            "multi_select": bool(multi_select),
            "domain": domain,
            "difficulty": difficulty,
            "certification": certification,
            "options": [{"key": item["key"], "text": item["text"]} for item in options],
            "correct_keys": correct_keys,
            "selected_keys": selected_keys,
            "is_correct": is_correct,
            "confidence_level": normalized_confidence,
            "elapsed_seconds": int(elapsed_seconds) if elapsed_seconds is not None else None,
            "answered_at": answered_at.isoformat() if answered_at else None,
            "justification": explanation_map.get(question_id),
            "tags": _parse_tags(tags_json),
            "citations": _parse_citations(citations_json),
        })

    weakest_domains = [
        str(item.get("label") or "").strip()
        for item in (result.get("insight", {}).get("weakest_domains") or [])
        if str(item.get("label") or "").strip()
    ][:3]
    session_meta = {
        "id": session.id,
        "exam_id": session.exam_id,
        "exam_title": exam.title if exam else None,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "completed_at": session.completed_at.isoformat() if session.completed_at else None,
        "selection_strategy": session.selection_strategy or "standard",
        "selection_mix": _parse_selection_mix(session.selection_mix_json),
        "total_questions": session.total_questions,
        "answered_count": session.answered_count,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "score_percent": result["score_percent"],
        "avg_seconds_per_question": round(timed_total / timed_count, 2) if timed_count else None,
        "confidence_low": confidence_counts["low"],
        "confidence_medium": confidence_counts["medium"],
        "confidence_high": confidence_counts["high"],
        "weakest_domains": weakest_domains,
    }

    return {
        "session": session_meta,
        "result": result,
        "questions": questions,
    }


def _merge_note_text(existing_text: str, incoming_text: str) -> str:
    existing = _normalize_note_text(existing_text) or ""
    incoming = _normalize_note_text(incoming_text) or ""
    if not incoming:
        return existing
    if not existing:
        return incoming
    if incoming == existing or incoming in existing:
        return existing

    merged = f"{existing}\n\n[Nota importada do dispositivo]\n{incoming}"
    if len(merged) <= NOTE_MAX_LENGTH:
        return merged

    budget = max(NOTE_MAX_LENGTH - len(existing) - len("\n\n[Nota importada do dispositivo]\n"), 0)
    if budget <= 0:
        return existing[:NOTE_MAX_LENGTH]
    trimmed_incoming = incoming[:budget].rstrip()
    return f"{existing}\n\n[Nota importada do dispositivo]\n{trimmed_incoming}"


def claim_client_study_state(db: Session, *, user: User, client_key: str | None) -> dict[str, int]:
    normalized_client_key = normalize_client_key(client_key)
    if not normalized_client_key:
        return {"bookmarks": 0, "notes": 0, "study_sessions": 0, "review_items": 0}

    claimed_bookmarks = 0
    claimed_notes = 0
    claimed_study_sessions = 0
    claimed_review_items = 0
    changed = False

    bookmark_rows = db.execute(
        select(UserBookmark).where(
            UserBookmark.user_id.is_(None),
            UserBookmark.client_key == normalized_client_key,
        )
    ).scalars().all()
    for bookmark in bookmark_rows:
        target = db.execute(
            select(UserBookmark).where(
                UserBookmark.user_id == user.id,
                UserBookmark.question_id == bookmark.question_id,
            )
        ).scalar_one_or_none()
        if target:
            db.delete(bookmark)
            changed = True
            continue
        bookmark.user_id = user.id
        bookmark.client_key = None
        bookmark.updated_at = datetime.utcnow()
        claimed_bookmarks += 1
        changed = True

    note_rows = db.execute(
        select(UserNote).where(
            UserNote.user_id.is_(None),
            UserNote.client_key == normalized_client_key,
        )
    ).scalars().all()
    for note in note_rows:
        target = db.execute(
            select(UserNote).where(
                UserNote.user_id == user.id,
                UserNote.question_id == note.question_id,
            )
        ).scalar_one_or_none()
        if target:
            target.note_text = _merge_note_text(target.note_text, note.note_text)
            target.updated_at = max(target.updated_at, note.updated_at) if target.updated_at and note.updated_at else datetime.utcnow()
            db.delete(note)
            changed = True
            continue
        note.user_id = user.id
        note.client_key = None
        note.updated_at = datetime.utcnow()
        claimed_notes += 1
        changed = True

    session_rows = db.execute(
        select(StudySession).where(
            StudySession.user_id.is_(None),
            StudySession.client_key == normalized_client_key,
        )
    ).scalars().all()
    for session in session_rows:
        session.user_id = user.id
        session.client_key = None
        claimed_study_sessions += 1
        changed = True

    queue_rows = db.execute(
        select(ReviewQueueItem).where(
            ReviewQueueItem.user_id.is_(None),
            ReviewQueueItem.client_key == normalized_client_key,
        )
    ).scalars().all()
    for item in queue_rows:
        target = db.execute(
            select(ReviewQueueItem).where(
                ReviewQueueItem.user_id == user.id,
                ReviewQueueItem.question_id == item.question_id,
            )
        ).scalar_one_or_none()
        if target:
            if item.due_at < target.due_at:
                target.due_at = item.due_at
                target.interval_days = item.interval_days
                target.last_outcome = item.last_outcome
                target.confidence_level = item.confidence_level
                target.last_attempt_at = item.last_attempt_at
                target.updated_at = datetime.utcnow()
            db.delete(item)
            changed = True
            continue
        item.user_id = user.id
        item.client_key = None
        item.updated_at = datetime.utcnow()
        claimed_review_items += 1
        changed = True

    if changed:
        db.commit()

    return {
        "bookmarks": claimed_bookmarks,
        "notes": claimed_notes,
        "study_sessions": claimed_study_sessions,
        "review_items": claimed_review_items,
    }


def _normalize_domain_filters(domains: list[str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in domains or []:
        label = str(value or "").strip()
        if not label:
            continue
        lowered = label.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(label)
    return normalized


def _normalize_strategy(value: str | None, queue_only: bool = False) -> str:
    if queue_only:
        return "review"
    normalized = str(value or "standard").strip().lower()
    if normalized not in {"standard", "review", "adaptive"}:
        raise ValueError("Study strategy must be one of: standard, review, adaptive.")
    return normalized


def _serialize_selection_mix(selection_mix: dict[str, int] | None) -> str | None:
    if not selection_mix:
        return None
    cleaned: dict[str, int] = {}
    for key, value in selection_mix.items():
        label = str(key or "").strip()
        if not label:
            continue
        try:
            amount = max(int(value), 0)
        except (TypeError, ValueError):
            continue
        cleaned[label] = amount
    if not cleaned:
        return None
    return json.dumps(cleaned, ensure_ascii=True, sort_keys=True)


def _parse_selection_mix(selection_mix_json: str | None) -> dict[str, int]:
    if not selection_mix_json:
        return {}
    try:
        payload = json.loads(selection_mix_json)
    except (TypeError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    parsed: dict[str, int] = {}
    for key, value in payload.items():
        label = str(key or "").strip()
        if not label:
            continue
        try:
            amount = max(int(value), 0)
        except (TypeError, ValueError):
            continue
        parsed[label] = amount
    return parsed


def _parse_tags(tags_json: str | None) -> list[str]:
    if not tags_json:
        return []
    try:
        payload = json.loads(tags_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    tags: list[str] = []
    for item in payload:
        label = str(item or "").strip()
        if label:
            tags.append(label)
    return tags


def _parse_citations(citations_json: str | None) -> list[dict[str, Any]]:
    if not citations_json:
        return []
    try:
        payload = json.loads(citations_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []

    citations: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        cleaned: dict[str, Any] = {}
        for key, value in item.items():
            label = str(key or "").strip()
            if not label:
                continue
            if value is None:
                continue
            if isinstance(value, str):
                normalized = value.strip()
                if not normalized:
                    continue
                cleaned[label] = normalized
                continue
            if isinstance(value, (bool, int, float)):
                cleaned[label] = value
                continue
            if isinstance(value, list):
                cleaned_values = [str(entry).strip() for entry in value if str(entry).strip()]
                if cleaned_values:
                    cleaned[label] = cleaned_values
                continue
            if isinstance(value, dict):
                nested: dict[str, Any] = {}
                for nested_key, nested_value in value.items():
                    nested_label = str(nested_key or "").strip()
                    if not nested_label:
                        continue
                    if nested_value is None:
                        continue
                    if isinstance(nested_value, str):
                        nested_text = nested_value.strip()
                        if nested_text:
                            nested[nested_label] = nested_text
                    elif isinstance(nested_value, (bool, int, float)):
                        nested[nested_label] = nested_value
                if nested:
                    cleaned[label] = nested
        if cleaned:
            citations.append(cleaned)
    return citations


def _normalize_confidence_level(value: str | None) -> str:
    normalized = str(value or "medium").strip().lower()
    if normalized not in CONFIDENCE_LEVELS:
        raise ValueError("Confidence must be one of: low, medium, high.")
    return normalized


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


def _correct_keys_for_question(db: Session, question_id: str) -> list[str]:
    rows = db.execute(
        select(Option.key).where(
            Option.question_id == question_id,
            Option.is_correct.is_(True),
        ).order_by(Option.key.asc())
    ).all()
    return [key for (key,) in rows]


def _option_keys_for_question(db: Session, question_id: str) -> list[str]:
    rows = db.execute(
        select(Option.key).where(Option.question_id == question_id).order_by(Option.key.asc())
    ).all()
    return [key for (key,) in rows]


def _serialize_question_payload(db: Session, question_id: str) -> dict[str, Any]:
    question = _question_or_error(db, question_id)
    option_rows = db.execute(
        select(Option.key, Option.text)
        .where(Option.question_id == question_id)
        .order_by(Option.key.asc())
    ).all()
    return {
        "id": question.id,
        "exam_id": question.exam_id,
        "prompt": question.prompt,
        "multi_select": question.multi_select,
        "domain": question.domain,
        "difficulty": question.difficulty,
        "certification": question.certification,
        "tags": _parse_tags(question.tags_json),
        "options": [{"key": key, "text": text} for key, text in option_rows],
    }


def _owner_review_item_query(
    question_id: str,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
):
    stmt = select(ReviewQueueItem).where(ReviewQueueItem.question_id == question_id)
    return _apply_owner_filters(stmt, ReviewQueueItem, owner_user_id, owner_client_key)


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
    return item


def _feedback_explanation(justification: str | None, *, is_correct: bool) -> str:
    raw = " ".join(str(justification or "").split()).strip()
    if raw:
        lowered = raw.lower()
        if any(marker in lowered for marker in ("alternativa", "correct answer", "resposta correta", "option ")):
            raw = ""
    if raw:
        trimmed = raw[:SAFE_FEEDBACK_MAX_CHARS].rstrip()
        if len(raw) > SAFE_FEEDBACK_MAX_CHARS:
            trimmed += "..."
        prefix = "Conceito-chave: " if is_correct else "Revise este conceito: "
        return f"{prefix}{trimmed}"
    if is_correct:
        return "Resposta correta. O racional completo permanece disponivel na revisao final deste bloco."
    return "Resposta incorreta. A questao entrou na fila de revisao e o racional completo fica no resumo final."


def _study_scope_for_session(session: StudySession) -> tuple[str | None, str | None]:
    return session.user_id, None if session.user_id else session.client_key


def _filtered_question_rows(
    db: Session,
    *,
    exam_id: Optional[str],
    domains: Optional[list[str]],
) -> list[tuple[str, str | None]]:
    normalized_domains = _normalize_domain_filters(domains)
    stmt = select(Question.id, Question.domain).where(True)
    if exam_id:
        stmt = stmt.where(Question.exam_id == exam_id)
    if normalized_domains:
        stmt = stmt.where(Question.domain.in_(normalized_domains))
    return db.execute(stmt).all()


def _owner_study_attempts_query(
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
):
    stmt = (
        select(
            StudyAttempt.question_id,
            StudyAttempt.is_correct,
            StudyAttempt.confidence_level,
            Question.exam_id,
            Question.domain,
        )
        .join(StudySession, StudySession.id == StudyAttempt.session_id)
        .join(Question, Question.id == StudyAttempt.question_id)
    )
    return _apply_owner_filters(stmt, StudySession, owner_user_id, owner_client_key)


def _owner_seen_question_ids(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
) -> set[str]:
    normalized_domains = _normalize_domain_filters(domains)
    seen: set[str] = set()

    study_stmt = (
        select(StudyAttempt.question_id, Question.exam_id, Question.domain)
        .join(StudySession, StudySession.id == StudyAttempt.session_id)
        .join(Question, Question.id == StudyAttempt.question_id)
    )
    study_stmt = _apply_owner_filters(study_stmt, StudySession, owner_user_id, owner_client_key)
    for question_id, question_exam_id, question_domain in db.execute(study_stmt).all():
        if exam_id and question_exam_id != exam_id:
            continue
        if normalized_domains and question_domain not in normalized_domains:
            continue
        seen.add(question_id)

    exam_stmt = (
        select(SessionAnswer.question_id, Question.exam_id, Question.domain)
        .join(ExamSession, ExamSession.id == SessionAnswer.session_id)
        .join(Question, Question.id == SessionAnswer.question_id)
    )
    exam_stmt = _apply_owner_filters(exam_stmt, ExamSession, owner_user_id, owner_client_key)
    for question_id, question_exam_id, question_domain in db.execute(exam_stmt).all():
        if exam_id and question_exam_id != exam_id:
            continue
        if normalized_domains and question_domain not in normalized_domains:
            continue
        seen.add(question_id)

    return seen


def _review_queue_candidates(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
) -> list[dict[str, Any]]:
    normalized_domains = _normalize_domain_filters(domains)
    stmt = (
        select(
            ReviewQueueItem.question_id,
            ReviewQueueItem.due_at,
            ReviewQueueItem.repetition_count,
            ReviewQueueItem.ease_factor,
            ReviewQueueItem.stability_score,
            Question.exam_id,
            Question.domain,
            Question.prompt,
            Question.certification,
        )
        .join(Question, Question.id == ReviewQueueItem.question_id)
        .order_by(ReviewQueueItem.due_at.asc(), ReviewQueueItem.id.asc())
    )
    stmt = _apply_owner_filters(stmt, ReviewQueueItem, owner_user_id, owner_client_key)

    rows: list[dict[str, Any]] = []
    for question_id, due_at, repetition_count, ease_factor, stability_score, question_exam_id, question_domain, prompt, certification in db.execute(stmt).all():
        if exam_id and question_exam_id != exam_id:
            continue
        if normalized_domains and question_domain not in normalized_domains:
            continue
        rows.append({
            "question_id": question_id,
            "due_at": due_at,
            "repetition_count": int(repetition_count or 0),
            "ease_factor": float(ease_factor or 2.5),
            "stability_score": float(stability_score or 0.0),
            "exam_id": question_exam_id,
            "domain": question_domain,
            "prompt": prompt,
            "certification": certification,
        })
    return rows


def _weak_domain_labels(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
    limit: int = 3,
) -> list[str]:
    normalized_domains = _normalize_domain_filters(domains)
    scores: dict[str, int] = {}
    for _question_id, is_correct, confidence_level, question_exam_id, domain in db.execute(
        _owner_study_attempts_query(owner_user_id, owner_client_key)
    ).all():
        if exam_id and question_exam_id != exam_id:
            continue
        domain_label = str(domain or "Sem dominio").strip() or "Sem dominio"
        if normalized_domains and domain_label not in normalized_domains:
            continue
        weight = 0
        if not bool(is_correct):
            weight += 3
        normalized_confidence = str(confidence_level or "medium").strip().lower()
        if normalized_confidence == "low":
            weight += 2
        elif normalized_confidence == "medium":
            weight += 1
        if weight <= 0:
            continue
        scores[domain_label] = scores.get(domain_label, 0) + weight

    queue_rows = _review_queue_candidates(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=domains,
    )
    now = datetime.utcnow()
    for row in queue_rows:
        domain_label = str(row.get("domain") or "Sem dominio").strip() or "Sem dominio"
        if normalized_domains and domain_label not in normalized_domains:
            continue
        due_at = row.get("due_at")
        bonus = 2 if due_at and due_at <= now else 1
        scores[domain_label] = scores.get(domain_label, 0) + bonus

    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0].lower()))
    return [label for label, _score in ordered[:limit]]


def _dedupe_question_ids(candidates: list[str], *, blocked: set[str] | None = None) -> list[str]:
    blocked_ids = blocked or set()
    ordered: list[str] = []
    seen: set[str] = set()
    for question_id in candidates:
        qid = str(question_id or "").strip()
        if not qid or qid in blocked_ids or qid in seen:
            continue
        seen.add(qid)
        ordered.append(qid)
    return ordered


def _build_question_pool(
    db: Session,
    *,
    exam_id: Optional[str],
    total_questions: int,
    question_ids: Optional[list[str]],
    domains: Optional[list[str]],
    strategy: str,
    queue_only: bool,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> tuple[list[str], str, dict[str, int]]:
    normalized_domains = _normalize_domain_filters(domains)
    resolved_strategy = _normalize_strategy(strategy, queue_only)

    if question_ids:
        requested: list[str] = []
        seen: set[str] = set()
        for raw in question_ids:
            qid = str(raw or "").strip()
            if not qid or qid in seen:
                continue
            seen.add(qid)
            requested.append(qid)
        if not requested:
            raise ValueError("No questions found for the selected study session.")
        existing = {
            qid for (qid,) in db.execute(
                select(Question.id).where(Question.id.in_(requested))
            ).all()
        }
        missing = [qid for qid in requested if qid not in existing]
        if missing:
            raise ValueError("One or more requested questions are unavailable.")
        selected = requested[:total_questions]
        return selected, "manual", {"manual": len(selected)}

    question_rows = _filtered_question_rows(db, exam_id=exam_id, domains=normalized_domains)
    qids = [qid for qid, _domain in question_rows]
    if not qids:
        if normalized_domains:
            raise ValueError("No questions found for the selected exam/domain.")
        raise ValueError("No questions found for the selected study session.")

    if total_questions > len(qids):
        total_questions = len(qids)

    if resolved_strategy == "review":
        queue_rows = _review_queue_candidates(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=exam_id,
            domains=normalized_domains,
        )
        if not queue_rows:
            raise ValueError("No review items found for the selected filters.")
        now = datetime.utcnow()
        due_now = [row["question_id"] for row in queue_rows if row["due_at"] and row["due_at"] <= now]
        upcoming = [row["question_id"] for row in queue_rows if not row["due_at"] or row["due_at"] > now]
        selected = _dedupe_question_ids(due_now)[:total_questions]
        remaining = total_questions - len(selected)
        if remaining > 0:
            selected.extend(_dedupe_question_ids(upcoming, blocked=set(selected))[:remaining])
        if not selected:
            raise ValueError("No review items found for the selected filters.")
        mix = {
            "due_now": len([qid for qid in selected if qid in set(due_now)]),
            "upcoming": len([qid for qid in selected if qid in set(upcoming)]),
        }
        return selected, resolved_strategy, mix

    if resolved_strategy == "adaptive":
        queue_rows = _review_queue_candidates(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=exam_id,
            domains=normalized_domains,
        )
        now = datetime.utcnow()
        due_now = _dedupe_question_ids([
            row["question_id"] for row in queue_rows if row["due_at"] and row["due_at"] <= now
        ])
        queue_future = _dedupe_question_ids([
            row["question_id"] for row in queue_rows if not row["due_at"] or row["due_at"] > now
        ])
        seen_ids = _owner_seen_question_ids(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=exam_id,
            domains=normalized_domains,
        )
        weak_domains = _weak_domain_labels(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=exam_id,
            domains=normalized_domains,
        )

        weak_new = [
            qid for qid, domain in question_rows
            if domain in weak_domains and qid not in seen_ids
        ]
        weak_seen = [
            qid for qid, domain in question_rows
            if domain in weak_domains and qid in seen_ids
        ]
        new_questions = [qid for qid, _domain in question_rows if qid not in seen_ids]
        fallback = list(qids)
        random.shuffle(weak_new)
        random.shuffle(weak_seen)
        random.shuffle(new_questions)
        random.shuffle(fallback)

        selected: list[str] = []
        selected.extend(due_now[:total_questions])
        if len(selected) < total_questions:
            due_target = 0
            if due_now:
                due_target = min(len(due_now), max(1, math.ceil(total_questions * 0.4)))
            if due_target and len(selected) > due_target:
                selected = selected[:due_target]
        blocked = set(selected)

        remaining = total_questions - len(selected)
        if remaining > 0:
            weak_target = min(remaining, max(1, math.ceil(total_questions * 0.35))) if weak_domains else 0
            weak_candidates = _dedupe_question_ids(weak_new + weak_seen + queue_future, blocked=blocked)
            selected.extend(weak_candidates[:weak_target])
            blocked = set(selected)

        remaining = total_questions - len(selected)
        if remaining > 0:
            selected.extend(_dedupe_question_ids(new_questions, blocked=blocked)[:remaining])
            blocked = set(selected)

        remaining = total_questions - len(selected)
        if remaining > 0:
            selected.extend(_dedupe_question_ids(queue_future + fallback, blocked=blocked)[:remaining])

        selected = selected[:total_questions]
        if not selected:
            raise ValueError("No questions found for the selected adaptive study session.")
        selected_set = set(selected)
        due_selected = selected_set & set(due_now)
        weak_selected = (selected_set & set(weak_new + weak_seen)) - due_selected
        new_selected = (selected_set & set(new_questions)) - due_selected - weak_selected
        mix = {
            "due_now": len(due_selected),
            "weak": len(weak_selected),
            "new": len(new_selected),
            "carry_over": max(len(selected) - len(due_selected) - len(weak_selected) - len(new_selected), 0),
        }
        return selected, resolved_strategy, mix

    random_pool = list(qids)
    random.shuffle(random_pool)
    selected = random_pool[:total_questions]
    return selected, resolved_strategy, {"random": len(selected)}


def create_study_session(
    db: Session,
    exam_id: Optional[str],
    total_questions: int,
    question_ids: Optional[list[str]] = None,
    domains: Optional[list[str]] = None,
    strategy: str = "standard",
    queue_only: bool = False,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> StudySession:
    qids, resolved_strategy, selection_mix = _build_question_pool(
        db,
        exam_id=exam_id,
        total_questions=total_questions,
        question_ids=question_ids,
        domains=domains,
        strategy=strategy,
        queue_only=queue_only,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
    )
    if not qids:
        raise ValueError("No questions found for the selected study session.")

    total = min(total_questions, len(qids))
    session = StudySession(
        id=str(uuid.uuid4()),
        exam_id=exam_id,
        user_id=owner_user_id,
        client_key=None if owner_user_id else normalize_client_key(owner_client_key),
        selection_strategy=resolved_strategy,
        selection_mix_json=_serialize_selection_mix(selection_mix),
        total_questions=total,
        current_index=0,
        answered_count=0,
        correct_count=0,
        wrong_count=0,
    )
    db.add(session)
    db.flush()

    for position, question_id in enumerate(qids[:total]):
        db.add(
            StudySessionQuestion(
                session_id=session.id,
                question_id=question_id,
                position=position,
            )
        )

    db.commit()
    db.refresh(session)
    return session


def serialize_study_session(session: StudySession) -> dict[str, Any]:
    return {
        "id": session.id,
        "exam_id": session.exam_id,
        "selection_strategy": session.selection_strategy or "standard",
        "selection_mix": _parse_selection_mix(session.selection_mix_json),
        "total_questions": session.total_questions,
        "current_index": session.current_index,
        "answered_count": session.answered_count,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "finished": session.completed_at is not None,
    }


def get_question_for_study_session(db: Session, session: StudySession, position: int) -> Optional[dict[str, Any]]:
    if position < 0 or position >= session.total_questions:
        return None
    question_id = db.execute(
        select(StudySessionQuestion.question_id).where(
            StudySessionQuestion.session_id == session.id,
            StudySessionQuestion.position == position,
        )
    ).scalar_one_or_none()
    if not question_id:
        return None
    return _serialize_question_payload(db, question_id)


def answer_study_question(
    db: Session,
    session: StudySession,
    question_id: str,
    selected_keys: list[str],
    confidence_level: str,
    elapsed_seconds: Optional[int] = None,
) -> dict[str, Any]:
    confidence = _normalize_confidence_level(confidence_level)
    belongs = db.execute(
        select(StudySessionQuestion.id).where(
            StudySessionQuestion.session_id == session.id,
            StudySessionQuestion.question_id == question_id,
        )
    ).scalar_one_or_none()
    if not belongs:
        raise ValueError("Question does not belong to this study session.")

    option_keys = _option_keys_for_question(db, question_id)
    if not option_keys:
        raise ValueError("Question options not found.")
    selected_set = {str(key or "").strip() for key in selected_keys if str(key or "").strip()}
    invalid = sorted(selected_set - set(option_keys))
    if invalid:
        raise ValueError(f"Invalid option key(s): {', '.join(invalid)}")

    correct_keys = _correct_keys_for_question(db, question_id)
    is_correct = (selected_set == set(correct_keys))
    now = datetime.utcnow()

    existing_attempt = db.execute(
        select(StudyAttempt).where(
            StudyAttempt.session_id == session.id,
            StudyAttempt.question_id == question_id,
        )
    ).scalar_one_or_none()
    if existing_attempt:
        if existing_attempt.is_correct:
            session.correct_count = max(session.correct_count - 1, 0)
        else:
            session.wrong_count = max(session.wrong_count - 1, 0)
        existing_attempt.selected_keys = ",".join(sorted(selected_set))
        existing_attempt.is_correct = is_correct
        existing_attempt.confidence_level = confidence
        existing_attempt.elapsed_seconds = elapsed_seconds
        existing_attempt.answered_at = now
    else:
        db.add(
            StudyAttempt(
                session_id=session.id,
                question_id=question_id,
                selected_keys=",".join(sorted(selected_set)),
                is_correct=is_correct,
                confidence_level=confidence,
                elapsed_seconds=elapsed_seconds,
                answered_at=now,
            )
        )
        session.answered_count += 1

    if is_correct:
        session.correct_count += 1
    else:
        session.wrong_count += 1

    if session.current_index < session.total_questions:
        session.current_index += 1
    if session.current_index >= session.total_questions:
        session.completed_at = now

    owner_user_id, owner_client_key = _study_scope_for_session(session)
    queue_item = _upsert_review_queue_item(
        db,
        question_id=question_id,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        is_correct=is_correct,
        confidence_level=confidence,
        attempted_at=now,
        elapsed_seconds=elapsed_seconds,
    )
    upsert_question_progress(
        db,
        question_id=question_id,
        mode="study",
        is_correct=is_correct,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        confidence_level=confidence,
        attempted_at=now,
    )

    db.commit()
    due_count = count_due_review_items(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
    )

    explanation = db.get(Explanation, question_id)
    remaining = max(session.total_questions - session.current_index, 0)
    if not is_correct:
        message = "Erro convertido em revisao. Esta questao voltara rapidamente para reforco."
    elif confidence == "low":
        message = "Acerto com baixa confianca. A revisao volta cedo para consolidar."
    elif confidence == "medium":
        message = "Bom progresso. A revisao volta em alguns dias."
    else:
        message = "Alta confianca registrada. Esta questao foi empurrada para uma revisao mais espaçada."

    return {
        "is_correct": is_correct,
        "justification": _feedback_explanation(explanation.justification if explanation else None, is_correct=is_correct),
        "progress_index": session.current_index,
        "total_questions": session.total_questions,
        "answered_count": session.answered_count,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "finished": session.completed_at is not None,
        "confidence_level": confidence,
        "next_review_at": queue_item.due_at.isoformat() if queue_item.due_at else None,
        "review_due_count": due_count,
        "insight": {
            "message": message,
            "remaining_questions": remaining,
        },
    }


def compute_study_result(db: Session, session: StudySession) -> dict[str, Any]:
    if session.completed_at is None:
        raise ValueError("Study session not completed.")

    rows = db.execute(
        select(
            StudySessionQuestion.position,
            Question.id,
            Question.prompt,
            Question.multi_select,
            Question.domain,
            Question.difficulty,
            StudyAttempt.is_correct,
            StudyAttempt.elapsed_seconds,
            StudyAttempt.confidence_level,
        )
        .join(Question, Question.id == StudySessionQuestion.question_id)
        .outerjoin(
            StudyAttempt,
            (StudyAttempt.session_id == StudySessionQuestion.session_id)
            & (StudyAttempt.question_id == StudySessionQuestion.question_id),
        )
        .where(StudySessionQuestion.session_id == session.id)
        .order_by(StudySessionQuestion.position.asc())
    ).all()

    attempted = 0
    wrong = 0
    total_elapsed = 0
    timed_attempts = 0
    missed_sample: list[dict[str, Any]] = []
    by_type = {
        "single_select": {"correct": 0, "total": 0, "score_percent": 0.0},
        "multi_select": {"correct": 0, "total": 0, "score_percent": 0.0},
    }
    by_domain: dict[str, dict[str, Any]] = {}
    confidence_buckets = {"low": 0, "medium": 0, "high": 0}

    for position, question_id, prompt, multi_select, domain, difficulty, is_correct, elapsed_seconds, confidence_level in rows:
        bucket = "multi_select" if multi_select else "single_select"
        by_type[bucket]["total"] += 1
        if is_correct is not None:
            attempted += 1
            confidence_key = str(confidence_level or "medium").strip().lower()
            if confidence_key in confidence_buckets:
                confidence_buckets[confidence_key] += 1
            if bool(is_correct):
                by_type[bucket]["correct"] += 1
            else:
                wrong += 1
                if len(missed_sample) < 5:
                    missed_sample.append({
                        "id": question_id,
                        "question_number": position + 1,
                        "prompt": prompt,
                        "domain": domain,
                        "difficulty": difficulty,
                    })
            if elapsed_seconds is not None:
                total_elapsed += int(elapsed_seconds)
                timed_attempts += 1

        domain_label = str(domain or "Sem dominio").strip() or "Sem dominio"
        stats = by_domain.setdefault(domain_label, {"correct": 0, "total": 0, "wrong": 0, "score_percent": 0.0})
        stats["total"] += 1
        if is_correct is not None and bool(is_correct):
            stats["correct"] += 1
        elif is_correct is not None:
            stats["wrong"] += 1

    for bucket in by_type.values():
        total = bucket["total"]
        bucket["score_percent"] = round((bucket["correct"] / total) * 100.0, 2) if total else 0.0

    weakest_domains = []
    for label, stats in by_domain.items():
        total = stats["total"]
        stats["score_percent"] = round((stats["correct"] / total) * 100.0, 2) if total else 0.0
        weakest_domains.append({
            "label": label,
            "correct": stats["correct"],
            "wrong": stats["wrong"],
            "total": total,
            "score_percent": stats["score_percent"],
        })
    weakest_domains.sort(key=lambda item: (-(item["wrong"]), item["score_percent"], item["label"].lower()))
    weakest_domains = weakest_domains[:5]

    unanswered = max(session.total_questions - attempted, 0)
    score = round((session.correct_count / session.total_questions) * 100.0, 2) if session.total_questions else 0.0
    avg_seconds = round(total_elapsed / timed_attempts, 2) if timed_attempts else None
    duration_seconds = total_elapsed if timed_attempts else None
    owner_user_id, owner_client_key = _study_scope_for_session(session)
    due_count = count_due_review_items(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
    )

    study_plan = []
    for item in weakest_domains[:3]:
        study_plan.append({
            "domain": item["label"],
            "wrong": item["wrong"],
            "total": item["total"],
            "score_percent": item["score_percent"],
            "reason": f"Este dominio concentrou {item['wrong']} erro(s) nesta sessao de estudo.",
            "action": "Revise as notas/bookmarks e reabra um bloco de estudo focado apenas neste dominio.",
            "topics": [item["label"]],
            "resources": [],
        })

    focus = []
    strategy = session.selection_strategy or "standard"
    selection_mix = _parse_selection_mix(session.selection_mix_json)
    if strategy == "review":
        focus.append("Sessao diaria puxada diretamente da sua fila de revisao.")
    elif strategy == "adaptive":
        focus.append("Sessao adaptativa montada com itens vencidos, dominios fracos e questoes novas.")
    if confidence_buckets["low"]:
        focus.append(f"{confidence_buckets['low']} resposta(s) foram marcadas como 'chutei'.")
    if due_count:
        focus.append(f"{due_count} revisao(oes) ja estao vencidas na sua fila.")
    if not focus:
        focus.append("Sessao limpa. Continue reforcando com blocos curtos e consistentes.")

    patterns = [
        f"Confianca baixa: {confidence_buckets['low']}",
        f"Confianca media: {confidence_buckets['medium']}",
        f"Confianca alta: {confidence_buckets['high']}",
    ]
    if selection_mix:
        mix_text = " | ".join(f"{label}: {amount}" for label, amount in selection_mix.items() if amount)
        if mix_text:
            patterns.append(f"Mix da sessao: {mix_text}")

    return {
        "session_id": session.id,
        "total_questions": session.total_questions,
        "answered_count": attempted,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "score_percent": score,
        "mode": "study",
        "strategy": strategy,
        "selection_mix": selection_mix,
        "review_due_count": due_count,
        "insight": {
            "summary": {
                "attempted": attempted,
                "unanswered": unanswered,
                "accuracy_percent": score,
                "duration_seconds": duration_seconds,
                "avg_seconds_per_question": avg_seconds,
            },
            "by_type": by_type,
            "by_domain": by_domain,
            "weakest_domains": weakest_domains,
            "missed_sample": missed_sample,
            "focus": focus,
            "patterns": patterns,
            "recommendation": (
                "Use o study mode para trabalhar apenas as questoes vencidas e marque confianca de forma honesta."
            ),
            "study_plan": study_plan,
        },
    }
