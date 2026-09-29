from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import case, func, inspect, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import (
    Exam,
    Question,
    QuestionBank,
    QuestionStatsSnapshot,
    QuestionVersion,
    ReviewQueueItem,
    SessionAnswer,
    StudyAttempt,
)


def _truncate_text(value: str | None, limit: int = 140) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(limit - 3, 0)].rstrip()}..."


def _snapshot_meta(db: Session) -> dict[str, Any]:
    if not _has_table(db, "question_stats_snapshot"):
        return {
            "snapshot_batch_count": 0,
            "latest_snapshot_at": None,
        }
    batch_count, latest_snapshot_at = db.execute(
        select(
            func.count(func.distinct(QuestionStatsSnapshot.capture_batch_id)),
            func.max(QuestionStatsSnapshot.captured_at),
        )
    ).one()
    return {
        "snapshot_batch_count": int(batch_count or 0),
        "latest_snapshot_at": latest_snapshot_at.isoformat() if latest_snapshot_at else None,
    }


def _has_table(db: Session, table_name: str) -> bool:
    return table_name in set(inspect(db.get_bind()).get_table_names())


def _collect_question_metrics(db: Session) -> list[dict[str, Any]]:
    question_rows = db.execute(
        select(
            Question.id,
            Question.exam_id,
            Exam.title,
            Question.prompt,
            Question.domain,
            Question.certification,
            Question.difficulty,
            QuestionBank.published_version_id,
        )
        .join(Exam, Exam.id == Question.exam_id)
        .outerjoin(QuestionBank, QuestionBank.stable_question_id == Question.id)
    ).all()
    if not question_rows:
        return []

    aggregates: dict[str, dict[str, Any]] = {
        question_id: {
            "id": question_id,
            "exam_id": exam_id,
            "exam_title": exam_title,
            "prompt": prompt,
            "domain": domain or "Sem dominio",
            "certification": certification,
            "difficulty": difficulty,
            "question_version_id": int(published_version_id) if published_version_id else None,
            "exam_attempts": 0,
            "study_attempts": 0,
            "wrong_count": 0,
            "low_confidence_count": 0,
            "elapsed_total": 0,
            "elapsed_count": 0,
            "review_pressure_count": 0,
        }
        for question_id, exam_id, exam_title, prompt, domain, certification, difficulty, published_version_id in question_rows
    }

    exam_attempt_rows = db.execute(
        select(
            SessionAnswer.question_id,
            func.count(SessionAnswer.id),
            func.sum(case((SessionAnswer.is_correct.is_(False), 1), else_=0)),
        ).group_by(SessionAnswer.question_id)
    ).all()
    for question_id, total_attempts, wrong_count in exam_attempt_rows:
        bucket = aggregates.get(question_id)
        if not bucket:
            continue
        bucket["exam_attempts"] = int(total_attempts or 0)
        bucket["wrong_count"] += int(wrong_count or 0)

    study_attempt_rows = db.execute(
        select(
            StudyAttempt.question_id,
            func.count(StudyAttempt.id),
            func.sum(case((StudyAttempt.is_correct.is_(False), 1), else_=0)),
            func.sum(case((StudyAttempt.confidence_level == "low", 1), else_=0)),
            func.sum(StudyAttempt.elapsed_seconds),
            func.count(StudyAttempt.elapsed_seconds),
        ).group_by(StudyAttempt.question_id)
    ).all()
    for question_id, total_attempts, wrong_count, low_confidence_count, elapsed_total, elapsed_count in study_attempt_rows:
        bucket = aggregates.get(question_id)
        if not bucket:
            continue
        bucket["study_attempts"] = int(total_attempts or 0)
        bucket["wrong_count"] += int(wrong_count or 0)
        bucket["low_confidence_count"] = int(low_confidence_count or 0)
        bucket["elapsed_total"] = int(elapsed_total or 0)
        bucket["elapsed_count"] = int(elapsed_count or 0)

    queue_rows = db.execute(
        select(
            ReviewQueueItem.question_id,
            func.count(ReviewQueueItem.id),
        ).group_by(ReviewQueueItem.question_id)
    ).all()
    for question_id, review_pressure_count in queue_rows:
        bucket = aggregates.get(question_id)
        if bucket:
            bucket["review_pressure_count"] = int(review_pressure_count or 0)

    metrics: list[dict[str, Any]] = []
    for bucket in aggregates.values():
        exam_attempts = int(bucket["exam_attempts"])
        study_attempts = int(bucket["study_attempts"])
        attempts_total = exam_attempts + study_attempts
        wrong_count = int(bucket["wrong_count"])
        low_confidence_count = int(bucket["low_confidence_count"])
        review_pressure_count = int(bucket["review_pressure_count"])
        elapsed_count = int(bucket["elapsed_count"])
        elapsed_total = int(bucket["elapsed_total"])
        wrong_rate = round((wrong_count / attempts_total) * 100.0, 2) if attempts_total else 0.0
        low_confidence_rate = round((low_confidence_count / study_attempts) * 100.0, 2) if study_attempts else 0.0
        review_pressure_score = min(review_pressure_count * 4, 20)
        sample_score = min(attempts_total, 25) / 25 * 10
        difficulty_score = round((wrong_rate * 0.7) + (low_confidence_rate * 0.2) + review_pressure_score + sample_score, 2)
        avg_study_elapsed_seconds = round(elapsed_total / elapsed_count, 2) if elapsed_count else None

        metrics.append({
            "id": bucket["id"],
            "exam_id": bucket["exam_id"],
            "exam_title": bucket["exam_title"],
            "prompt": _truncate_text(bucket["prompt"]),
            "domain": bucket["domain"],
            "certification": bucket["certification"],
            "difficulty": bucket["difficulty"],
            "question_version_id": bucket["question_version_id"],
            "attempts_total": attempts_total,
            "exam_attempts": exam_attempts,
            "study_attempts": study_attempts,
            "wrong_count": wrong_count,
            "wrong_rate_percent": wrong_rate,
            "low_confidence_count": low_confidence_count,
            "low_confidence_rate_percent": low_confidence_rate,
            "review_pressure_count": review_pressure_count,
            "avg_study_elapsed_seconds": avg_study_elapsed_seconds,
            "difficulty_score": difficulty_score,
        })

    return metrics


