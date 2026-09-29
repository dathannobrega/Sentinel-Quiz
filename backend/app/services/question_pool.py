"""Question selection primitives shared by exam (quiz) and study sessions (M-C6).

All candidate generation for *new* sessions, search and review queue runs through the
helpers in this module and only ever returns active questions
(``Question.is_active IS TRUE``, M-A2). Existing history rows that reference
inactive questions are not affected: they are read through the session tables.
"""
from __future__ import annotations

import logging
import math
import random
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import (
    ExamSession,
    Question,
    ReviewQueueItem,
    SessionAnswer,
    StudyAttempt,
    StudySession,
    UserBookmark,
    UserNote,
)
from app.services.owner_scope import apply_owner_filters
from app.services.serialization import UNKNOWN_DOMAIN_LABEL, domain_label, parse_tags

logger = logging.getLogger(__name__)

# Fallback exam outline weights, used only while the domain_blueprint table has no
# weighted rows for a certification (M-A6). Keys are lower-cased certifications.
FALLBACK_BLUEPRINT_WEIGHTS: dict[str, dict[str, float]] = {
    "security+": {
        "General Security Concepts": 12.0,
        "Threats, Vulnerabilities and Mitigations": 22.0,
        "Security Architecture": 18.0,
        "Security Operations": 28.0,
        "Security Program Management and Oversight": 20.0,
    },
    "cissp": {
        "Security and Risk Management": 16.0,
        "Asset Security": 10.0,
        "Security Architecture and Engineering": 13.0,
        "Communication and Network Security": 13.0,
        "Identity and Access Management (IAM)": 13.0,
        "Security Assessment and Testing": 12.0,
        "Security Operations": 13.0,
        "Software Development Security": 10.0,
    },
}
MIXED_BUCKET_SEPARATOR = " :: "


def active_question_clause():
    return Question.is_active.is_(True)


# --------------------------------------------------------------------------- filters

