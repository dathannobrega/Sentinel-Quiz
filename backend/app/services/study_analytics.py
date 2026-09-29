"""Weekly study analytics and study session history."""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Exam, Question, ReviewQueueItem, ReviewSchedule, StudyAttempt, StudySession
from app.services.metrics import load_weekly_progress_snapshots
from app.services.owner_scope import require_owner_filters
from app.services.review_queue import build_review_queue_snapshot
from app.services.serialization import parse_selection_mix as _parse_selection_mix


WEEKLY_ANALYTICS_DEFAULT_WEEKS = 8


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

    snapshot_rows = []
    if owner_user_id or owner_client_key:
        try:
            snapshot_rows = load_weekly_progress_snapshots(
                db,
                owner_user_id=owner_user_id,
                owner_client_key=owner_client_key,
                range_start=range_start,
            )
        except ValueError:
            snapshot_rows = []
    if snapshot_rows:
        snapshot_map = {row.week_start.date().isoformat(): row for row in snapshot_rows}
        for key in ordered_week_keys:
            row = snapshot_map.get(key)
            bucket = buckets[key]
            if not row:
                continue
            bucket["study_questions"] = int(row.questions_answered)
            bucket["review_questions"] = int(row.review_questions)
            bucket["scheduled_reviews"] = int(row.scheduled_reviews)
            bucket["completed_sessions"] = int(row.completed_study_sessions)
            bucket["review_sessions"] = int(row.completed_review_sessions)
            bucket["correct_count"] = int(row.correct_count)
            bucket["low_confidence"] = int(row.low_confidence_count)
    else:
        session_stmt = select(StudySession.selection_strategy, StudySession.completed_at).where(
            StudySession.completed_at.is_not(None),
            StudySession.completed_at >= range_start,
        )
        session_stmt = require_owner_filters(session_stmt, StudySession, owner_user_id, owner_client_key)
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
        attempt_stmt = require_owner_filters(attempt_stmt, StudySession, owner_user_id, owner_client_key)
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
        schedule_stmt = require_owner_filters(schedule_stmt, ReviewQueueItem, owner_user_id, owner_client_key)
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
    stmt = require_owner_filters(stmt, StudySession, owner_user_id, owner_client_key)
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
