from __future__ import annotations

import json
import math
import random
import uuid
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import and_, false, func, select
from app.models import (
    Exam,
    Question,
    Option,
    ExamSession,
    SessionQuestion,
    SessionAnswer,
    ReviewQueueItem,
    StudySession,
    StudyAttempt,
    UserBookmark,
    UserNote,
)
from app.services.learning import upsert_question_progress
from app.services.metrics import (
    aggregate_domain_metrics_for_owner,
    record_question_attempt_metrics,
    record_session_metrics,
)
from app.services.readiness import build_readiness_snapshot
from app.services.reference_resolver import build_feedback_summary, build_official_reference_summaries
from typing import Optional, Dict, Any

PASS_THRESHOLD = 90.0
SAFE_FEEDBACK_MAX_CHARS = 240
DEFAULT_EXAM_SECONDS_PER_QUESTION = 75
MIN_EXAM_TIME_LIMIT_SECONDS = 300
DEFAULT_EXAM_PAUSE_LIMIT = 2
DEFAULT_EXAM_MAX_PAUSE_SECONDS = 300
SELECTION_MIX_KEY = "_selection_mix"
SESSION_CONFIG_KEY = "_session_config"
ACTIVE_FILTERS_KEY = "_active_filters"
BLUEPRINT_WEIGHT_PRESETS = {
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


def _score_percent(correct: int, total: int) -> float:
    return round((correct / total) * 100.0, 2) if total else 0.0


def _clean_citation_value(value):
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, list):
        cleaned_items = []
        for item in value:
            cleaned = _clean_citation_value(item)
            if cleaned is not None:
                cleaned_items.append(cleaned)
        return cleaned_items or None
    if isinstance(value, dict):
        cleaned_dict = {}
        for key, item in value.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            cleaned = _clean_citation_value(item)
            if cleaned is not None:
                cleaned_dict[clean_key] = cleaned
        return cleaned_dict or None
    return None


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
        text = str(item or "").strip()
        if text:
            tags.append(text)
    return tags


