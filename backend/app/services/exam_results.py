"""Exam grading analysis and read-only results (split from quiz.py, M-C6)."""
from __future__ import annotations

import math
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models import (
    Exam,
    ExamSession,
    Question,
    SessionAnswer,
    SessionQuestion,
)
from app.services.exam_policy import DEFAULT_PASS_THRESHOLD, resolve_pass_threshold
from app.services.readiness import build_readiness_snapshot
from app.services.serialization import (
    format_citation,
    parse_citations,
    parse_tags,
    score_percent,
)
from app.services.serialization import parse_selection_mix as _parse_selection_mix
from app.services.exam_timing import _build_exam_timing_metadata


# Kept for backwards compatibility; the real threshold depends on the certification
# (see app.services.exam_policy, M-C3).
PASS_THRESHOLD = DEFAULT_PASS_THRESHOLD


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
