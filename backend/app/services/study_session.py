"""Study session lifecycle: pool selection, questions, answers, results and review."""
from __future__ import annotations

import json
import math
import random
import uuid
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import Exam, Explanation, Option, Question, StudyAttempt, StudySession, StudySessionQuestion
from app.services.auth import normalize_client_key
from app.services.engagement import refresh_engagement_state
from app.services.learning import upsert_question_progress
from app.services.metrics import record_question_attempt_metrics, record_session_metrics
from app.services.option_order import OptionMapping, build_option_orders, split_keys
from app.services.pedagogy import confidence_signal_from_level
from app.services.question_pool import (
    count_due_review_items as _count_due_review_items,
    dedupe_question_ids,
    domain_key,
    filtered_question_rows_detailed,
    normalize_domain_filters,
    owner_bookmark_question_ids,
    owner_note_question_ids,
    owner_seen_question_ids,
    review_queue_candidates,
    validate_requested_question_ids,
    weak_domain_keys,
)
from app.services.readiness import build_readiness_snapshot
from app.services.reference_resolver import build_feedback_summary, build_official_reference_summaries
from app.services.review_queue import (
    _classify_review_queue_item,
    _normalize_confidence_level,
    _normalize_review_state_filters,
    _upsert_review_queue_item,
)
from app.services.question_data import option_rows, published_version_id
from app.services.serialization import parse_citation_dicts, parse_selection_mix, parse_tags
from app.services.study_plan import (
    PLACEMENT_MIN_QUESTION_COUNT,
    _mark_placement_complete,
    placement_completed_by_session,
)
from app.services.study_state import _question_or_error


def count_due_review_items(db: Session, *, owner_user_id=None, owner_client_key=None, due_at_or_before=None) -> int:
    return _count_due_review_items(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        due_at_or_before=due_at_or_before,
        required=True,
    )


def _bucket_rows(buckets: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"label": label, **data}
        for label, data in buckets.items()
    ]


def _normalize_strategy(value: str | None, queue_only: bool = False) -> str:
    if queue_only:
        return "review"
    normalized = str(value or "standard").strip().lower()
    if normalized not in {"standard", "review", "adaptive"}:
        raise ValueError("Study strategy must be one of: standard, review, adaptive.")
    return normalized


def _serialize_selection_mix(selection_mix: dict[str, int] | None) -> str | None:
    if not selection_mix:
        return None
    cleaned: dict[str, int] = {}
    for key, value in selection_mix.items():
        label = str(key or "").strip()
        if not label:
            continue
        try:
            amount = max(int(value), 0)
        except (TypeError, ValueError):
            continue
        cleaned[label] = amount
    if not cleaned:
        return None
    return json.dumps(cleaned, ensure_ascii=True, sort_keys=True)


def _session_question_row(db: Session, session_id: str, question_id: str) -> StudySessionQuestion | None:
    return db.execute(
        select(StudySessionQuestion).where(
            StudySessionQuestion.session_id == session_id,
            StudySessionQuestion.question_id == question_id,
        )
    ).scalar_one_or_none()


def _serialize_question_payload(db: Session, question_id: str, option_order_json: str | None = None) -> dict[str, Any]:
    question = _question_or_error(db, question_id)
    options = option_rows(db, question_id)
    mapping = OptionMapping.build(option_order_json, [item["key"] for item in options])
    return {
        "id": question.id,
        "exam_id": question.exam_id,
        "prompt": question.prompt,
        "multi_select": question.multi_select,
        "domain": question.domain,
        "difficulty": question.difficulty,
        "certification": question.certification,
        "tags": parse_tags(question.tags_json),
        "options": [{"key": item["key"], "text": item["text"]} for item in mapping.display_options(options)],
    }


def _study_scope_for_session(session: StudySession) -> tuple[str | None, str | None]:
    return session.user_id, None if session.user_id else session.client_key


