"""Exam (simulado) sessions: selection, runtime state, grading and results.

Shared building blocks live in :mod:`app.services.question_pool` (candidate selection,
blueprint quotas), :mod:`app.services.owner_scope`, :mod:`app.services.serialization`
and :mod:`app.services.option_order` (per-session option shuffle, M-C1).

Progress/metrics/SRS for an exam are recorded exactly once, when the session is
completed (submit, last answer with auto-submit, or timer expiry) - see
:func:`finalize_exam_session` (M-C2).
"""
from __future__ import annotations

import math
import random
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from sqlalchemy import and_, false, select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.models import (
    Exam,
    ExamSession,
    Question,
    SessionAnswer,
    SessionQuestion,
)
from app.services.engagement import refresh_engagement_state
from app.services.exam_policy import DEFAULT_PASS_THRESHOLD, resolve_pass_threshold
from app.services.learning import record_question_progress_batch
from app.services.metrics import (
    aggregate_domain_metrics_for_owner,
    record_question_attempt_metrics_batch,
    record_session_metrics,
    refresh_weekly_backlog_counts,
    week_start,
)
from app.services.option_order import OptionMapping, build_option_orders, option_keys_by_question
from app.services.question_pool import (
    active_question_clause,
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
    validate_requested_question_ids,
    weak_domain_keys,
    weighted_domain_sample,
)
from app.services.readiness import build_readiness_snapshot
from app.services.review_queue import schedule_exam_answers_for_review
from app.services.question_data import option_rows
from app.services.serialization import (
    format_citation,
    parse_citations,
    parse_tags,
    score_percent,
)
from app.services.serialization import parse_selection_mix as _parse_selection_mix
from app.services.serialization import parse_session_payload as _parse_session_payload
from app.services.serialization import serialize_session_payload as _serialize_session_payload

# Kept for backwards compatibility; the real threshold depends on the certification
# (see app.services.exam_policy, M-C3).
PASS_THRESHOLD = DEFAULT_PASS_THRESHOLD

DEFAULT_EXAM_SECONDS_PER_QUESTION = 75
MIN_EXAM_TIME_LIMIT_SECONDS = 300
DEFAULT_EXAM_PAUSE_LIMIT = 2
DEFAULT_EXAM_MAX_PAUSE_SECONDS = 300


def _bucket_template() -> dict:
    return {"total": 0, "correct": 0, "wrong": 0, "pedagogical_signal": 0, "score_percent": 0.0}


def _update_bucket(bucket: dict, is_correct: bool) -> None:
    bucket["total"] += 1
    if is_correct:
        bucket["correct"] += 1
    else:
        bucket["wrong"] += 1
    bucket["score_percent"] = score_percent(bucket["correct"], bucket["total"])


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
    now = datetime.utcnow()
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


def _analyze_session(
    session: ExamSession,
    rows,
    *,
    pass_threshold: float = DEFAULT_PASS_THRESHOLD,
    pass_threshold_certification: Optional[str] = None,
) -> dict:
    answered_rows = [row for row in rows if row[11] is not None]
    attempted = len(answered_rows)
    unanswered = max(session.total_questions - attempted, 0)
    correct = session.correct_count
    wrong = session.wrong_count
    score = score_percent(correct, session.total_questions)
    attempt_accuracy = score_percent(correct, attempted) if attempted else 0.0
    passed = score >= pass_threshold

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
            for citation in parse_citations(citations_json):
                formatted = format_citation(citation)
                if formatted and formatted not in study_resources[domain_label]:
                    study_resources[domain_label].append(formatted)

            tags_bucket = study_topics.setdefault(domain_label, {})
            parsed_tags = parse_tags(tags_json)
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
        recent_five_accuracy = score_percent(recent_five_correct, len(recent_five))

    first_half_accuracy = score_percent(first_half_correct, first_half_total) if first_half_total else None
    second_half_accuracy = score_percent(second_half_correct, second_half_total) if second_half_total else None

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
            f"Abaixo de {pass_threshold:g}% (nota de aprovação). Refaça as erradas e concentre a revisão nas áreas com maior volume de falhas."
            if not passed else
            f"Acima de {pass_threshold:g}% (nota de aprovação). Mantenha simulados mistos e revise apenas as áreas com erro residual."
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
        "pass_threshold_percent": pass_threshold,
        "pass_threshold_certification": pass_threshold_certification,
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

    option_orders = build_option_orders(db, selected)
    for i, qid in enumerate(selected):
        db.add(SessionQuestion(session_id=sid, question_id=qid, position=i, option_order_json=option_orders.get(qid)))

    db.commit()
    db.refresh(session)
    return session