def normalize_text_filters(values: Optional[list[str]]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for item in values or []:
        label = str(item or "").strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(label)
    return normalized


def normalize_domain_filters(domains: Optional[list[str]]) -> list[str]:
    return normalize_text_filters(domains)


def normalize_difficulty_filters(difficulties: Optional[list[str]]) -> list[str]:
    return normalize_text_filters(difficulties)


def normalize_tag_filters(tags: Optional[list[str]]) -> list[str]:
    return normalize_text_filters(tags)


def dedupe_question_ids(candidates: list[str], *, blocked: set[str] | None = None) -> list[str]:
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


def _matches_scope(question_exam_id, question_domain, *, exam_id, normalized_domains) -> bool:
    if exam_id and question_exam_id != exam_id:
        return False
    if normalized_domains and question_domain not in normalized_domains:
        return False
    return True


# --------------------------------------------------------------------------- owner sets

def _owner_question_ids(db: Session, model, *, owner_user_id, owner_client_key, exam_id, domains) -> set[str]:
    normalized_domains = normalize_domain_filters(domains)
    stmt = select(model.question_id, Question.exam_id, Question.domain).join(Question, Question.id == model.question_id)
    stmt = apply_owner_filters(stmt, model, owner_user_id, owner_client_key)
    return {
        question_id
        for question_id, question_exam_id, question_domain in db.execute(stmt).all()
        if _matches_scope(question_exam_id, question_domain, exam_id=exam_id, normalized_domains=normalized_domains)
    }


def owner_bookmark_question_ids(db: Session, *, owner_user_id, owner_client_key, exam_id, domains) -> set[str]:
    return _owner_question_ids(
        db, UserBookmark, owner_user_id=owner_user_id, owner_client_key=owner_client_key, exam_id=exam_id, domains=domains
    )


def owner_note_question_ids(db: Session, *, owner_user_id, owner_client_key, exam_id, domains) -> set[str]:
    return _owner_question_ids(
        db, UserNote, owner_user_id=owner_user_id, owner_client_key=owner_client_key, exam_id=exam_id, domains=domains
    )


def _exam_answer_rows(db: Session, owner_user_id, owner_client_key, *columns):
    stmt = (
        select(*columns, Question.exam_id, Question.domain)
        .join(ExamSession, ExamSession.id == SessionAnswer.session_id)
        .join(Question, Question.id == SessionAnswer.question_id)
    )
    return db.execute(apply_owner_filters(stmt, ExamSession, owner_user_id, owner_client_key)).all()


def _study_attempt_rows(db: Session, owner_user_id, owner_client_key, *columns):
    stmt = (
        select(*columns, Question.exam_id, Question.domain)
        .join(StudySession, StudySession.id == StudyAttempt.session_id)
        .join(Question, Question.id == StudyAttempt.question_id)
    )
    return db.execute(apply_owner_filters(stmt, StudySession, owner_user_id, owner_client_key)).all()


def owner_incorrect_question_ids(db: Session, *, owner_user_id, owner_client_key, exam_id, domains) -> set[str]:
    normalized_domains = normalize_domain_filters(domains)
    incorrect: set[str] = set()
    rows = [
        *_exam_answer_rows(db, owner_user_id, owner_client_key, SessionAnswer.question_id, SessionAnswer.is_correct),
        *_study_attempt_rows(db, owner_user_id, owner_client_key, StudyAttempt.question_id, StudyAttempt.is_correct),
    ]
    for question_id, is_correct, question_exam_id, question_domain in rows:
        if bool(is_correct):
            continue
        if _matches_scope(question_exam_id, question_domain, exam_id=exam_id, normalized_domains=normalized_domains):
            incorrect.add(question_id)
    return incorrect


def owner_low_confidence_question_ids(db: Session, *, owner_user_id, owner_client_key, exam_id, domains) -> set[str]:
    normalized_domains = normalize_domain_filters(domains)
    rows: set[str] = set()
    for question_id, confidence_level, question_exam_id, question_domain in _study_attempt_rows(
        db, owner_user_id, owner_client_key, StudyAttempt.question_id, StudyAttempt.confidence_level
    ):
        if str(confidence_level or "").strip().lower() == "high":
            continue
        if _matches_scope(question_exam_id, question_domain, exam_id=exam_id, normalized_domains=normalized_domains):
            rows.add(question_id)
    return rows


def owner_seen_question_ids(db: Session, *, owner_user_id, owner_client_key, exam_id, domains) -> set[str]:
    normalized_domains = normalize_domain_filters(domains)
    seen: set[str] = set()
    rows = [
        *_exam_answer_rows(db, owner_user_id, owner_client_key, SessionAnswer.question_id),
        *_study_attempt_rows(db, owner_user_id, owner_client_key, StudyAttempt.question_id),
    ]
    for question_id, question_exam_id, question_domain in rows:
        if _matches_scope(question_exam_id, question_domain, exam_id=exam_id, normalized_domains=normalized_domains):
            seen.add(question_id)
    return seen


# --------------------------------------------------------------------------- candidate rows

def filtered_question_rows_detailed(
    db: Session,
    *,
    exam_id: Optional[str],
    domains: Optional[list[str]],
    difficulties: Optional[list[str]] = None,
    tags: Optional[list[str]] = None,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
    bookmarked_only: bool = False,
    notes_only: bool = False,
    incorrect_only: bool = False,
    unseen_only: bool = False,
    low_confidence_only: bool = False,
) -> list[tuple[str, str | None, str | None]]:
    """Active candidate questions as ``(question_id, domain, certification)``."""
    normalized_domains = normalize_domain_filters(domains)
    normalized_difficulties = normalize_difficulty_filters(difficulties)
    normalized_tags = {item.lower() for item in normalize_tag_filters(tags)}

    stmt = select(Question.id, Question.domain, Question.certification, Question.tags_json).where(active_question_clause())
    if exam_id:
        stmt = stmt.where(Question.exam_id == exam_id)
    if normalized_domains:
        stmt = stmt.where(Question.domain.in_(normalized_domains))
    if normalized_difficulties:
        stmt = stmt.where(Question.difficulty.in_(normalized_difficulties))

    scope = {
        "owner_user_id": owner_user_id,
        "owner_client_key": owner_client_key,
        "exam_id": exam_id,
        "domains": normalized_domains,
    }
    bookmark_ids = owner_bookmark_question_ids(db, **scope) if bookmarked_only else set()
    note_ids = owner_note_question_ids(db, **scope) if notes_only else set()
    incorrect_ids = owner_incorrect_question_ids(db, **scope) if incorrect_only else set()
    seen_ids = owner_seen_question_ids(db, **scope) if unseen_only else set()
    low_confidence_ids = owner_low_confidence_question_ids(db, **scope) if low_confidence_only else set()

    rows: list[tuple[str, str | None, str | None]] = []
    for question_id, domain, certification, tags_json in db.execute(stmt.order_by(Question.id.asc())).all():
        if normalized_tags:
            question_tags = {item.lower() for item in parse_tags(tags_json)}
            if not question_tags.intersection(normalized_tags):
                continue
        if bookmarked_only and question_id not in bookmark_ids:
            continue
        if notes_only and question_id not in note_ids:
            continue
        if incorrect_only and question_id not in incorrect_ids:
            continue
        if unseen_only and question_id in seen_ids:
            continue
        if low_confidence_only and question_id not in low_confidence_ids:
            continue
        rows.append((question_id, domain, certification))
    return rows


def filtered_question_rows(db: Session, **kwargs) -> list[tuple[str, str | None]]:
    """Active candidate questions as ``(question_id, domain)``."""
    return [(qid, domain) for qid, domain, _cert in filtered_question_rows_detailed(db, **kwargs)]


def validate_requested_question_ids(db: Session, question_ids: list[str], *, empty_message: str) -> list[str]:
    """Deduplicate manually requested ids; every id must exist and be active."""
    requested = dedupe_question_ids(list(question_ids or []))
    if not requested:
        raise ValueError(empty_message)
    existing = {
        qid
        for (qid,) in db.execute(
            select(Question.id).where(Question.id.in_(requested), active_question_clause())
        ).all()
    }
    if any(qid not in existing for qid in requested):
        raise ValueError("One or more requested questions are unavailable.")
    return requested


def review_queue_candidates(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
) -> list[dict[str, Any]]:
    """Owner review queue items for active questions, ordered by due date."""
    normalized_domains = normalize_domain_filters(domains)
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
        .where(active_question_clause())
        .order_by(ReviewQueueItem.due_at.asc(), ReviewQueueItem.id.asc())
    )
    stmt = apply_owner_filters(stmt, ReviewQueueItem, owner_user_id, owner_client_key)

    rows: list[dict[str, Any]] = []
    for question_id, due_at, repetition_count, ease_factor, stability_score, question_exam_id, question_domain, prompt, certification in db.execute(stmt).all():
        if not _matches_scope(question_exam_id, question_domain, exam_id=exam_id, normalized_domains=normalized_domains):
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


