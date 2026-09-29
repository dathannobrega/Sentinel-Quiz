"""PBQ runtime glue: serving, answering, feedback and review of performance-based questions.

Grading rules live in :mod:`app.services.pbq_grading` (pure functions); this module
reads/writes the database columns (``Question.pbq_payload_json``/``pbq_answer_json``,
``*_session_questions.pbq_order_json``, ``session_answers``/``study_attempts``
``response_json``/``score``) and shapes the API payloads.

API shapes (exam and study routes):

* question payload: ``format: "mcq" | "pbq"``; for PBQ ``options: []`` and
  ``pbq: {title, scenario, exhibits, tasks}`` (session shuffle applied, no solutions).
* answer input: ``pbq_response: {task_id: response}`` (``selected_keys`` empty).
* feedback: ``format``, ``score`` (0..1), ``points_earned``, ``points_possible``,
  ``is_correct`` (score == 1), ``task_results: [{task_id, type, weight, score,
  is_correct}]`` and - only when correctness may be revealed - ``pbq_solution``,
  ``pbq_explanations`` (+ ``pbq_item_explanations``).
"""
from __future__ import annotations

import json
import random
from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Question
from app.services.pbq_grading import (
    MAX_PBQ_COUNT,
    PBQError,
    build_session_order,
    grade_response,
    parse_json_object,
    render_public_payload,
    sanitize_response,
    serialize_session_order,
    solutions_and_explanations,
)

PBQ_FORMAT = "pbq"
MCQ_FORMAT = "mcq"

__all__ = [
    "MAX_PBQ_COUNT",
    "MCQ_FORMAT",
    "PBQ_FORMAT",
    "PBQError",
    "build_pbq_orders",
    "empty_pbq_feedback",
    "grade_pbq_answer",
    "is_pbq",
    "pbq_feedback_fields",
    "pbq_question_view",
    "pbq_review_fields",
    "question_formats",
]


def is_pbq(question: Question | None) -> bool:
    return bool(question is not None and question.question_format == PBQ_FORMAT)


def question_formats(db: Session, question_ids: Iterable[str]) -> dict[str, str]:
    ids = [qid for qid in dict.fromkeys(question_ids) if qid]
    if not ids:
        return {}
    return {
        qid: fmt or MCQ_FORMAT
        for qid, fmt in db.execute(select(Question.id, Question.question_format).where(Question.id.in_(ids))).all()
    }


def _public(question: Question) -> dict[str, Any]:
    return parse_json_object(question.pbq_payload_json)


def _answer(question: Question) -> dict[str, Any]:
    return parse_json_object(question.pbq_answer_json)


def build_pbq_orders(
    db: Session,
    question_ids: Iterable[str],
    rng: Optional[random.Random] = None,
) -> dict[str, Optional[str]]:
    """``{question_id: pbq_order_json}`` for the PBQs being added to a session."""
    ids = [qid for qid in dict.fromkeys(question_ids) if qid]
    if not ids:
        return {}
    rows = db.execute(
        select(Question.id, Question.pbq_payload_json).where(
            Question.id.in_(ids), Question.question_format == PBQ_FORMAT
        )
    ).all()
    return {qid: serialize_session_order(build_session_order(parse_json_object(raw), rng)) for qid, raw in rows}


def pbq_question_view(question: Question, pbq_order_json: Optional[str]) -> dict[str, Any]:
    """Format fields of a served question (``format``/``options``/``pbq``)."""
    if not is_pbq(question):
        return {"format": MCQ_FORMAT}
    return {
        "format": PBQ_FORMAT,
        "options": [],
        "multi_select": False,
        "pbq": render_public_payload(_public(question), parse_json_object(pbq_order_json)),
    }


def grade_pbq_answer(question: Question, response: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """``(sanitized response, grading)``; raises :class:`PBQError` on invalid input."""
    public = _public(question)
    if not public.get("tasks"):
        raise PBQError("Performance-based question has no tasks.")
    clean = sanitize_response(public, response)
    return clean, grade_response(public, _answer(question), clean)


def dump_response(response: dict[str, Any]) -> str:
    return json.dumps(response, ensure_ascii=False, sort_keys=True)


def load_response(raw: Optional[str]) -> dict[str, Any]:
    return parse_json_object(raw)


def pbq_feedback_fields(question: Question, grading: dict[str, Any], *, reveal: bool) -> dict[str, Any]:
    """Feedback keys of a graded PBQ answer (solutions only when ``reveal``)."""
    fields: dict[str, Any] = {
        "format": PBQ_FORMAT,
        "score": grading["score"],
        "points_earned": grading["points_earned"],
        "points_possible": grading["points_possible"],
        "task_results": grading["task_results"],
        "pbq_solution": None,
        "pbq_explanations": None,
        "pbq_item_explanations": None,
    }
    if reveal:
        solutions, explanations, per_item = solutions_and_explanations(_answer(question))
        fields["pbq_solution"] = solutions
        fields["pbq_explanations"] = explanations
        fields["pbq_item_explanations"] = per_item or None
    return fields


def empty_pbq_feedback() -> dict[str, Any]:
    """Feedback keys for exam_day mode (nothing that reveals correctness)."""
    return {
        "format": PBQ_FORMAT,
        "score": None,
        "points_earned": None,
        "points_possible": None,
        "task_results": None,
        "pbq_solution": None,
        "pbq_explanations": None,
        "pbq_item_explanations": None,
    }


def pbq_review_fields(
    question: Question,
    *,
    pbq_order_json: Optional[str],
    response_json: Optional[str],
    answered: bool,
    stored_score: Optional[float] = None,
) -> dict[str, Any]:
    """Review keys (completed sessions): payload, learner response, grading and solutions."""
    if not is_pbq(question):
        return {"format": MCQ_FORMAT}
    response = load_response(response_json)
    public = _public(question)
    grading = grade_response(public, _answer(question), response) if answered else None
    solutions, explanations, per_item = solutions_and_explanations(_answer(question))
    return {
        "format": PBQ_FORMAT,
        "options": [],
        "correct_keys": [],
        "selected_keys": [],
        "pbq": render_public_payload(public, parse_json_object(pbq_order_json)),
        "pbq_response": response if answered else None,
        # The score recorded when the learner answered wins over a re-grade (the
        # answer key may have been edited since).
        "score": (stored_score if stored_score is not None else grading["score"]) if grading else None,
        "points_earned": grading["points_earned"] if grading else None,
        "points_possible": grading["points_possible"] if grading else float(_answer(question).get("points") or 1.0),
        "task_results": grading["task_results"] if grading else None,
        "pbq_solution": solutions,
        "pbq_explanations": explanations,
        "pbq_item_explanations": per_item or None,
    }
