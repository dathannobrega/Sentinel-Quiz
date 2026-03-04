from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ReviewQueueItem, UserDomainMetricDaily, UserQuestionProgress
from app.services.auth import normalize_client_key


def _owner_filters(model, owner_user_id: str | None, owner_client_key: str | None):
    if owner_user_id:
        return [model.user_id == owner_user_id]
    normalized_client_key = normalize_client_key(owner_client_key)
    if normalized_client_key:
        return [model.user_id.is_(None), model.client_key == normalized_client_key]
    return [False]


def _readiness_band(score_percent: float) -> str:
    if score_percent >= 85:
        return "strong"
    if score_percent >= 70:
        return "stable"
    if score_percent >= 55:
        return "developing"
    return "at_risk"


def build_readiness_snapshot(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    weakest_domains: Optional[list[dict[str, Any]]] = None,
    due_count: Optional[int] = None,
) -> dict[str, Any]:
    weakest_domains = weakest_domains or []
    now = datetime.utcnow()
    recent_cutoff = now - timedelta(days=21)

    progress_stmt = select(
        func.avg(UserQuestionProgress.mastery_score),
        func.max(UserQuestionProgress.last_seen_at),
        func.count(UserQuestionProgress.id),
    ).where(*_owner_filters(UserQuestionProgress, owner_user_id, owner_client_key))
    avg_mastery_raw, last_seen_at, tracked_questions = db.execute(progress_stmt).one()
    avg_mastery = round(float(avg_mastery_raw or 0.0), 2)
    tracked_questions = int(tracked_questions or 0)

    recent_metrics = db.execute(
        select(
            UserDomainMetricDaily.domain,
            func.sum(UserDomainMetricDaily.attempts_total),
            func.sum(UserDomainMetricDaily.correct_count),
            func.sum(UserDomainMetricDaily.wrong_count),
            func.sum(UserDomainMetricDaily.low_confidence_count),
            func.sum(UserDomainMetricDaily.total_elapsed_seconds),
            func.sum(UserDomainMetricDaily.timed_attempts),
        )
        .where(
            *_owner_filters(UserDomainMetricDaily, owner_user_id, owner_client_key),
            UserDomainMetricDaily.metric_date >= recent_cutoff,
        )
        .group_by(UserDomainMetricDaily.domain)
    ).all()

    if due_count is None:
        due_count = int(
            db.execute(
                select(func.count(ReviewQueueItem.id)).where(
                    *_owner_filters(ReviewQueueItem, owner_user_id, owner_client_key),
                    ReviewQueueItem.due_at <= now,
                )
            ).scalar_one()
            or 0
        )

    domain_scores: list[dict[str, Any]] = []
    metric_map: dict[str, dict[str, float]] = {}
    for domain, attempts, correct, wrong, low_confidence, elapsed_total, timed_attempts in recent_metrics:
        attempts_count = int(attempts or 0)
        correct_count = int(correct or 0)
        wrong_count = int(wrong or 0)
        low_confidence_count = int(low_confidence or 0)
        timed_count = int(timed_attempts or 0)
        accuracy_percent = round((correct_count / attempts_count) * 100.0, 2) if attempts_count else 0.0
        avg_elapsed_seconds = round(float(elapsed_total or 0) / timed_count, 2) if timed_count else None
        metric_map[str(domain or "Sem dominio").strip() or "Sem dominio"] = {
            "attempts": attempts_count,
            "correct": correct_count,
            "wrong": wrong_count,
            "low_confidence": low_confidence_count,
            "accuracy_percent": accuracy_percent,
            "avg_elapsed_seconds": avg_elapsed_seconds,
        }

    targets = []
    for item in weakest_domains[:3]:
        label = str(item.get("label") or item.get("domain") or "Sem dominio").strip() or "Sem dominio"
        targets.append(label)
    for label in metric_map:
        if label not in targets:
            targets.append(label)
        if len(targets) >= 5:
            break

    for label in targets:
        metric = metric_map.get(label, {})
        attempts = int(metric.get("attempts") or 0)
        accuracy_percent = float(metric.get("accuracy_percent") or 0.0)
        low_confidence = int(metric.get("low_confidence") or 0)
        avg_elapsed_seconds = metric.get("avg_elapsed_seconds")
        weakest_penalty = 0.0
        for item in weakest_domains:
            item_label = str(item.get("label") or item.get("domain") or "").strip()
            if item_label == label:
                wrong = int(item.get("wrong") or 0)
                total = max(int(item.get("total") or 0), 1)
                weakest_penalty = min((wrong / total) * 18.0, 18.0)
                break

        baseline = accuracy_percent if attempts else max(55.0, avg_mastery)
        confidence_penalty = min(low_confidence * 1.6, 12.0)
        timing_penalty = 0.0
        if isinstance(avg_elapsed_seconds, (int, float)) and avg_elapsed_seconds > 95:
            timing_penalty = min((float(avg_elapsed_seconds) - 95.0) / 8.0, 8.0)
        domain_score = round(max(0.0, min(baseline - confidence_penalty - timing_penalty - weakest_penalty + 6.0, 99.0)), 2)
        domain_scores.append(
            {
                "domain": label,
                "score_percent": domain_score,
                "accuracy_percent": round(accuracy_percent, 2),
                "attempts": attempts,
                "avg_elapsed_seconds": avg_elapsed_seconds,
                "low_confidence_count": low_confidence,
            }
        )

    if domain_scores:
        overall = round(sum(item["score_percent"] for item in domain_scores) / len(domain_scores), 2)
    elif tracked_questions:
        overall = avg_mastery
    else:
        overall = 62.0

    if due_count:
        overall = round(max(overall - min(due_count * 1.4, 12.0), 0.0), 2)

    projection_boost = 0.0
    if weakest_domains:
        projection_boost += min(len(weakest_domains[:3]) * 2.5, 7.5)
    if due_count:
        projection_boost += min(due_count * 0.8, 5.0)
    projected = round(min(overall + projection_boost, 99.0), 2)

    drivers: list[str] = []
    if due_count:
        drivers.append(f"{due_count} revisao(oes) vencidas ainda pesam no seu score.")
    if weakest_domains:
        top = weakest_domains[0]
        label = top.get("label") or top.get("domain") or "Sem dominio"
        drivers.append(f"{label} segue como o ponto de maior atrito na sessao atual.")
    slowest_domain = None
    for item in domain_scores:
        avg_elapsed = item.get("avg_elapsed_seconds")
        if not isinstance(avg_elapsed, (int, float)):
            continue
        if slowest_domain is None or float(avg_elapsed) > float(slowest_domain["avg_elapsed_seconds"]):
            slowest_domain = item
    if slowest_domain and float(slowest_domain["avg_elapsed_seconds"]) > 95.0:
        drivers.append(
            f"Velocidade: {slowest_domain['domain']} esta lenta ({round(float(slowest_domain['avg_elapsed_seconds']))}s por questao em media)."
        )
    if last_seen_at and last_seen_at < now - timedelta(days=7):
        drivers.append("Sua recencia caiu; volte a revisar nas proximas 24 horas.")
    elif not tracked_questions:
        drivers.append("Ainda ha pouco historico. O score usa mais peso na sessao atual.")

    if not drivers:
        drivers.append("Base consistente. O foco agora e reduzir erros residuais e manter o ritmo.")

    recommended_minutes = 15
    if weakest_domains:
        recommended_minutes += min(len(weakest_domains[:3]) * 5, 15)
    if due_count:
        recommended_minutes += min(due_count * 2, 15)

    weakest_domain_scores = sorted(domain_scores, key=lambda item: (item["score_percent"], item["domain"].lower()))[:3]

    return {
        "score_percent": overall,
        "projected_score_percent": projected,
        "band": _readiness_band(overall),
        "recommended_minutes": min(max(recommended_minutes, 15), 45),
        "tracked_questions": tracked_questions,
        "factors": drivers,
        "domain_scores": domain_scores,
        "weakest_domains": weakest_domain_scores,
    }
