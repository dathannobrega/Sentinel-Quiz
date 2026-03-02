from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    ReviewQueueItem,
    UserDomainMetricDaily,
    UserExamMetricsSnapshot,
    WeeklyProgressSnapshot,
)
from app.services.auth import normalize_client_key

MIXED_SCOPE_EXAM_ID = "__mixed__"


def _normalize_owner_scope(
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    normalized_user_id = str(owner_user_id or "").strip() or None
    normalized_client_key = None if normalized_user_id else normalize_client_key(owner_client_key)
    if not normalized_user_id and not normalized_client_key:
        raise ValueError("Owner scope is required for metrics tracking.")
    return normalized_user_id, normalized_client_key


def _day_start(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _week_start(value: datetime) -> datetime:
    base = _day_start(value)
    return base - timedelta(days=base.weekday())


def _owner_filters(model: Any, owner_user_id: Optional[str], owner_client_key: Optional[str]) -> tuple[Any, ...]:
    if owner_user_id:
        return (model.user_id == owner_user_id,)
    return (
        model.user_id.is_(None),
        model.client_key == owner_client_key,
    )


def _normalize_exam_id(exam_id: Optional[str]) -> str:
    normalized = str(exam_id or "").strip()
    return normalized or MIXED_SCOPE_EXAM_ID


def _get_or_create_weekly_snapshot(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    week_start: datetime,
    created_at: datetime,
) -> WeeklyProgressSnapshot:
    snapshot = db.execute(
        select(WeeklyProgressSnapshot).where(
            *_owner_filters(WeeklyProgressSnapshot, owner_user_id, owner_client_key),
            WeeklyProgressSnapshot.week_start == week_start,
        )
    ).scalar_one_or_none()
    if snapshot:
        return snapshot

    snapshot = WeeklyProgressSnapshot(
        user_id=owner_user_id,
        client_key=owner_client_key,
        week_start=week_start,
        questions_answered=0,
        review_questions=0,
        scheduled_reviews=0,
        correct_count=0,
        wrong_count=0,
        low_confidence_count=0,
        completed_exam_sessions=0,
        completed_study_sessions=0,
        completed_review_sessions=0,
        review_due_count=0,
        review_total_count=0,
        updated_at=created_at,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def _refresh_backlog_counts(
    db: Session,
    *,
    snapshot: WeeklyProgressSnapshot,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    observed_at: datetime,
) -> None:
    if snapshot.week_start != _week_start(observed_at):
        return
    total_count = int(
        db.execute(
            select(func.count(ReviewQueueItem.id)).where(
                *_owner_filters(ReviewQueueItem, owner_user_id, owner_client_key),
            )
        ).scalar_one()
        or 0
    )
    due_count = int(
        db.execute(
            select(func.count(ReviewQueueItem.id)).where(
                *_owner_filters(ReviewQueueItem, owner_user_id, owner_client_key),
                ReviewQueueItem.due_at <= observed_at,
            )
        ).scalar_one()
        or 0
    )
    snapshot.review_total_count = total_count
    snapshot.review_due_count = due_count
    snapshot.updated_at = observed_at


def _refresh_completed_session_counts(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    week_start: datetime,
    observed_at: datetime,
) -> WeeklyProgressSnapshot:
    snapshot = _get_or_create_weekly_snapshot(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        week_start=week_start,
        created_at=observed_at,
    )
    week_end = week_start + timedelta(days=7)
    rows = db.execute(
        select(
            UserExamMetricsSnapshot.mode,
            func.count(UserExamMetricsSnapshot.id),
        ).where(
            *_owner_filters(UserExamMetricsSnapshot, owner_user_id, owner_client_key),
            UserExamMetricsSnapshot.completed_at.is_not(None),
            UserExamMetricsSnapshot.completed_at >= week_start,
            UserExamMetricsSnapshot.completed_at < week_end,
        ).group_by(UserExamMetricsSnapshot.mode)
    ).all()
    completed_exam_sessions = 0
    completed_study_sessions = 0
    for mode, count in rows:
        if str(mode or "").strip().lower() == "study":
            completed_study_sessions = int(count or 0)
        else:
            completed_exam_sessions = int(count or 0)
    completed_review_sessions = int(
        db.execute(
            select(func.count(UserExamMetricsSnapshot.id)).where(
                *_owner_filters(UserExamMetricsSnapshot, owner_user_id, owner_client_key),
                UserExamMetricsSnapshot.mode == "study",
                UserExamMetricsSnapshot.selection_strategy == "review",
                UserExamMetricsSnapshot.completed_at.is_not(None),
                UserExamMetricsSnapshot.completed_at >= week_start,
                UserExamMetricsSnapshot.completed_at < week_end,
            )
        ).scalar_one()
        or 0
    )
    snapshot.completed_exam_sessions = completed_exam_sessions
    snapshot.completed_study_sessions = completed_study_sessions
    snapshot.completed_review_sessions = completed_review_sessions
    _refresh_backlog_counts(
        db,
        snapshot=snapshot,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        observed_at=observed_at,
    )
    return snapshot


def record_review_schedule_event(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    scheduled_at: Optional[datetime] = None,
) -> WeeklyProgressSnapshot:
    owner_user_id, owner_client_key = _normalize_owner_scope(owner_user_id, owner_client_key)
    timestamp = scheduled_at or datetime.utcnow()
    snapshot = _get_or_create_weekly_snapshot(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        week_start=_week_start(timestamp),
        created_at=timestamp,
    )
    snapshot.scheduled_reviews += 1
    snapshot.updated_at = timestamp
    _refresh_backlog_counts(
        db,
        snapshot=snapshot,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        observed_at=timestamp,
    )
    return snapshot


def record_question_attempt_metrics(
    db: Session,
    *,
    question_id: str,
    mode: str,
    exam_id: Optional[str],
    certification: Optional[str],
    domain: Optional[str],
    is_correct: bool,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    confidence_level: Optional[str] = None,
    elapsed_seconds: Optional[int] = None,
    attempted_at: Optional[datetime] = None,
    selection_strategy: Optional[str] = None,
) -> dict[str, Any]:
    owner_user_id, owner_client_key = _normalize_owner_scope(owner_user_id, owner_client_key)
    timestamp = attempted_at or datetime.utcnow()
    normalized_mode = "study" if str(mode or "").strip().lower() == "study" else "exam"
    normalized_domain = str(domain or "Sem dominio").strip() or "Sem dominio"
    normalized_certification = str(certification or "").strip() or None
    normalized_exam_id = _normalize_exam_id(exam_id)
    normalized_confidence = str(confidence_level or "").strip().lower() or None
    normalized_strategy = str(selection_strategy or "").strip().lower() or None
    metric_date = _day_start(timestamp)

    domain_metric = db.execute(
        select(UserDomainMetricDaily).where(
            *_owner_filters(UserDomainMetricDaily, owner_user_id, owner_client_key),
            UserDomainMetricDaily.metric_date == metric_date,
            UserDomainMetricDaily.exam_id == normalized_exam_id,
            UserDomainMetricDaily.domain == normalized_domain,
        )
    ).scalar_one_or_none()
    if not domain_metric:
        domain_metric = UserDomainMetricDaily(
            user_id=owner_user_id,
            client_key=owner_client_key,
            metric_date=metric_date,
            exam_id=normalized_exam_id,
            certification=normalized_certification,
            domain=normalized_domain,
            attempts_total=0,
            exam_attempts=0,
            study_attempts=0,
            correct_count=0,
            wrong_count=0,
            low_confidence_count=0,
            total_elapsed_seconds=0,
            timed_attempts=0,
            updated_at=timestamp,
        )
        db.add(domain_metric)
        db.flush()

    domain_metric.certification = normalized_certification or domain_metric.certification
    domain_metric.attempts_total += 1
    if normalized_mode == "study":
        domain_metric.study_attempts += 1
    else:
        domain_metric.exam_attempts += 1
    if is_correct:
        domain_metric.correct_count += 1
    else:
        domain_metric.wrong_count += 1
    if normalized_confidence == "low":
        domain_metric.low_confidence_count += 1
    if elapsed_seconds is not None and elapsed_seconds >= 0:
        domain_metric.total_elapsed_seconds += int(elapsed_seconds)
        domain_metric.timed_attempts += 1
    domain_metric.updated_at = timestamp

    weekly_snapshot = _get_or_create_weekly_snapshot(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        week_start=_week_start(timestamp),
        created_at=timestamp,
    )
    weekly_snapshot.questions_answered += 1
    if normalized_mode == "study" and normalized_strategy == "review":
        weekly_snapshot.review_questions += 1
    if is_correct:
        weekly_snapshot.correct_count += 1
    else:
        weekly_snapshot.wrong_count += 1
    if normalized_confidence == "low":
        weekly_snapshot.low_confidence_count += 1
    weekly_snapshot.updated_at = timestamp
    _refresh_backlog_counts(
        db,
        snapshot=weekly_snapshot,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        observed_at=timestamp,
    )
    return {
        "question_id": question_id,
        "domain_metric": domain_metric,
        "weekly_snapshot": weekly_snapshot,
    }


def record_session_metrics(
    db: Session,
    *,
    session_id: str,
    mode: str,
    exam_id: Optional[str],
    selection_strategy: Optional[str],
    total_questions: int,
    answered_count: int,
    correct_count: int,
    wrong_count: int,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    completed_at: Optional[datetime],
    created_at: Optional[datetime],
    weakest_domains: Optional[list[dict[str, Any]]] = None,
) -> UserExamMetricsSnapshot | None:
    if completed_at is None:
        return None

    owner_user_id, owner_client_key = _normalize_owner_scope(owner_user_id, owner_client_key)
    normalized_mode = "study" if str(mode or "").strip().lower() == "study" else "exam"
    normalized_exam_id = _normalize_exam_id(exam_id)
    normalized_strategy = str(selection_strategy or "").strip().lower() or None
    weakest_payload = weakest_domains or []
    duration_seconds = None
    if created_at and completed_at and completed_at >= created_at:
        duration_seconds = int((completed_at - created_at).total_seconds())
    score_percent = round((correct_count / total_questions) * 100.0, 2) if total_questions else 0.0

    snapshot = db.execute(
        select(UserExamMetricsSnapshot).where(UserExamMetricsSnapshot.session_id == session_id)
    ).scalar_one_or_none()
    previous_week_start = _week_start(snapshot.completed_at) if snapshot and snapshot.completed_at else None
    if not snapshot:
        snapshot = UserExamMetricsSnapshot(
            user_id=owner_user_id,
            client_key=owner_client_key,
            session_id=session_id,
            mode=normalized_mode,
            exam_id=normalized_exam_id,
            selection_strategy=normalized_strategy,
            total_questions=total_questions,
            answered_count=answered_count,
            correct_count=correct_count,
            wrong_count=wrong_count,
            score_percent=score_percent,
            duration_seconds=duration_seconds,
            weakest_domains_json=json.dumps(weakest_payload, ensure_ascii=False) if weakest_payload else None,
            review_due_count=0,
            review_total_count=0,
            completed_at=completed_at,
            created_at=created_at or completed_at,
            updated_at=completed_at,
        )
        db.add(snapshot)
        db.flush()
    else:
        snapshot.user_id = owner_user_id
        snapshot.client_key = owner_client_key
        snapshot.mode = normalized_mode
        snapshot.exam_id = normalized_exam_id
        snapshot.selection_strategy = normalized_strategy
        snapshot.total_questions = total_questions
        snapshot.answered_count = answered_count
        snapshot.correct_count = correct_count
        snapshot.wrong_count = wrong_count
        snapshot.score_percent = score_percent
        snapshot.duration_seconds = duration_seconds
        snapshot.weakest_domains_json = json.dumps(weakest_payload, ensure_ascii=False) if weakest_payload else None
        snapshot.completed_at = completed_at
        snapshot.updated_at = completed_at

    current_week_start = _week_start(completed_at)
    if previous_week_start and previous_week_start != current_week_start:
        _refresh_completed_session_counts(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            week_start=previous_week_start,
            observed_at=completed_at,
        )
    refreshed_weekly = _refresh_completed_session_counts(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        week_start=current_week_start,
        observed_at=completed_at,
    )
    snapshot.review_due_count = refreshed_weekly.review_due_count
    snapshot.review_total_count = refreshed_weekly.review_total_count
    return snapshot


def aggregate_domain_metrics_for_owner(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    days: Optional[int] = None,
) -> list[dict[str, Any]]:
    owner_user_id, owner_client_key = _normalize_owner_scope(owner_user_id, owner_client_key)
    stmt = (
        select(
            UserDomainMetricDaily.certification,
            UserDomainMetricDaily.domain,
            func.sum(UserDomainMetricDaily.attempts_total),
            func.sum(UserDomainMetricDaily.correct_count),
            func.sum(UserDomainMetricDaily.wrong_count),
            func.sum(UserDomainMetricDaily.low_confidence_count),
            func.sum(UserDomainMetricDaily.total_elapsed_seconds),
            func.sum(UserDomainMetricDaily.timed_attempts),
        )
        .where(*_owner_filters(UserDomainMetricDaily, owner_user_id, owner_client_key))
        .group_by(UserDomainMetricDaily.certification, UserDomainMetricDaily.domain)
    )
    if days:
        threshold = _day_start(datetime.utcnow() - timedelta(days=max(int(days), 1) - 1))
        stmt = stmt.where(UserDomainMetricDaily.metric_date >= threshold)

    rows = db.execute(stmt).all()
    items: list[dict[str, Any]] = []
    for certification, domain, attempts_total, correct_count, wrong_count, low_confidence_count, elapsed_total, timed_attempts in rows:
        attempts = int(attempts_total or 0)
        correct = int(correct_count or 0)
        wrong = int(wrong_count or 0)
        low_confidence = int(low_confidence_count or 0)
        elapsed = int(elapsed_total or 0)
        timed = int(timed_attempts or 0)
        items.append({
            "certification": str(certification or "Sem certificacao").strip() or "Sem certificacao",
            "domain": str(domain or "Sem dominio").strip() or "Sem dominio",
            "attempts_total": attempts,
            "correct_count": correct,
            "wrong_count": wrong,
            "low_confidence_count": low_confidence,
            "accuracy_percent": round((correct / attempts) * 100.0, 2) if attempts else 0.0,
            "avg_elapsed_seconds": round(elapsed / timed, 2) if timed else None,
        })
    return items


def load_weekly_progress_snapshots(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    range_start: datetime,
) -> list[WeeklyProgressSnapshot]:
    owner_user_id, owner_client_key = _normalize_owner_scope(owner_user_id, owner_client_key)
    return db.execute(
        select(WeeklyProgressSnapshot)
        .where(
            *_owner_filters(WeeklyProgressSnapshot, owner_user_id, owner_client_key),
            WeeklyProgressSnapshot.week_start >= range_start,
        )
        .order_by(WeeklyProgressSnapshot.week_start.asc())
    ).scalars().all()