def count_due_review_items(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    due_at_or_before: Optional[datetime] = None,
    required: bool = False,
) -> int:
    """Due review queue items of the owner (active questions only)."""
    due_cutoff = due_at_or_before or utcnow()
    stmt = (
        select(func.count())
        .select_from(ReviewQueueItem)
        .join(Question, Question.id == ReviewQueueItem.question_id)
        .where(ReviewQueueItem.due_at <= due_cutoff, active_question_clause())
    )
    stmt = apply_owner_filters(stmt, ReviewQueueItem, owner_user_id, owner_client_key, required=required)
    return int(db.execute(stmt).scalar_one() or 0)


def domain_key(certification: Any, domain: Any) -> tuple[str, str]:
    return (str(certification or "").strip(), domain_label(domain))


def weak_domain_keys(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
    include_exam_answers: bool,
    limit: int = 3,
) -> list[tuple[str, str]]:
    """Weakest ``(certification, domain)`` pairs of the owner (M-C5).

    Weights: wrong answer +3, low confidence +2, medium confidence +1, review queue item
    +2 when due (+1 otherwise). Exam answers only count for exam sessions.
    """
    normalized_domains = normalize_domain_filters(domains)
    weights: dict[tuple[str, str], int] = {}

    def _add(certification, domain, weight: int) -> None:
        key = domain_key(certification, domain)
        if normalized_domains and key[1] not in normalized_domains:
            return
        if weight:
            weights[key] = weights.get(key, 0) + weight

    if include_exam_answers:
        stmt = (
            select(SessionAnswer.is_correct, Question.exam_id, Question.domain, Question.certification)
            .join(ExamSession, ExamSession.id == SessionAnswer.session_id)
            .join(Question, Question.id == SessionAnswer.question_id)
        )
        for is_correct, question_exam_id, question_domain, certification in db.execute(
            apply_owner_filters(stmt, ExamSession, owner_user_id, owner_client_key)
        ).all():
            if exam_id and question_exam_id != exam_id:
                continue
            _add(certification, question_domain, 0 if bool(is_correct) else 3)

    stmt = (
        select(StudyAttempt.is_correct, StudyAttempt.confidence_level, Question.exam_id, Question.domain, Question.certification)
        .join(StudySession, StudySession.id == StudyAttempt.session_id)
        .join(Question, Question.id == StudyAttempt.question_id)
    )
    for is_correct, confidence_level, question_exam_id, question_domain, certification in db.execute(
        apply_owner_filters(stmt, StudySession, owner_user_id, owner_client_key)
    ).all():
        if exam_id and question_exam_id != exam_id:
            continue
        weight = 0 if bool(is_correct) else 3
        normalized_confidence = str(confidence_level or "medium").strip().lower()
        if normalized_confidence == "low":
            weight += 2
        elif normalized_confidence == "medium":
            weight += 1
        _add(certification, question_domain, weight)

    now = utcnow()
    for item in review_queue_candidates(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=domains,
    ):
        due_at = item.get("due_at")
        _add(item.get("certification"), item.get("domain"), 2 if due_at and due_at <= now else 1)

    ordered = sorted(weights.items(), key=lambda item: (-item[1], item[0][1].lower(), item[0][0].lower()))
    return [key for key, _weight in ordered[:limit]]