def sync_exam_session_state(
    db: Session,
    session: ExamSession,
) -> dict[str, Any]:
    """Bring the session state up to date *in memory* (pause rollover, timer expiry).

    Never commits: mutating flows (answer, pause, resume, submit) call it and commit
    their own transaction. Read-only endpoints use :func:`expire_exam_session_if_due`.
    """
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

    if changed:
        session.selection_mix_json = _serialize_session_payload(
            selection_mix,
            session_config=config,
            active_filters=active_filters,
        )

    timing = _build_exam_timing_metadata(session, now=now, config=config)
    if session.completed_at is None and timing["remaining_seconds"] <= 0:
        complete_exam_session(db, session, completed_at=now, auto_submitted=True)
        timing = _build_exam_timing_metadata(session, now=now)

    timing["selection_mix"] = selection_mix
    timing["active_filters"] = active_filters
    return timing


def exam_session_expired(session: ExamSession, *, now: datetime | None = None) -> bool:
    if session.completed_at is not None:
        return False
    timing = _build_exam_timing_metadata(session, now=now or datetime.utcnow())
    return timing["remaining_seconds"] <= 0


def expire_exam_session_if_due(db: Session, session: ExamSession) -> bool:
    """The only write allowed on exam GET endpoints (M-B7).

    A timed exam whose clock ran out must be auto-submitted even if the learner never
    comes back to press "submit": otherwise the session would stay open forever and its
    results would never reach progress/metrics/SRS. Reads therefore finalise an expired
    session (once) and commit; in every other case they persist nothing.
    """
    if not exam_session_expired(session):
        return False
    lock_exam_session(db, session)
    if not exam_session_expired(session):
        # A concurrent request auto-submitted it while we waited for the lock.
        db.commit()
        return False
    now = datetime.utcnow()
    complete_exam_session(db, session, completed_at=now, auto_submitted=True)
    db.commit()
    db.refresh(session)
    return True