def build_admin_question_analytics(
    db: Session,
    *,
    limit: int = 10,
) -> dict[str, Any]:
    normalized_limit = max(3, min(int(limit or 10), 30))
    metrics = _collect_question_metrics(db)
    snapshot_meta = _snapshot_meta(db)
    if not metrics:
        return {
            "summary": {
                "tracked_questions": 0,
                "questions_with_signals": 0,
                "total_attempts": 0,
                "exam_attempts": 0,
                "study_attempts": 0,
                "total_review_pressure": 0,
                "average_wrong_rate_percent": 0.0,
                **snapshot_meta,
            },
            "hardest_questions": [],
            "weakest_domains": [],
            "weakest_exams": [],
        }

    hardest_questions: list[dict[str, Any]] = []
    domain_buckets: dict[str, dict[str, Any]] = {}
    exam_buckets: dict[str, dict[str, Any]] = {}
    total_attempts = 0
    total_exam_attempts = 0
    total_study_attempts = 0
    total_wrong = 0
    total_review_pressure = 0

    for item in metrics:
        attempts_total = int(item["attempts_total"])
        exam_attempts = int(item["exam_attempts"])
        study_attempts = int(item["study_attempts"])
        wrong_count = int(item["wrong_count"])
        low_confidence_count = int(item["low_confidence_count"])
        review_pressure_count = int(item["review_pressure_count"])

        total_attempts += attempts_total
        total_exam_attempts += exam_attempts
        total_study_attempts += study_attempts
        total_wrong += wrong_count
        total_review_pressure += review_pressure_count

        if attempts_total <= 0 and review_pressure_count <= 0:
            continue

        hardest_questions.append(item)

        domain_label = str(item["domain"] or "Sem dominio").strip() or "Sem dominio"
        domain_bucket = domain_buckets.setdefault(domain_label, {
            "domain": domain_label,
            "tracked_questions": 0,
            "attempts_total": 0,
            "wrong_count": 0,
            "low_confidence_count": 0,
            "review_pressure_count": 0,
        })
        domain_bucket["tracked_questions"] += 1
        domain_bucket["attempts_total"] += attempts_total
        domain_bucket["wrong_count"] += wrong_count
        domain_bucket["low_confidence_count"] += low_confidence_count
        domain_bucket["review_pressure_count"] += review_pressure_count

        exam_label = str(item["exam_title"] or item["exam_id"] or "Sem prova").strip() or "Sem prova"
        exam_bucket = exam_buckets.setdefault(item["exam_id"], {
            "exam_id": item["exam_id"],
            "exam_title": exam_label,
            "tracked_questions": 0,
            "attempts_total": 0,
            "wrong_count": 0,
            "low_confidence_count": 0,
            "review_pressure_count": 0,
        })
        exam_bucket["tracked_questions"] += 1
        exam_bucket["attempts_total"] += attempts_total
        exam_bucket["wrong_count"] += wrong_count
        exam_bucket["low_confidence_count"] += low_confidence_count
        exam_bucket["review_pressure_count"] += review_pressure_count

    hardest_questions.sort(
        key=lambda item: (
            -float(item["difficulty_score"]),
            -int(item["attempts_total"]),
            -int(item["review_pressure_count"]),
            str(item["prompt"]).lower(),
        )
    )

    weakest_domains: list[dict[str, Any]] = []
    for bucket in domain_buckets.values():
        attempts_total = int(bucket["attempts_total"])
        wrong_count = int(bucket["wrong_count"])
        weakest_domains.append({
            "domain": bucket["domain"],
            "tracked_questions": int(bucket["tracked_questions"]),
            "attempts_total": attempts_total,
            "wrong_count": wrong_count,
            "wrong_rate_percent": round((wrong_count / attempts_total) * 100.0, 2) if attempts_total else 0.0,
            "low_confidence_count": int(bucket["low_confidence_count"]),
            "review_pressure_count": int(bucket["review_pressure_count"]),
        })

    weakest_domains.sort(
        key=lambda item: (
            -float(item["wrong_rate_percent"]),
            -int(item["review_pressure_count"]),
            -int(item["attempts_total"]),
            str(item["domain"]).lower(),
        )
    )

    weakest_exams: list[dict[str, Any]] = []
    for bucket in exam_buckets.values():
        attempts_total = int(bucket["attempts_total"])
        wrong_count = int(bucket["wrong_count"])
        weakest_exams.append({
            "exam_id": bucket["exam_id"],
            "exam_title": bucket["exam_title"],
            "tracked_questions": int(bucket["tracked_questions"]),
            "attempts_total": attempts_total,
            "wrong_count": wrong_count,
            "wrong_rate_percent": round((wrong_count / attempts_total) * 100.0, 2) if attempts_total else 0.0,
            "low_confidence_count": int(bucket["low_confidence_count"]),
            "review_pressure_count": int(bucket["review_pressure_count"]),
        })

    weakest_exams.sort(
        key=lambda item: (
            -float(item["wrong_rate_percent"]),
            -int(item["review_pressure_count"]),
            -int(item["attempts_total"]),
            str(item["exam_title"]).lower(),
        )
    )

    questions_with_signals = len(hardest_questions)
    return {
        "summary": {
            "tracked_questions": len(metrics),
            "questions_with_signals": questions_with_signals,
            "total_attempts": total_attempts,
            "exam_attempts": total_exam_attempts,
            "study_attempts": total_study_attempts,
            "total_review_pressure": total_review_pressure,
            "average_wrong_rate_percent": round((total_wrong / total_attempts) * 100.0, 2) if total_attempts else 0.0,
            **snapshot_meta,
        },
        "hardest_questions": hardest_questions[:normalized_limit],
        "weakest_domains": weakest_domains[:normalized_limit],
        "weakest_exams": weakest_exams[:normalized_limit],
    }