# --------------------------------------------------------------------------- blueprint weights / quotas

def blueprint_weights_for_certification(db: Session, certification: Optional[str]) -> dict[str, float]:
    """Official domain weights of a certification: ``domain_blueprint`` first (M-A6),
    falling back to the built-in outline while the table has no weighted rows."""
    normalized = str(certification or "").strip()
    if not normalized:
        return {}
    from app.services.ingest import get_domain_blueprint_weights

    try:
        if db.get_bind().dialect.name == "postgresql":
            # A failed statement aborts the whole PostgreSQL transaction: run the
            # lookup inside a SAVEPOINT so a failure only rolls back the savepoint and
            # the request transaction stays usable.
            with db.begin_nested():
                weights = get_domain_blueprint_weights(db, normalized)
        else:
            weights = get_domain_blueprint_weights(db, normalized)
    except SQLAlchemyError:
        # Defensive (e.g. table not migrated yet): never block session creation.
        logger.warning("domain_blueprint lookup failed; using built-in weights", exc_info=True)
        weights = {}
    if weights:
        return dict(weights)
    return dict(FALLBACK_BLUEPRINT_WEIGHTS.get(normalized.lower(), {}))


def bucket_label(certification: Any, domain: Any, *, mixed: bool) -> str:
    label = domain_label(domain)
    if not mixed:
        return label
    return f"{str(certification or '').strip() or '-'}{MIXED_BUCKET_SEPARATOR}{label}"


