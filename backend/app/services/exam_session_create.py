"""Exam session creation: question pool selection and per-session question view (split from quiz.py, M-C6)."""
from __future__ import annotations

import math
import random
import uuid
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import (
    ExamSession,
    Question,
    SessionQuestion,
)
from app.services.option_order import OptionMapping, build_option_orders, option_keys_by_question
from app.services.pbq_runtime import MAX_PBQ_COUNT, build_pbq_orders, pbq_question_view
from app.services.question_pool import (
    build_domain_quota_map,
    build_question_domain_map,
    dedupe_question_ids,
    domain_key,
    filtered_question_rows_detailed,
    normalize_difficulty_filters,
    normalize_domain_filters,
    normalize_tag_filters,
    owner_seen_question_ids,
    resolve_quota_buckets,
    review_queue_candidates,
    select_candidates_with_domain_targets,
    select_pbq_question_ids,
    validate_requested_question_ids,
    weak_domain_keys,
    weighted_domain_sample,
)
from app.services.question_data import option_rows
from app.services.serialization import parse_tags
from app.services.serialization import serialize_session_payload as _serialize_session_payload
from app.services.exam_timing import MIN_EXAM_TIME_LIMIT_SECONDS, _default_session_config


def _normalize_strategy(value: str | None) -> str:
    normalized = str(value or "standard").strip().lower()
    if normalized not in {"standard", "adaptive"}:
        raise ValueError("Exam strategy must be one of: standard, adaptive.")
    return normalized


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
    normalized_domains = normalize_domain_filters(domains)
    normalized_difficulties = normalize_difficulty_filters(difficulties)
    normalized_tags = normalize_tag_filters(tags)
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
    normalized_domains = normalize_domain_filters(domains)
    resolved_strategy = _normalize_strategy(strategy)

    if question_ids:
        requested = validate_requested_question_ids(db, question_ids, empty_message="No questions found for the selected exam.")
        selected = requested[:total_questions]
        return selected, "manual", {"manual": len(selected)}

    detailed_rows = filtered_question_rows_detailed(
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
    qids = [qid for qid, _domain, _cert in detailed_rows]
    if not qids:
        if normalized_domains:
            raise ValueError("No questions found for the selected exam/domain.")
        raise ValueError("No questions found for the selected exam.")

    if total_questions > len(qids):
        total_questions = len(qids)

    # Quotas follow the official blueprint weights (domain_blueprint, M-A6). Buckets are
    # (certification, domain) when the pool mixes certifications (M-C5).
    question_rows, blueprint_weights = resolve_quota_buckets(
        db,
        detailed_rows,
        apply_weights=not normalized_domains,
    )
    domain_targets, used_blueprint = build_domain_quota_map(
        question_rows,
        total_questions,
        blueprint_weights=blueprint_weights,
    )
    question_domains = build_question_domain_map(question_rows)

    if resolved_strategy != "adaptive":
        selected, used_blueprint = weighted_domain_sample(
            question_rows,
            total_questions=total_questions,
            blueprint_weights=blueprint_weights,
        )
        mix = {"blueprint_weighted": len(selected)} if used_blueprint else {"balanced_random": len(selected)}
        return selected, resolved_strategy, mix

    seen_ids = owner_seen_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    )
    weak_domains = set(weak_domain_keys(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
        include_exam_answers=True,
    ))
    now = utcnow()
    queue_rows = review_queue_candidates(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    )
    due_now = dedupe_question_ids([
        item["question_id"] for item in queue_rows if item.get("due_at") and item["due_at"] <= now
    ])
    candidate_ids = set(qids)
    due_now = [qid for qid in due_now if qid in candidate_ids]
    weak_new = [qid for qid, domain, cert in detailed_rows if domain_key(cert, domain) in weak_domains and qid not in seen_ids]
    weak_seen = [qid for qid, domain, cert in detailed_rows if domain_key(cert, domain) in weak_domains and qid in seen_ids]
    fresh_questions = [qid for qid in qids if qid not in seen_ids]
    random.shuffle(weak_new)
    random.shuffle(weak_seen)
    random.shuffle(fresh_questions)
    fallback = list(qids)
    random.shuffle(fallback)

    selected: list[str] = []
    due_target = min(len(due_now), max(1, math.ceil(total_questions * 0.2))) if due_now else 0
    selected.extend(
        select_candidates_with_domain_targets(
            due_now,
            limit=due_target,
            question_domains=question_domains,
            domain_targets=domain_targets,
            already_selected=selected,
        )
    )

    remaining = total_questions - len(selected)
    if remaining > 0:
        weak_target = min(remaining, max(1, math.ceil(total_questions * 0.45))) if weak_domains else 0
        selected.extend(
            select_candidates_with_domain_targets(
                weak_new + weak_seen,
                limit=weak_target,
                question_domains=question_domains,
                domain_targets=domain_targets,
                already_selected=selected,
            )
        )

    remaining = total_questions - len(selected)
    if remaining > 0:
        fresh_target = min(remaining, max(1, math.ceil(total_questions * 0.2))) if fresh_questions else 0
        selected.extend(
            select_candidates_with_domain_targets(
                fresh_questions,
                limit=fresh_target,
                question_domains=question_domains,
                domain_targets=domain_targets,
                already_selected=selected,
            )
        )

    remaining = total_questions - len(selected)
    if remaining > 0:
        selected.extend(
            select_candidates_with_domain_targets(
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
    pbq_count: int = 0,
) -> ExamSession:
    # PBQs come first, as in the real exam, and are part of ``total_questions``.
    pbq_ids: list[str] = []
    if pbq_count and not question_ids:
        pbq_ids = select_pbq_question_ids(
            db,
            count=min(int(pbq_count), MAX_PBQ_COUNT, int(total_questions)),
            exam_id=exam_id,
            domains=domains,
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
    mcq_total = int(total_questions) - len(pbq_ids)
    selected: list[str] = []
    resolved_strategy = _normalize_strategy(strategy)
    selection_mix: dict[str, int] = {}
    if mcq_total > 0:
        try:
            selected, resolved_strategy, selection_mix = _build_exam_question_pool(
                db,
                exam_id=exam_id,
                total_questions=mcq_total,
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
        except ValueError:
            if not pbq_ids:
                raise
    if pbq_ids:
        selection_mix = {"pbq": len(pbq_ids), **selection_mix}
    selected = pbq_ids + [qid for qid in selected if qid not in set(pbq_ids)]
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

    option_orders = build_option_orders(db, selected)
    pbq_orders = build_pbq_orders(db, selected)
    for i, qid in enumerate(selected):
        db.add(
            SessionQuestion(
                session_id=sid,
                question_id=qid,
                position=i,
                option_order_json=option_orders.get(qid),
                pbq_order_json=pbq_orders.get(qid),
            )
        )

    db.commit()
    db.refresh(session)
    return session


def session_option_mapping(db: Session, session_question: SessionQuestion, option_keys: list[str] | None = None) -> OptionMapping:
    """Display/original key mapping of one question inside one exam session."""
    keys = option_keys
    if keys is None:
        keys = option_keys_by_question(db, [session_question.question_id]).get(session_question.question_id, [])
    return OptionMapping.build(session_question.option_order_json, keys)


def get_question_for_session(db: Session, session: ExamSession, position: int) -> Optional[Dict[str, Any]]:
    if position < 0 or position >= session.total_questions:
        return None

    row = db.execute(
        select(SessionQuestion).where(SessionQuestion.session_id == session.id, SessionQuestion.position == position)
    ).scalar_one_or_none()
    if not row:
        return None

    q = db.get(Question, row.question_id)
    if not q:
        return None

    options = option_rows(db, q.id)
    mapping = OptionMapping.build(row.option_order_json, [item["key"] for item in options])
    return {
        "id": q.id,
        "exam_id": q.exam_id,
        "prompt": q.prompt,
        "multi_select": q.multi_select,
        "domain": q.domain,
        "difficulty": q.difficulty,
        "certification": q.certification,
        "tags": parse_tags(q.tags_json),
        "options": [{"key": item["key"], "text": item["text"]} for item in mapping.display_options(options)],
        **pbq_question_view(q, row.pbq_order_json),
    }