def _weak_domain_keys(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    exam_id: Optional[str],
    domains: Optional[list[str]],
    limit: int = 3,
) -> list[tuple[str, str]]:
    """Weakest ``(certification, domain)`` pairs from study attempts + review queue."""
    return weak_domain_keys(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=domains,
        include_exam_answers=False,
        limit=limit,
    )


def _build_question_pool(
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
    queue_only: bool,
    review_states: Optional[list[str]],
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> tuple[list[str], str, dict[str, int]]:
    normalized_domains = normalize_domain_filters(domains)
    normalized_review_states = _normalize_review_state_filters(review_states)
    resolved_strategy = _normalize_strategy(strategy, queue_only)

    if question_ids:
        requested = validate_requested_question_ids(
            db, question_ids, empty_message="No questions found for the selected study session."
        )
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
    question_rows = [(qid, domain) for qid, domain, _cert in detailed_rows]
    qids = [qid for qid, _domain in question_rows]
    if not qids:
        if normalized_domains:
            raise ValueError("No questions found for the selected exam/domain.")
        raise ValueError("No questions found for the selected study session.")

    if total_questions > len(qids):
        total_questions = len(qids)

    now = utcnow()
    bookmark_ids = owner_bookmark_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    ) if bookmarked_only else set()
    note_ids = owner_note_question_ids(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        exam_id=exam_id,
        domains=normalized_domains,
    ) if notes_only else set()

    def _filter_queue_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        filtered_rows: list[dict[str, Any]] = []
        for row in rows:
            state, overdue_days, is_overdue = _classify_review_queue_item(
                due_at=row.get("due_at"),
                repetition_count=int(row.get("repetition_count") or 0),
                stability_score=float(row.get("stability_score") or 0.0),
                ease_factor=float(row.get("ease_factor") or 2.5),
                now=now,
            )
            question_id = row["question_id"]
            if bookmarked_only and question_id not in bookmark_ids:
                continue
            if notes_only and question_id not in note_ids:
                continue
            if normalized_review_states:
                matched = False
                for requested_state in normalized_review_states:
                    if requested_state == "overdue" and is_overdue:
                        matched = True
                        break
                    if requested_state == "due_today" and state == "due_now" and not is_overdue:
                        matched = True
                        break
                    if requested_state == state:
                        matched = True
                        break
                if not matched:
                    continue
            filtered_row = dict(row)
            filtered_row["computed_state"] = state
            filtered_row["overdue_days"] = overdue_days
            filtered_row["is_overdue"] = is_overdue
            filtered_rows.append(filtered_row)
        return filtered_rows

    if resolved_strategy == "review":
        queue_rows = _filter_queue_rows(review_queue_candidates(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=exam_id,
            domains=normalized_domains,
        ))
        if not queue_rows:
            raise ValueError("No review items found for the selected filters.")
        due_now = [row["question_id"] for row in queue_rows if row["due_at"] and row["due_at"] <= now]
        upcoming = [row["question_id"] for row in queue_rows if not row["due_at"] or row["due_at"] > now]
        selected = dedupe_question_ids(due_now)[:total_questions]
        remaining = total_questions - len(selected)
        if remaining > 0:
            selected.extend(dedupe_question_ids(upcoming, blocked=set(selected))[:remaining])
        if not selected:
            raise ValueError("No review items found for the selected filters.")
        mix = {
            "due_now": len([qid for qid in selected if qid in set(due_now)]),
            "upcoming": len([qid for qid in selected if qid in set(upcoming)]),
        }
        return selected, resolved_strategy, mix

    if resolved_strategy == "adaptive":
        queue_rows = _filter_queue_rows(review_queue_candidates(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=exam_id,
            domains=normalized_domains,
        ))
        due_now = dedupe_question_ids([
            row["question_id"] for row in queue_rows if row["due_at"] and row["due_at"] <= now
        ])
        queue_future = dedupe_question_ids([
            row["question_id"] for row in queue_rows if not row["due_at"] or row["due_at"] > now
        ])
        seen_ids = owner_seen_question_ids(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=exam_id,
            domains=normalized_domains,
        )
        weak_domains = set(_weak_domain_keys(
            db,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            exam_id=exam_id,
            domains=normalized_domains,
        ))

        weak_new = [
            qid for qid, domain, cert in detailed_rows
            if domain_key(cert, domain) in weak_domains and qid not in seen_ids
        ]
        weak_seen = [
            qid for qid, domain, cert in detailed_rows
            if domain_key(cert, domain) in weak_domains and qid in seen_ids
        ]
        new_questions = [qid for qid, _domain in question_rows if qid not in seen_ids]
        fallback = list(qids)
        random.shuffle(weak_new)
        random.shuffle(weak_seen)
        random.shuffle(new_questions)
        random.shuffle(fallback)

        selected: list[str] = []
        selected.extend(due_now[:total_questions])
        if len(selected) < total_questions:
            due_target = 0
            if due_now:
                due_target = min(len(due_now), max(1, math.ceil(total_questions * 0.4)))
            if due_target and len(selected) > due_target:
                selected = selected[:due_target]
        blocked = set(selected)

        remaining = total_questions - len(selected)
        if remaining > 0:
            weak_target = min(remaining, max(1, math.ceil(total_questions * 0.35))) if weak_domains else 0
            weak_candidates = dedupe_question_ids(weak_new + weak_seen + queue_future, blocked=blocked)
            selected.extend(weak_candidates[:weak_target])
            blocked = set(selected)

        remaining = total_questions - len(selected)
        if remaining > 0:
            selected.extend(dedupe_question_ids(new_questions, blocked=blocked)[:remaining])
            blocked = set(selected)

        remaining = total_questions - len(selected)
        if remaining > 0:
            selected.extend(dedupe_question_ids(queue_future + fallback, blocked=blocked)[:remaining])

        selected = selected[:total_questions]
        if not selected:
            raise ValueError("No questions found for the selected adaptive study session.")
        selected_set = set(selected)
        due_selected = selected_set & set(due_now)
        weak_selected = (selected_set & set(weak_new + weak_seen)) - due_selected
        new_selected = (selected_set & set(new_questions)) - due_selected - weak_selected
        mix = {
            "due_now": len(due_selected),
            "weak": len(weak_selected),
            "new": len(new_selected),
            "carry_over": max(len(selected) - len(due_selected) - len(weak_selected) - len(new_selected), 0),
        }
        return selected, resolved_strategy, mix

    random_pool = list(qids)
    random.shuffle(random_pool)
    selected = random_pool[:total_questions]
    return selected, resolved_strategy, {"random": len(selected)}


