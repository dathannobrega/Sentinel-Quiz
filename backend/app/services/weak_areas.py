"""Domain catalog and per-certification weak-area snapshot (split from quiz.py, M-C6)."""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import false, select
from sqlalchemy.orm import Session

from app.models import (
    ExamSession,
    Question,
    SessionAnswer,
)
from app.services.metrics import aggregate_domain_metrics_for_owner
from app.services.question_pool import active_question_clause
from app.services.serialization import score_percent
from app.services.exam_results import _bucket_template, _sorted_buckets, _top_bucket_entries, _update_bucket


def build_domain_catalog(db: Session, exam_id: Optional[str] = None) -> dict:
    stmt = select(Question.domain, Question.certification).where(Question.domain.is_not(None), active_question_clause())
    if exam_id:
        stmt = stmt.where(Question.exam_id == exam_id)

    buckets: dict[str, dict] = {}
    for domain, certification in db.execute(stmt).all():
        label = str(domain or "").strip()
        if not label:
            continue
        bucket = buckets.setdefault(label, {"question_count": 0, "certifications": set()})
        bucket["question_count"] += 1
        cert_label = str(certification or "").strip()
        if cert_label:
            bucket["certifications"].add(cert_label)

    domains = []
    for label, data in buckets.items():
        certifications = sorted(data["certifications"])
        display_label = label
        if not exam_id and len(certifications) > 1:
            display_label = f"{label} ({', '.join(certifications)})"
        domains.append({
            "value": label,
            "label": display_label,
            "question_count": data["question_count"],
            "certifications": certifications,
        })

    domains.sort(key=lambda item: (-item["question_count"], item["label"].lower()))
    return {"exam_id": exam_id, "domains": domains}


WEAK_AREA_LOW_ACCURACY_PERCENT = 70.0
WEAK_AREA_ON_TRACK_PERCENT = 85.0


def _weak_area_score(correct: int, total: int) -> float | None:
    return round((correct / total) * 100.0, 1) if total else None


def _describe_weak_area_domain(entry: dict[str, Any]) -> dict[str, Any]:
    """Add ``score_percent`` plus an i18n ``code``/``params`` (and PT ``message`` fallback)."""
    total = int(entry.get("total") or 0)
    correct = int(entry.get("correct") or 0)
    wrong = int(entry.get("wrong") or 0)
    accuracy = _weak_area_score(correct, total)
    label = entry.get("label") or ""
    entry["score_percent"] = accuracy
    params = {"domain": label, "accuracy": accuracy, "total": total, "correct": correct, "wrong": wrong}
    if accuracy is None:
        code, message = "weak_area.no_data", f"Sem respostas registradas em {label}."
    elif accuracy < WEAK_AREA_LOW_ACCURACY_PERCENT:
        code = "weak_area.low_accuracy"
        message = f"Precisão baixa em {label}: {accuracy:g}% em {total} questões."
    elif accuracy < WEAK_AREA_ON_TRACK_PERCENT:
        code = "weak_area.needs_practice"
        message = f"Precisão intermediária em {label}: {accuracy:g}% em {total} questões. Continue praticando."
    else:
        code = "weak_area.on_track"
        message = f"Bom desempenho em {label}: {accuracy:g}% em {total} questões."
    entry["code"] = code
    entry["params"] = params
    entry["message"] = message
    return entry


def _weak_area_track(certification: str, attempted: int, wrong: int, weakest_domains: list[dict[str, Any]]) -> dict[str, Any]:
    for entry in weakest_domains:
        _describe_weak_area_domain(entry)
    focus_domain = weakest_domains[0] if weakest_domains else None
    if attempted and focus_domain:
        low_confidence = int(focus_domain.get("pedagogical_signal", 0) or 0)
        code = "weak_area.focus_domain"
        params: dict[str, Any] = {
            "domain": focus_domain["label"],
            "wrong": int(focus_domain["wrong"]),
            "low_confidence": low_confidence,
            "total": int(focus_domain["total"]),
            "accuracy": focus_domain["score_percent"],
        }
        message = (
            f"Maior necessidade de estudo em {focus_domain['label']} "
            f"({focus_domain['wrong']} erro(s) e {low_confidence} sinal(is) de baixa segurança "
            f"em {focus_domain['total']} questões)."
        )
    else:
        code = "weak_area.no_data"
        params = {"certification": certification}
        message = "Sem histórico suficiente para este track."
    return {
        "certification": certification,
        "attempted": attempted,
        "wrong": wrong,
        "focus_domain": focus_domain,
        "domains": weakest_domains,
        "message": message,
        "code": code,
        "params": params,
    }


