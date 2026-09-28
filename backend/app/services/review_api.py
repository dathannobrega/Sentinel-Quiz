"""Read models for exam session history and post-exam review (moved out of api/routes.py)."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Exam, ExamSession, Explanation, Option, Question, SessionAnswer, SessionQuestion
from app.services.option_order import OptionMapping


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def parse_selection_mix(selection_mix_json: str | None) -> dict[str, int]:
    if not selection_mix_json:
        return {}
    try:
        payload = json.loads(selection_mix_json)
    except (TypeError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    raw_mix = payload.get("_selection_mix") if isinstance(payload.get("_selection_mix"), dict) else payload
    if not isinstance(raw_mix, dict):
        return {}
    cleaned: dict[str, int] = {}
    for key, value in raw_mix.items():
        label = str(key or "").strip()
        if not label or label.startswith("_"):
            continue
        try:
            cleaned[label] = max(int(value), 0)
        except (TypeError, ValueError):
            continue
    return cleaned


def serialize_session_history(session: ExamSession, exam_title: str | None) -> dict[str, Any]:
    total = session.total_questions
    score = (session.correct_count / total * 100.0) if total else 0.0
    return {
        "id": session.id,
        "exam_id": session.exam_id,
        "exam_title": exam_title,
        "created_at": iso(session.created_at),
        "completed_at": iso(session.completed_at),
        "selection_strategy": session.selection_strategy or "standard",
        "selection_mix": parse_selection_mix(session.selection_mix_json),
        "total_questions": total,
        "correct_count": session.correct_count,
        "wrong_count": session.wrong_count,
        "score_percent": round(score, 2),
    }


def list_completed_session_history(
    db: Session,
    *,
    owner_user_id: str | None,
    owner_client_key: str | None,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    stmt = (
        select(ExamSession, Exam.title)
        .outerjoin(Exam, Exam.id == ExamSession.exam_id)
        .where(ExamSession.completed_at.is_not(None))
        .order_by(ExamSession.completed_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if owner_user_id:
        stmt = stmt.where(ExamSession.user_id == owner_user_id)
    elif owner_client_key:
        stmt = stmt.where(ExamSession.user_id.is_(None), ExamSession.client_key == owner_client_key)
    else:
        return []
    return [serialize_session_history(session, exam_title) for session, exam_title in db.execute(stmt).all()]


def _parse_list(raw: str | None, *, dicts: bool = False) -> list | None:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, list):
        return None
    if dicts:
        return [item for item in parsed if isinstance(item, dict)]
    return [str(item).strip() for item in parsed if str(item).strip()]


def build_exam_review_questions(db: Session, session: ExamSession) -> list[dict[str, Any]]:
    q_rows = db.execute(
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
            SessionQuestion.option_order_json,
        )
        .join(Question, Question.id == SessionQuestion.question_id)
        .where(SessionQuestion.session_id == session.id)
        .order_by(SessionQuestion.position.asc())
    ).all()
    qids = [row[1] for row in q_rows]

    opt_rows: list = []
    exp_rows: list = []
    ans_rows: list = []
    if qids:
        opt_rows = db.execute(
            select(Option.question_id, Option.key, Option.text, Option.is_correct)
            .where(Option.question_id.in_(qids))
            .order_by(Option.question_id.asc(), Option.key.asc())
        ).all()
        exp_rows = db.execute(
            select(Explanation.question_id, Explanation.justification)
            .where(Explanation.question_id.in_(qids))
        ).all()
        ans_rows = db.execute(
            select(SessionAnswer.question_id, SessionAnswer.selected_keys, SessionAnswer.is_correct)
            .where(SessionAnswer.session_id == session.id)
        ).all()

    opt_map: dict[str, list[dict[str, Any]]] = {}
    for qid, key, text, is_correct in opt_rows:
        opt_map.setdefault(qid, []).append({"key": key, "text": text, "is_correct": is_correct})
    exp_map = {qid: justification for (qid, justification) in exp_rows}
    ans_map = {
        qid: {"selected_keys": (selected.split(",") if selected else []), "is_correct": ok}
        for (qid, selected, ok) in ans_rows
    }

    questions = []
    for _pos, qid, prompt, multi, domain, difficulty, certification, tags_json, citations_json, option_order_json in q_rows:
        raw_opts = opt_map.get(qid, [])
        # Present options/keys exactly as in this session (per-session shuffle, M-C1).
        mapping = OptionMapping.build(option_order_json, [o["key"] for o in raw_opts])
        opts = mapping.display_options(raw_opts)
        answer = ans_map.get(qid, {})
        questions.append({
            "id": qid,
            "prompt": prompt,
            "multi_select": multi,
            "domain": domain,
            "difficulty": difficulty,
            "certification": certification,
            "options": [{"key": o["key"], "text": o["text"]} for o in opts],
            "correct_keys": [o["key"] for o in opts if o["is_correct"]],
            "selected_keys": mapping.to_display(answer.get("selected_keys", [])),
            "is_correct": answer.get("is_correct"),
            "justification": mapping.remap_text(exp_map.get(qid)),
            "tags": _parse_list(tags_json),
            "citations": _parse_list(citations_json, dicts=True),
        })
    return questions


def build_exam_session_meta(db: Session, session: ExamSession) -> dict[str, Any]:
    exam = db.get(Exam, session.exam_id) if session.exam_id else None
    return serialize_session_history(session, exam.title if exam else None)