def _parse_citations(citations_json: str | None) -> list[dict]:
    if not citations_json:
        return []
    try:
        payload = json.loads(citations_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []

    citations: list[dict] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        cleaned_item = {}
        for key, value in item.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            if clean_key in {"source", "reference"}:
                cleaned = str(value or "").strip()
            else:
                cleaned = _clean_citation_value(value)
            if cleaned is None:
                continue
            cleaned_item[clean_key] = cleaned
        source = str(cleaned_item.get("source") or "").strip()
        reference = str(cleaned_item.get("reference") or "").strip()
        locator = str(cleaned_item.get("locator") or "").strip()
        material_path = str(cleaned_item.get("material_path") or "").strip()
        if source or reference or locator or material_path:
            cleaned_item["source"] = source
            cleaned_item["reference"] = reference
            citations.append(cleaned_item)
    return citations


def _format_citation(citation: dict) -> str:
    source = str(citation.get("source") or "").strip()
    reference = str(citation.get("reference") or "").strip()
    chapter = str(citation.get("chapter") or "").strip()
    section = str(citation.get("section") or "").strip()
    locator = str(citation.get("locator") or "").strip()

    if not reference:
        if chapter and section and section.lower() != chapter.lower():
            reference = f"{chapter} -> {section}"
        else:
            reference = chapter or section

    page_start = citation.get("page_start")
    page_end = citation.get("page_end")
    page_text = ""
    if page_start is not None and page_end is not None:
        if str(page_start) == str(page_end):
            page_text = f"p. {page_start}"
        else:
            page_text = f"pp. {page_start}-{page_end}"
    elif page_start is not None:
        page_text = f"p. {page_start}"

    detail_parts = [part for part in [reference, page_text, locator] if part]
    if source and detail_parts:
        return f"{source}: {' | '.join(detail_parts)}"
    if detail_parts:
        return " | ".join(detail_parts)
    return source


def _bucket_template() -> dict:
    return {"total": 0, "correct": 0, "wrong": 0, "pedagogical_signal": 0, "score_percent": 0.0}


def _update_bucket(bucket: dict, is_correct: bool) -> None:
    bucket["total"] += 1
    if is_correct:
        bucket["correct"] += 1
    else:
        bucket["wrong"] += 1
    bucket["score_percent"] = _score_percent(bucket["correct"], bucket["total"])


def _sorted_buckets(buckets: dict[str, dict]) -> dict[str, dict]:
    ordered_items = sorted(
        buckets.items(),
        key=lambda item: (
            -(item[1]["wrong"] + math.ceil((item[1].get("pedagogical_signal", 0) or 0) / 2)),
            item[1]["score_percent"],
            -item[1]["total"],
            item[0].lower(),
        ),
    )
    return {label: data for label, data in ordered_items}


def _top_bucket_entries(buckets: dict[str, dict], *, reverse: bool = False, limit: int = 3) -> list[dict]:
    items = [
        {"label": label, **data}
        for label, data in buckets.items()
        if data.get("total", 0) > 0
    ]
    if reverse:
        items.sort(key=lambda item: (-item["score_percent"], item["wrong"], -item["total"], item["label"].lower()))
    else:
        items.sort(
            key=lambda item: (
                -(item["wrong"] + math.ceil((item.get("pedagogical_signal", 0) or 0) / 2)),
                item["score_percent"],
                -item["total"],
                item["label"].lower(),
            )
        )
    return items[:limit]


def _bucket_rows(buckets: dict[str, dict]) -> list[dict]:
    return [
        {"label": label, **data}
        for label, data in buckets.items()
    ]


def _normalize_text_filters(values: Optional[list[str]]) -> list[str]:
    if not values:
        return []
    normalized: list[str] = []
    seen = set()
    for item in values:
        label = str(item or "").strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(label)
    return normalized


def _normalize_domain_filters(domains: Optional[list[str]]) -> list[str]:
    return _normalize_text_filters(domains)


def _normalize_difficulty_filters(difficulties: Optional[list[str]]) -> list[str]:
    return _normalize_text_filters(difficulties)


def _normalize_tag_filters(tags: Optional[list[str]]) -> list[str]:
    return _normalize_text_filters(tags)


def _normalize_strategy(value: str | None) -> str:
    normalized = str(value or "standard").strip().lower()
    if normalized not in {"standard", "adaptive"}:
        raise ValueError("Exam strategy must be one of: standard, adaptive.")
    return normalized


def _resolve_blueprint_weight_preset(
    db: Session,
    *,
    exam_id: Optional[str],
    question_ids: list[str],
) -> dict[str, float]:
    if not question_ids:
        return {}

    rows = db.execute(
        select(Question.certification, func.count(Question.id))
        .where(Question.id.in_(question_ids))
        .group_by(Question.certification)
        .order_by(func.count(Question.id).desc())
    ).all()
    if not rows:
        return {}

    certification = str(rows[0][0] or "").strip().lower()
    if certification in BLUEPRINT_WEIGHT_PRESETS:
        return dict(BLUEPRINT_WEIGHT_PRESETS[certification])

    normalized_exam_id = str(exam_id or "").strip().lower()
    return dict(BLUEPRINT_WEIGHT_PRESETS.get(normalized_exam_id, {}))


def _build_domain_quota_map(
    question_rows: list[tuple[str, str | None]],
    total_questions: int,
    *,
    blueprint_weights: dict[str, float] | None = None,
) -> tuple[dict[str, int], bool]:
    domain_buckets: dict[str, list[str]] = {}
    for question_id, domain in question_rows:
        domain_label = str(domain or "Sem dominio").strip() or "Sem dominio"
        domain_buckets.setdefault(domain_label, []).append(question_id)

    if not domain_buckets:
        return {}, False

    domain_labels = sorted(domain_buckets)
    provided_weights = blueprint_weights or {}
    matched_weight_labels = [label for label in domain_labels if label in provided_weights]
    use_blueprint = bool(matched_weight_labels)
    weighted_domains: list[tuple[str, float]] = []

    if use_blueprint:
        smallest_known = min((provided_weights[label] for label in matched_weight_labels), default=5.0)
        fallback_weight = max(smallest_known * 0.35, 3.0)
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


def _weighted_domain_sample(
    question_rows: list[tuple[str, str | None]],
    *,
    total_questions: int,
    blueprint_weights: dict[str, float] | None = None,
) -> tuple[list[str], bool]:
    if not question_rows or total_questions <= 0:
        return [], False

    domain_buckets: dict[str, list[str]] = {}
    for question_id, domain in question_rows:
        domain_label = str(domain or "Sem dominio").strip() or "Sem dominio"
        domain_buckets.setdefault(domain_label, []).append(question_id)

    for bucket in domain_buckets.values():
        random.shuffle(bucket)

    quotas, use_blueprint = _build_domain_quota_map(
        question_rows,
        total_questions,
        blueprint_weights=blueprint_weights,
    )
    if not quotas:
        pool = [question_id for question_id, _domain in question_rows]
        random.shuffle(pool)
        return pool[:total_questions], False

    staged: dict[str, list[str]] = {}
    for domain_label, quota in quotas.items():
        if quota > 0:
            staged[domain_label] = domain_buckets[domain_label][:quota]

    selected: list[str] = []
    ordered_domains = sorted(
        staged,
        key=lambda label: (-len(staged[label]), label.lower()),
    )
    while True:
        progressed = False
        for domain_label in ordered_domains:
            bucket = staged.get(domain_label) or []
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


def _build_question_domain_map(question_rows: list[tuple[str, str | None]]) -> dict[str, str]:
    domain_map: dict[str, str] = {}
    for question_id, domain in question_rows:
        domain_map[question_id] = str(domain or "Sem dominio").strip() or "Sem dominio"
    return domain_map


def _select_candidates_with_domain_targets(
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
    ordered_candidates = _dedupe_question_ids(candidates, blocked=blocked)
    if not ordered_candidates:
        return []
    if not domain_targets:
        return ordered_candidates[:limit]

    selected_counts: dict[str, int] = {}
    for question_id in already_selected or []:
        domain_label = question_domains.get(question_id, "Sem dominio")
        selected_counts[domain_label] = selected_counts.get(domain_label, 0) + 1

    remaining = list(ordered_candidates)
    picked: list[str] = []

    while remaining and len(picked) < limit:
        best_index = 0
        best_score: tuple[int, int, int, int] | None = None

        for index, question_id in enumerate(remaining):
            domain_label = question_domains.get(question_id, "Sem dominio")
            target = max(int(domain_targets.get(domain_label, 0) or 0), 0)
            current = selected_counts.get(domain_label, 0)
            deficit = max(target - current, 0)
            score = (
                1 if deficit > 0 else 0,
                deficit,
                -current,
                -index,
            )
            if best_score is None or score > best_score:
                best_index = index
                best_score = score

        question_id = remaining.pop(best_index)
        picked.append(question_id)
        domain_label = question_domains.get(question_id, "Sem dominio")
        selected_counts[domain_label] = selected_counts.get(domain_label, 0) + 1

    return picked


def _sanitize_selection_mix(selection_mix: dict[str, int] | None) -> dict[str, int]:
    cleaned: dict[str, int] = {}
    for key, value in (selection_mix or {}).items():
        label = str(key or "").strip()
        if not label:
            continue
        try:
            cleaned[label] = max(int(value), 0)
        except (TypeError, ValueError):
            continue
    return cleaned


def _normalize_active_filters(
    *,
    domains: Optional[list[str]] = None,
    difficulties: Optional[list[str]] = None,
    tags: Optional[list[str]] = None,
    bookmarked_only: bool = False,
    notes_only: bool = False,
    incorrect_only: bool = False,
    unseen_only: bool = False,
    low_confidence_only: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    normalized_domains = _normalize_domain_filters(domains)
    normalized_difficulties = _normalize_difficulty_filters(difficulties)
    normalized_tags = _normalize_tag_filters(tags)
    if normalized_domains:
        payload["domains"] = normalized_domains
    if normalized_difficulties:
        payload["difficulties"] = normalized_difficulties
    if normalized_tags:
        payload["tags"] = normalized_tags
    if bookmarked_only:
        payload["bookmarked_only"] = True
    if notes_only:
        payload["notes_only"] = True
    if incorrect_only:
        payload["incorrect_only"] = True
    if unseen_only:
        payload["unseen_only"] = True
    if low_confidence_only:
        payload["low_confidence_only"] = True
    return payload


def _default_session_config(total_questions: int) -> dict[str, Any]:
    return {
        "time_limit_seconds": max(int(total_questions or 0) * DEFAULT_EXAM_SECONDS_PER_QUESTION, MIN_EXAM_TIME_LIMIT_SECONDS),
        "pause_limit": DEFAULT_EXAM_PAUSE_LIMIT,
        "max_pause_seconds": DEFAULT_EXAM_MAX_PAUSE_SECONDS,
        "paused_at": None,
        "paused_total_seconds": 0,
        "pause_count": 0,
        "auto_submitted": False,
    }


def _serialize_session_payload(
    selection_mix: dict[str, int] | None,
    *,
    session_config: dict[str, Any] | None = None,
    active_filters: dict[str, Any] | None = None,
) -> str | None:
    cleaned_mix = _sanitize_selection_mix(selection_mix)
    cleaned_config = dict(session_config or {})
    cleaned_filters = dict(active_filters or {})
    if not cleaned_config and not cleaned_filters:
        if not cleaned_mix:
            return None
        return json.dumps(cleaned_mix, ensure_ascii=True, sort_keys=True)

    payload: dict[str, Any] = {
        SELECTION_MIX_KEY: cleaned_mix,
        SESSION_CONFIG_KEY: cleaned_config,
        ACTIVE_FILTERS_KEY: cleaned_filters,
    }
    return json.dumps(payload, ensure_ascii=True, sort_keys=True)


def _parse_session_payload(selection_mix_json: str | None) -> tuple[dict[str, int], dict[str, Any], dict[str, Any]]:
    if not selection_mix_json:
        return {}, {}, {}
    try:
        payload = json.loads(selection_mix_json)
    except (TypeError, ValueError):
        return {}, {}, {}
    if not isinstance(payload, dict):
        return {}, {}, {}

    if SELECTION_MIX_KEY in payload or SESSION_CONFIG_KEY in payload or ACTIVE_FILTERS_KEY in payload:
        raw_mix = payload.get(SELECTION_MIX_KEY)
        raw_config = payload.get(SESSION_CONFIG_KEY)
        raw_filters = payload.get(ACTIVE_FILTERS_KEY)
    else:
        raw_mix = payload
        raw_config = {}
        raw_filters = {}

    parsed_mix: dict[str, int] = {}
    if isinstance(raw_mix, dict):
        for key, value in raw_mix.items():
            label = str(key or "").strip()
            if not label:
                continue
            try:
                parsed_mix[label] = max(int(value), 0)
            except (TypeError, ValueError):
                continue

    parsed_config = raw_config if isinstance(raw_config, dict) else {}
    parsed_filters = raw_filters if isinstance(raw_filters, dict) else {}
    return parsed_mix, parsed_config, parsed_filters


def _parse_selection_mix(selection_mix_json: str | None) -> dict[str, int]:
    parsed_mix, _parsed_config, _parsed_filters = _parse_session_payload(selection_mix_json)
    return parsed_mix


def _parse_session_config(selection_mix_json: str | None) -> dict[str, Any]:
    _parsed_mix, parsed_config, _parsed_filters = _parse_session_payload(selection_mix_json)
    return parsed_config


def _parse_active_filters(selection_mix_json: str | None) -> dict[str, Any]:
    _parsed_mix, _parsed_config, parsed_filters = _parse_session_payload(selection_mix_json)
    return parsed_filters


def _parse_iso_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _effective_session_config(session: ExamSession, config: dict[str, Any] | None = None) -> dict[str, Any]:
    source = dict(config or _parse_session_config(session.selection_mix_json))
    defaults = _default_session_config(session.total_questions)
    merged = {**defaults, **source}
    merged["time_limit_seconds"] = max(int(merged.get("time_limit_seconds") or defaults["time_limit_seconds"]), MIN_EXAM_TIME_LIMIT_SECONDS)
    merged["pause_limit"] = max(int(merged.get("pause_limit") or defaults["pause_limit"]), 0)
    merged["max_pause_seconds"] = max(int(merged.get("max_pause_seconds") or defaults["max_pause_seconds"]), 0)
    merged["paused_total_seconds"] = max(int(merged.get("paused_total_seconds") or 0), 0)
    merged["pause_count"] = max(int(merged.get("pause_count") or 0), 0)
    merged["auto_submitted"] = bool(merged.get("auto_submitted"))
    merged["paused_at"] = str(merged.get("paused_at") or "").strip() or None
    return merged


def _build_exam_timing_metadata(
    session: ExamSession,
    *,
    now: datetime | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    reference_now = now or datetime.utcnow()
    effective_now = session.completed_at if session.completed_at and session.completed_at < reference_now else reference_now
    effective_config = _effective_session_config(session, config)
    paused_at = _parse_iso_datetime(effective_config.get("paused_at"))
    active_pause_seconds = 0
    paused = False
    if paused_at:
        elapsed_pause = max(int((reference_now - paused_at).total_seconds()), 0)
        granted_pause = min(elapsed_pause, effective_config["max_pause_seconds"])
        if elapsed_pause < effective_config["max_pause_seconds"]:
            paused = session.completed_at is None
            active_pause_seconds = granted_pause
        else:
            active_pause_seconds = effective_config["max_pause_seconds"]
    total_paused_seconds = max(int(effective_config["paused_total_seconds"]), 0) + active_pause_seconds
    elapsed_seconds = max(int((effective_now - session.created_at).total_seconds()) - total_paused_seconds, 0)
    time_limit_seconds = int(effective_config["time_limit_seconds"])
    remaining_seconds = max(time_limit_seconds - elapsed_seconds, 0)
    expires_at = None
    if not paused:
        expires_at = (session.created_at + timedelta(seconds=time_limit_seconds + total_paused_seconds)).isoformat()

    return {
        "time_limit_seconds": time_limit_seconds,
        "remaining_seconds": remaining_seconds,
        "expires_at": expires_at,
        "paused": paused,
        "pause_count": int(effective_config["pause_count"]),
        "auto_submitted": bool(effective_config.get("auto_submitted")),
        "time_spent_seconds": elapsed_seconds,
    }
def _apply_owner_filters(stmt, model, owner_user_id: Optional[str], owner_client_key: Optional[str]):
    if owner_user_id:
        return stmt.where(model.user_id == owner_user_id)
    if owner_client_key:
        return stmt.where(model.user_id.is_(None), model.client_key == owner_client_key)
    return stmt.where(false())


def _owner_bookmark_question_ids(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
) -> set[str]:
    normalized_domains = _normalize_domain_filters(domains)
    stmt = select(UserBookmark.question_id, Question.exam_id, Question.domain).join(Question, Question.id == UserBookmark.question_id)
    stmt = _apply_owner_filters(stmt, UserBookmark, owner_user_id, owner_client_key)
    rows = set()
    for question_id, question_exam_id, question_domain in db.execute(stmt).all():
        if exam_id and question_exam_id != exam_id:
            continue
        if normalized_domains and question_domain not in normalized_domains:
            continue
        rows.add(question_id)
    return rows


def _owner_note_question_ids(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
) -> set[str]:
    normalized_domains = _normalize_domain_filters(domains)
    stmt = select(UserNote.question_id, Question.exam_id, Question.domain).join(Question, Question.id == UserNote.question_id)
    stmt = _apply_owner_filters(stmt, UserNote, owner_user_id, owner_client_key)
    rows = set()
    for question_id, question_exam_id, question_domain in db.execute(stmt).all():
        if exam_id and question_exam_id != exam_id:
            continue
        if normalized_domains and question_domain not in normalized_domains:
            continue
        rows.add(question_id)
    return rows


def _owner_incorrect_question_ids(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
) -> set[str]:
    normalized_domains = _normalize_domain_filters(domains)
    incorrect: set[str] = set()

    exam_stmt = (
        select(SessionAnswer.question_id, SessionAnswer.is_correct, Question.exam_id, Question.domain)
        .join(ExamSession, ExamSession.id == SessionAnswer.session_id)
        .join(Question, Question.id == SessionAnswer.question_id)
    )
    exam_stmt = _apply_owner_filters(exam_stmt, ExamSession, owner_user_id, owner_client_key)
    for question_id, is_correct, question_exam_id, question_domain in db.execute(exam_stmt).all():
        if bool(is_correct):
            continue
        if exam_id and question_exam_id != exam_id:
            continue
        if normalized_domains and question_domain not in normalized_domains:
            continue
        incorrect.add(question_id)

    study_stmt = (
        select(StudyAttempt.question_id, StudyAttempt.is_correct, Question.exam_id, Question.domain)
        .join(StudySession, StudySession.id == StudyAttempt.session_id)
        .join(Question, Question.id == StudyAttempt.question_id)
    )
    study_stmt = _apply_owner_filters(study_stmt, StudySession, owner_user_id, owner_client_key)
    for question_id, is_correct, question_exam_id, question_domain in db.execute(study_stmt).all():
        if bool(is_correct):
            continue
        if exam_id and question_exam_id != exam_id:
            continue
        if normalized_domains and question_domain not in normalized_domains:
            continue
        incorrect.add(question_id)

    return incorrect


def _owner_low_confidence_question_ids(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
) -> set[str]:
    normalized_domains = _normalize_domain_filters(domains)
    stmt = (
        select(StudyAttempt.question_id, StudyAttempt.confidence_level, Question.exam_id, Question.domain)
        .join(StudySession, StudySession.id == StudyAttempt.session_id)
        .join(Question, Question.id == StudyAttempt.question_id)
    )
    stmt = _apply_owner_filters(stmt, StudySession, owner_user_id, owner_client_key)
    rows = set()
    for question_id, confidence_level, question_exam_id, question_domain in db.execute(stmt).all():
        if str(confidence_level or "").strip().lower() == "high":
            continue
        if exam_id and question_exam_id != exam_id:
            continue
        if normalized_domains and question_domain not in normalized_domains:
            continue
        rows.add(question_id)
    return rows


def _filtered_question_rows(
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
) -> list[tuple[str, str | None]]:
    normalized_domains = _normalize_domain_filters(domains)
    normalized_difficulties = _normalize_difficulty_filters(difficulties)
    normalized_tags = {item.lower() for item in _normalize_tag_filters(tags)}

    stmt = select(Question.id, Question.domain, Question.tags_json).where(True)
    if exam_id:
        stmt = stmt.where(Question.exam_id == exam_id)
    if normalized_domains:
        stmt = stmt.where(Question.domain.in_(normalized_domains))
    if normalized_difficulties:
        stmt = stmt.where(Question.difficulty.in_(normalized_difficulties))

    bookmark_ids = _owner_bookmark_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    ) if bookmarked_only else set()
    note_ids = _owner_note_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    ) if notes_only else set()
    incorrect_ids = _owner_incorrect_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    ) if incorrect_only else set()
    seen_ids = _owner_seen_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    ) if unseen_only else set()
    low_confidence_ids = _owner_low_confidence_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    ) if low_confidence_only else set()

    rows: list[tuple[str, str | None]] = []
    for question_id, domain, tags_json in db.execute(stmt).all():
        if normalized_tags:
            question_tags = {item.lower() for item in _parse_tags(tags_json)}
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
        rows.append((question_id, domain))

    return rows


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

    return seen


