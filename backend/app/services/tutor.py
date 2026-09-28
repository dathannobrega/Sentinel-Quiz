"""AI tutor orchestration (contract §3).

Rules enforced here / in the route:

* only authenticated users (401 ``auth_required``);
* never while the exam session is unfinished, whatever its experience mode
  (409 ``tutor_unavailable_during_exam``);
* daily quota per user (``TUTOR_DAILY_QUOTA``, 429 ``tutor_quota_exceeded``) stored in
  the rate-limit store (memory or Redis);
* the official justification is only sent to the model after the question was
  answered in the session;
* provider failures are reported as a generic 502 ``tutor_upstream_error``.

The database work is done first and the connection is released before calling the
provider, so a slow Gemini call never holds a pooled connection (M-B5).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import ExamSession, Option, Question, SessionAnswer, SessionQuestion
from app.services.option_order import OptionMapping, split_keys
from app.services.reference_resolver import resolve_full_explanation_text


ALLOWED_TUTOR_MODES = frozenset({"help", "why_wrong", "review"})
MAX_TUTOR_MESSAGE_CHARS = 800
DEFAULT_TUTOR_MESSAGES = {
    "help": "Me ajude a entender esta questao e os conceitos envolvidos.",
    "why_wrong": "Explique por que minha resposta esta errada e como evitar esse erro.",
    "review": "Revisar a materia relacionada a esta questao.",
}


class TutorRequestError(ValueError):
    def __init__(self, status_code: int, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


@dataclass
class TutorContext:
    """Plain (detached) data needed to call the provider."""

    mode: str
    user_message: str
    question_prompt: str
    multi_select: bool
    options: list[dict[str, Any]] = field(default_factory=list)
    selected_keys: list[str] = field(default_factory=list)
    is_correct: Optional[bool] = None
    justification: Optional[str] = None
    # When set, the route answers with this message without calling the provider.
    short_circuit_message: Optional[str] = None
    short_circuit_blocked: bool = False


def ensure_tutor_allowed(session: ExamSession) -> None:
    if session.completed_at is None:
        raise TutorRequestError(
            409,
            "The AI tutor is not available while the exam is in progress.",
            code="tutor_unavailable_during_exam",
        )


def build_tutor_context(
    db: Session,
    *,
    session_id: str,
    question_id: str,
    mode: str | None,
    user_message: str | None,
) -> TutorContext:
    session_row = db.execute(
        select(SessionQuestion).where(
            SessionQuestion.session_id == session_id,
            SessionQuestion.question_id == question_id,
        )
    ).scalar_one_or_none()
    if not session_row:
        raise TutorRequestError(400, "Question does not belong to this session.")

    question = db.get(Question, question_id)
    if not question:
        raise TutorRequestError(404, "Question not found.")

    normalized_mode = (mode or "help").strip().lower()
    if normalized_mode not in ALLOWED_TUTOR_MODES:
        raise TutorRequestError(400, "Invalid mode.")

    message = (user_message or "").strip()
    if len(message) > MAX_TUTOR_MESSAGE_CHARS:
        raise TutorRequestError(400, "Message too long.")
    if not message:
        message = DEFAULT_TUTOR_MESSAGES[normalized_mode]

    option_rows = db.execute(
        select(Option.key, Option.text, Option.is_correct)
        .where(Option.question_id == question_id)
        .order_by(Option.key.asc())
    ).all()
    raw_options = [{"key": key, "text": text, "is_correct": ok} for (key, text, ok) in option_rows]
    # Show the model the options exactly as the learner saw them (per-session shuffle).
    mapping = OptionMapping.build(session_row.option_order_json, [item["key"] for item in raw_options])
    options = mapping.display_options(raw_options)

    answer = db.execute(
        select(SessionAnswer.selected_keys, SessionAnswer.is_correct)
        .where(SessionAnswer.session_id == session_id, SessionAnswer.question_id == question_id)
    ).first()
    selected_keys: list[str] = []
    is_correct: Optional[bool] = None
    if answer:
        selected_raw, ok = answer
        selected_keys = mapping.to_display(split_keys(selected_raw))
        is_correct = bool(ok)

    context = TutorContext(
        mode=normalized_mode,
        user_message=message,
        question_prompt=question.prompt,
        multi_select=bool(question.multi_select),
        options=options,
        selected_keys=selected_keys,
        is_correct=is_correct,
    )

    if normalized_mode == "why_wrong":
        if is_correct is None:
            context.short_circuit_message = (
                "Voce ainda nao respondeu essa questao. Responda e depois use 'Pq Errei!' para analisar o erro."
            )
            context.short_circuit_blocked = True
            return context
        if is_correct is True:
            context.short_circuit_message = (
                "Sua resposta esta correta. Posso revisar o conceito ou tirar outras duvidas sobre a questao."
            )
            return context

    # The official justification is only shared after the question was answered.
    if is_correct is not None:
        # Cited letters follow the learner's (shuffled) option keys, like the options above.
        context.justification = mapping.remap_text(resolve_full_explanation_text(db, question_id))
    return context


def tutor_quota_key(user_id: str, now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    return f"tutor:{user_id}:{current.strftime('%Y%m%d')}"


def seconds_until_utc_midnight(now: datetime | None = None) -> int:
    current = now or datetime.now(timezone.utc)
    seconds_today = current.hour * 3600 + current.minute * 60 + current.second
    return max(86400 - seconds_today, 1)


def tutor_daily_quota() -> int:
    return max(int(settings.tutor_daily_quota or 0), 0)