def build_weak_area_snapshot(db: Session) -> dict:
    return build_weak_area_snapshot_for_owner(db)


def build_weak_area_snapshot_for_owner(
    db: Session,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> dict:
    if owner_user_id or owner_client_key:
        metric_rows = aggregate_domain_metrics_for_owner(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
    else:
        metric_rows = []

    if metric_rows:
        buckets_by_cert: dict[str, dict[str, dict[str, Any]]] = {}
        for item in metric_rows:
            certification = item["certification"]
            domain_label = item["domain"]
            attempts = int(item["attempts_total"])
            wrong = int(item["wrong_count"])
            correct = int(item["correct_count"])
            pedagogical_signal = int(item.get("low_confidence_count") or 0)
            bucket = buckets_by_cert.setdefault(certification, {}).setdefault(domain_label, _bucket_template())
            bucket["total"] += attempts
            bucket["wrong"] += wrong
            bucket["correct"] += correct
            bucket["pedagogical_signal"] += pedagogical_signal
            bucket["score_percent"] = score_percent(bucket["correct"], bucket["total"])

        items = []
        for certification in sorted(buckets_by_cert):
            domain_buckets = _sorted_buckets(buckets_by_cert.get(certification, {}))
            weakest_domains = _top_bucket_entries(domain_buckets, limit=5)
            attempted = sum(bucket["total"] for bucket in domain_buckets.values())
            wrong = sum(bucket["wrong"] for bucket in domain_buckets.values())
            items.append(_weak_area_track(certification, attempted, wrong, weakest_domains))
        return {"certifications": items}

    certification_rows = db.execute(
        select(Question.certification).where(Question.certification.is_not(None), active_question_clause())
    ).all()
    certifications = sorted({
        str(certification or "").strip()
        for (certification,) in certification_rows
        if str(certification or "").strip()
    })

    buckets_by_cert: dict[str, dict[str, dict]] = {
        certification: {}
        for certification in certifications
    }

    stmt = (
        select(
            Question.certification,
            Question.domain,
            SessionAnswer.is_correct,
        )
        .join(SessionAnswer, SessionAnswer.question_id == Question.id)
        .join(ExamSession, ExamSession.id == SessionAnswer.session_id)
        .where(ExamSession.completed_at.is_not(None))
    )
    if owner_user_id:
        stmt = stmt.where(ExamSession.user_id == owner_user_id)
    elif owner_client_key:
        stmt = stmt.where(
            ExamSession.user_id.is_(None),
            ExamSession.client_key == owner_client_key,
        )
    else:
        stmt = stmt.where(false())

    rows = db.execute(stmt).all()

    for certification, domain, is_correct in rows:
        cert_label = str(certification or "Sem certificacao").strip() or "Sem certificacao"
        domain_label = str(domain or "Sem dominio").strip() or "Sem dominio"
        domain_bucket = buckets_by_cert.setdefault(cert_label, {}).setdefault(domain_label, _bucket_template())
        _update_bucket(domain_bucket, bool(is_correct))

    items = []
    for certification in sorted(buckets_by_cert):
        domain_buckets = _sorted_buckets(buckets_by_cert.get(certification, {}))
        weakest_domains = _top_bucket_entries(domain_buckets, limit=5)
        attempted = sum(bucket["total"] for bucket in domain_buckets.values())
        wrong = sum(bucket["wrong"] for bucket in domain_buckets.values())
        items.append(_weak_area_track(certification, attempted, wrong, weakest_domains))

    return {"certifications": items}