def _review_queue_candidates_for_owner(
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
            Question.exam_id,
            Question.domain,
        )
        .join(Question, Question.id == ReviewQueueItem.question_id)
        .order_by(ReviewQueueItem.due_at.asc(), ReviewQueueItem.id.asc())
    )
    stmt = _apply_owner_filters(stmt, ReviewQueueItem, owner_user_id, owner_client_key)
    rows: list[dict[str, Any]] = []
    for question_id, due_at, question_exam_id, question_domain in db.execute(stmt).all():
        if exam_id and question_exam_id != exam_id:
            continue
        if normalized_domains and question_domain not in normalized_domains:
            continue
        rows.append({
            "question_id": question_id,
            "due_at": due_at,
            "domain": question_domain,
        })
    return rows


def _weak_domain_labels_for_owner(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
    limit: int = 3,
) -> list[str]:
    normalized_domains = _normalize_domain_filters(domains)
    weights: dict[str, int] = {}

    exam_stmt = (
        select(SessionAnswer.is_correct, Question.exam_id, Question.domain)
        .join(ExamSession, ExamSession.id == SessionAnswer.session_id)
        .join(Question, Question.id == SessionAnswer.question_id)
    )
    exam_stmt = _apply_owner_filters(exam_stmt, ExamSession, owner_user_id, owner_client_key)
    for is_correct, question_exam_id, question_domain in db.execute(exam_stmt).all():
        if exam_id and question_exam_id != exam_id:
            continue
        domain_label = str(question_domain or "Sem dominio").strip() or "Sem dominio"
        if normalized_domains and domain_label not in normalized_domains:
            continue
        if not bool(is_correct):
            weights[domain_label] = weights.get(domain_label, 0) + 3

    study_stmt = (
        select(StudyAttempt.is_correct, StudyAttempt.confidence_level, Question.exam_id, Question.domain)
        .join(StudySession, StudySession.id == StudyAttempt.session_id)
        .join(Question, Question.id == StudyAttempt.question_id)
    )
    study_stmt = _apply_owner_filters(study_stmt, StudySession, owner_user_id, owner_client_key)
    for is_correct, confidence_level, question_exam_id, question_domain in db.execute(study_stmt).all():
        if exam_id and question_exam_id != exam_id:
            continue
        domain_label = str(question_domain or "Sem dominio").strip() or "Sem dominio"
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
        if weight:
            weights[domain_label] = weights.get(domain_label, 0) + weight

    now = datetime.utcnow()
    for item in _review_queue_candidates_for_owner(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=domains,
    ):
        domain_label = str(item.get("domain") or "Sem dominio").strip() or "Sem dominio"
        if normalized_domains and domain_label not in normalized_domains:
            continue
        due_at = item.get("due_at")
        bonus = 2 if due_at and due_at <= now else 1
        weights[domain_label] = weights.get(domain_label, 0) + bonus

    ordered = sorted(weights.items(), key=lambda item: (-item[1], item[0].lower()))
    return [label for label, _weight in ordered[:limit]]


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