def capture_admin_question_analytics_snapshot(
    db: Session,
    *,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    if not _has_table(db, "question_stats_snapshot"):
        return {
            "ok": False,
            "schema_ready": False,
            "message": "Analytics snapshot schema is unavailable. Run Alembic migrations first.",
            "capture_batch_id": None,
            "captured_at": None,
            "snapshot_count": 0,
        }

    metrics = _collect_question_metrics(db)
    captured_at = utcnow()
    capture_batch_id = str(uuid.uuid4())

    for item in metrics:
        db.add(
            QuestionStatsSnapshot(
                capture_batch_id=capture_batch_id,
                question_id=item["id"],
                question_version_id=item["question_version_id"],
                exam_id=item["exam_id"],
                domain=item["domain"],
                certification=item["certification"],
                attempts_total=item["attempts_total"],
                exam_attempts=item["exam_attempts"],
                study_attempts=item["study_attempts"],
                wrong_count=item["wrong_count"],
                wrong_rate_percent=item["wrong_rate_percent"],
                low_confidence_count=item["low_confidence_count"],
                low_confidence_rate_percent=item["low_confidence_rate_percent"],
                review_pressure_count=item["review_pressure_count"],
                avg_study_elapsed_seconds=item["avg_study_elapsed_seconds"],
                difficulty_score=item["difficulty_score"],
                captured_at=captured_at,
            )
        )

    return {
        "ok": True,
        "schema_ready": True,
        "message": None,
        "actor_user_id": actor_user_id,
        "capture_batch_id": capture_batch_id if metrics else None,
        "captured_at": captured_at.isoformat() if metrics else None,
        "snapshot_count": len(metrics),
    }


def list_question_analytics_history(
    db: Session,
    *,
    question_id: str,
    limit: int = 12,
) -> list[dict[str, Any]]:
    if not _has_table(db, "question_stats_snapshot"):
        return []

    normalized_limit = max(1, min(int(limit or 12), 60))
    rows = db.execute(
        select(
            QuestionStatsSnapshot,
            QuestionVersion.version_number,
        )
        .outerjoin(QuestionVersion, QuestionVersion.id == QuestionStatsSnapshot.question_version_id)
        .where(QuestionStatsSnapshot.question_id == question_id)
        .order_by(QuestionStatsSnapshot.captured_at.desc(), QuestionStatsSnapshot.id.desc())
        .limit(normalized_limit)
    ).all()

    history: list[dict[str, Any]] = []
    for snapshot, version_number in rows:
        history.append({
            "id": snapshot.id,
            "capture_batch_id": snapshot.capture_batch_id,
            "question_id": snapshot.question_id,
            "question_version_id": snapshot.question_version_id,
            "version_number": int(version_number) if version_number else None,
            "attempts_total": int(snapshot.attempts_total or 0),
            "exam_attempts": int(snapshot.exam_attempts or 0),
            "study_attempts": int(snapshot.study_attempts or 0),
            "wrong_count": int(snapshot.wrong_count or 0),
            "wrong_rate_percent": round(float(snapshot.wrong_rate_percent or 0.0), 2),
            "low_confidence_count": int(snapshot.low_confidence_count or 0),
            "low_confidence_rate_percent": round(float(snapshot.low_confidence_rate_percent or 0.0), 2),
            "review_pressure_count": int(snapshot.review_pressure_count or 0),
            "avg_study_elapsed_seconds": round(float(snapshot.avg_study_elapsed_seconds), 2)
            if snapshot.avg_study_elapsed_seconds is not None
            else None,
            "difficulty_score": round(float(snapshot.difficulty_score or 0.0), 2),
            "captured_at": snapshot.captured_at.isoformat() if snapshot.captured_at else None,
        })
    return history