def lock_exam_session(db: Session, session: ExamSession) -> ExamSession:
    """Serialize mutating flows on one exam session (answer, pause, submit, expiry).

    Takes a row lock (``SELECT ... FOR UPDATE``; a no-op on SQLite, whose writers are
    already serialized) and reloads the row so the caller sees the state committed by
    a concurrent request that held the lock before it (e.g. ``completed_at`` and the
    ``finalized_at`` marker of a parallel submit). Must be called before modifying the
    session in the current transaction.
    """
    db.execute(
        select(ExamSession)
        .where(ExamSession.id == session.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    return session


def _claim_completion(db: Session, session: ExamSession, completed_at: datetime) -> bool:
    """Atomically mark the session completed; False when another request already did.

    ``UPDATE ... WHERE completed_at IS NULL`` is the idempotency guard of the
    finalization (M-C2): only the request whose update matched a row records progress,
    metrics and SRS, even without the row lock of :func:`lock_exam_session`.
    """
    result = db.execute(
        update(ExamSession)
        .where(ExamSession.id == session.id, ExamSession.completed_at.is_(None))
        .values(completed_at=completed_at)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 1:
        set_committed_value(session, "completed_at", completed_at)
        return True
    db.refresh(session, attribute_names=["completed_at", "selection_mix_json"])
    return False


def complete_exam_session(
    db: Session,
    session: ExamSession,
    *,
    completed_at: datetime | None = None,
    auto_submitted: bool = False,
) -> None:
    """Mark the session completed and record its learning signals once (no commit)."""
    if session.completed_at is None:
        if not _claim_completion(db, session, completed_at or datetime.utcnow()):
            # A concurrent request completed (and finalized) the session first.
            return
        if auto_submitted:
            selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
            config = _effective_session_config(session, raw_config)
            config["auto_submitted"] = True
            session.selection_mix_json = _serialize_session_payload(
                selection_mix,
                session_config=config,
                active_filters=active_filters,
            )
    finalize_exam_session(db, session)


def finalize_exam_session(db: Session, session: ExamSession) -> bool:
    """Record progress, domain metrics, SRS scheduling and the session snapshot (M-C2).

    Runs once per session (guarded by ``finalized_at`` in the session config): each
    question counts as a single attempt with its final answer, however many times the
    learner changed it during the exam. Wrong answers enter the review queue.

    All rows are loaded and written in bulk (a constant number of statements however
    many questions the exam has).
    """
    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    if raw_config.get("finalized_at"):
        return False
    db.flush()
    owner_user_id, owner_client_key = session.user_id, None if session.user_id else session.client_key
    rows = db.execute(
        select(
            SessionAnswer.question_id,
            SessionAnswer.is_correct,
            SessionAnswer.answered_at,
            SessionAnswer.elapsed_seconds,
            Question.exam_id,
            Question.certification,
            Question.domain,
        )
        .join(Question, Question.id == SessionAnswer.question_id)
        .where(SessionAnswer.session_id == session.id)
        .order_by(SessionAnswer.answered_at.asc(), SessionAnswer.id.asc())
    ).all()
    fallback_time = session.completed_at or datetime.utcnow()
    attempts = [
        {
            "question_id": question_id,
            "is_correct": bool(is_correct),
            "attempted_at": answered_at or fallback_time,
            "elapsed_seconds": elapsed_seconds,
            "exam_id": exam_id,
            "certification": certification,
            "domain": domain,
            "confidence_level": None,
        }
        for question_id, is_correct, answered_at, elapsed_seconds, exam_id, certification, domain in rows
    ]
    if attempts:
        record_question_progress_batch(
            db,
            attempts,
            mode="exam",
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
        )
        record_question_attempt_metrics_batch(
            db,
            attempts,
            mode="exam",
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            selection_strategy=session.selection_strategy,
            refresh_backlog=False,
        )
        schedule_exam_answers_for_review(
            db,
            attempts,
            owner_user_id=owner_user_id,
            owner_client_key=owner_client_key,
            refresh_backlog=False,
        )
        last_attempt_at = max(item["attempted_at"] for item in attempts)
        if session.completed_at is None or week_start(last_attempt_at) != week_start(session.completed_at):
            # record_session_metrics() below refreshes the backlog counters of the
            # completion week; only an exam spanning two weeks needs this extra refresh.
            refresh_weekly_backlog_counts(
                db,
                owner_user_id=owner_user_id,
                owner_client_key=owner_client_key,
                observed_at=last_attempt_at,
            )

    rows_for_result = _get_session_rows(db, session.id)
    threshold, threshold_cert = _pass_threshold_from_rows(rows_for_result)
    result = _analyze_session(session, rows_for_result, pass_threshold=threshold, pass_threshold_certification=threshold_cert)
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
        owner_user_id=owner_user_id,
        owner_client_key=owner_client_key,
        completed_at=session.completed_at,
        created_at=session.created_at,
        weakest_domains=((result.get("insight") or {}).get("weakest_domains") or []),
    )
    refresh_engagement_state(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)

    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    config = dict(raw_config)
    config["finalized_at"] = datetime.utcnow().isoformat()
    session.selection_mix_json = _serialize_session_payload(
        selection_mix,
        session_config=config,
        active_filters=active_filters,
    )
    db.flush()
    return True


def pause_exam_session(db: Session, session: ExamSession) -> ExamSession:
    lock_exam_session(db, session)
    timing = sync_exam_session_state(db, session)
    if session.completed_at is not None:
        db.commit()
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
    lock_exam_session(db, session)
    sync_exam_session_state(db, session)
    selection_mix, raw_config, active_filters = _parse_session_payload(session.selection_mix_json)
    config = _effective_session_config(session, raw_config)
    paused_at = _parse_iso_datetime(config.get("paused_at"))
    if not paused_at:
        db.commit()
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
    sync_exam_session_state(db, session)
    db.commit()
    db.refresh(session)
    return session


def exam_answers_are_hidden(session: ExamSession) -> bool:
    """Exam-day sessions reveal no correctness (verdict, key, score) until completed."""
    return (session.experience_mode or "standard") == "exam_day" and session.completed_at is None


def serialize_exam_session(session: ExamSession) -> dict[str, Any]:
    timing = _build_exam_timing_metadata(session)
    hidden = exam_answers_are_hidden(session)
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
        "correct_count": None if hidden else session.correct_count,
        "wrong_count": None if hidden else session.wrong_count,
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
    }


def _pass_threshold_from_rows(rows) -> tuple[float, Optional[str]]:
    counts: dict[Optional[str], int] = {}
    for row in rows:
        certification = row[6]
        counts[certification] = counts.get(certification, 0) + 1
    return resolve_pass_threshold(counts)


def compute_result(db: Session, session: ExamSession) -> dict:
    """Read-only exam result (GET /result, /review; POST /submit after completing).

    Persists nothing: the session snapshot/progress are written once by
    :func:`finalize_exam_session` when the session is completed (M-B7).
    """
    rows = _get_session_rows(db, session.id)
    threshold, threshold_cert = _pass_threshold_from_rows(rows)
    result = _analyze_session(session, rows, pass_threshold=threshold, pass_threshold_certification=threshold_cert)
    timing = _build_exam_timing_metadata(session)
    result["insight"]["readiness"] = build_readiness_snapshot(
        db,
        owner_user_id=session.user_id,
        owner_client_key=session.client_key,
        weakest_domains=((result.get("insight") or {}).get("weakest_domains") or []),
        certification=threshold_cert,
    )
    result["time_limit_seconds"] = timing["time_limit_seconds"]
    result["time_spent_seconds"] = timing["time_spent_seconds"]
    result["timed_out"] = bool(timing["auto_submitted"] and session.completed_at is not None and timing["remaining_seconds"] <= 0)
    return result