def create_study_session(
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
    queue_only: bool = False,
    review_states: Optional[list[str]] = None,
    owner_user_id: Optional[str] = None,
    owner_client_key: Optional[str] = None,
) -> StudySession:
    qids, resolved_strategy, selection_mix = _build_question_pool(
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
        queue_only=queue_only,
        review_states=review_states,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
    )
    if not qids:
        raise ValueError("No questions found for the selected study session.")

    total = min(total_questions, len(qids))
    session = StudySession(
        id=str(uuid.uuid4()),
        exam_id=exam_id,
        user_id=owner_user_id,
        client_key=None if owner_user_id else normalize_client_key(owner_client_key),
        selection_strategy=resolved_strategy,
        selection_mix_json=_serialize_selection_mix(selection_mix),
        total_questions=total,
        current_index=0,
        answered_count=0,
        correct_count=0,
        wrong_count=0,
    )
    db.add(session)
    db.flush()

    option_orders = build_option_orders(db, qids[:total])
    for position, question_id in enumerate(qids[:total]):
        db.add(
            StudySessionQuestion(
                session_id=session.id,
                question_id=question_id,
                position=position,
                option_order_json=option_orders.get(question_id),
            )
        )

    db.commit()
    db.refresh(session)
    return session


def create_placement_session(
    db: Session,
    *,
    exam_id: Optional[str],
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> StudySession:
    return create_study_session(
        db,
        exam_id=exam_id,
        total_questions=PLACEMENT_MIN_QUESTION_COUNT,
        strategy="adaptive",
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
    )


def serialize_study_session(session: StudySession) -> dict[str, Any]:
    return {
        "id": session.id,
        "exam_id": session.exam_id,
        "selection_strategy": session.selection_strategy or "standard",
        "selection_mix": parse_selection_mix(session.selection_mix_json),
        "total_questions": session.total_questions,
        "current_index": session.current_index,
        "answered_count": session.answered_count,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "finished": session.completed_at is not None,
    }


def get_question_for_study_session(db: Session, session: StudySession, position: int) -> Optional[dict[str, Any]]:
    if position < 0 or position >= session.total_questions:
        return None
    row = db.execute(
        select(StudySessionQuestion.question_id, StudySessionQuestion.option_order_json).where(
            StudySessionQuestion.session_id == session.id,
            StudySessionQuestion.position == position,
        )
    ).first()
    if not row:
        return None
    question_id, option_order_json = row
    return _serialize_question_payload(db, question_id, option_order_json)


def answer_study_question(
    db: Session,
    session: StudySession,
    question_id: str,
    selected_keys: list[str],
    confidence_level: str,
    elapsed_seconds: Optional[int] = None,
) -> dict[str, Any]:
    confidence = _normalize_confidence_level(confidence_level)
    session_row = _session_question_row(db, session.id, question_id)
    if not session_row:
        raise ValueError("Question does not belong to this study session.")

    question = db.get(Question, question_id)

    options = option_rows(db, question_id)
    if not options:
        raise ValueError("Question options not found.")
    mapping = OptionMapping.build(session_row.option_order_json, [item["key"] for item in options])
    # Display keys -> original keys: grading, storage and analytics use original keys.
    original_selected = mapping.to_original(selected_keys)
    selected_set = set(original_selected)

    correct_keys = [item["key"] for item in options if item["is_correct"]]
    is_correct = (selected_set == set(correct_keys))
    now = utcnow()
    question_version_id = published_version_id(db, question_id)

    existing_attempt = db.execute(
        select(StudyAttempt).where(
            StudyAttempt.session_id == session.id,
            StudyAttempt.question_id == question_id,
        )
    ).scalar_one_or_none()
    if existing_attempt:
        if existing_attempt.is_correct:
            session.correct_count = max(session.correct_count - 1, 0)
        else:
            session.wrong_count = max(session.wrong_count - 1, 0)
        existing_attempt.selected_keys = ",".join(original_selected)
        existing_attempt.question_version_id = question_version_id
        existing_attempt.is_correct = is_correct
        existing_attempt.confidence_level = confidence
        existing_attempt.elapsed_seconds = elapsed_seconds
        existing_attempt.answered_at = now
    else:
        db.add(
            StudyAttempt(
                session_id=session.id,
                question_id=question_id,
                question_version_id=question_version_id,
                selected_keys=",".join(original_selected),
                is_correct=is_correct,
                confidence_level=confidence,
                elapsed_seconds=elapsed_seconds,
                answered_at=now,
            )
        )
        session.answered_count += 1

    if is_correct:
        session.correct_count += 1
    else:
        session.wrong_count += 1

    was_completed = session.completed_at is not None
    if session.current_index < session.total_questions:
        session.current_index += 1
    if session.current_index >= session.total_questions:
        session.completed_at = now

    owner_user_id, owner_client_key = _study_scope_for_session(session)
    queue_item = _upsert_review_queue_item(
        db,
        question_id=question_id,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        is_correct=is_correct,
        confidence_level=confidence,
        attempted_at=now,
        elapsed_seconds=elapsed_seconds,
    )
    upsert_question_progress(
        db,
        question_id=question_id,
        mode="study",
        is_correct=is_correct,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        confidence_level=confidence,
        attempted_at=now,
    )
    record_question_attempt_metrics(
        db,
        question_id=question_id,
        mode="study",
        exam_id=question.exam_id if question else session.exam_id,
        certification=question.certification if question else None,
        domain=question.domain if question else None,
        is_correct=is_correct,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        confidence_level=confidence,
        elapsed_seconds=elapsed_seconds,
        attempted_at=now,
        selection_strategy=session.selection_strategy,
    )
    if session.completed_at is not None and not was_completed:
        _finalize_study_session(db, session)

    db.commit()
    due_count = count_due_review_items(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
    )

    official_references = build_official_reference_summaries(db, question_id, limit=4)
    feedback_summary = mapping.remap_text(build_feedback_summary(db, question_id, is_correct=is_correct))
    remaining = max(session.total_questions - session.current_index, 0)
    message_code, message = _study_feedback_message(is_correct=is_correct, confidence=confidence)
    next_review_at = queue_item.due_at.isoformat() if queue_item.due_at else None
    message_params = {
        "confidence_level": confidence,
        "interval_days": int(queue_item.interval_days or 0),
        "next_review_at": next_review_at,
    }

    return {
        "is_correct": is_correct,
        "justification": feedback_summary,
        "feedback_summary": feedback_summary,
        "progress_index": session.current_index,
        "total_questions": session.total_questions,
        "answered_count": session.answered_count,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "finished": session.completed_at is not None,
        "confidence_level": confidence,
        "confidence_signal": confidence_signal_from_level(confidence),
        "uncertain_correct": bool(is_correct and confidence != "high"),
        "next_review_at": next_review_at,
        "review_due_count": due_count,
        "official_references": official_references,
        "insight": {
            "message": message,
            # i18n (M-C7): "study_feedback.<snake_case>" + params; message is the pt-BR fallback.
            "message_code": message_code,
            "message_params": message_params,
            "remaining_questions": remaining,
        },
        "correct_keys": mapping.to_display(correct_keys),
        "selected_keys": mapping.to_display(original_selected),
    }


STUDY_FEEDBACK_MESSAGES = {
    "study_feedback.wrong_review_soon": "Erro convertido em revisão. Esta questão voltará rapidamente para reforço.",
    "study_feedback.correct_low_confidence": "Acerto com baixa confiança. A revisão volta cedo para consolidar.",
    "study_feedback.correct_medium_confidence": "Bom progresso. A revisão volta em alguns dias.",
    "study_feedback.correct_high_confidence": (
        "Alta confiança registrada. Esta questão foi empurrada para uma revisão mais espaçada."
    ),
}


def _study_feedback_message(*, is_correct: bool, confidence: str) -> tuple[str, str]:
    """``(code, pt-BR fallback)`` of the SRS feedback shown after a study answer."""
    if not is_correct:
        code = "study_feedback.wrong_review_soon"
    elif confidence == "low":
        code = "study_feedback.correct_low_confidence"
    elif confidence == "medium":
        code = "study_feedback.correct_medium_confidence"
    else:
        code = "study_feedback.correct_high_confidence"
    return code, STUDY_FEEDBACK_MESSAGES[code]


def _finalize_study_session(db: Session, session: StudySession) -> None:
    """Writes that belong to the end of a study session (moved out of GET /result, M-B7):
    placement completion, the per-session metrics snapshot and engagement state."""
    db.flush()
    result = _build_study_result(db, session)
    owner_user_id, owner_client_key = _study_scope_for_session(session)
    _mark_placement_complete(db, session=session, answered_count=result["answered_count"])
    record_session_metrics(
        db,
        session_id=session.id,
        mode="study",
        exam_id=session.exam_id,
        selection_strategy=session.selection_strategy,
        total_questions=session.total_questions,
        answered_count=result["answered_count"],
        correct_count=session.correct_count,
        wrong_count=session.wrong_count,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        completed_at=session.completed_at,
        created_at=session.created_at,
        weakest_domains=((result.get("insight") or {}).get("weakest_domains") or []),
    )
    refresh_engagement_state(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)


def compute_study_result(db: Session, session: StudySession) -> dict[str, Any]:
    """Read-only study result (GET /result, /review): persists nothing (M-B7)."""
    if session.completed_at is None:
        raise ValueError("Study session not completed.")
    result = _build_study_result(db, session)
    owner_user_id, owner_client_key = _study_scope_for_session(session)
    result["insight"]["readiness"] = build_readiness_snapshot(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        weakest_domains=((result.get("insight") or {}).get("weakest_domains") or []),
        due_count=result["review_due_count"],
    )
    result["placement_completed"] = placement_completed_by_session(
        db,
        session=session,
        answered_count=result["answered_count"],
    )
    return result


def _build_study_result(db: Session, session: StudySession) -> dict[str, Any]:
    rows = db.execute(
        select(
            StudySessionQuestion.position,
            Question.id,
            Question.prompt,
            Question.multi_select,
            Question.domain,
            Question.difficulty,
            StudyAttempt.is_correct,
            StudyAttempt.elapsed_seconds,
            StudyAttempt.confidence_level,
        )
        .join(Question, Question.id == StudySessionQuestion.question_id)
        .outerjoin(
            StudyAttempt,
            (StudyAttempt.session_id == StudySessionQuestion.session_id)
            & (StudyAttempt.question_id == StudySessionQuestion.question_id),
        )
        .where(StudySessionQuestion.session_id == session.id)
        .order_by(StudySessionQuestion.position.asc())
    ).all()

    attempted = 0
    wrong = 0
    total_elapsed = 0
    timed_attempts = 0
    missed_sample: list[dict[str, Any]] = []
    by_type = {
        "single_select": {"correct": 0, "total": 0, "score_percent": 0.0},
        "multi_select": {"correct": 0, "total": 0, "score_percent": 0.0},
    }
    by_domain: dict[str, dict[str, Any]] = {}
    confidence_buckets = {"low": 0, "medium": 0, "high": 0}

    for position, question_id, prompt, multi_select, domain, difficulty, is_correct, elapsed_seconds, confidence_level in rows:
        bucket = "multi_select" if multi_select else "single_select"
        by_type[bucket]["total"] += 1
        if is_correct is not None:
            attempted += 1
            confidence_key = str(confidence_level or "medium").strip().lower()
            if confidence_key in confidence_buckets:
                confidence_buckets[confidence_key] += 1
            if bool(is_correct):
                by_type[bucket]["correct"] += 1
            else:
                wrong += 1
                if len(missed_sample) < 5:
                    missed_sample.append({
                        "id": question_id,
                        "question_number": position + 1,
                        "prompt": prompt,
                        "domain": domain,
                        "difficulty": difficulty,
                    })
            if elapsed_seconds is not None:
                total_elapsed += int(elapsed_seconds)
                timed_attempts += 1

        domain_label = str(domain or "Sem dominio").strip() or "Sem dominio"
        stats = by_domain.setdefault(domain_label, {"correct": 0, "total": 0, "wrong": 0, "score_percent": 0.0})
        stats["total"] += 1
        if is_correct is not None and bool(is_correct):
            stats["correct"] += 1
        elif is_correct is not None:
            stats["wrong"] += 1

    for bucket in by_type.values():
        total = bucket["total"]
        bucket["score_percent"] = round((bucket["correct"] / total) * 100.0, 2) if total else 0.0

    weakest_domains = []
    for label, stats in by_domain.items():
        total = stats["total"]
        stats["score_percent"] = round((stats["correct"] / total) * 100.0, 2) if total else 0.0
        weakest_domains.append({
            "label": label,
            "correct": stats["correct"],
            "wrong": stats["wrong"],
            "total": total,
            "score_percent": stats["score_percent"],
        })
    weakest_domains.sort(key=lambda item: (-(item["wrong"]), item["score_percent"], item["label"].lower()))
    weakest_domains = weakest_domains[:5]

    unanswered = max(session.total_questions - attempted, 0)
    score = round((session.correct_count / session.total_questions) * 100.0, 2) if session.total_questions else 0.0
    avg_seconds = round(total_elapsed / timed_attempts, 2) if timed_attempts else None
    duration_seconds = total_elapsed if timed_attempts else None
    owner_user_id, owner_client_key = _study_scope_for_session(session)
    due_count = count_due_review_items(
        db,
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
    )

    study_plan = []
    for item in weakest_domains[:3]:
        study_plan.append({
            "domain": item["label"],
            "wrong": item["wrong"],
            "total": item["total"],
            "score_percent": item["score_percent"],
            "reason": f"Este dominio concentrou {item['wrong']} erro(s) nesta sessao de estudo.",
            "action": "Revise as notas/bookmarks e reabra um bloco de estudo focado apenas neste dominio.",
            "topics": [item["label"]],
            "resources": [],
        })

    focus = []
    strategy = session.selection_strategy or "standard"
    selection_mix = parse_selection_mix(session.selection_mix_json)
    if strategy == "review":
        focus.append("Sessao diaria puxada diretamente da sua fila de revisao.")
    elif strategy == "adaptive":
        focus.append("Sessao adaptativa montada com itens vencidos, dominios fracos e questoes novas.")
    if confidence_buckets["low"]:
        focus.append(f"{confidence_buckets['low']} resposta(s) foram marcadas como 'chutei'.")
    if due_count:
        focus.append(f"{due_count} revisao(oes) ja estao vencidas na sua fila.")
    if not focus:
        focus.append("Sessao limpa. Continue reforcando com blocos curtos e consistentes.")

    patterns = [
        f"Confianca baixa: {confidence_buckets['low']}",
        f"Confianca media: {confidence_buckets['medium']}",
        f"Confianca alta: {confidence_buckets['high']}",
    ]
    if selection_mix:
        mix_text = " | ".join(f"{label}: {amount}" for label, amount in selection_mix.items() if amount)
        if mix_text:
            patterns.append(f"Mix da sessao: {mix_text}")

    result = {
        "session_id": session.id,
        "total_questions": session.total_questions,
        "answered_count": attempted,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "score_percent": score,
        "mode": "study",
        "strategy": strategy,
        "selection_mix": selection_mix,
        "review_due_count": due_count,
        "insight": {
            "summary": {
                "attempted": attempted,
                "unanswered": unanswered,
                "accuracy_percent": score,
                "duration_seconds": duration_seconds,
                "avg_seconds_per_question": avg_seconds,
            },
            "by_type": by_type,
            "by_domain": _bucket_rows(by_domain),
            "weakest_domains": weakest_domains,
            "missed_sample": missed_sample,
            "focus": focus,
            "patterns": patterns,
            "timing": {
                "duration_seconds": duration_seconds,
                "avg_seconds_per_question": avg_seconds,
                "fastest_seconds": None,
                "slowest_seconds": None,
            },
            "recommendation": (
                "Use o study mode para trabalhar apenas as questoes vencidas e marque confianca de forma honesta."
            ),
            "study_plan": study_plan,
        },
    }
    return result


def get_study_session_review(db: Session, session: StudySession) -> dict[str, Any]:
    if session.completed_at is None:
        raise ValueError("Study session not completed.")

    result = compute_study_result(db, session)
    exam = db.get(Exam, session.exam_id) if session.exam_id else None

    rows = db.execute(
        select(
            StudySessionQuestion.position,
            Question.id,
            Question.prompt,
            Question.multi_select,
            Question.domain,
            Question.difficulty,
            Question.certification,
            Question.tags_json,
            Question.citations_json,
            StudySessionQuestion.option_order_json,
            StudyAttempt.selected_keys,
            StudyAttempt.is_correct,
            StudyAttempt.confidence_level,
            StudyAttempt.elapsed_seconds,
            StudyAttempt.answered_at,
        )
        .join(Question, Question.id == StudySessionQuestion.question_id)
        .outerjoin(
            StudyAttempt,
            (StudyAttempt.session_id == StudySessionQuestion.session_id)
            & (StudyAttempt.question_id == StudySessionQuestion.question_id),
        )
        .where(StudySessionQuestion.session_id == session.id)
        .order_by(StudySessionQuestion.position.asc())
    ).all()

    question_ids = [row[1] for row in rows]
    option_rows = []
    explanation_rows = []
    if question_ids:
        option_rows = db.execute(
            select(Option.question_id, Option.key, Option.text, Option.is_correct)
            .where(Option.question_id.in_(question_ids))
            .order_by(Option.question_id.asc(), Option.key.asc())
        ).all()
        explanation_rows = db.execute(
            select(Explanation.question_id, Explanation.justification)
            .where(Explanation.question_id.in_(question_ids))
        ).all()

    option_map: dict[str, list[dict[str, Any]]] = {}
    for question_id, key, text, is_correct in option_rows:
        option_map.setdefault(question_id, []).append({
            "key": key,
            "text": text,
            "is_correct": bool(is_correct),
        })
    explanation_map = {question_id: justification for question_id, justification in explanation_rows}

    timed_total = 0
    timed_count = 0
    confidence_counts = {"low": 0, "medium": 0, "high": 0}
    questions: list[dict[str, Any]] = []
    for (
        position,
        question_id,
        prompt,
        multi_select,
        domain,
        difficulty,
        certification,
        tags_json,
        citations_json,
        option_order_json,
        selected_keys_raw,
        is_correct,
        confidence_level,
        elapsed_seconds,
        answered_at,
    ) in rows:
        raw_options = option_map.get(question_id, [])
        mapping = OptionMapping.build(option_order_json, [item["key"] for item in raw_options])
        options = mapping.display_options(raw_options)
        correct_keys = [item["key"] for item in options if item["is_correct"]]
        selected_keys = mapping.to_display(split_keys(selected_keys_raw))
        normalized_confidence = str(confidence_level or "").strip().lower() or None
        if normalized_confidence in confidence_counts:
            confidence_counts[normalized_confidence] += 1
        if elapsed_seconds is not None:
            timed_total += int(elapsed_seconds)
            timed_count += 1
        questions.append({
            "id": question_id,
            "question_number": int(position) + 1,
            "prompt": prompt,
            "multi_select": bool(multi_select),
            "domain": domain,
            "difficulty": difficulty,
            "certification": certification,
            "options": [{"key": item["key"], "text": item["text"]} for item in options],
            "correct_keys": correct_keys,
            "selected_keys": selected_keys,
            "is_correct": is_correct,
            "confidence_level": normalized_confidence,
            "elapsed_seconds": int(elapsed_seconds) if elapsed_seconds is not None else None,
            "answered_at": answered_at.isoformat() if answered_at else None,
            "justification": mapping.remap_text(explanation_map.get(question_id)),
            "tags": parse_tags(tags_json),
            "citations": parse_citation_dicts(citations_json),
        })

    weakest_domains = [
        str(item.get("label") or "").strip()
        for item in (result.get("insight", {}).get("weakest_domains") or [])
        if str(item.get("label") or "").strip()
    ][:3]
    session_meta = {
        "id": session.id,
        "exam_id": session.exam_id,
        "exam_title": exam.title if exam else None,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "completed_at": session.completed_at.isoformat() if session.completed_at else None,
        "selection_strategy": session.selection_strategy or "standard",
        "selection_mix": parse_selection_mix(session.selection_mix_json),
        "total_questions": session.total_questions,
        "answered_count": session.answered_count,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "score_percent": result["score_percent"],
        "avg_seconds_per_question": round(timed_total / timed_count, 2) if timed_count else None,
        "confidence_low": confidence_counts["low"],
        "confidence_medium": confidence_counts["medium"],
        "confidence_high": confidence_counts["high"],
        "weakest_domains": weakest_domains,
    }

    return {
        "session": session_meta,
        "result": result,
        "questions": questions,
    }
