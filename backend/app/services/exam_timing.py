"""Exam session configuration and timer/pause bookkeeping (split from quiz.py, M-C6)."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.core.clock import parse_iso_utc, utcnow
from app.models import ExamSession
from app.services.serialization import parse_selection_mix as _parse_selection_mix
from app.services.serialization import parse_session_payload as _parse_session_payload


DEFAULT_EXAM_SECONDS_PER_QUESTION = 75
MIN_EXAM_TIME_LIMIT_SECONDS = 300
DEFAULT_EXAM_PAUSE_LIMIT = 2
DEFAULT_EXAM_MAX_PAUSE_SECONDS = 300


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
    # Legacy values were naive UTC isoformat strings; always return aware UTC.
    return parse_iso_utc(value)


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
    reference_now = now or utcnow()
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
