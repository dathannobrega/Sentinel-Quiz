"""Exam readiness estimate (M-C4 / M-C5).

Formula (per certification ``c``; all inputs come from the last 21 days of
``user_domain_metrics_daily`` rows of the owner, grouped by ``(certification, domain)``)::

    accuracy(d)   = correct(d) / attempts(d) * 100
    penalty(d)    = min(low_confidence(d) / attempts(d) * 10, 10)          # hesitation
                  + min(max(avg_seconds(d) - 95, 0) / 8, 8)                # slowness
    score(d)      = clamp(accuracy(d) - penalty(d), 0, 100)

    w(d)          = official blueprint weight of d in c (domain_blueprint, with a
                    built-in fallback); domains outside the blueprint get 35 % of the
                    smallest known weight (1.0 when c has no blueprint at all)
    score(c)      = sum(w(d) * score(d)) / sum(w(d))      over domains d of c with data
    coverage(c)   = sum(w(d) of domains with data) / sum(w(d) of the blueprint)

    trend(c)      = clamp((accuracy_7d(c) - accuracy_21d(c)) * 0.5, -5, +5)
                    (0 when the last 7 days have fewer than 5 attempts)
    overdue(c)    = min(due_reviews(c) / max(tracked_questions(c), 1) * 20, 10)
    projected(c)  = clamp(score(c) + trend(c) - overdue(c), 0, 100)

``projected`` never increases with more overdue reviews: overdue items only subtract.
There is no fixed bonus and no default score: with fewer than
``MIN_READINESS_ATTEMPTS`` recent attempts for a certification the score/projection are
``None`` and the band is ``"insufficient_data"``.

Bands are relative to the certification passing threshold ``T`` (see exam_policy):
``strong`` >= T + 10, ``stable`` >= T, ``developing`` >= T - 15, else ``at_risk``.

The top-level fields describe the primary certification (explicit ``certification``
argument, otherwise the one with most recent attempts); every certification is listed
in ``certifications`` and every ``(certification, domain)`` pair in ``domain_scores``.

Texts in ``factors`` are a pt-BR fallback; clients should translate ``factor_codes``
(stable ``code`` + ``params``, M-C7).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import Question, ReviewQueueItem, UserDomainMetricDaily, UserQuestionProgress
from app.services.exam_policy import normalize_certification, pass_threshold_for
from app.services.owner_scope import owner_clauses
from app.services.question_pool import active_question_clause, blueprint_weights_for_certification
from app.services.serialization import domain_label

RECENT_WINDOW_DAYS = 21
TREND_WINDOW_DAYS = 7
MIN_READINESS_ATTEMPTS = 10
MIN_TREND_ATTEMPTS = 5
SLOW_ANSWER_SECONDS = 95.0
INSUFFICIENT_DATA_BAND = "insufficient_data"


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def readiness_band(score_percent: Optional[float], pass_threshold: float) -> str:
    if score_percent is None:
        return INSUFFICIENT_DATA_BAND
    if score_percent >= pass_threshold + 10:
        return "strong"
    if score_percent >= pass_threshold:
        return "stable"
    if score_percent >= pass_threshold - 15:
        return "developing"
    return "at_risk"


def _domain_metrics(db: Session, owner_user_id, owner_client_key, since: datetime) -> dict[tuple[str, str], dict[str, Any]]:
    rows = db.execute(
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
        .where(
            *owner_clauses(UserDomainMetricDaily, owner_user_id, owner_client_key),
            UserDomainMetricDaily.metric_date >= since,
        )
        .group_by(UserDomainMetricDaily.certification, UserDomainMetricDaily.domain)
    ).all()
    metrics: dict[tuple[str, str], dict[str, Any]] = {}
    for certification, domain, attempts, correct, wrong, low_confidence, elapsed_total, timed in rows:
        key = (str(certification or "").strip(), domain_label(domain))
        bucket = metrics.setdefault(key, {"attempts": 0, "correct": 0, "wrong": 0, "low_confidence": 0, "elapsed": 0, "timed": 0})
        bucket["attempts"] += int(attempts or 0)
        bucket["correct"] += int(correct or 0)
        bucket["wrong"] += int(wrong or 0)
        bucket["low_confidence"] += int(low_confidence or 0)
        bucket["elapsed"] += int(elapsed_total or 0)
        bucket["timed"] += int(timed or 0)
    return metrics


def _count_by_certification(db: Session, stmt) -> dict[str, int]:
    return {str(cert or "").strip(): int(count or 0) for cert, count in db.execute(stmt).all()}


def _domain_weight(weights: dict[str, float], domain: str) -> float:
    if not weights:
        return 1.0
    if domain in weights:
        return float(weights[domain])
    return min(weights.values()) * 0.35


def build_readiness_snapshot(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    weakest_domains: Optional[list[dict[str, Any]]] = None,
    due_count: Optional[int] = None,
    certification: Optional[str] = None,
) -> dict[str, Any]:
    """Read-only readiness snapshot; see the module docstring for the formula."""
    weakest_domains = weakest_domains or []
    now = utcnow()
    recent = _domain_metrics(db, owner_user_id, owner_client_key, now - timedelta(days=RECENT_WINDOW_DAYS))
    trend_window = _domain_metrics(db, owner_user_id, owner_client_key, now - timedelta(days=TREND_WINDOW_DAYS))

    progress_owner = owner_clauses(UserQuestionProgress, owner_user_id, owner_client_key)
    tracked_total, last_seen_at = db.execute(
        select(func.count(UserQuestionProgress.id), func.max(UserQuestionProgress.last_seen_at)).where(*progress_owner)
    ).one()
    tracked_total = int(tracked_total or 0)
    tracked_by_cert = _count_by_certification(
        db,
        select(Question.certification, func.count(UserQuestionProgress.id))
        .join(Question, Question.id == UserQuestionProgress.question_id)
        .where(*progress_owner)
        .group_by(Question.certification),
    )
    due_by_cert = _count_by_certification(
        db,
        select(Question.certification, func.count(ReviewQueueItem.id))
        .join(Question, Question.id == ReviewQueueItem.question_id)
        .where(
            *owner_clauses(ReviewQueueItem, owner_user_id, owner_client_key),
            ReviewQueueItem.due_at <= now,
            active_question_clause(),
        )
        .group_by(Question.certification),
    )
    overdue_total = int(due_count) if due_count is not None else sum(due_by_cert.values())

    domain_scores: list[dict[str, Any]] = []
    per_cert_domains: dict[str, list[dict[str, Any]]] = {}
    for (cert, domain), metric in recent.items():
        attempts = metric["attempts"]
        if attempts <= 0:
            continue
        accuracy = metric["correct"] / attempts * 100.0
        avg_elapsed = round(metric["elapsed"] / metric["timed"], 2) if metric["timed"] else None
        confidence_penalty = min(metric["low_confidence"] / attempts * 10.0, 10.0)
        timing_penalty = 0.0
        if avg_elapsed is not None and avg_elapsed > SLOW_ANSWER_SECONDS:
            timing_penalty = min((avg_elapsed - SLOW_ANSWER_SECONDS) / 8.0, 8.0)
        entry = {
            "certification": cert or None,
            "domain": domain,
            "score_percent": round(_clamp(accuracy - confidence_penalty - timing_penalty, 0.0, 100.0), 2),
            "accuracy_percent": round(accuracy, 2),
            "attempts": attempts,
            "avg_elapsed_seconds": avg_elapsed,
            "low_confidence_count": metric["low_confidence"],
            "weight": None,
        }
        domain_scores.append(entry)
        per_cert_domains.setdefault(cert, []).append(entry)

    certifications: list[dict[str, Any]] = []
    for cert, entries in per_cert_domains.items():
        weights = blueprint_weights_for_certification(db, cert)
        weighted_sum = 0.0
        weight_total = 0.0
        attempts_total = 0
        correct_total = 0
        for entry in entries:
            weight = _domain_weight(weights, entry["domain"])
            entry["weight"] = round(weight, 2)
            weighted_sum += weight * entry["score_percent"]
            weight_total += weight
            attempts_total += entry["attempts"]
            correct_total += round(entry["accuracy_percent"] * entry["attempts"] / 100.0)
        blueprint_total = sum(weights.values()) if weights else weight_total
        covered = sum(float(weights[e["domain"]]) for e in entries if e["domain"] in weights) if weights else weight_total
        coverage = round(_clamp(covered / blueprint_total * 100.0, 0.0, 100.0), 2) if blueprint_total else 0.0

        threshold = pass_threshold_for(cert)
        tracked = int(tracked_by_cert.get(cert, 0))
        due = int(due_by_cert.get(cert, 0))
        sufficient = attempts_total >= MIN_READINESS_ATTEMPTS and weight_total > 0
        score = round(weighted_sum / weight_total, 2) if sufficient else None

        trend = 0.0
        trend_attempts = sum(m["attempts"] for (c, _d), m in trend_window.items() if c == cert)
        if trend_attempts >= MIN_TREND_ATTEMPTS and attempts_total:
            trend_correct = sum(m["correct"] for (c, _d), m in trend_window.items() if c == cert)
            accuracy_21 = correct_total / attempts_total * 100.0
            accuracy_7 = trend_correct / trend_attempts * 100.0
            trend = _clamp((accuracy_7 - accuracy_21) * 0.5, -5.0, 5.0)
        overdue_penalty = min(due / max(tracked, 1) * 20.0, 10.0) if due else 0.0
        projected = round(_clamp(score + trend - overdue_penalty, 0.0, 100.0), 2) if score is not None else None

        certifications.append({
            "certification": cert or None,
            "score_percent": score,
            "projected_score_percent": projected,
            "band": readiness_band(score, threshold),
            "pass_threshold_percent": threshold,
            "coverage_percent": coverage,
            "attempts": attempts_total,
            "tracked_questions": tracked,
            "overdue_reviews": due,
            "trend_points": round(trend, 2),
            "overdue_penalty_points": round(overdue_penalty, 2),
        })
    certifications.sort(key=lambda item: (-item["attempts"], str(item["certification"] or "").lower()))

    primary: Optional[dict[str, Any]] = None
    if certification:
        wanted = normalize_certification(certification)
        primary = next((item for item in certifications if normalize_certification(item["certification"]) == wanted), None)
    elif certifications:
        primary = certifications[0]

    if primary:
        primary_cert = primary["certification"]
    else:
        primary_cert = str(certification or "").strip() or None
    threshold = primary["pass_threshold_percent"] if primary else pass_threshold_for(primary_cert)
    score = primary["score_percent"] if primary else None
    projected = primary["projected_score_percent"] if primary else None
    status = "ok" if score is not None else INSUFFICIENT_DATA_BAND

    ranked = sorted(
        (item for item in domain_scores if primary is None or item["certification"] == primary["certification"]),
        key=lambda item: (item["score_percent"], -float(item["weight"] or 0), item["domain"].lower()),
    )
    weakest = ranked[:3]

    factor_codes: list[dict[str, Any]] = []
    factors: list[str] = []

    def _factor(code: str, text: str, **params: Any) -> None:
        factor_codes.append({"code": code, "params": params})
        factors.append(text)

    if status != "ok":
        attempts_seen = primary["attempts"] if primary else 0
        _factor(
            "readiness.insufficient_data",
            f"Ainda há pouco histórico recente ({attempts_seen} de {MIN_READINESS_ATTEMPTS} respostas). Responda mais questões para liberar a estimativa.",
            attempts=attempts_seen,
            required=MIN_READINESS_ATTEMPTS,
        )
    if overdue_total:
        _factor(
            "readiness.overdue_reviews",
            f"{overdue_total} revisão(ões) vencida(s) reduzem a sua projeção.",
            count=overdue_total,
        )
    if weakest_domains:
        top = weakest_domains[0]
        label = str(top.get("label") or top.get("domain") or "Sem domínio")
        _factor("readiness.session_weakest_domain", f"{label} segue como o ponto de maior atrito na sessão atual.", domain=label)
    elif weakest and status == "ok":
        _factor(
            "readiness.weakest_domain",
            f"{weakest[0]['domain']} é o domínio com menor desempenho ({weakest[0]['score_percent']}%).",
            domain=weakest[0]["domain"],
            score=weakest[0]["score_percent"],
        )
    slowest = max(
        (item for item in domain_scores if isinstance(item.get("avg_elapsed_seconds"), (int, float))),
        key=lambda item: float(item["avg_elapsed_seconds"]),
        default=None,
    )
    if slowest and float(slowest["avg_elapsed_seconds"]) > SLOW_ANSWER_SECONDS:
        seconds = round(float(slowest["avg_elapsed_seconds"]))
        _factor(
            "readiness.slow_domain",
            f"Velocidade: {slowest['domain']} está lento ({seconds}s por questão em média).",
            domain=slowest["domain"],
            seconds=seconds,
        )
    if primary and primary["coverage_percent"] < 60 and status == "ok":
        _factor(
            "readiness.low_coverage",
            f"A estimativa cobre só {primary['coverage_percent']}% do blueprint; pratique os domínios que faltam.",
            coverage=primary["coverage_percent"],
        )
    if last_seen_at and last_seen_at < now - timedelta(days=7):
        _factor("readiness.stale_activity", "Sua recência caiu; volte a revisar nas próximas 24 horas.")
    if not factors:
        _factor("readiness.consistent", "Base consistente. O foco agora é reduzir erros residuais e manter o ritmo.")

    recommended_minutes = 15
    if weakest_domains or weakest:
        recommended_minutes += min(len((weakest_domains or weakest)[:3]) * 5, 15)
    if overdue_total:
        recommended_minutes += min(overdue_total * 2, 15)

    return {
        "status": status,
        "certification": primary_cert,
        "score_percent": score,
        "projected_score_percent": projected,
        "band": readiness_band(score, threshold),
        "pass_threshold_percent": threshold,
        "coverage_percent": primary["coverage_percent"] if primary else 0.0,
        "overdue_reviews": overdue_total,
        "recommended_minutes": min(max(recommended_minutes, 15), 45),
        "tracked_questions": tracked_total,
        "factors": factors,
        "factor_codes": factor_codes,
        "domain_scores": sorted(
            domain_scores,
            key=lambda item: (str(item["certification"] or "").lower(), item["score_percent"], item["domain"].lower()),
        ),
        "weakest_domains": weakest,
        "certifications": certifications,
    }