def _build_exam_question_pool(
    db: Session,
    *,
    exam_id: Optional[str],
    total_questions: int,
    question_ids: Optional[list[str]],
    domains: Optional[list[str]],
    difficulties: Optional[list[str]],
    tags: Optional[list[str]],
    bookmarked_only: bool,
    notes_only: bool,
    incorrect_only: bool,
    unseen_only: bool,
    low_confidence_only: bool,
    strategy: str,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> tuple[list[str], str, dict[str, int]]:
    normalized_domains = _normalize_domain_filters(domains)
    resolved_strategy = _normalize_strategy(strategy)

    if question_ids:
        requested = []
        seen = set()
        for qid in question_ids:
            if not qid:
                continue
            qid = qid.strip()
            if not qid or qid in seen:
                continue
            seen.add(qid)
            requested.append(qid)
        if not requested:
            raise ValueError("No questions found for the selected exam.")
        existing = [row[0] for row in db.execute(select(Question.id).where(Question.id.in_(requested))).all()]
        existing_set = set(existing)
        missing = [qid for qid in requested if qid not in existing_set]
        if missing:
            raise ValueError("One or more requested questions are unavailable.")
        selected = [qid for qid in requested if qid in existing_set][:total_questions]
        return selected, "manual", {"manual": len(selected)}

    question_rows = _filtered_question_rows(
        db,
        exam_id=exam_id,
        domains=normalized_domains,
        difficulties=difficulties,
        tags=tags,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        bookmarked_only=bookmarked_only,
        notes_only=notes_only,
        incorrect_only=incorrect_only,
        unseen_only=unseen_only,
        low_confidence_only=low_confidence_only,
    )
    qids = [qid for qid, _domain in question_rows]
    if not qids:
        if normalized_domains:
            raise ValueError("No questions found for the selected exam/domain.")
        raise ValueError("No questions found for the selected exam.")

    if total_questions > len(qids):
        total_questions = len(qids)

    blueprint_weights = (
        _resolve_blueprint_weight_preset(db, exam_id=exam_id, question_ids=qids)
        if exam_id and not normalized_domains
        else {}
    )
    domain_targets, used_blueprint = _build_domain_quota_map(
        question_rows,
        total_questions,
        blueprint_weights=blueprint_weights,
    )
    question_domains = _build_question_domain_map(question_rows)

    if resolved_strategy != "adaptive":
        selected, used_blueprint = _weighted_domain_sample(
            question_rows,
            total_questions=total_questions,
            blueprint_weights=blueprint_weights,
        )
        mix = {"blueprint_weighted": len(selected)} if used_blueprint else {"balanced_random": len(selected)}
        return selected, resolved_strategy, mix

    seen_ids = _owner_seen_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    )
    weak_domains = _weak_domain_labels_for_owner(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    )
    now = datetime.utcnow()
    queue_rows = _review_queue_candidates_for_owner(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    )
    due_now = _dedupe_question_ids([
        item["question_id"] for item in queue_rows if item.get("due_at") and item["due_at"] <= now
    ])
    weak_new = [qid for qid, domain in question_rows if domain in weak_domains and qid not in seen_ids]
    weak_seen = [qid for qid, domain in question_rows if domain in weak_domains and qid in seen_ids]
    fresh_questions = [qid for qid, _domain in question_rows if qid not in seen_ids]
    random.shuffle(weak_new)
    random.shuffle(weak_seen)
    random.shuffle(fresh_questions)
    fallback = list(qids)
    random.shuffle(fallback)

    selected: list[str] = []
    due_target = min(len(due_now), max(1, math.ceil(total_questions * 0.2))) if due_now else 0
    selected.extend(
        _select_candidates_with_domain_targets(
            due_now,
            limit=due_target,
            question_domains=question_domains,
            domain_targets=domain_targets,
            already_selected=selected,
        )
    )
    blocked = set(selected)

    remaining = total_questions - len(selected)
    if remaining > 0:
        weak_target = min(remaining, max(1, math.ceil(total_questions * 0.45))) if weak_domains else 0
        selected.extend(
            _select_candidates_with_domain_targets(
                weak_new + weak_seen,
                limit=weak_target,
                question_domains=question_domains,
                domain_targets=domain_targets,
                already_selected=selected,
            )
        )
        blocked = set(selected)

    remaining = total_questions - len(selected)
    if remaining > 0:
        fresh_target = min(remaining, max(1, math.ceil(total_questions * 0.2))) if fresh_questions else 0
        selected.extend(
            _select_candidates_with_domain_targets(
                fresh_questions,
                limit=fresh_target,
                question_domains=question_domains,
                domain_targets=domain_targets,
                already_selected=selected,
            )
        )
        blocked = set(selected)

    remaining = total_questions - len(selected)
    if remaining > 0:
        selected.extend(
            _select_candidates_with_domain_targets(
                fallback,
                limit=remaining,
                question_domains=question_domains,
                domain_targets=domain_targets,
                already_selected=selected,
            )
        )

    selected = selected[:total_questions]
    if not selected:
        raise ValueError("No questions found for the selected adaptive exam.")

    selected_set = set(selected)
    due_selected = selected_set & set(due_now)
    weak_selected = (selected_set & set(weak_new + weak_seen)) - due_selected
    fresh_selected = (selected_set & set(fresh_questions)) - due_selected - weak_selected
    mix = {
        "due_now": len(due_selected),
        "weak": len(weak_selected),
        "fresh": len(fresh_selected),
        "carry_over": max(len(selected) - len(due_selected) - len(weak_selected) - len(fresh_selected), 0),
    }
    if used_blueprint:
        mix["blueprint_weighted"] = len(selected)
    return selected, resolved_strategy, mix