def resolve_quota_buckets(
    db: Session,
    detailed_rows: list[tuple[str, str | None, str | None]],
    *,
    apply_weights: bool,
) -> tuple[list[tuple[str, str]], dict[str, float]]:
    """Group candidates by domain — by ``(certification, domain)`` when the pool mixes
    certifications — and resolve the blueprint weight of every bucket (M-C5).

    In a mixed pool each certification gets a share proportional to its candidates and
    that share is split by the certification's own blueprint weights, so homonymous
    domains (e.g. "Security Operations" in CISSP and Security+) never merge.
    """
    certifications = sorted({str(cert or "").strip() for _qid, _domain, cert in detailed_rows})
    mixed = len(certifications) > 1
    rows = [(qid, bucket_label(cert, domain, mixed=mixed)) for qid, domain, cert in detailed_rows]
    if not apply_weights or not detailed_rows:
        return rows, {}

    if not mixed:
        return rows, blueprint_weights_for_certification(db, certifications[0] if certifications else None)

    pool_sizes: dict[str, int] = {}
    for _qid, _domain, cert in detailed_rows:
        key = str(cert or "").strip()
        pool_sizes[key] = pool_sizes.get(key, 0) + 1
    total_pool = sum(pool_sizes.values()) or 1
    weights: dict[str, float] = {}
    for cert, size in pool_sizes.items():
        cert_weights = blueprint_weights_for_certification(db, cert)
        weight_total = sum(cert_weights.values())
        if not weight_total:
            continue
        share = size / total_pool
        for domain, weight in cert_weights.items():
            weights[bucket_label(cert, domain, mixed=True)] = round(share * (weight / weight_total) * 100.0, 4)
    return rows, weights


def build_domain_quota_map(
    question_rows: list[tuple[str, str | None]],
    total_questions: int,
    *,
    blueprint_weights: dict[str, float] | None = None,
) -> tuple[dict[str, int], bool]:
    domain_buckets: dict[str, list[str]] = {}
    for question_id, domain in question_rows:
        domain_buckets.setdefault(domain_label(domain), []).append(question_id)

    if not domain_buckets:
        return {}, False

    domain_labels = sorted(domain_buckets)
    provided_weights = blueprint_weights or {}
    matched_weight_labels = [label for label in domain_labels if label in provided_weights]
    use_blueprint = bool(matched_weight_labels)
    weighted_domains: list[tuple[str, float]] = []

    if use_blueprint:
        smallest_known = min((provided_weights[label] for label in matched_weight_labels), default=5.0)
        fallback_weight = max(smallest_known * 0.35, 3.0) if smallest_known >= 3.0 else smallest_known * 0.35
        for label in domain_labels:
            weighted_domains.append((label, float(provided_weights.get(label, fallback_weight))))
    else:
        for label in domain_labels:
            weighted_domains.append((label, 1.0))

    total_weight = sum(weight for _label, weight in weighted_domains) or float(len(weighted_domains))
    quotas = {label: 0 for label in domain_labels}
    remainders: list[tuple[float, str]] = []

    for label, weight in weighted_domains:
        available = len(domain_buckets[label])
        raw_quota = (total_questions * weight) / total_weight
        base_quota = min(int(math.floor(raw_quota)), available)
        quotas[label] = base_quota
        remainders.append((raw_quota - math.floor(raw_quota), label))

    if total_questions >= len(domain_labels):
        missing = [label for label in domain_labels if quotas[label] == 0 and len(domain_buckets[label]) > 0]
        for label in missing:
            donor = max(
                (candidate for candidate in domain_labels if quotas[candidate] > 1),
                key=lambda item: quotas[item],
                default=None,
            )
            if donor:
                quotas[donor] -= 1
                quotas[label] += 1

    remaining = max(total_questions - sum(quotas.values()), 0)
    remainders.sort(key=lambda item: (-item[0], item[1].lower()))
    while remaining > 0:
        allocated = False
        for _remainder, label in remainders:
            available = len(domain_buckets[label])
            if quotas[label] >= available:
                continue
            quotas[label] += 1
            remaining -= 1
            allocated = True
            if remaining <= 0:
                break
        if not allocated:
            break

    return quotas, use_blueprint


