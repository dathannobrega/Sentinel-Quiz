from __future__ import annotations

import json
import uuid
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import and_, select
from app.models import Exam, Question, Option, Explanation, ExamSession, SessionQuestion, SessionAnswer
from typing import Optional, Dict, Any

PASS_THRESHOLD = 90.0


def _score_percent(correct: int, total: int) -> float:
    return round((correct / total) * 100.0, 2) if total else 0.0


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
        source = str(item.get("source") or "").strip()
        reference = str(item.get("reference") or "").strip()
        if source or reference:
            citations.append({"source": source, "reference": reference})
    return citations


def _format_citation(citation: dict) -> str:
    source = str(citation.get("source") or "").strip()
    reference = str(citation.get("reference") or "").strip()
    if source and reference:
        return f"{source}: {reference}"
    return source or reference


def _bucket_template() -> dict:
    return {"total": 0, "correct": 0, "wrong": 0, "score_percent": 0.0}


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
        key=lambda item: (-item[1]["wrong"], item[1]["score_percent"], -item[1]["total"], item[0].lower()),
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
        items.sort(key=lambda item: (-item["wrong"], item["score_percent"], -item["total"], item["label"].lower()))
    return items[:limit]


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
            _position,
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
        "by_domain": by_domain,
        "by_difficulty": by_difficulty,
        "by_certification": by_certification,
        "by_exam": by_exam,
        "weakest_domains": weakest_domains,
        "strongest_domains": strongest_domains,
        "patterns": patterns,
        "focus": focus,
        "study_plan": study_plan,
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
        "insight": insight,
    }


def create_session(db: Session, exam_id: Optional[str], total_questions: int, question_ids: Optional[list[str]] = None) -> ExamSession:
    # Fetch pool
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

        existing = [r[0] for r in db.execute(select(Question.id).where(Question.id.in_(requested))).all()]
        existing_set = set(existing)
        missing = [qid for qid in requested if qid not in existing_set]
        if missing:
            raise ValueError(f"Question IDs not found: {', '.join(missing[:5])}")

        qids = [qid for qid in requested if qid in existing_set]
    else:
        stmt = select(Question.id).where(True)
        if exam_id:
            stmt = stmt.where(Question.exam_id == exam_id)
        qids = [r[0] for r in db.execute(stmt).all()]

    if not qids:
        raise ValueError("No questions found for the selected exam.")

    # Sample without replacement
    if total_questions > len(qids):
        total_questions = len(qids)

    if question_ids:
        selected = qids[:total_questions]
    else:
        import random
        selected = random.sample(qids, total_questions)

    sid = str(uuid.uuid4())
    session = ExamSession(id=sid, exam_id=exam_id, total_questions=total_questions, current_index=0, correct_count=0, wrong_count=0)
    db.add(session)
    db.flush()

    for i, qid in enumerate(selected):
        db.add(SessionQuestion(session_id=sid, question_id=qid, position=i))

    db.commit()
    db.refresh(session)
    return session

def _get_correct_keys(db: Session, question_id: str) -> list[str]:
    stmt = select(Option.key).where(Option.question_id == question_id, Option.is_correct == True)
    return [r[0] for r in db.execute(stmt).all()]

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

    exp = db.get(Explanation, question_id)
    db.flush()
    result_snapshot = _analyze_session(session, _get_session_rows(db, session.id))
    db.commit()

    finished = session.completed_at is not None
    return {
        "is_correct": is_correct,
        "correct_keys": correct_keys,
        "justification": exp.justification if exp else None,
        "progress_index": session.current_index,
        "total_questions": session.total_questions,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "finished": finished,
        "insight": result_snapshot["insight"]["live"],
    }

def compute_result(db: Session, session: ExamSession) -> dict:
    return _analyze_session(session, _get_session_rows(db, session.id))
