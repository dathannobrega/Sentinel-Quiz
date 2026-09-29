"""Engagement snapshot: goals, streak and adaptive profile.

``build_engagement_snapshot`` (GET /analytics/engagement) is read-only (M-B7): goals
fall back to defaults, streak and adaptive profile are computed on the fly. The rows are
persisted by :func:`refresh_engagement_state`, called from the mutating flows (end of a
study session, exam submission).
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import (
    bucket_study_date,
    study_date,
    study_day_start,
    study_day_start_for_date,
    study_week_start,
    utcnow,
)
from app.models import (
    AdaptiveProfile,
    ReviewQueueItem,
    StudyAttempt,
    StudySession,
    UserDomainMetricDaily,
    UserGoal,
    UserStreak,
    WeeklyProgressSnapshot,
)
from app.services.owner_scope import owner_clauses, require_owner_scope


DEFAULT_GOALS = {
    "daily_question_target": 10,
    "daily_review_target": 5,
    "weekly_question_target": 50,
    "weekly_review_target": 30,
    "stretch_question_target": 15,
}


# Day/week boundaries follow STUDY_DAY_TIMEZONE (see app.core.clock) and match the
# bucket keys written by app.services.metrics.
def _day_start(value: datetime) -> datetime:
    return study_day_start(value)


def _week_start(value: datetime) -> datetime:
    return study_week_start(value)


def _progress_payload(*, completed: int, target: int) -> dict[str, Any]:
    safe_target = max(int(target), 1)
    progress_percent = min(round((max(int(completed), 0) / safe_target) * 100.0, 2), 100.0)
    remaining = max(safe_target - max(int(completed), 0), 0)
    return {
        "target": safe_target,
        "completed": max(int(completed), 0),
        "remaining": remaining,
        "progress_percent": progress_percent,
        "reached": remaining == 0,
    }


def _find_user_goal(db: Session, *, owner_user_id: Optional[str], owner_client_key: Optional[str]) -> UserGoal | None:
    return db.execute(
        select(UserGoal).where(*owner_clauses(UserGoal, owner_user_id, owner_client_key))
    ).scalar_one_or_none()


def get_or_create_user_goal(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> UserGoal:
    owner_user_id, owner_client_key = require_owner_scope(owner_user_id, owner_client_key)
    goal = _find_user_goal(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    if goal:
        return goal

    goal = UserGoal(
        user_id=owner_user_id,
        client_key=owner_client_key,
        **DEFAULT_GOALS,
    )
    db.add(goal)
    db.flush()
    return goal


def _compute_streak(db: Session, *, owner_user_id: Optional[str], owner_client_key: Optional[str], now: datetime) -> dict[str, Any]:
    today = study_date(now)
    rows = db.execute(
        select(UserDomainMetricDaily.metric_date)
        .where(
            *owner_clauses(UserDomainMetricDaily, owner_user_id, owner_client_key),
            UserDomainMetricDaily.attempts_total > 0,
        )
        .order_by(UserDomainMetricDaily.metric_date.asc())
    ).scalars().all()
    # Calendar dates in STUDY_DAY_TIMEZONE (legacy UTC-midnight buckets map to their date).
    activity_days = sorted({bucket_study_date(item) for item in rows if item})

    best = 0
    current_run = 0
    previous_day: date | None = None
    for day in activity_days:
        if previous_day and day == previous_day + timedelta(days=1):
            current_run += 1
        else:
            current_run = 1
        best = max(best, current_run)
        previous_day = day

    current = 0
    if activity_days:
        last_day = activity_days[-1]
        if last_day == today:
            current = 1
            cursor = last_day
            for day in reversed(activity_days[:-1]):
                if day == cursor - timedelta(days=1):
                    current += 1
                    cursor = day
                    continue
                break
    return {
        "current": current,
        "best": max(best, current),
        "total_active_days": len(activity_days),
        "last_activity_date": study_day_start_for_date(activity_days[-1]) if activity_days else None,
    }


def _find_streak(db: Session, *, owner_user_id: Optional[str], owner_client_key: Optional[str]) -> UserStreak | None:
    return db.execute(
        select(UserStreak).where(*owner_clauses(UserStreak, owner_user_id, owner_client_key))
    ).scalar_one_or_none()


def sync_user_streak(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    observed_at: Optional[datetime] = None,
    daily_goal_completed: bool = False,
) -> UserStreak:
    owner_user_id, owner_client_key = require_owner_scope(owner_user_id, owner_client_key)
    now = observed_at or utcnow()
    computed = _compute_streak(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key, now=now)

    streak = _find_streak(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    if not streak:
        streak = UserStreak(
            user_id=owner_user_id,
            client_key=owner_client_key,
            current_streak_days=0,
            best_streak_days=0,
            total_active_days=0,
        )
        db.add(streak)
        db.flush()

    streak.current_streak_days = computed["current"]
    streak.best_streak_days = max(computed["best"], int(streak.best_streak_days or 0))
    streak.total_active_days = computed["total_active_days"]
    streak.last_activity_date = computed["last_activity_date"]
    if daily_goal_completed:
        streak.last_goal_completed_date = _day_start(now)
    streak.updated_at = now
    db.flush()
    return streak


def _compute_adaptive_profile(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    now: datetime,
    lookback_days: int = 21,
) -> dict[str, Any]:
    since = _day_start(now - timedelta(days=max(int(lookback_days), 1) - 1))
    rows = db.execute(
        select(
            UserDomainMetricDaily.certification,
            UserDomainMetricDaily.domain,
            func.sum(UserDomainMetricDaily.attempts_total),
            func.sum(UserDomainMetricDaily.wrong_count),
            func.sum(UserDomainMetricDaily.low_confidence_count),
        )
        .where(
            *owner_clauses(UserDomainMetricDaily, owner_user_id, owner_client_key),
            UserDomainMetricDaily.metric_date >= since,
        )
        .group_by(UserDomainMetricDaily.certification, UserDomainMetricDaily.domain)
    ).all()

    # Grouped by (certification, domain) so homonymous domains never merge (M-C5).
    focus_domains: list[dict[str, Any]] = []
    confidence_weighted_total = 0.0
    attempt_total = 0
    for certification, domain, attempts_total, wrong_count, low_confidence_count in rows:
        attempts = int(attempts_total or 0)
        if attempts <= 0:
            continue
        wrong = int(wrong_count or 0)
        low_confidence = int(low_confidence_count or 0)
        wrong_rate = wrong / attempts
        uncertainty_rate = low_confidence / attempts
        focus_score = round((wrong_rate * 0.7) + (uncertainty_rate * 0.3), 4)
        focus_domains.append(
            {
                "certification": str(certification or "").strip() or None,
                "domain": str(domain or "Sem dominio").strip() or "Sem dominio",
                "attempts": attempts,
                "wrong_rate_percent": round(wrong_rate * 100.0, 2),
                "uncertainty_rate_percent": round(uncertainty_rate * 100.0, 2),
                "focus_score": round(focus_score * 100.0, 2),
            }
        )
        confidence_weighted_total += low_confidence
        attempt_total += attempts

    focus_domains.sort(key=lambda item: (-item["focus_score"], -item["attempts"], item["domain"].lower()))
    low_confidence_bias = round((confidence_weighted_total / attempt_total) * 100.0, 2) if attempt_total else 0.0

    due_count = int(
        db.execute(
            select(func.count(ReviewQueueItem.id)).where(
                *owner_clauses(ReviewQueueItem, owner_user_id, owner_client_key),
                ReviewQueueItem.due_at <= now,
            )
        ).scalar_one()
        or 0
    )
    return {
        "focus_domains": focus_domains[:3],
        "low_confidence_bias": low_confidence_bias,
        "variety_floor_percent": 30.0 if len(focus_domains) >= 3 else 40.0,
        "recovery_mode": due_count >= 12 or low_confidence_bias >= 35.0,
    }


def recompute_adaptive_profile(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    lookback_days: int = 21,
    observed_at: Optional[datetime] = None,
) -> AdaptiveProfile:
    owner_user_id, owner_client_key = require_owner_scope(owner_user_id, owner_client_key)
    now = observed_at or utcnow()
    computed = _compute_adaptive_profile(
        db, owner_user_id=owner_user_id, owner_client_key=owner_client_key, now=now, lookback_days=lookback_days
    )
    profile = db.execute(
        select(AdaptiveProfile).where(*owner_clauses(AdaptiveProfile, owner_user_id, owner_client_key))
    ).scalar_one_or_none()
    if not profile:
        profile = AdaptiveProfile(
            user_id=owner_user_id,
            client_key=owner_client_key,
            variety_floor_percent=30.0,
        )
        db.add(profile)
        db.flush()

    profile.weak_domain_focus_json = json.dumps(computed["focus_domains"], ensure_ascii=False) if computed["focus_domains"] else None
    profile.low_confidence_bias = computed["low_confidence_bias"]
    profile.variety_floor_percent = computed["variety_floor_percent"]
    profile.recovery_mode = computed["recovery_mode"]
    profile.last_recomputed_at = now
    profile.updated_at = now
    db.flush()
    return profile


def build_engagement_snapshot(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> dict[str, Any]:
    owner_user_id, owner_client_key = require_owner_scope(owner_user_id, owner_client_key)
    now = utcnow()
    today = _day_start(now)
    week_start = _week_start(now)

    goals = _find_user_goal(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key) or SimpleNamespace(**DEFAULT_GOALS)

    today_questions_answered = int(
        db.execute(
            select(func.coalesce(func.sum(UserDomainMetricDaily.attempts_total), 0)).where(
                *owner_clauses(UserDomainMetricDaily, owner_user_id, owner_client_key),
                UserDomainMetricDaily.metric_date == today,
            )
        ).scalar_one()
        or 0
    )

    today_review_completed = int(
        db.execute(
            select(func.count(StudyAttempt.id))
            .join(StudySession, StudySession.id == StudyAttempt.session_id)
            .where(
                *owner_clauses(StudySession, owner_user_id, owner_client_key),
                StudySession.selection_strategy == "review",
                StudyAttempt.answered_at >= today,
                StudyAttempt.answered_at < today + timedelta(days=1),
            )
        ).scalar_one()
        or 0
    )

    due_now = int(
        db.execute(
            select(func.count(ReviewQueueItem.id)).where(
                *owner_clauses(ReviewQueueItem, owner_user_id, owner_client_key),
                ReviewQueueItem.due_at <= now,
            )
        ).scalar_one()
        or 0
    )

    weekly_snapshot = db.execute(
        select(WeeklyProgressSnapshot).where(
            *owner_clauses(WeeklyProgressSnapshot, owner_user_id, owner_client_key),
            WeeklyProgressSnapshot.week_start == week_start,
        )
    ).scalar_one_or_none()
    weekly_questions_completed = int(weekly_snapshot.questions_answered if weekly_snapshot else 0)
    weekly_review_completed = int(weekly_snapshot.review_questions if weekly_snapshot else 0)

    daily_question_goal = _progress_payload(
        completed=today_questions_answered,
        target=goals.daily_question_target,
    )
    daily_review_goal = _progress_payload(
        completed=today_review_completed,
        target=goals.daily_review_target,
    )
    weekly_question_goal = _progress_payload(
        completed=weekly_questions_completed,
        target=goals.weekly_question_target,
    )
    weekly_review_goal = _progress_payload(
        completed=weekly_review_completed,
        target=goals.weekly_review_target,
    )

    daily_goal_completed = daily_question_goal["reached"] and daily_review_goal["reached"]
    streak = _compute_streak(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key, now=now)
    stored_streak = _find_streak(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    best_days = max(streak["best"], int(stored_streak.best_streak_days or 0) if stored_streak else 0)
    goal_completed_today = daily_goal_completed or bool(
        stored_streak and stored_streak.last_goal_completed_date == today
    )
    profile = _compute_adaptive_profile(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key, now=now)
    focus_domains = profile["focus_domains"]

    if due_now > max(goals.daily_review_target, 0):
        recommended_next_action = (
            f"Priorize {min(due_now, goals.daily_review_target + 5)} revisoes agora para conter o backlog vencido."
        )
    elif not daily_question_goal["reached"]:
        recommended_next_action = (
            f"Resolva mais {daily_question_goal['remaining']} questoes novas para fechar a meta diaria."
        )
    elif not daily_review_goal["reached"]:
        recommended_next_action = (
            f"Feche pelo menos {daily_review_goal['remaining']} revisoes hoje para manter o ritmo."
        )
    elif focus_domains:
        recommended_next_action = (
            f"Bom ritmo. Seu maior ponto de atencao agora e {focus_domains[0]['domain']}."
        )
    else:
        recommended_next_action = "Meta diaria em dia. Mantenha consistencia e preserve variedade entre dominios."

    return {
        "daily_goal": daily_question_goal,
        "daily_review_goal": daily_review_goal,
        "weekly_goal": weekly_question_goal,
        "weekly_review_goal": weekly_review_goal,
        "streak": {
            "current_days": int(streak["current"]),
            "best_days": int(best_days),
            "total_active_days": int(streak["total_active_days"]),
            "last_activity_at": streak["last_activity_date"].isoformat() if streak["last_activity_date"] else None,
            "goal_completed_today": bool(goal_completed_today),
        },
        "adaptive_profile": {
            "recovery_mode": bool(profile["recovery_mode"]),
            "low_confidence_bias": round(float(profile["low_confidence_bias"] or 0.0), 2),
            "variety_floor_percent": round(float(profile["variety_floor_percent"] or 0.0), 2),
            "focus_domains": focus_domains,
            "last_recomputed_at": now.isoformat(),
        },
        "review_backlog_due": due_now,
        "recommended_next_action": recommended_next_action,
    }


def refresh_engagement_state(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> None:
    """Persist goals/streak/adaptive profile (mutating flows only; never from a GET)."""
    try:
        owner_user_id, owner_client_key = require_owner_scope(owner_user_id, owner_client_key)
    except ValueError:
        return
    now = utcnow()
    get_or_create_user_goal(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    snapshot = build_engagement_snapshot(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    daily_goal_completed = bool(snapshot["daily_goal"]["reached"] and snapshot["daily_review_goal"]["reached"])
    sync_user_streak(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        observed_at=now,
        daily_goal_completed=daily_goal_completed,
    )
    recompute_adaptive_profile(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key, observed_at=now)