def _get_session_rows(db: Session, session_id: str):
    return db.execute(
        select(
            SessionQuestion.position,
            Question.id,
            Question.prompt,
            Question.multi_select,
            Question.domain,
            Question.difficulty,
            Question.certification,
            Question.tags_json,
            Question.citations_json,
            Question.exam_id,
            Exam.title,
            SessionAnswer.is_correct,
            SessionAnswer.answered_at,
        )
        .join(Question, Question.id == SessionQuestion.question_id)
        .outerjoin(Exam, Exam.id == Question.exam_id)
        .outerjoin(
            SessionAnswer,
            and_(
                SessionAnswer.session_id == SessionQuestion.session_id,
                SessionAnswer.question_id == SessionQuestion.question_id,
            ),
        )
        .where(SessionQuestion.session_id == session_id)
        .order_by(SessionQuestion.position.asc())
    ).all()


def _analyze_session(session: ExamSession, rows) -> dict:
    answered_rows = [row for row in rows if row[11] is not None]
    attempted = len(answered_rows)
    unanswered = max(session.total_questions - attempted, 0)
    correct = session.correct_count
    wrong = session.wrong_count
    score = _score_percent(correct, session.total_questions)
    attempt_accuracy = _score_percent(correct, attempted) if attempted else 0.0
    passed = score >= PASS_THRESHOLD

    ms = _bucket_template()
    ss = _bucket_template()
    by_domain: dict[str, dict] = {}
    by_difficulty: dict[str, dict] = {}
    by_certification: dict[str, dict] = {}
    by_exam: dict[str, dict] = {}
    missed_sample: list[dict] = []
    study_resources: dict[str, list[str]] = {}
    study_topics: dict[str, dict[str, int]] = {}

    max_correct_streak = 0
    max_wrong_streak = 0
    current_correct_streak = 0
    current_wrong_streak = 0
    last_correct_streak = 0

    answer_deltas: list[float] = []
    previous_timestamp = session.created_at

    first_half_correct = 0
    second_half_correct = 0
    first_half_total = 0
    second_half_total = 0
    split_index = attempted // 2 if attempted else 0

    for idx, row in enumerate(answered_rows):
        (
            position,
            qid,
            prompt,
            multi_select,
            domain,
            difficulty,
            certification,
            tags_json,
            citations_json,
            exam_id,
            exam_title,
            is_correct,
            answered_at,
        ) = row

        bucket = ms if multi_select else ss
        _update_bucket(bucket, bool(is_correct))

        domain_label = str(domain or "Sem dominio")
        difficulty_label = str(difficulty or "Sem dificuldade")
        certification_label = str(certification or "Sem certificacao")
        exam_label = str(exam_title or exam_id or "Misturar todas")

        _update_bucket(by_domain.setdefault(domain_label, _bucket_template()), bool(is_correct))
        _update_bucket(by_difficulty.setdefault(difficulty_label, _bucket_template()), bool(is_correct))
        _update_bucket(by_certification.setdefault(certification_label, _bucket_template()), bool(is_correct))
        _update_bucket(by_exam.setdefault(exam_label, _bucket_template()), bool(is_correct))

        if not is_correct and len(missed_sample) < 10:
            missed_sample.append({
                "id": qid,
                "question_number": position + 1,
                "prompt": prompt[:180] + ("..." if len(prompt) > 180 else ""),
                "domain": domain_label,
                "difficulty": difficulty_label,
            })

        if not is_correct:
            if domain_label not in study_resources:
                study_resources[domain_label] = []
            for citation in _parse_citations(citations_json):
                formatted = _format_citation(citation)
                if formatted and formatted not in study_resources[domain_label]:
                    study_resources[domain_label].append(formatted)

            tags_bucket = study_topics.setdefault(domain_label, {})
            parsed_tags = _parse_tags(tags_json)
            for tag in parsed_tags:
                tags_bucket[tag] = tags_bucket.get(tag, 0) + 1
            if not parsed_tags and domain_label != "Sem dominio":
                tags_bucket[domain_label] = tags_bucket.get(domain_label, 0) + 1

        if is_correct:
            current_correct_streak += 1
            current_wrong_streak = 0
            max_correct_streak = max(max_correct_streak, current_correct_streak)
        else:
            current_wrong_streak += 1
            current_correct_streak = 0
            max_wrong_streak = max(max_wrong_streak, current_wrong_streak)
        last_correct_streak = current_correct_streak

        if answered_at and previous_timestamp:
            delta = max((answered_at - previous_timestamp).total_seconds(), 0.0)
            answer_deltas.append(round(delta, 2))
        previous_timestamp = answered_at or previous_timestamp

        if idx < split_index:
            first_half_total += 1
            if is_correct:
                first_half_correct += 1
        else:
            second_half_total += 1
            if is_correct:
                second_half_correct += 1

    by_domain = _sorted_buckets(by_domain)
    by_difficulty = _sorted_buckets(by_difficulty)
    by_certification = _sorted_buckets(by_certification)
    by_exam = _sorted_buckets(by_exam)

    weakest_domains = _top_bucket_entries(by_domain)
    strongest_domains = _top_bucket_entries(by_domain, reverse=True)
    weakest_certifications = _top_bucket_entries(by_certification)
    weakest_difficulties = _top_bucket_entries(by_difficulty)

    duration_seconds = None
    avg_seconds_per_question = None
    fastest_seconds = None
    slowest_seconds = None
    if attempted:
        if answered_rows:
            first_answered_at = answered_rows[0][12]
            last_answered_at = answered_rows[-1][12]
            if first_answered_at and last_answered_at:
                duration_seconds = max((last_answered_at - session.created_at).total_seconds(), 0.0)
            elif last_answered_at:
                duration_seconds = max((last_answered_at - session.created_at).total_seconds(), 0.0)

        if duration_seconds is not None:
            avg_seconds_per_question = round(duration_seconds / attempted, 2)
        if answer_deltas:
            fastest_seconds = min(answer_deltas)
            slowest_seconds = max(answer_deltas)

    recent_five = answered_rows[-5:]
    recent_five_accuracy = None
    if recent_five:
        recent_five_correct = sum(1 for row in recent_five if row[11])
        recent_five_accuracy = _score_percent(recent_five_correct, len(recent_five))

    first_half_accuracy = _score_percent(first_half_correct, first_half_total) if first_half_total else None
    second_half_accuracy = _score_percent(second_half_correct, second_half_total) if second_half_total else None

    focus: list[str] = []
    if weakest_domains:
        area = weakest_domains[0]
        focus.append(
            f"Maior concentracao de erros em {area['label']} ({area['wrong']} erro(s) em {area['total']} questoes)."
        )
    if ss["total"] and ms["total"]:
        if ss["score_percent"] < ms["score_percent"]:
            focus.append("Seu desempenho caiu mais em single-select; revise eliminacao de alternativas.")
        elif ms["score_percent"] < ss["score_percent"]:
            focus.append("Seu desempenho caiu mais em multi-select; revise validacao de cada opcao antes de marcar.")
    if weakest_difficulties and weakest_difficulties[0]["label"] != "Sem dificuldade":
        difficulty_area = weakest_difficulties[0]
        focus.append(
            f"As questoes {difficulty_area['label']} foram as mais instaveis ({difficulty_area['score_percent']}% de acerto)."
        )
    if first_half_accuracy is not None and second_half_accuracy is not None and second_half_accuracy + 10 < first_half_accuracy:
        focus.append("Houve queda perceptivel na segunda metade da prova; vale revisar ritmo e fadiga.")
    if weakest_certifications and len(by_certification) > 1:
        cert = weakest_certifications[0]
        focus.append(
            f"No mix de certificacoes, {cert['label']} foi seu ponto mais fraco ({cert['wrong']} erro(s))."
        )
    if not focus:
        focus.append("Sessao consistente; mantenha revisao pontual dos erros.")

    patterns: list[str] = []
    if recent_five_accuracy is not None:
        patterns.append(f"Ultimas 5: {recent_five_accuracy}% de acerto.")
    if first_half_accuracy is not None and second_half_accuracy is not None:
        patterns.append(f"1a metade: {first_half_accuracy}% | 2a metade: {second_half_accuracy}%.")
    if max_wrong_streak:
        patterns.append(f"Maior sequencia de erros: {max_wrong_streak}.")
    if slowest_seconds is not None:
        patterns.append(f"Questao mais lenta: {slowest_seconds}s.")

    study_plan: list[dict] = []
    for area in weakest_domains[:3]:
        domain_label = area["label"]
        topic_counts = study_topics.get(domain_label, {})
        sorted_topics = sorted(topic_counts.items(), key=lambda item: (-item[1], item[0].lower()))
        topics = [topic for topic, _count in sorted_topics[:3]]
        resources = study_resources.get(domain_label, [])[:3]
        topic_label = ", ".join(topics) if topics else domain_label
        study_plan.append({
            "domain": domain_label,
            "wrong": area["wrong"],
            "total": area["total"],
            "score_percent": area["score_percent"],
            "topics": topics,
            "resources": resources,
            "reason": f"Voce errou {area['wrong']} de {area['total']} questoes neste dominio.",
            "action": f"Priorize revisar {topic_label} e depois refaca as questoes erradas deste bloco.",
        })

    weakest_area = weakest_domains[0] if weakest_domains else None
    live_message = (
        f"Acuracia atual {attempt_accuracy}%. Area mais critica: {weakest_area['label']}."
        if weakest_area else
        f"Acuracia atual {attempt_accuracy}%."
    )

    insight = {
        "summary": {
            "attempted": attempted,
            "unanswered": unanswered,
            "accuracy_percent": attempt_accuracy,
            "max_correct_streak": max_correct_streak,
            "max_wrong_streak": max_wrong_streak,
            "duration_seconds": duration_seconds,
            "avg_seconds_per_question": avg_seconds_per_question,
            "recent_five_accuracy": recent_five_accuracy,
            "first_half_accuracy": first_half_accuracy,
            "second_half_accuracy": second_half_accuracy,
            "fastest_seconds": fastest_seconds,
            "slowest_seconds": slowest_seconds,
        },
        "by_type": {
            "single_select": ss,
            "multi_select": ms,
        },
        "by_domain": _bucket_rows(by_domain),
        "by_difficulty": _bucket_rows(by_difficulty),
        "by_certification": _bucket_rows(by_certification),
        "by_exam": _bucket_rows(by_exam),
        "weakest_domains": weakest_domains,
        "strongest_domains": strongest_domains,
        "patterns": patterns,
        "focus": focus,
        "study_plan": study_plan,
        "timing": {
            "duration_seconds": duration_seconds,
            "avg_seconds_per_question": avg_seconds_per_question,
            "fastest_seconds": fastest_seconds,
            "slowest_seconds": slowest_seconds,
        },
        "recommendation": (
            "Abaixo de 90%. Refaça as erradas e concentre a revisao nas areas com maior volume de falhas."
            if not passed else
            "Acima de 90%. Mantenha simulados mistos e revise apenas as areas com erro residual."
        ),
        "missed_sample": missed_sample,
        "live": {
            "accuracy_percent": attempt_accuracy,
            "remaining_questions": unanswered,
            "current_correct_streak": last_correct_streak,
            "weakest_area": weakest_area,
            "message": live_message,
        },
    }

    return {
        "session_id": session.id,
        "total_questions": session.total_questions,
        "correct_count": correct,
        "wrong_count": wrong,
        "score_percent": score,
        "passed": passed,
        "pass_threshold_percent": PASS_THRESHOLD,
        "strategy": session.selection_strategy or "standard",
        "selection_mix": _parse_selection_mix(session.selection_mix_json),
        "insight": insight,
    }