def weighted_domain_sample(
    question_rows: list[tuple[str, str | None]],
    *,
    total_questions: int,
    blueprint_weights: dict[str, float] | None = None,
) -> tuple[list[str], bool]:
    if not question_rows or total_questions <= 0:
        return [], False

    domain_buckets: dict[str, list[str]] = {}
    for question_id, domain in question_rows:
        domain_buckets.setdefault(domain_label(domain), []).append(question_id)

    for bucket in domain_buckets.values():
        random.shuffle(bucket)

    quotas, use_blueprint = build_domain_quota_map(
        question_rows,
        total_questions,
        blueprint_weights=blueprint_weights,
    )
    if not quotas:
        pool = [question_id for question_id, _domain in question_rows]
        random.shuffle(pool)
        return pool[:total_questions], False

    staged: dict[str, list[str]] = {}
    for label, quota in quotas.items():
        if quota > 0:
            staged[label] = domain_buckets[label][:quota]

    selected: list[str] = []
    ordered_domains = sorted(staged, key=lambda label: (-len(staged[label]), label.lower()))
    while True:
        progressed = False
        for label in ordered_domains:
            bucket = staged.get(label) or []
            if not bucket:
                continue
            selected.append(bucket.pop())
            progressed = True
            if len(selected) >= total_questions:
                return selected[:total_questions], use_blueprint
        if not progressed:
            break

    if len(selected) < total_questions:
        selected_set = set(selected)
        fallback = [question_id for question_id, _domain in question_rows if question_id not in selected_set]
        random.shuffle(fallback)
        selected.extend(fallback[: max(total_questions - len(selected), 0)])

    return selected[:total_questions], use_blueprint


def build_question_domain_map(question_rows: list[tuple[str, str | None]]) -> dict[str, str]:
    return {question_id: domain_label(domain) for question_id, domain in question_rows}


def select_candidates_with_domain_targets(
    candidates: list[str],
    *,
    limit: int,
    question_domains: dict[str, str],
    domain_targets: dict[str, int] | None = None,
    already_selected: list[str] | None = None,
) -> list[str]:
    if limit <= 0:
        return []

    blocked = set(already_selected or [])
    ordered_candidates = dedupe_question_ids(candidates, blocked=blocked)
    if not ordered_candidates:
        return []
    if not domain_targets:
        return ordered_candidates[:limit]

    selected_counts: dict[str, int] = {}
    for question_id in already_selected or []:
        label = question_domains.get(question_id, UNKNOWN_DOMAIN_LABEL)
        selected_counts[label] = selected_counts.get(label, 0) + 1

    remaining = list(ordered_candidates)
    picked: list[str] = []

    while remaining and len(picked) < limit:
        best_index = 0
        best_score: tuple[int, int, int, int] | None = None
        for index, question_id in enumerate(remaining):
            label = question_domains.get(question_id, UNKNOWN_DOMAIN_LABEL)
            target = max(int(domain_targets.get(label, 0) or 0), 0)
            current = selected_counts.get(label, 0)
            deficit = max(target - current, 0)
            score = (1 if deficit > 0 else 0, deficit, -current, -index)
            if best_score is None or score > best_score:
                best_index = index
                best_score = score

        question_id = remaining.pop(best_index)
        picked.append(question_id)
        label = question_domains.get(question_id, UNKNOWN_DOMAIN_LABEL)
        selected_counts[label] = selected_counts.get(label, 0) + 1

    return picked
