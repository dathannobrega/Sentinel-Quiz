"""Sentinel Arena authoring: host policy, quiz/item CRUD, bank import and publishing.

Every mutation checks ``expected_version`` (optimistic lock) and bumps the quiz version,
so two editor tabs never silently overwrite each other (409 ``version_conflict``).
Publishing freezes content AND answer key into an immutable ``LiveQuizVersion``
(DC-14): later edits, or a new editorial version of a bank question, never change a
session that already ran.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.clock import utcnow
from app.core.config import settings
from app.core.errors import api_error
from app.models import (
    Explanation,
    LiveQuiz,
    LiveQuizItem,
    LiveQuizVersion,
    LiveSession,
    Option,
    Question,
    QuestionBank,
    User,
)
from app.schemas_live import THEME_KEYS
from app.services import licensing
from app.services import live_items as items_registry
from app.services.live_items import ItemInputError

DEFAULT_SETTINGS: dict[str, Any] = {
    "scoring": "speed",
    "reading_phase_s": 3,
    "grace_ms": 750,
    "streak_bonus": False,
    "show_live_distribution": False,
    "show_correct_on_device": True,
    "show_explanation": True,
    "leaderboard_every": 3,
    "music": True,
}


# ----------------------------------------------------------------------------- policy

def host_capability(user: User | None) -> tuple[bool, str | None]:
    if not settings.live_enabled:
        return False, "live_disabled"
    if user is None:
        return False, "auth_required"
    if user.role == "admin":
        return True, None
    policy = str(settings.live_host_policy or "allowlist").strip().lower()
    if policy == "all":
        return True, None
    if policy == "verified_users":
        return (True, None) if user.email_verified else (False, "email_not_verified")
    allowlist = {entry.strip().lower() for entry in settings.live_host_allowlist.split(",") if entry.strip()}
    if str(user.email or "").lower() in allowlist or str(user.id).lower() in allowlist:
        return True, None
    return False, "not_allowlisted"


def require_host(user: User | None) -> User:
    ok, reason = host_capability(user)
    if not ok:
        if reason == "live_disabled":
            raise api_error(404, "live_disabled", "Live quizzes are not enabled.")
        if reason == "auth_required":
            raise api_error(401, "auth_required", "Authentication required.")
        raise api_error(403, reason or "forbidden", "You cannot host live quizzes yet.")
    return user  # type: ignore[return-value]


def capabilities(user: User | None) -> dict[str, Any]:
    can_host, reason = host_capability(user)
    return {
        "enabled": bool(settings.live_enabled),
        "can_host": can_host,
        "reason": reason,
        "item_types": list(items_registry.LIVE_ITEM_TYPES),
        "themes": list(THEME_KEYS),
        "limits": {
            "max_participants": settings.live_max_participants,
            "max_items": settings.live_max_items,
            "prompt_max": items_registry.PROMPT_MAX,
            "option_max": items_registry.OPTION_MAX,
            "options_min": items_registry.OPTIONS_MIN,
            "options_max": items_registry.OPTIONS_MAX,
            "time_limit_min": items_registry.TIME_LIMIT_MIN,
            "time_limit_max": items_registry.TIME_LIMIT_MAX,
        },
    }


# ----------------------------------------------------------------------------- helpers

def merged_settings(current: dict | None, patch: dict | None) -> dict[str, Any]:
    result = dict(DEFAULT_SETTINGS)
    result.update({k: v for k, v in (current or {}).items() if k in DEFAULT_SETTINGS})
    result.update({k: v for k, v in (patch or {}).items() if k in DEFAULT_SETTINGS and v is not None})
    return result


def get_owned_quiz(db: Session, user: User, quiz_id: str, *, for_update: bool = False) -> LiveQuiz:
    stmt = select(LiveQuiz).where(LiveQuiz.id == quiz_id).options(selectinload(LiveQuiz.items))
    if for_update:
        stmt = stmt.with_for_update(of=LiveQuiz)
    quiz = db.execute(stmt).scalar_one_or_none()
    if quiz is None or quiz.archived_at is not None or quiz.owner_user_id != user.id:
        raise api_error(404, "quiz_not_found", "Quiz not found.")
    return quiz


def _check_version(quiz: LiveQuiz, expected_version: int) -> None:
    if int(expected_version) != int(quiz.version):
        exc = api_error(409, "version_conflict", "The quiz was changed elsewhere. Reload and try again.")
        exc.detail["current_version"] = quiz.version  # type: ignore[index]
        raise exc


def _touch(quiz: LiveQuiz) -> None:
    quiz.version = int(quiz.version or 0) + 1
    quiz.updated_at = utcnow()


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _item_error(exc: ItemInputError) -> Exception:
    error = api_error(422, "item_invalid", exc.message)
    error.detail["details"] = {"field": exc.field, "reason": exc.code}  # type: ignore[index]
    return error


# ----------------------------------------------------------------------------- serialization

def serialize_item(item: LiveQuizItem) -> dict[str, Any]:
    payload = item.payload_json or {}
    answer = item.answer_json or {}
    correct = set(answer.get("correct_keys") or [])
    return {
        "id": item.id,
        "position": item.position,
        "item_type": item.item_type,
        "prompt": item.prompt or "",
        "options": [
            {"key": o["key"], "text": o.get("text") or "", "correct": o["key"] in correct}
            for o in payload.get("options") or []
        ],
        "accepted_answers": list(answer.get("accepted_answers") or []),
        "allow_multiple": bool(payload.get("allow_multiple")),
        "all_or_nothing": bool(payload.get("all_or_nothing")),
        "body": payload.get("body"),
        "time_limit_s": item.time_limit_s,
        "points_multiplier": item.points_multiplier,
        "explanation": item.explanation,
        "presenter_notes": item.presenter_notes,
        "source_kind": item.source_kind,
        "source_question_id": item.source_question_id,
        "source_version_id": item.source_version_id,
        "license_scope": item.license_scope,
        "review_state": item.review_state,
        "domain": item.domain,
        "certification": item.certification,
        "difficulty": item.difficulty,
        "updated_at": _iso(item.updated_at),
    }


def _last_sessions(db: Session, quiz_ids: list[str]) -> dict[str, dict]:
    if not quiz_ids:
        return {}
    rows = db.execute(
        select(LiveSession.quiz_id, LiveSession.id, LiveSession.status, LiveSession.created_at)
        .where(LiveSession.quiz_id.in_(quiz_ids))
        .order_by(LiveSession.created_at.desc())
    ).all()
    result: dict[str, dict] = {}
    for quiz_id, session_id, status, created_at in rows:
        result.setdefault(quiz_id, {"id": session_id, "status": status, "created_at": _iso(created_at)})
    return result


def serialize_summary(quiz: LiveQuiz, *, item_count: int, last_session: dict | None) -> dict[str, Any]:
    return {
        "id": quiz.id,
        "title": quiz.title,
        "description": quiz.description,
        "theme_key": quiz.theme_key,
        "item_count": item_count,
        "version": quiz.version,
        "published_version_no": quiz.published_version_no,
        "has_unpublished_changes": quiz.published_at_version != quiz.version,
        "created_at": _iso(quiz.created_at),
        "updated_at": _iso(quiz.updated_at),
        "last_session": last_session,
    }


def serialize_detail(db: Session, quiz: LiveQuiz) -> dict[str, Any]:
    ordered = sorted(quiz.items, key=lambda item: item.position)
    data = serialize_summary(quiz, item_count=len(ordered), last_session=_last_sessions(db, [quiz.id]).get(quiz.id))
    data.update(
        {
            "language": quiz.language,
            "settings": merged_settings(quiz.settings_json, None),
            "items": [serialize_item(item) for item in ordered],
            "can_edit": True,
        }
    )
    return data


# ----------------------------------------------------------------------------- quiz CRUD

def list_quizzes(db: Session, user: User) -> list[dict[str, Any]]:
    quizzes = db.execute(
        select(LiveQuiz)
        .where(LiveQuiz.owner_user_id == user.id, LiveQuiz.archived_at.is_(None))
        .order_by(LiveQuiz.updated_at.desc())
    ).scalars().all()
    ids = [quiz.id for quiz in quizzes]
    counts = dict(
        db.execute(
            select(LiveQuizItem.quiz_id, func.count()).where(LiveQuizItem.quiz_id.in_(ids)).group_by(LiveQuizItem.quiz_id)
        ).all()
    ) if ids else {}
    last = _last_sessions(db, ids)
    return [serialize_summary(quiz, item_count=int(counts.get(quiz.id, 0)), last_session=last.get(quiz.id)) for quiz in quizzes]


def create_quiz(db: Session, user: User, *, title: str, description: str | None, language: str, theme_key: str, settings_patch: dict | None) -> LiveQuiz:
    now = utcnow()
    quiz = LiveQuiz(
        owner_user_id=user.id,
        title=title.strip(),
        description=(description or "").strip() or None,
        language=language,
        theme_key=theme_key,
        settings_json=merged_settings(None, settings_patch),
        version=1,
        created_at=now,
        updated_at=now,
    )
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def update_quiz(db: Session, user: User, quiz_id: str, *, expected_version: int, fields: dict[str, Any]) -> LiveQuiz:
    quiz = get_owned_quiz(db, user, quiz_id, for_update=True)
    _check_version(quiz, expected_version)
    if "title" in fields and fields["title"] is not None:
        quiz.title = str(fields["title"]).strip()
    if "description" in fields:
        quiz.description = (fields["description"] or "").strip() or None
    if fields.get("language"):
        quiz.language = fields["language"]
    if fields.get("theme_key"):
        quiz.theme_key = fields["theme_key"]
    if fields.get("settings") is not None:
        quiz.settings_json = merged_settings(quiz.settings_json, fields["settings"])
    _touch(quiz)
    db.commit()
    return get_owned_quiz(db, user, quiz_id)


def archive_quiz(db: Session, user: User, quiz_id: str) -> None:
    quiz = get_owned_quiz(db, user, quiz_id, for_update=True)
    quiz.archived_at = utcnow()
    db.commit()


def duplicate_quiz(db: Session, user: User, quiz_id: str) -> LiveQuiz:
    source = get_owned_quiz(db, user, quiz_id)
    now = utcnow()
    copy = LiveQuiz(
        owner_user_id=user.id,
        title=f"{source.title[:110]} (cópia)",
        description=source.description,
        language=source.language,
        theme_key=source.theme_key,
        settings_json=dict(source.settings_json or {}),
        version=1,
        forked_from_id=source.id,
        created_at=now,
        updated_at=now,
    )
    db.add(copy)
    db.flush()
    for item in sorted(source.items, key=lambda it: it.position):
        db.add(
            LiveQuizItem(
                quiz_id=copy.id,
                position=item.position,
                item_type=item.item_type,
                source_kind=item.source_kind,
                source_question_id=item.source_question_id,
                source_version_id=item.source_version_id,
                prompt=item.prompt,
                payload_json=json.loads(json.dumps(item.payload_json or {})),
                answer_json=json.loads(json.dumps(item.answer_json or {})),
                explanation=item.explanation,
                presenter_notes=item.presenter_notes,
                time_limit_s=item.time_limit_s,
                points_multiplier=item.points_multiplier,
                license_scope=item.license_scope,
                review_state=item.review_state,
                domain=item.domain,
                certification=item.certification,
                difficulty=item.difficulty,
                objective_code=item.objective_code,
                created_at=now,
                updated_at=now,
            )
        )
    db.commit()
    return get_owned_quiz(db, user, copy.id)


# ----------------------------------------------------------------------------- items

def _renumber(db: Session, ordered: list[LiveQuizItem]) -> None:
    """Assign 0..n-1 without tripping UNIQUE(quiz_id, position) mid-update."""
    for index, item in enumerate(ordered):
        item.position = -(index + 1)
    db.flush()
    for index, item in enumerate(ordered):
        item.position = index
    db.flush()


def _find_item(quiz: LiveQuiz, item_id: str) -> LiveQuizItem:
    for item in quiz.items:
        if item.id == item_id:
            return item
    raise api_error(404, "item_not_found", "Item not found.")


def _ensure_capacity(quiz: LiveQuiz, adding: int = 1) -> None:
    if len(quiz.items) + adding > settings.live_max_items:
        raise api_error(422, "too_many_items", f"A quiz can have at most {settings.live_max_items} items.")


def add_item(db: Session, user: User, quiz_id: str, *, expected_version: int, item_type: str, position: int | None, fields: dict[str, Any]) -> LiveQuiz:
    quiz = get_owned_quiz(db, user, quiz_id, for_update=True)
    _check_version(quiz, expected_version)
    _ensure_capacity(quiz)
    payload, answer = items_registry.default_payload(item_type)
    fields = dict(fields)
    fields.setdefault("time_limit_s", items_registry.DEFAULT_TIME_LIMIT.get(item_type))
    fields.setdefault("points_multiplier", 1 if item_type in items_registry.SCORED_TYPES else 0)
    try:
        values = items_registry.apply_write(item_type, fields, payload=payload, answer=answer)
    except ItemInputError as exc:
        raise _item_error(exc) from None
    now = utcnow()
    item = LiveQuizItem(
        quiz_id=quiz.id,
        position=len(quiz.items) + 1000,  # temporary, renumbered below
        item_type=item_type,
        source_kind="custom",
        prompt=values.pop("prompt", ""),
        license_scope=licensing.OWN,
        review_state="ok",
        created_at=now,
        updated_at=now,
        **values,
    )
    db.add(item)
    db.flush()
    ordered = sorted((it for it in quiz.items if it.id != item.id), key=lambda it: it.position)
    insert_at = len(ordered) if position is None else max(0, min(int(position), len(ordered)))
    ordered.insert(insert_at, item)
    _renumber(db, ordered)
    _touch(quiz)
    db.commit()
    return get_owned_quiz(db, user, quiz_id)


def update_item(db: Session, user: User, quiz_id: str, item_id: str, *, expected_version: int, item_type: str | None, fields: dict[str, Any]) -> LiveQuiz:
    quiz = get_owned_quiz(db, user, quiz_id, for_update=True)
    _check_version(quiz, expected_version)
    item = _find_item(quiz, item_id)
    payload, answer = item.payload_json or {}, item.answer_json or {}
    if item_type and item_type != item.item_type:
        if item.source_kind == "bank":
            raise api_error(422, "item_invalid", "Items from the question bank keep their type.")
        new_payload, new_answer = items_registry.default_payload(item_type)
        # Keep what still makes sense (options between option types, prompt always).
        if item_type in items_registry.OPTION_TYPES and item.item_type in items_registry.OPTION_TYPES and item_type != "true_false" and item.item_type != "true_false":
            new_payload["options"] = payload.get("options") or new_payload.get("options")
            if item_type != "poll":
                new_answer["correct_keys"] = answer.get("correct_keys") or []
                if item_type == "single_choice":
                    new_answer["correct_keys"] = new_answer["correct_keys"][:1]
        payload, answer = new_payload, new_answer
        item.item_type = item_type
        if item_type in items_registry.PASSIVE_TYPES or item_type == "poll":
            item.points_multiplier = 0
        elif item.points_multiplier == 0:
            item.points_multiplier = 1
        if item_type in items_registry.PASSIVE_TYPES:
            item.time_limit_s = None
        elif item.time_limit_s is None:
            item.time_limit_s = items_registry.DEFAULT_TIME_LIMIT.get(item_type)
    # Edited bank content keeps its provenance and licence: a reworded question is still
    # derived from the licensed source (PLANO §15.4).
    try:
        values = items_registry.apply_write(item.item_type, fields, payload=payload, answer=answer)
    except ItemInputError as exc:
        raise _item_error(exc) from None
    for key, value in values.items():
        setattr(item, key, value)
    item.updated_at = utcnow()
    _touch(quiz)
    db.commit()
    return get_owned_quiz(db, user, quiz_id)


def delete_item(db: Session, user: User, quiz_id: str, item_id: str, *, expected_version: int) -> LiveQuiz:
    quiz = get_owned_quiz(db, user, quiz_id, for_update=True)
    _check_version(quiz, expected_version)
    item = _find_item(quiz, item_id)
    remaining = sorted((it for it in quiz.items if it.id != item.id), key=lambda it: it.position)
    db.delete(item)
    db.flush()
    _renumber(db, remaining)
    _touch(quiz)
    db.commit()
    return get_owned_quiz(db, user, quiz_id)


def reorder_items(db: Session, user: User, quiz_id: str, *, expected_version: int, item_ids: list[str]) -> LiveQuiz:
    quiz = get_owned_quiz(db, user, quiz_id, for_update=True)
    _check_version(quiz, expected_version)
    by_id = {item.id: item for item in quiz.items}
    if len(item_ids) != len(by_id) or set(item_ids) != set(by_id):
        raise api_error(422, "reorder_mismatch", "item_ids must list every item of the quiz exactly once.")
    _renumber(db, [by_id[item_id] for item_id in item_ids])
    _touch(quiz)
    db.commit()
    return get_owned_quiz(db, user, quiz_id)


def mark_item_reviewed(db: Session, user: User, quiz_id: str, item_id: str, *, expected_version: int) -> LiveQuiz:
    quiz = get_owned_quiz(db, user, quiz_id, for_update=True)
    _check_version(quiz, expected_version)
    item = _find_item(quiz, item_id)
    item.review_state = "ok"
    item.updated_at = utcnow()
    _touch(quiz)
    db.commit()
    return get_owned_quiz(db, user, quiz_id)


# ----------------------------------------------------------------------------- bank

_TF_TRUE = {"verdadeiro", "true", "v", "certo"}


def _bank_rows(db: Session, question_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = list(dict.fromkeys(str(q) for q in question_ids))
    if not ids:
        return {}
    questions = db.execute(select(Question).where(Question.id.in_(ids))).scalars().all()
    options: dict[str, list[dict]] = {}
    for question_id, key, text, is_correct in db.execute(
        select(Option.question_id, Option.key, Option.text, Option.is_correct)
        .where(Option.question_id.in_(ids))
        .order_by(Option.question_id, Option.key)
    ).all():
        options.setdefault(question_id, []).append({"key": key, "text": text, "correct": bool(is_correct)})
    explanations = dict(
        db.execute(select(Explanation.question_id, Explanation.justification).where(Explanation.question_id.in_(ids))).all()
    )
    versions = dict(
        db.execute(
            select(QuestionBank.stable_question_id, QuestionBank.published_version_id).where(
                QuestionBank.stable_question_id.in_(ids)
            )
        ).all()
    )
    return {
        q.id: {
            "question": q,
            "options": options.get(q.id, []),
            "explanation": explanations.get(q.id),
            "version_id": versions.get(q.id),
        }
        for q in questions
    }


def _bank_reject_reason(row: dict[str, Any]) -> tuple[str | None, str | None]:
    question: Question = row["question"]
    if not question.is_active:
        return None, "inactive"
    if question.question_format != "mcq":
        return None, "unsupported_format"
    if not licensing.is_live_usable(question.license_scope):
        return None, "license_personal_use"
    return items_registry.bank_conversion(row["options"], bool(question.multi_select))


def _bank_item_values(row: dict[str, Any], item_type: str) -> dict[str, Any]:
    question: Question = row["question"]
    if item_type == "true_false":
        options, correct = [], []
        by_truth = sorted(
            row["options"],
            key=lambda o: 0 if items_registry.normalize_text_answer(o["text"]) in _TF_TRUE else 1,
        )
        for key, option in zip(items_registry.TRUE_FALSE_KEYS, by_truth):
            options.append({"key": key, "text": option["text"]})
            if option["correct"]:
                correct.append(key)
    else:
        options = [{"key": key, "text": o["text"]} for key, o in zip(items_registry.OPTION_KEYS, row["options"])]
        correct = [key for key, o in zip(items_registry.OPTION_KEYS, row["options"]) if o["correct"]]
    return {
        "item_type": item_type,
        "prompt": (question.prompt or "")[: items_registry.PROMPT_MAX],
        "payload_json": {"options": options, **({"all_or_nothing": False} if item_type == "multi_choice" else {})},
        "answer_json": {"correct_keys": correct},
        "explanation": (row["explanation"] or None),
        "time_limit_s": items_registry.DEFAULT_TIME_LIMIT.get(item_type),
        "points_multiplier": 1,
        "source_kind": "bank",
        "source_question_id": question.id,
        "source_version_id": row["version_id"],
        "license_scope": question.license_scope,
        "review_state": "needs_review" if question.needs_review else "ok",
        "domain": question.domain,
        "certification": question.certification,
        "difficulty": question.difficulty,
    }


def add_items_from_bank(db: Session, user: User, quiz_id: str, *, expected_version: int, question_ids: list[str]) -> tuple[LiveQuiz, list[dict]]:
    quiz = get_owned_quiz(db, user, quiz_id, for_update=True)
    _check_version(quiz, expected_version)
    rows = _bank_rows(db, question_ids)
    existing = {item.source_question_id for item in quiz.items if item.source_question_id}
    rejected: list[dict] = []
    accepted: list[dict] = []
    for question_id in dict.fromkeys(question_ids):
        row = rows.get(question_id)
        if row is None:
            rejected.append({"question_id": question_id, "reason": "not_found"})
            continue
        if question_id in existing:
            rejected.append({"question_id": question_id, "reason": "already_in_quiz"})
            continue
        item_type, reason = _bank_reject_reason(row)
        if item_type is None:
            rejected.append({"question_id": question_id, "reason": reason or "unsupported"})
            continue
        accepted.append(_bank_item_values(row, item_type))
    if accepted:
        _ensure_capacity(quiz, len(accepted))
        now = utcnow()
        start = len(quiz.items)
        for offset, values in enumerate(accepted):
            db.add(LiveQuizItem(quiz_id=quiz.id, position=start + offset, created_at=now, updated_at=now, **values))
        _touch(quiz)
    db.commit()
    return get_owned_quiz(db, user, quiz_id), rejected


def _bank_base_query():
    return select(Question).where(
        Question.is_active.is_(True),
        Question.question_format == "mcq",
        Question.license_scope != licensing.PERSONAL_USE,
    )


def bank_facets(db: Session) -> dict[str, Any]:
    base = _bank_base_query().subquery()
    certs = db.execute(
        select(base.c.certification, func.count()).group_by(base.c.certification).order_by(base.c.certification)
    ).all()
    domains = db.execute(
        select(base.c.certification, base.c.domain, func.count())
        .where(base.c.domain.is_not(None))
        .group_by(base.c.certification, base.c.domain)
        .order_by(base.c.certification, base.c.domain)
    ).all()
    return {
        "certifications": [
            {"id": cert, "label": cert, "count": int(count)} for cert, count in certs if cert
        ],
        "domains": [
            {"certification": cert, "domain": domain, "count": int(count)} for cert, domain, count in domains
        ],
    }


def bank_search(
    db: Session,
    *,
    q: str | None,
    certification: str | None,
    domain: str | None,
    difficulty: str | None,
    only_guest_eligible: bool,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    stmt = _bank_base_query()
    if certification:
        stmt = stmt.where(Question.certification == certification)
    if domain:
        stmt = stmt.where(Question.domain == domain)
    if difficulty:
        stmt = stmt.where(Question.difficulty == difficulty)
    if only_guest_eligible:
        scopes = licensing.allowed_scopes(allow_guests=True, platform_guest_ok=settings.live_platform_guest_ok)
        stmt = stmt.where(Question.license_scope.in_(sorted(scopes)))
    term = str(q or "").strip()
    if term:
        like = f"%{term.lower()[:100]}%"
        stmt = stmt.where(or_(func.lower(Question.prompt).like(like), func.lower(Question.id).like(like)))
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    page = db.execute(stmt.order_by(Question.id).limit(limit).offset(offset)).scalars().all()
    rows = _bank_rows(db, [question.id for question in page])
    result = []
    for question in page:
        row = rows[question.id]
        item_type, reason = _bank_reject_reason(row)
        result.append(
            {
                "question_id": question.id,
                "prompt": question.prompt,
                "options": [{"key": o["key"], "text": o["text"]} for o in row["options"]],
                "multi_select": bool(question.multi_select),
                "certification": question.certification,
                "domain": question.domain,
                "difficulty": question.difficulty,
                "license_scope": question.license_scope,
                "guest_eligible": licensing.is_guest_eligible(
                    question.license_scope, platform_guest_ok=settings.live_platform_guest_ok
                ),
                "convertible_to": item_type,
                "reject_reason": reason,
            }
        )
    return {"items": result, "total": total}


# ----------------------------------------------------------------------------- publish

def snapshot_of(item: LiveQuizItem) -> dict[str, Any]:
    return {
        "item_id": item.id,
        "position": item.position,
        "item_type": item.item_type,
        "prompt": item.prompt or "",
        "payload": json.loads(json.dumps(item.payload_json or {})),
        "answer": json.loads(json.dumps(item.answer_json or {})),
        "explanation": item.explanation,
        "presenter_notes": item.presenter_notes,
        "time_limit_s": item.time_limit_s,
        "points_multiplier": item.points_multiplier,
        "source_kind": item.source_kind,
        "source_question_id": item.source_question_id,
        "source_version_id": item.source_version_id,
        "license_scope": item.license_scope,
        "domain": item.domain,
        "certification": item.certification,
        "difficulty": item.difficulty,
        "objective_code": item.objective_code,
    }


def quiz_issues(quiz: LiveQuiz) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    ordered = sorted(quiz.items, key=lambda item: item.position)
    if not ordered:
        issues.append({"item_id": None, "position": None, "field": "items", "code": "empty", "message": "Add at least one item.", "severity": "error"})
    if ordered and not any(item.item_type in items_registry.INTERACTIVE_TYPES for item in ordered):
        issues.append({"item_id": None, "position": None, "field": "items", "code": "no_interactive", "message": "Add at least one question.", "severity": "error"})
    if len(ordered) > settings.live_max_items:
        issues.append({"item_id": None, "position": None, "field": "items", "code": "too_many_items", "message": "Too many items.", "severity": "error"})
    for item in ordered:
        for issue in items_registry.publish_issues(
            item.item_type,
            prompt=item.prompt or "",
            payload=item.payload_json or {},
            answer=item.answer_json or {},
            time_limit_s=item.time_limit_s,
        ):
            issues.append({"item_id": item.id, "position": item.position, **asdict(issue)})
        if item.review_state == "needs_review":
            issues.append(
                {"item_id": item.id, "position": item.position, "field": "review_state", "code": "needs_review",
                 "message": "Review this item before publishing.", "severity": "error"}
            )
        if item.license_scope == licensing.PERSONAL_USE:
            issues.append(
                {"item_id": item.id, "position": item.position, "field": "license_scope", "code": "license_personal_use",
                 "message": "This content is licensed for private study only.", "severity": "error"}
            )
    return issues


def _public_issue(issue: dict[str, Any]) -> dict[str, Any]:
    return {key: issue[key] for key in ("item_id", "position", "field", "code", "message")}


def publish_quiz(db: Session, user: User, quiz_id: str, *, expected_version: int) -> dict[str, Any]:
    quiz = get_owned_quiz(db, user, quiz_id, for_update=True)
    _check_version(quiz, expected_version)
    issues = quiz_issues(quiz)
    errors = [issue for issue in issues if issue["severity"] == "error"]
    if errors:
        exc = api_error(422, "quiz_invalid", "The quiz has problems that block publishing.")
        exc.detail["details"] = {"issues": [_public_issue(issue) for issue in errors]}  # type: ignore[index]
        raise exc
    snapshot = [snapshot_of(item) for item in sorted(quiz.items, key=lambda it: it.position)]
    canonical = json.dumps(
        {"items": snapshot, "settings": merged_settings(quiz.settings_json, None), "theme": quiz.theme_key},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    version_no = int(quiz.published_version_no or 0) + 1
    now = utcnow()
    db.add(
        LiveQuizVersion(
            quiz_id=quiz.id,
            version_no=version_no,
            title=quiz.title,
            theme_key=quiz.theme_key,
            settings_json=merged_settings(quiz.settings_json, None),
            items_snapshot_json=snapshot,
            snapshot_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
            published_by_user_id=user.id,
            published_at=now,
        )
    )
    quiz.published_version_no = version_no
    _touch(quiz)
    quiz.published_at_version = quiz.version
    db.commit()
    fresh = get_owned_quiz(db, user, quiz_id)
    return {
        "quiz": serialize_detail(db, fresh),
        "version_no": version_no,
        "published_at": _iso(now),
        "warnings": [_public_issue(issue) for issue in issues if issue["severity"] == "warning"],
    }


def latest_version(db: Session, quiz_id: str) -> LiveQuizVersion | None:
    return db.execute(
        select(LiveQuizVersion).where(LiveQuizVersion.quiz_id == quiz_id).order_by(LiveQuizVersion.version_no.desc()).limit(1)
    ).scalar_one_or_none()
