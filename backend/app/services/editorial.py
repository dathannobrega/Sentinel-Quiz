from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    EditorialAuditLog,
    Explanation,
    Option,
    Question,
    QuestionBank,
    QuestionVersion,
    QuestionVersionOption,
)


def _parse_text_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    return [str(item).strip() for item in payload if str(item).strip()]


def _parse_dict_list(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


def _json_or_none(value: Any) -> str | None:
    if not value:
        return None
    return json.dumps(value, ensure_ascii=False)


def _clean_payload(payload: dict[str, Any]) -> dict[str, Any]:
    options = []
    for item in payload.get("options") or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip().upper()
        text = str(item.get("text") or "").strip()
        if not key or not text:
            continue
        options.append({
            "key": key,
            "text": text,
            "is_correct": bool(item.get("is_correct")),
        })
    options.sort(key=lambda item: item["key"])

    tags = [str(item).strip() for item in (payload.get("tags") or []) if str(item).strip()]
    citations = [item for item in (payload.get("citations") or []) if isinstance(item, dict)]

    return {
        "id": str(payload.get("id") or "").strip(),
        "exam_id": str(payload.get("exam_id") or "").strip(),
        "prompt": str(payload.get("prompt") or "").strip(),
        "multi_select": bool(payload.get("multi_select")),
        "domain": str(payload.get("domain") or "").strip() or None,
        "difficulty": str(payload.get("difficulty") or "").strip() or None,
        "certification": str(payload.get("certification") or "").strip() or None,
        "tags": tags,
        "citations": citations,
        "options": options,
        "justification": str(payload.get("justification") or "").strip() or None,
        "change_summary": str(payload.get("change_summary") or "").strip() or None,
    }


def _question_payload_from_projection(db: Session, question_id: str) -> dict[str, Any] | None:
    question = db.get(Question, question_id)
    if not question:
        return None

    explanation = db.get(Explanation, question_id)
    options = db.execute(
        select(Option)
        .where(Option.question_id == question_id)
        .order_by(Option.key.asc())
    ).scalars().all()

    return {
        "id": question.id,
        "exam_id": question.exam_id,
        "prompt": question.prompt,
        "multi_select": question.multi_select,
        "domain": question.domain,
        "difficulty": question.difficulty,
        "certification": question.certification,
        "tags": _parse_text_list(question.tags_json),
        "citations": _parse_dict_list(question.citations_json),
        "options": [
            {
                "key": option.key,
                "text": option.text,
                "is_correct": option.is_correct,
            }
            for option in options
        ],
        "justification": explanation.justification if explanation else None,
        "change_summary": None,
    }


def _question_payload_from_version(version: QuestionVersion) -> dict[str, Any]:
    return {
        "id": version.question_bank_id,
        "exam_id": version.exam_id,
        "prompt": version.prompt,
        "multi_select": version.multi_select,
        "domain": version.domain,
        "difficulty": version.difficulty,
        "certification": version.certification,
        "tags": _parse_text_list(version.tags_json),
        "citations": _parse_dict_list(version.citations_json),
        "options": [
            {
                "key": option.key,
                "text": option.text,
                "is_correct": option.is_correct,
            }
            for option in sorted(version.options, key=lambda item: item.key)
        ],
        "justification": version.justification,
        "change_summary": version.change_summary,
    }


def _get_question_bank(db: Session, question_id: str) -> QuestionBank | None:
    return db.get(QuestionBank, question_id)


def _get_version(db: Session, version_id: int | None) -> QuestionVersion | None:
    if not version_id:
        return None
    return db.get(QuestionVersion, version_id)


def _next_version_number(db: Session, question_id: str) -> int:
    stmt = select(func.max(QuestionVersion.version_number)).where(QuestionVersion.question_bank_id == question_id)
    current = db.execute(stmt).scalar_one_or_none()
    return int(current or 0) + 1


def _write_audit_log(
    db: Session,
    *,
    question_id: str | None,
    version_id: int | None,
    action: str,
    actor_user_id: str | None,
    actor_role: str | None,
    reason: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db.add(
        EditorialAuditLog(
            question_bank_id=question_id,
            question_version_id=version_id,
            actor_user_id=actor_user_id,
            actor_role=actor_role,
            action=action,
            reason=reason,
            metadata_json=_json_or_none(metadata),
        )
    )


def _replace_version_fields(
    version: QuestionVersion,
    payload: dict[str, Any],
    *,
    actor_user_id: str | None,
    preserve_status: bool = True,
) -> None:
    version.exam_id = payload["exam_id"]
    version.prompt = payload["prompt"]
    version.multi_select = bool(payload["multi_select"])
    version.domain = payload["domain"]
    version.difficulty = payload["difficulty"]
    version.certification = payload["certification"]
    version.tags_json = _json_or_none(payload.get("tags"))
    version.citations_json = _json_or_none(payload.get("citations"))
    version.justification = payload.get("justification")
    version.change_summary = payload.get("change_summary")
    version.updated_by_user_id = actor_user_id
    if not preserve_status:
        version.status = "draft"
        version.review_notes = None


def _replace_version_options(
    db: Session,
    version: QuestionVersion,
    options: list[dict[str, Any]],
) -> None:
    for item in list(version.options):
        db.delete(item)
    db.flush()

    for item in options:
        db.add(
            QuestionVersionOption(
                version_id=version.id,
                key=item["key"],
                text=item["text"],
                is_correct=bool(item["is_correct"]),
            )
        )
    db.flush()
    db.refresh(version)


def _create_version(
    db: Session,
    *,
    question_id: str,
    payload: dict[str, Any],
    status: str,
    actor_user_id: str | None,
    approved_by_user_id: str | None = None,
    published_at: datetime | None = None,
) -> QuestionVersion:
    version = QuestionVersion(
        question_bank_id=question_id,
        version_number=_next_version_number(db, question_id),
        status=status,
        exam_id=payload["exam_id"],
        prompt=payload["prompt"],
        multi_select=bool(payload["multi_select"]),
        domain=payload["domain"],
        difficulty=payload["difficulty"],
        certification=payload["certification"],
        tags_json=_json_or_none(payload.get("tags")),
        citations_json=_json_or_none(payload.get("citations")),
        justification=payload.get("justification"),
        change_summary=payload.get("change_summary"),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
        approved_by_user_id=approved_by_user_id,
        published_at=published_at,
    )
    db.add(version)
    db.flush()

    for item in payload.get("options") or []:
        db.add(
            QuestionVersionOption(
                version_id=version.id,
                key=item["key"],
                text=item["text"],
                is_correct=bool(item["is_correct"]),
            )
        )
    db.flush()
    db.refresh(version)
    return version


def _ensure_bank_seeded_from_projection(
    db: Session,
    question_id: str,
) -> QuestionBank | None:
    bank = _get_question_bank(db, question_id)
    if bank:
        if bank.published_version_id:
            return bank
        published_payload = _question_payload_from_projection(db, question_id)
        if not published_payload:
            return bank
        seeded_version = _create_version(
            db,
            question_id=question_id,
            payload=published_payload,
            status="published",
            actor_user_id=None,
            approved_by_user_id=None,
            published_at=datetime.utcnow(),
        )
        bank.published_version_id = seeded_version.id
        bank.review_status = "published"
        _write_audit_log(
            db,
            question_id=question_id,
            version_id=seeded_version.id,
            action="seed_published",
            actor_user_id=None,
            actor_role="system",
            metadata={"version_number": seeded_version.version_number},
        )
        db.flush()
        return bank

    published_payload = _question_payload_from_projection(db, question_id)
    if not published_payload:
        return None

    bank = QuestionBank(
        stable_question_id=question_id,
        review_status="published",
    )
    db.add(bank)
    db.flush()

    seeded_version = _create_version(
        db,
        question_id=question_id,
        payload=published_payload,
        status="published",
        actor_user_id=None,
        approved_by_user_id=None,
        published_at=datetime.utcnow(),
    )
    bank.published_version_id = seeded_version.id
    _write_audit_log(
        db,
        question_id=question_id,
        version_id=seeded_version.id,
        action="seed_published",
        actor_user_id=None,
        actor_role="system",
        metadata={"version_number": seeded_version.version_number},
    )
    db.flush()
    return bank


def _ensure_editable_bank(
    db: Session,
    question_id: str,
    *,
    actor_user_id: str | None,
) -> QuestionBank:
    bank = _ensure_bank_seeded_from_projection(db, question_id)
    if bank:
        if actor_user_id and not bank.created_by_user_id:
            bank.created_by_user_id = actor_user_id
        return bank

    bank = QuestionBank(
        stable_question_id=question_id,
        review_status="draft",
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(bank)
    db.flush()
    return bank


def _sync_projection_from_version(
    db: Session,
    question_id: str,
    version: QuestionVersion,
) -> None:
    projection = db.get(Question, question_id)
    if not projection:
        projection = Question(
            id=question_id,
            exam_id=version.exam_id,
            prompt=version.prompt,
            multi_select=version.multi_select,
            domain=version.domain,
            difficulty=version.difficulty,
            certification=version.certification,
            tags_json=version.tags_json,
            citations_json=version.citations_json,
        )
        db.add(projection)
    else:
        projection.exam_id = version.exam_id
        projection.prompt = version.prompt
        projection.multi_select = version.multi_select
        projection.domain = version.domain
        projection.difficulty = version.difficulty
        projection.certification = version.certification
        projection.tags_json = version.tags_json
        projection.citations_json = version.citations_json

    if projection.options:
        for item in list(projection.options):
            db.delete(item)
    db.flush()

    for item in sorted(version.options, key=lambda option: option.key):
        db.add(
            Option(
                question_id=question_id,
                key=item.key,
                text=item.text,
                is_correct=item.is_correct,
            )
        )

    explanation = db.get(Explanation, question_id)
    if not explanation:
        db.add(Explanation(question_id=question_id, justification=version.justification))
    else:
        explanation.justification = version.justification
    db.flush()


def _serialize_version_summary(bank: QuestionBank, version: QuestionVersion) -> dict[str, Any]:
    correct_count = sum(1 for item in version.options if item.is_correct)
    return {
        "id": version.id,
        "question_id": bank.stable_question_id,
        "version_number": version.version_number,
        "status": version.status,
        "change_summary": version.change_summary,
        "review_notes": version.review_notes,
        "created_at": version.created_at.isoformat() if version.created_at else None,
        "updated_at": version.updated_at.isoformat() if version.updated_at else None,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "option_count": len(version.options),
        "correct_count": correct_count,
        "is_current_draft": bank.draft_version_id == version.id,
        "is_current_published": bank.published_version_id == version.id,
    }


def build_admin_question_document(db: Session, question_id: str) -> dict[str, Any] | None:
    bank = _ensure_bank_seeded_from_projection(db, question_id)
    if bank:
        target_version = _get_version(db, bank.draft_version_id) or _get_version(db, bank.published_version_id)
        if target_version:
            payload = _question_payload_from_version(target_version)
            return {
                "id": payload["id"],
                "exam_id": payload["exam_id"],
                "prompt": payload["prompt"],
                "multi_select": payload["multi_select"],
                "domain": payload["domain"],
                "difficulty": payload["difficulty"],
                "certification": payload["certification"],
                "tags": payload["tags"],
                "citations": payload["citations"],
                "options": payload["options"],
                "correct_keys": [item["key"] for item in payload["options"] if item["is_correct"]],
                "justification": payload["justification"],
                "change_summary": payload.get("change_summary"),
                "editorial_status": bank.review_status,
                "loaded_from": "draft" if bank.draft_version_id == target_version.id else "published",
                "version_id": target_version.id,
                "version_number": target_version.version_number,
                "published_version_number": _get_version(db, bank.published_version_id).version_number if bank.published_version_id else None,
                "draft_version_number": _get_version(db, bank.draft_version_id).version_number if bank.draft_version_id else None,
            }

    payload = _question_payload_from_projection(db, question_id)
    if not payload:
        return None
    return {
        "id": payload["id"],
        "exam_id": payload["exam_id"],
        "prompt": payload["prompt"],
        "multi_select": payload["multi_select"],
        "domain": payload["domain"],
        "difficulty": payload["difficulty"],
        "certification": payload["certification"],
        "tags": payload["tags"],
        "citations": payload["citations"],
        "options": payload["options"],
        "correct_keys": [item["key"] for item in payload["options"] if item["is_correct"]],
        "justification": payload["justification"],
        "change_summary": None,
        "editorial_status": "published",
        "loaded_from": "published",
        "version_id": None,
        "version_number": None,
        "published_version_number": None,
        "draft_version_number": None,
    }


def list_question_versions(db: Session, question_id: str) -> list[dict[str, Any]]:
    bank = _ensure_bank_seeded_from_projection(db, question_id)
    if not bank:
        return []

    versions = db.execute(
        select(QuestionVersion)
        .where(QuestionVersion.question_bank_id == question_id)
        .order_by(QuestionVersion.version_number.desc(), QuestionVersion.id.desc())
    ).scalars().all()

    return [_serialize_version_summary(bank, version) for version in versions]


def list_editorial_audit_logs(
    db: Session,
    *,
    question_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    stmt = (
        select(EditorialAuditLog)
        .order_by(EditorialAuditLog.created_at.desc(), EditorialAuditLog.id.desc())
        .limit(limit)
    )
    if question_id:
        stmt = stmt.where(EditorialAuditLog.question_bank_id == question_id)

    rows = db.execute(stmt).scalars().all()
    return [
        {
            "id": row.id,
            "question_id": row.question_bank_id,
            "question_version_id": row.question_version_id,
            "actor_user_id": row.actor_user_id,
            "actor_role": row.actor_role,
            "action": row.action,
            "reason": row.reason,
            "metadata": json.loads(row.metadata_json) if row.metadata_json else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


def get_question_bank_status(db: Session, question_id: str) -> dict[str, Any] | None:
    bank = _ensure_bank_seeded_from_projection(db, question_id)
    if not bank:
        return None

    published_version = _get_version(db, bank.published_version_id)
    draft_version = _get_version(db, bank.draft_version_id)
    return {
        "question_id": bank.stable_question_id,
        "editorial_status": bank.review_status,
        "published_version_id": bank.published_version_id,
        "draft_version_id": bank.draft_version_id,
        "published_version_number": published_version.version_number if published_version else None,
        "draft_version_number": draft_version.version_number if draft_version else None,
        "updated_at": bank.updated_at.isoformat() if bank.updated_at else None,
    }


def save_question_draft(
    db: Session,
    payload: dict[str, Any],
    *,
    actor_user_id: str | None,
    actor_role: str | None,
) -> dict[str, Any]:
    clean = _clean_payload(payload)
    if not clean["id"]:
        raise ValueError("Question ID is required.")

    bank = _ensure_editable_bank(db, clean["id"], actor_user_id=actor_user_id)
    current_draft = _get_version(db, bank.draft_version_id)

    if current_draft and current_draft.question_bank_id == clean["id"]:
        _replace_version_fields(current_draft, clean, actor_user_id=actor_user_id, preserve_status=False)
        _replace_version_options(db, current_draft, clean["options"])
        version = current_draft
        action = "draft_updated"
    else:
        version = _create_version(
            db,
            question_id=clean["id"],
            payload=clean,
            status="draft",
            actor_user_id=actor_user_id,
        )
        bank.draft_version_id = version.id
        action = "draft_saved"

    bank.review_status = "draft"
    bank.updated_by_user_id = actor_user_id
    db.flush()

    _write_audit_log(
        db,
        question_id=clean["id"],
        version_id=version.id,
        action=action,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        reason=clean.get("change_summary"),
        metadata={
            "version_number": version.version_number,
            "status": version.status,
        },
    )

    return {
        "ok": True,
        "id": clean["id"],
        "status": "draft",
        "version_id": version.id,
        "version_number": version.version_number,
    }


def submit_question_for_review(
    db: Session,
    question_id: str,
    *,
    actor_user_id: str | None,
    actor_role: str | None,
    reason: str | None = None,
) -> dict[str, Any]:
    bank = _ensure_editable_bank(db, question_id, actor_user_id=actor_user_id)
    version = _get_version(db, bank.draft_version_id)
    if not version:
        raise ValueError("No draft version available to submit.")

    version.status = "in_review"
    version.review_notes = reason or version.review_notes
    version.updated_by_user_id = actor_user_id
    bank.review_status = "in_review"
    bank.updated_by_user_id = actor_user_id
    db.flush()

    _write_audit_log(
        db,
        question_id=question_id,
        version_id=version.id,
        action="review_requested",
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        reason=reason,
        metadata={"version_number": version.version_number},
    )

    return {
        "ok": True,
        "id": question_id,
        "status": "in_review",
        "version_id": version.id,
        "version_number": version.version_number,
    }


def publish_question(
    db: Session,
    question_id: str,
    *,
    actor_user_id: str | None,
    actor_role: str | None,
    reason: str | None = None,
    version_id: int | None = None,
) -> dict[str, Any]:
    bank = _ensure_editable_bank(db, question_id, actor_user_id=actor_user_id)
    version = _get_version(db, version_id or bank.draft_version_id or bank.published_version_id)
    if not version or version.question_bank_id != question_id:
        raise ValueError("Target version not found.")

    previous_published = _get_version(db, bank.published_version_id)
    if previous_published and previous_published.id != version.id:
        previous_published.status = "archived"
        previous_published.updated_by_user_id = actor_user_id

    version.status = "published"
    version.approved_by_user_id = actor_user_id
    version.published_at = datetime.utcnow()
    version.updated_by_user_id = actor_user_id

    bank.published_version_id = version.id
    if bank.draft_version_id == version.id:
        bank.draft_version_id = None
    bank.review_status = "published"
    bank.updated_by_user_id = actor_user_id

    _sync_projection_from_version(db, question_id, version)
    db.flush()

    _write_audit_log(
        db,
        question_id=question_id,
        version_id=version.id,
        action="published",
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        reason=reason or version.change_summary,
        metadata={"version_number": version.version_number},
    )

    return {
        "ok": True,
        "id": question_id,
        "status": "published",
        "version_id": version.id,
        "version_number": version.version_number,
    }


def rollback_question_to_version(
    db: Session,
    question_id: str,
    target_version_id: int,
    *,
    actor_user_id: str | None,
    actor_role: str | None,
    reason: str | None = None,
) -> dict[str, Any]:
    bank = _ensure_editable_bank(db, question_id, actor_user_id=actor_user_id)
    target = _get_version(db, target_version_id)
    if not target or target.question_bank_id != question_id:
        raise ValueError("Target version not found.")

    cloned_payload = _question_payload_from_version(target)
    cloned_payload["change_summary"] = reason or f"Rollback para a versao {target.version_number}"

    new_version = _create_version(
        db,
        question_id=question_id,
        payload=cloned_payload,
        status="published",
        actor_user_id=actor_user_id,
        approved_by_user_id=actor_user_id,
        published_at=datetime.utcnow(),
    )

    previous_published = _get_version(db, bank.published_version_id)
    if previous_published and previous_published.id != new_version.id:
        previous_published.status = "archived"
        previous_published.updated_by_user_id = actor_user_id

    bank.published_version_id = new_version.id
    bank.draft_version_id = None
    bank.review_status = "published"
    bank.updated_by_user_id = actor_user_id

    _sync_projection_from_version(db, question_id, new_version)
    db.flush()

    _write_audit_log(
        db,
        question_id=question_id,
        version_id=new_version.id,
        action="rolled_back",
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        reason=reason,
        metadata={
            "rolled_back_from_version_id": target.id,
            "rolled_back_from_version_number": target.version_number,
            "new_version_number": new_version.version_number,
        },
    )

    return {
        "ok": True,
        "id": question_id,
        "status": "published",
        "version_id": new_version.id,
        "version_number": new_version.version_number,
    }


def delete_question_with_history(
    db: Session,
    question_id: str,
    *,
    actor_user_id: str | None,
    actor_role: str | None,
    reason: str | None = None,
) -> dict[str, Any]:
    bank = _ensure_bank_seeded_from_projection(db, question_id)
    projection = db.get(Question, question_id)
    if not bank and not projection:
        raise ValueError("Question not found.")

    version_id = bank.published_version_id if bank else None
    _write_audit_log(
        db,
        question_id=question_id,
        version_id=version_id,
        action="deleted",
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        reason=reason,
    )

    if bank:
        db.delete(bank)
    if projection:
        db.delete(projection)
    db.flush()

    return {
        "ok": True,
        "id": question_id,
        "status": "deleted",
    }
