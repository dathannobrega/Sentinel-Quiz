from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

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
from app.services.auth import normalize_client_key


DEFAULT_GOALS = {
    "daily_question_target": 10,
    "daily_review_target": 5,
    "weekly_question_target": 50,
    "weekly_review_target": 30,
    "stretch_question_target": 15,
}


def _normalize_owner_scope(
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    normalized_user_id = str(owner_user_id or "").strip() or None
    normalized_client_key = None if normalized_user_id else normalize_client_key(owner_client_key)
    if not normalized_user_id and not normalized_client_key:
        raise ValueError("Owner scope is required.")
    return normalized_user_id, normalized_client_key


def _owner_filters(model: Any, owner_user_id: Optional[str], owner_client_key: Optional[str]) -> tuple[Any, ...]:
    if owner_user_id:
        return (model.user_id == owner_user_id,)
    return (
        model.user_id.is_(None),
        model.client_key == owner_client_key,
    )


def _day_start(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _week_start(value: datetime) -> datetime:
    base = _day_start(value)
    return base - timedelta(days=base.weekday())


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


def get_or_create_user_goal(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> UserGoal:
    owner_user_id, owner_client_key = _normalize_owner_scope(owner_user_id, owner_client_key)
    goal = db.execute(
        select(UserGoal).where(*_owner_filters(UserGoal, owner_user_id, owner_client_key))
    ).scalar_one_or_none()
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


def sync_user_streak(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    observed_at: Optional[datetime] = None,
    daily_goal_completed: bool = False,
) -> UserStreak:
    owner_user_id, owner_client_key = _normalize_owner_scope(owner_user_id, owner_client_key)
    now = observed_at or datetime.utcnow()
    today = _day_start(now)
    yesterday = today - timedelta(days=1)

    rows = db.execute(
        select(UserDomainMetricDaily.metric_date)
        .where(
            *_owner_filters(UserDomainMetricDaily, owner_user_id, owner_client_key),
            UserDomainMetricDaily.attempts_total > 0,
        )
        .order_by(UserDomainMetricDaily.metric_date.asc())
    ).scalars().all()
    activity_days = sorted({_day_start(item) for item in rows if item})

    streak = db.execute(
        select(UserStreak).where(*_owner_filters(UserStreak, owner_user_id, owner_client_key))
    ).scalar_one_or_none()
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

    best = 0
    current_run = 0
    previous_day: datetime | None = None
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
        if last_day >= yesterday:
            current = 1
            cursor = last_day
            for day in reversed(activity_days[:-1]):
                if day == cursor - timedelta(days=1):
                    current += 1
                    cursor = day
                    continue
                break

    streak.current_streak_days = current
    streak.best_streak_days = max(best, current, int(streak.best_streak_days or 0))
    streak.total_active_days = len(activity_days)
    streak.last_activity_date = activity_days[-1] if activity_days else None
    if daily_goal_completed:
        streak.last_goal_completed_date = today
    streak.updated_at = now
    db.flush()
    return streak


def recompute_adaptive_profile(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    lookback_days: int = 21,
    observed_at: Optional[datetime] = None,
) -> AdaptiveProfile:
    owner_user_id, owner_client_key = _normalize_owner_scope(owner_user_id, owner_client_key)
    now = observed_at or datetime.utcnow()
    since = _day_start(now - timedelta(days=max(int(lookback_days), 1) - 1))

    rows = db.execute(
        select(
            UserDomainMetricDaily.domain,
            func.sum(UserDomainMetricDaily.attempts_total),
            func.sum(UserDomainMetricDaily.wrong_count),
            func.sum(UserDomainMetricDaily.low_confidence_count),
        )
        .where(
            *_owner_filters(UserDomainMetricDaily, owner_user_id, owner_client_key),
            UserDomainMetricDaily.metric_date >= since,
        )
        .group_by(UserDomainMetricDaily.domain)
    ).all()

    focus_domains: list[dict[str, Any]] = []
    confidence_weighted_total = 0.0
    attempt_total = 0
    for domain, attempts_total, wrong_count, low_confidence_count in rows:
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
                *_owner_filters(ReviewQueueItem, owner_user_id, owner_client_key),
                ReviewQueueItem.due_at <= now,
            )
        ).scalar_one()
        or 0
    )

    profile = db.execute(
        select(AdaptiveProfile).where(*_owner_filters(AdaptiveProfile, owner_user_id, owner_client_key))
    ).scalar_one_or_none()
    if not profile:
        profile = AdaptiveProfile(
            user_id=owner_user_id,
            client_key=owner_client_key,
            variety_floor_percent=30.0,
        )
        db.add(profile)
        db.flush()

    profile.weak_domain_focus_json = json.dumps(focus_domains[:3], ensure_ascii=False) if focus_domains else None
    profile.low_confidence_bias = low_confidence_bias
    profile.variety_floor_percent = 30.0 if len(focus_domains) >= 3 else 40.0
    profile.recovery_mode = due_count >= 12 or low_confidence_bias >= 35.0
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
    owner_user_id, owner_client_key = _normalize_owner_scope(owner_user_id, owner_client_key)
    now = datetime.utcnow()
    today = _day_start(now)
    week_start = _week_start(now)

    goals = get_or_create_user_goal(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
    )

    today_questions_answered = int(
        db.execute(
            select(func.coalesce(func.sum(UserDomainMetricDaily.attempts_total), 0)).where(
                *_owner_filters(UserDomainMetricDaily, owner_user_id, owner_client_key),
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
                *_owner_filters(StudySession, owner_user_id, owner_client_key),
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
                *_owner_filters(ReviewQueueItem, owner_user_id, owner_client_key),
                ReviewQueueItem.due_at <= now,
            )
        ).scalar_one()
        or 0
    )

    weekly_snapshot = db.execute(
        select(WeeklyProgressSnapshot).where(
            *_owner_filters(WeeklyProgressSnapshot, owner_user_id, owner_client_key),
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
    streak = sync_user_streak(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        observed_at=now,
        daily_goal_completed=daily_goal_completed,
    )
    profile = recompute_adaptive_profile(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        observed_at=now,
    )

    focus_domains = []
    if profile.weak_domain_focus_json:
        try:
            parsed = json.loads(profile.weak_domain_focus_json)
        except (TypeError, ValueError):
            parsed = []
        if isinstance(parsed, list):
            focus_domains = [item for item in parsed if isinstance(item, dict)]

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
            "current_days": int(streak.current_streak_days or 0),
            "best_days": int(streak.best_streak_days or 0),
            "total_active_days": int(streak.total_active_days or 0),
            "last_activity_at": streak.last_activity_date.isoformat() if streak.last_activity_date else None,
            "goal_completed_today": bool(streak.last_goal_completed_date == today),
        },
        "adaptive_profile": {
            "recovery_mode": bool(profile.recovery_mode),
            "low_confidence_bias": round(float(profile.low_confidence_bias or 0.0), 2),
            "variety_floor_percent": round(float(profile.variety_floor_percent or 0.0), 2),
            "focus_domains": focus_domains,
            "last_recomputed_at": profile.last_recomputed_at.isoformat() if profile.last_recomputed_at else None,
        },
        "review_backlog_due": due_now,
        "recommended_next_action": recommended_next_action,
    }