def create_session(
    db: Session,
    exam_id: Optional[str],
    total_questions: int,
    question_ids: Optional[list[str]] = None,
    domains: Optional[list[str]] = None,
    difficulties: Optional[list[str]] = None,
    tags: Optional[list[str]] = None,
    bookmarked_only: bool = False,
    notes_only: bool = False,
    incorrect_only: bool = False,
    unseen_only: bool = False,
    low_confidence_only: bool = False,
    strategy: str = "standard",
    time_limit_minutes: Optional[int] = None,
    experience_mode: str = "standard",
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> ExamSession:
    selected, resolved_strategy, selection_mix = _build_exam_question_pool(
        db,
        exam_id=exam_id,
        total_questions=total_questions,
        question_ids=question_ids,
        domains=domains,
        difficulties=difficulties,
        tags=tags,
        bookmarked_only=bookmarked_only,
        notes_only=notes_only,
        incorrect_only=incorrect_only,
        unseen_only=unseen_only,
        low_confidence_only=low_confidence_only,
        strategy=strategy,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
    )
    total_questions = len(selected)
    active_filters = _normalize_active_filters(
        domains=domains,
        difficulties=difficulties,
        tags=tags,
        bookmarked_only=bookmarked_only,
        notes_only=notes_only,
        incorrect_only=incorrect_only,
        unseen_only=unseen_only,
        low_confidence_only=low_confidence_only,
    )
    session_config = _default_session_config(total_questions)
    if time_limit_minutes:
        session_config["time_limit_seconds"] = max(int(time_limit_minutes) * 60, MIN_EXAM_TIME_LIMIT_SECONDS)

    normalized_experience_mode = str(experience_mode or "standard").strip().lower()
    if normalized_experience_mode not in {"standard", "exam_day"}:
        normalized_experience_mode = "standard"

    sid = str(uuid.uuid4())
    session = ExamSession(
        id=sid,
        exam_id=exam_id,
        user_id=owner_user_id,
        client_key=None if owner_user_id else owner_client_key,
        selection_strategy=resolved_strategy,
        selection_mix_json=_serialize_session_payload(
            selection_mix,
            session_config=session_config,
            active_filters=active_filters,
        ),
        total_questions=total_questions,
        current_index=0,
        current_position=0,
        experience_mode=normalized_experience_mode,
        correct_count=0,
        wrong_count=0,
    )
    db.add(session)
    db.flush()

    for i, qid in enumerate(selected):
        db.add(SessionQuestion(session_id=sid, question_id=qid, position=i))

    db.commit()
    db.refresh(session)
    return session


def sync_exam_session_state(
    db: Session,
    session: ExamSession,
) -> dict[str, Any]:
    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    config = _effective_session_config(session, raw_config)
    changed = False
    now = datetime.utcnow()

    paused_at = _parse_iso_datetime(config.get("paused_at"))
    if paused_at and session.completed_at is None:
        elapsed_pause = max(int((now - paused_at).total_seconds()), 0)
        max_pause_seconds = int(config["max_pause_seconds"])
        if elapsed_pause >= max_pause_seconds:
            config["paused_total_seconds"] = max(int(config["paused_total_seconds"]), 0) + max_pause_seconds
            config["paused_at"] = None
            changed = True

    timing = _build_exam_timing_metadata(session, now=now, config=config)
    if session.completed_at is None and timing["remaining_seconds"] <= 0:
        session.completed_at = now
        config["auto_submitted"] = True
        changed = True
        timing = _build_exam_timing_metadata(session, now=now, config=config)

    if changed:
        session.selection_mix_json = _serialize_session_payload(
            selection_mix,
            session_config=config,
            active_filters=active_filters,
        )
        db.commit()
        db.refresh(session)

    timing["selection_mix"] = selection_mix
    timing["active_filters"] = active_filters
    return timing


def pause_exam_session(db: Session, session: ExamSession) -> ExamSession:
    timing = sync_exam_session_state(db, session)
    if session.completed_at is not None:
        raise ValueError("Session already completed.")
    if timing["paused"]:
        raise ValueError("Session is already paused.")

    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    config = _effective_session_config(session, raw_config)
    if int(config["pause_count"]) >= int(config["pause_limit"]):
        raise ValueError("Pause limit reached for this exam session.")

    config["paused_at"] = datetime.utcnow().isoformat()
    config["pause_count"] = int(config["pause_count"]) + 1
    session.selection_mix_json = _serialize_session_payload(
        selection_mix,
        session_config=config,
        active_filters=active_filters,
    )
    db.commit()
    db.refresh(session)
    return session


def resume_exam_session(db: Session, session: ExamSession) -> ExamSession:
    sync_exam_session_state(db, session)
    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    config = _effective_session_config(session, raw_config)
    paused_at = _parse_iso_datetime(config.get("paused_at"))
    if not paused_at:
        raise ValueError("Session is not paused.")

    now = datetime.utcnow()
    elapsed_pause = max(int((now - paused_at).total_seconds()), 0)
    config["paused_total_seconds"] = max(int(config["paused_total_seconds"]), 0) + min(
        elapsed_pause,
        int(config["max_pause_seconds"]),
    )
    config["paused_at"] = None
    session.selection_mix_json = _serialize_session_payload(
        selection_mix,
        session_config=config,
        active_filters=active_filters,
    )
    db.commit()
    db.refresh(session)
    sync_exam_session_state(db, session)
    return session


def serialize_exam_session(session: ExamSession) -> dict[str, Any]:
    timing = _build_exam_timing_metadata(session)
    answered_count = len(session.answers)
    marked_for_review_count = sum(1 for item in session.questions if item.marked_for_review)
    return {
        "id": session.id,
        "exam_id": session.exam_id,
        "selection_strategy": session.selection_strategy or "standard",
        "selection_mix": _parse_selection_mix(session.selection_mix_json),
        "active_filters": _parse_active_filters(session.selection_mix_json),
        "total_questions": session.total_questions,
        "current_index": session.current_index,
        "current_position": session.current_position,
        "answered_count": answered_count,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "marked_for_review_count": marked_for_review_count,
        "experience_mode": session.experience_mode or "standard",
        "time_limit_seconds": timing["time_limit_seconds"],
        "remaining_seconds": timing["remaining_seconds"],
        "expires_at": timing["expires_at"],
        "paused": timing["paused"],
        "pause_count": timing["pause_count"],
        "auto_submitted": timing["auto_submitted"],
        "finished": session.completed_at is not None,
    }


def build_domain_catalog(db: Session, exam_id: Optional[str] = None) -> dict:
    stmt = select(Question.domain, Question.certification).where(Question.domain.is_not(None))
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

        items = []
        for certification in sorted(buckets_by_cert):
            domain_buckets = _sorted_buckets(buckets_by_cert.get(certification, {}))
            weakest_domains = _top_bucket_entries(domain_buckets, limit=5)
            attempted = sum(bucket["total"] for bucket in domain_buckets.values())
            wrong = sum(bucket["wrong"] for bucket in domain_buckets.values())
            focus_domain = weakest_domains[0] if weakest_domains else None
            if attempted and focus_domain:
                message = (
                    f"Maior necessidade de estudo em {focus_domain['label']} "
                    f"({focus_domain['wrong']} erro(s) e {focus_domain.get('pedagogical_signal', 0)} sinal(is) de baixa seguranca "
                    f"em {focus_domain['total']} questoes)."
                )
            else:
                message = "Sem historico suficiente para este track."
            items.append({
                "certification": certification,
                "attempted": attempted,
                "wrong": wrong,
                "focus_domain": focus_domain,
                "domains": weakest_domains,
                "message": message,
            })
        return {"certifications": items}

    certification_rows = db.execute(
        select(Question.certification).where(Question.certification.is_not(None))
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
        focus_domain = weakest_domains[0] if weakest_domains else None
        if attempted and focus_domain:
            message = (
                f"Maior necessidade de estudo em {focus_domain['label']} "
                f"({focus_domain['wrong']} erro(s) em {focus_domain['total']} questoes)."
            )
        else:
            message = "Sem historico suficiente para este track."
        items.append({
            "certification": certification,
            "attempted": attempted,
            "wrong": wrong,
            "focus_domain": focus_domain,
            "domains": weakest_domains,
            "message": message,
        })

    return {"certifications": items}

def _get_correct_keys(db: Session, question_id: str) -> list[str]:
    stmt = select(Option.key).where(Option.question_id == question_id, Option.is_correct == True)
    return [r[0] for r in db.execute(stmt).all()]


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
        return "Resposta correta. A revisao completa continua disponivel no resumo final da sessao."
    return "Resposta incorreta. O conceito foi registrado para revisao e a explicacao completa fica na tela final."

def get_question_for_session(db: Session, session: ExamSession, position: int) -> Optional[Dict[str, Any]]:
    if position < 0 or position >= session.total_questions:
        return None

    sq = db.execute(
        select(SessionQuestion.question_id).where(SessionQuestion.session_id == session.id, SessionQuestion.position == position)
    ).scalar_one_or_none()
    if not sq:
        return None

    q = db.get(Question, sq)
    if not q:
        return None

    opts = db.execute(select(Option.key, Option.text).where(Option.question_id == q.id).order_by(Option.key.asc())).all()
    return {
        "id": q.id,
        "exam_id": q.exam_id,
        "prompt": q.prompt,
        "multi_select": q.multi_select,
        "domain": q.domain,
        "difficulty": q.difficulty,
        "certification": q.certification,
        "tags": _parse_tags(q.tags_json),
        "options": [{"key": k, "text": t} for (k, t) in opts],
    }

def answer_question(db: Session, session: ExamSession, question_id: str, selected_keys: list[str]) -> dict:
    timing = sync_exam_session_state(db, session)
    if session.completed_at is not None and timing["remaining_seconds"] <= 0:
        raise ValueError("Session time limit expired. The exam was auto-submitted.")
    if timing["paused"]:
        raise ValueError("Session is paused. Resume it before submitting an answer.")

    # Validate that the question belongs to the session
    belongs = db.execute(
        select(SessionQuestion.id).where(
            SessionQuestion.session_id == session.id,
            SessionQuestion.question_id == question_id
        )
    ).scalar_one_or_none()
    if not belongs:
        raise ValueError("Question does not belong to this session.")

    q = db.get(Question, question_id)
    if not q:
        raise ValueError("Question not found.")

    option_keys = [r[0] for r in db.execute(
        select(Option.key).where(Option.question_id == question_id)
    ).all()]
    if not option_keys:
        raise ValueError("Question options not found.")

    selected_set = {k.strip() for k in selected_keys if k and k.strip()}
    invalid = sorted(set(selected_set) - set(option_keys))
    if invalid:
        raise ValueError(f"Invalid option key(s): {', '.join(invalid)}")
    correct_keys = _get_correct_keys(db, question_id)
    correct_set = set(correct_keys)

    is_correct = (selected_set == correct_set)

    # upsert answer for this question in this session
    existing = db.execute(
        select(SessionAnswer).where(SessionAnswer.session_id == session.id, SessionAnswer.question_id == question_id)
    ).scalar_one_or_none()

    if existing is None:
        db.add(SessionAnswer(
            session_id=session.id,
            question_id=question_id,
            selected_keys=",".join(sorted(selected_set)),
            is_correct=is_correct
        ))
        if is_correct:
            session.correct_count += 1
        else:
            session.wrong_count += 1
    else:
        # if user re-answers, adjust counts
        if existing.is_correct != is_correct:
            if existing.is_correct:
                session.correct_count -= 1
                session.wrong_count += 1
            else:
                session.wrong_count -= 1
                session.correct_count += 1
        existing.selected_keys = ",".join(sorted(selected_set))
        existing.is_correct = is_correct

    # Move forward only if they answered the current question
    # (front-end should submit in order, but we keep safe)
    q_current = get_question_for_session(db, session, session.current_index)
    if q_current and q_current["id"] == question_id:
        session.current_index += 1
        if session.current_index >= session.total_questions:
            session.completed_at = datetime.utcnow()

    official_references = build_official_reference_summaries(db, question_id, limit=4)
    feedback_summary = build_feedback_summary(db, question_id, is_correct=is_correct)
    upsert_question_progress(
        db,
        question_id=question_id,
        mode="exam",
        is_correct=is_correct,
        owner_user_id=session.user_id,
        owner_client_key=session.client_key,
        confidence_level=None,
    )
    record_question_attempt_metrics(
        db,
        question_id=question_id,
        mode="exam",
        exam_id=q.exam_id,
        certification=q.certification,
        domain=q.domain,
        is_correct=is_correct,
        owner_user_id=session.user_id,
        owner_client_key=session.client_key,
        selection_strategy=session.selection_strategy,
    )
    db.flush()
    result_snapshot = _analyze_session(session, _get_session_rows(db, session.id))
    db.commit()

    finished = session.completed_at is not None
    return {
        "is_correct": is_correct,
        "justification": feedback_summary,
        "feedback_summary": feedback_summary,
        "progress_index": session.current_index,
        "current_position": session.current_position,
        "total_questions": session.total_questions,
        "answered_count": len(session.answers),
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "marked_for_review_count": sum(1 for item in session.questions if item.marked_for_review),
        "finished": finished,
        "official_references": official_references,
        "insight": result_snapshot["insight"]["live"],
    }

def compute_result(db: Session, session: ExamSession) -> dict:
    result = _analyze_session(session, _get_session_rows(db, session.id))
    timing = sync_exam_session_state(db, session)
    result["insight"]["readiness"] = build_readiness_snapshot(
        db,
        owner_user_id=session.user_id,
        owner_client_key=session.client_key,
        weakest_domains=((result.get("insight") or {}).get("weakest_domains") or []),
    )
    result["time_limit_seconds"] = timing["time_limit_seconds"]
    result["time_spent_seconds"] = timing["time_spent_seconds"]
    result["timed_out"] = bool(timing["auto_submitted"] and session.completed_at is not None and timing["remaining_seconds"] <= 0)
    if session.completed_at is not None:
        record_session_metrics(
            db,
            session_id=session.id,
            mode="exam",
            exam_id=session.exam_id,
            selection_strategy=session.selection_strategy,
            total_questions=session.total_questions,
            answered_count=session.correct_count + session.wrong_count,
            correct_count=session.correct_count,
            wrong_count=session.wrong_count,
            owner_user_id=session.user_id,
            owner_client_key=session.client_key,
            completed_at=session.completed_at,
            created_at=session.created_at,
            weakest_domains=((result.get("insight") or {}).get("weakest_domains") or []),
        )
        db.flush()
    return result
