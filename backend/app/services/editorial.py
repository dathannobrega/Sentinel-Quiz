from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import (
    QUESTION_DEACTIVATED_DELETED,
    DomainBlueprint,
    DomainCatalog,
    EditorialAuditLog,
    Explanation,
    Option,
    Question,
    QuestionBank,
    QuestionReference,
    QuestionVersion,
    QuestionVersionOption,
)
from app.services.admin_serialization import json_or_none as _json_or_none
from app.services.admin_serialization import parse_json
from app.services.admin_serialization import parse_dict_list as _parse_dict_list
from app.services.admin_serialization import parse_text_list as _parse_text_list
from app.services.question_quality import (
    assess_question_quality,
    is_fallback_rationale,
    json_text_list,
    normalize_difficulty,
    normalize_editorial_payload,
)

# import_hash markers for versions that predate provenance tracking (migration 0014).
LEGACY_IMPORT_MARKERS = {"legacy-import", "seeded-projection"}


def _payload_signature(payload: dict[str, Any]) -> str:
    normalized = normalize_editorial_payload(payload)
    normalized_options = sorted(
        list(normalized.get("options") or []),
        key=lambda item: str(item.get("key") or "").upper(),
    )
    normalized_citations = sorted(
        list(normalized.get("citations") or []),
        key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True),
    )
    signature_payload = {
        "id": normalized.get("id"),
        "exam_id": normalized.get("exam_id"),
        "prompt": normalized.get("prompt"),
        "multi_select": bool(normalized.get("multi_select")),
        "domain": normalized.get("domain"),
        "difficulty": normalized.get("difficulty"),
        "certification": normalized.get("certification"),
        "subject": normalized.get("subject"),
        "subtopic": normalized.get("subtopic"),
        "subdomain": normalized.get("subdomain"),
        "objective_code": normalized.get("objective_code"),
        "blueprint_code": normalized.get("blueprint_code"),
        "keywords": normalized.get("keywords") or [],
        "trap_patterns": normalized.get("trap_patterns") or [],
        "question_format": normalized.get("question_format"),
        "tags": normalized.get("tags") or [],
        "citations": normalized_citations,
        "options": normalized_options,
        "justification": normalized.get("justification"),
        "correct_rationale": normalized.get("correct_rationale"),
        "incorrect_rationales": normalized.get("incorrect_rationales") or [],
        "avg_time_seconds": normalized.get("avg_time_seconds"),
        "global_accuracy_percent": normalized.get("global_accuracy_percent"),
    }
    return json.dumps(signature_payload, ensure_ascii=False, sort_keys=True)


def _signature_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(_payload_signature(payload).encode("utf-8")).hexdigest()


def _quality_summary(quality: dict[str, Any]) -> dict[str, Any]:
    return {
        "blocking_issues": list(quality.get("blocking_issues") or []),
        "warnings": list(quality.get("warnings") or []),
        "field_status": dict(quality.get("field_status") or {}),
        "completeness_score": float(quality.get("completeness_score") or 0.0),
        "is_publish_ready": bool(quality.get("is_publish_ready")),
        "blueprint": dict(quality.get("blueprint") or {}),
    }


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

    normalized = {
        "id": str(payload.get("id") or "").strip(),
        "exam_id": str(payload.get("exam_id") or "").strip(),
        "prompt": str(payload.get("prompt") or "").strip(),
        "multi_select": bool(payload.get("multi_select")),
        "domain": str(payload.get("domain") or "").strip() or None,
        # Canonical Easy/Medium/Hard (CHECK constraint); invalid values raise ValueError (-> HTTP 400).
        "difficulty": normalize_difficulty(payload.get("difficulty")),
        "certification": str(payload.get("certification") or "").strip() or None,
        "tags": tags,
        "citations": citations,
        "options": options,
        "justification": str(payload.get("justification") or "").strip() or None,
        "change_summary": str(payload.get("change_summary") or "").strip() or None,
        "subject": str(payload.get("subject") or "").strip() or None,
        "subtopic": str(payload.get("subtopic") or "").strip() or None,
        "subdomain": str(payload.get("subdomain") or "").strip() or None,
        "objective_code": str(payload.get("objective_code") or "").strip() or None,
        "blueprint_code": str(payload.get("blueprint_code") or "").strip() or None,
        "keywords": payload.get("keywords") or [],
        "trap_patterns": payload.get("trap_patterns") or [],
        "question_format": str(payload.get("question_format") or "").strip() or None,
        "correct_rationale": str(payload.get("correct_rationale") or "").strip() or None,
        "incorrect_rationales": payload.get("incorrect_rationales") or [],
        "avg_time_seconds": payload.get("avg_time_seconds"),
        "global_accuracy_percent": payload.get("global_accuracy_percent"),
    }
    return normalize_editorial_payload(normalized)


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

    return normalize_editorial_payload({
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
    })


def _question_payload_from_version(version: QuestionVersion) -> dict[str, Any]:
    references = [
        {
            "source": item.source,
            "reference": item.reference,
            "chapter": item.chapter,
            "locator": item.locator,
            "material_path": item.material_path,
            "page_start": item.page_start,
            "page_end": item.page_end,
        }
        for item in sorted(version.references, key=lambda item: item.id)
    ]
    return normalize_editorial_payload({
        "id": version.question_bank_id,
        "exam_id": version.exam_id,
        "prompt": version.prompt,
        "multi_select": version.multi_select,
        "domain": version.domain,
        "difficulty": version.difficulty,
        "certification": version.certification,
        "subject": version.subject,
        "subtopic": version.subtopic,
        "subdomain": version.subdomain,
        "objective_code": version.objective_code,
        "blueprint_code": version.blueprint_code,
        "keywords": _parse_text_list(version.keywords_json),
        "trap_patterns": _parse_text_list(version.trap_patterns_json),
        "question_format": version.question_format,
        "tags": _parse_text_list(version.tags_json),
        "citations": references or _parse_dict_list(version.citations_json),
        "options": [
            {
                "key": option.key,
                "text": option.text,
                "is_correct": option.is_correct,
            }
            for option in sorted(version.options, key=lambda item: item.key)
        ],
        "justification": version.justification,
        "correct_rationale": version.correct_rationale,
        "incorrect_rationales": _parse_text_list(version.incorrect_rationales_json),
        "avg_time_seconds": version.avg_time_seconds,
        "global_accuracy_percent": version.global_accuracy_percent,
        "change_summary": version.change_summary,
    })


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
    version.subject = payload.get("subject")
    version.subtopic = payload.get("subtopic")
    version.subdomain = payload.get("subdomain")
    version.objective_code = payload.get("objective_code")
    version.blueprint_code = payload.get("blueprint_code")
    version.keywords_json = json_text_list(payload.get("keywords"))
    version.trap_patterns_json = json_text_list(payload.get("trap_patterns"))
    version.question_format = payload.get("question_format") or version.question_format or "single_choice"
    version.tags_json = _json_or_none(payload.get("tags"))
    version.citations_json = _json_or_none(payload.get("citations"))
    version.justification = payload.get("justification")
    version.correct_rationale = payload.get("correct_rationale")
    version.incorrect_rationales_json = json_text_list(payload.get("incorrect_rationales"))
    version.avg_time_seconds = payload.get("avg_time_seconds")
    version.global_accuracy_percent = payload.get("global_accuracy_percent")
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


def _replace_version_references(
    db: Session,
    version: QuestionVersion,
    citations: list[dict[str, Any]],
) -> None:
    for item in list(version.references):
        db.delete(item)
    db.flush()

    for citation in citations:
        page_start = citation.get("page_start")
        page_end = citation.get("page_end")
        db.add(
            QuestionReference(
                question_version_id=version.id,
                source=str(citation.get("source") or "").strip() or None,
                reference=str(citation.get("reference") or "").strip() or None,
                chapter=str(citation.get("chapter") or "").strip() or None,
                locator=str(citation.get("locator") or "").strip() or None,
                material_path=str(citation.get("material_path") or "").strip() or None,
                page_start=int(page_start) if isinstance(page_start, (int, float)) else None,
                page_end=int(page_end) if isinstance(page_end, (int, float)) else None,
            )
        )
    db.flush()
    db.refresh(version)


def _sync_domain_blueprint_catalog(
    db: Session,
    payload: dict[str, Any],
) -> None:
    certification = str(payload.get("certification") or "").strip()
    domain = str(payload.get("domain") or "").strip()
    if not certification or not domain:
        return

    subdomain = str(payload.get("subdomain") or "").strip() or None
    objective_code = str(payload.get("objective_code") or "").strip() or None
    blueprint_code = str(payload.get("blueprint_code") or "").strip() or None
    subject = str(payload.get("subject") or "").strip() or None
    subtopic = str(payload.get("subtopic") or "").strip() or None

    catalog_row = db.execute(
        select(DomainCatalog).where(
            DomainCatalog.certification == certification,
            DomainCatalog.domain == domain,
            DomainCatalog.subdomain == subdomain,
            DomainCatalog.objective_code == objective_code,
            DomainCatalog.blueprint_code == blueprint_code,
        )
    ).scalar_one_or_none()
    if not catalog_row:
        catalog_row = DomainCatalog(
            certification=certification,
            domain=domain,
            subdomain=subdomain,
            subject=subject,
            objective_code=objective_code,
            blueprint_code=blueprint_code,
            title=subtopic or domain,
            description=(payload.get("correct_rationale") or payload.get("justification")),
        )
        db.add(catalog_row)
    else:
        catalog_row.subject = subject or catalog_row.subject
        catalog_row.title = subtopic or catalog_row.title
        catalog_row.description = (payload.get("correct_rationale") or payload.get("justification") or catalog_row.description)
        catalog_row.is_active = True
        catalog_row.updated_at = utcnow()

    if blueprint_code:
        blueprint_row = db.execute(
            select(DomainBlueprint).where(
                DomainBlueprint.certification == certification,
                DomainBlueprint.blueprint_code == blueprint_code,
                DomainBlueprint.objective_code == objective_code,
            )
        ).scalar_one_or_none()
        if not blueprint_row:
            db.add(
                DomainBlueprint(
                    certification=certification,
                    blueprint_code=blueprint_code,
                    objective_code=objective_code,
                    domain=domain,
                    subdomain=subdomain,
                    title=subtopic or domain,
                    description=(payload.get("correct_rationale") or payload.get("justification")),
                )
            )
        else:
            blueprint_row.domain = domain
            blueprint_row.subdomain = subdomain
            blueprint_row.title = subtopic or blueprint_row.title
            blueprint_row.description = (payload.get("correct_rationale") or payload.get("justification") or blueprint_row.description)
            blueprint_row.updated_at = utcnow()


def _create_version(
    db: Session,
    *,
    question_id: str,
    payload: dict[str, Any],
    status: str,
    actor_user_id: str | None,
    approved_by_user_id: str | None = None,
    published_at: datetime | None = None,
    import_hash: str | None = None,
) -> QuestionVersion:
    version = QuestionVersion(
        import_hash=import_hash,
        question_bank_id=question_id,
        version_number=_next_version_number(db, question_id),
        status=status,
        exam_id=payload["exam_id"],
        prompt=payload["prompt"],
        multi_select=bool(payload["multi_select"]),
        domain=payload["domain"],
        difficulty=payload["difficulty"],
        certification=payload["certification"],
        subject=payload.get("subject"),
        subtopic=payload.get("subtopic"),
        subdomain=payload.get("subdomain"),
        objective_code=payload.get("objective_code"),
        blueprint_code=payload.get("blueprint_code"),
        keywords_json=json_text_list(payload.get("keywords")),
        trap_patterns_json=json_text_list(payload.get("trap_patterns")),
        question_format=payload.get("question_format") or "single_choice",
        tags_json=_json_or_none(payload.get("tags")),
        citations_json=_json_or_none(payload.get("citations")),
        justification=payload.get("justification"),
        correct_rationale=payload.get("correct_rationale"),
        incorrect_rationales_json=json_text_list(payload.get("incorrect_rationales")),
        avg_time_seconds=payload.get("avg_time_seconds"),
        global_accuracy_percent=payload.get("global_accuracy_percent"),
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
    _replace_version_references(db, version, payload.get("citations") or [])
    _sync_domain_blueprint_catalog(db, payload)
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
            published_at=utcnow(),
            import_hash="seeded-projection",
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
        # A projection without a bank can only come from a pre-editorial import.
        last_import_hash="seeded-projection",
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
        published_at=utcnow(),
        import_hash="seeded-projection",
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
        if not version.exam_id:
            raise ValueError("Cannot project a question version without exam_id.")
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
        # is_active / deactivation fields are intentionally untouched: publishing a new
        # version never resurrects a deleted question (see reactivate_question).
        if version.exam_id:
            projection.exam_id = version.exam_id
        projection.prompt = version.prompt
        projection.multi_select = version.multi_select
        projection.domain = version.domain
        projection.difficulty = version.difficulty
        projection.certification = version.certification
        projection.tags_json = version.tags_json
        projection.citations_json = version.citations_json

    sync_projection_options(
        db,
        projection,
        [
            {"key": item.key, "text": item.text, "is_correct": item.is_correct}
            for item in sorted(version.options, key=lambda option: option.key)
        ],
    )

    explanation = db.get(Explanation, question_id)
    explanation_text = version.correct_rationale or version.justification
    if not explanation:
        db.add(Explanation(question_id=question_id, justification=explanation_text))
    else:
        explanation.justification = explanation_text
    projection.explanation_missing = (not explanation_text) or is_fallback_rationale(explanation_text)
    db.flush()


def sync_projection_options(
    db: Session,
    question: Question,
    options: list[dict[str, Any]],
) -> None:
    """Update the projection options in place, keyed by option key.

    Existing rows keep their primary key (text/is_correct are updated), options whose
    key disappeared are deleted and flushed *before* new keys are inserted, so the
    (question_id, key) unique constraint is never hit. (C1: re-import used to delete and
    re-insert the same keys in one flush, which the unit of work orders INSERT-first.)
    """
    desired: dict[str, dict[str, Any]] = {}
    for item in options:
        key = str(item.get("key") or "").strip().upper()
        text = str(item.get("text") or "").strip()
        if not key or not text:
            continue
        desired[key] = {"text": text, "is_correct": bool(item.get("is_correct"))}

    existing = {
        option.key: option
        for option in db.execute(select(Option).where(Option.question_id == question.id)).scalars().all()
    }
    removed = False
    for key, option in existing.items():
        if key not in desired:
            db.delete(option)
            removed = True
    if removed:
        db.flush()

    for key, values in desired.items():
        option = existing.get(key)
        if option is not None:
            option.text = values["text"]
            option.is_correct = values["is_correct"]
        else:
            db.add(Option(question_id=question.id, key=key, text=values["text"], is_correct=values["is_correct"]))
    db.flush()
    db.expire(question, ["options"])


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


def _projection_state(db: Session, question_id: str) -> dict[str, Any]:
    """Lifecycle/editorial flags of the student-facing projection (defaults for drafts)."""
    projection = db.get(Question, question_id)
    if projection is None:
        return {
            "is_active": True,
            "deactivated_reason": None,
            "deactivated_at": None,
            "needs_review": False,
            "explanation_missing": False,
        }
    return {
        "is_active": bool(projection.is_active),
        "deactivated_reason": projection.deactivated_reason,
        "deactivated_at": projection.deactivated_at.isoformat() if projection.deactivated_at else None,
        "needs_review": bool(projection.needs_review),
        "explanation_missing": bool(projection.explanation_missing),
    }


def build_admin_question_document(db: Session, question_id: str) -> dict[str, Any] | None:
    """Read-only: never seeds the editorial bank (M-B7).

    Banks are created by the JSON ingest (sync_imported_question_publication) and by
    the editorial write paths (_ensure_editable_bank). A legacy projection without a
    bank is rendered straight from the projection, in memory, without persisting.
    """
    bank = _get_question_bank(db, question_id)
    state = _projection_state(db, question_id)
    if bank:
        target_version = _get_version(db, bank.draft_version_id) or _get_version(db, bank.published_version_id)
        if target_version:
            payload = _question_payload_from_version(target_version)
            quality = assess_question_quality(payload, db=db)
            return {
                "id": payload["id"],
                "exam_id": payload["exam_id"],
                "prompt": payload["prompt"],
                "multi_select": payload["multi_select"],
                "domain": payload["domain"],
                "difficulty": payload["difficulty"],
                "certification": payload["certification"],
                "subject": payload.get("subject"),
                "subtopic": payload.get("subtopic"),
                "subdomain": payload.get("subdomain"),
                "objective_code": payload.get("objective_code"),
                "blueprint_code": payload.get("blueprint_code"),
                "keywords": payload.get("keywords"),
                "trap_patterns": payload.get("trap_patterns"),
                "question_format": payload.get("question_format"),
                "tags": payload["tags"],
                "citations": payload["citations"],
                "options": payload["options"],
                "correct_keys": [item["key"] for item in payload["options"] if item["is_correct"]],
                "justification": payload["justification"],
                "correct_rationale": payload.get("correct_rationale"),
                "incorrect_rationales": payload.get("incorrect_rationales"),
                "avg_time_seconds": payload.get("avg_time_seconds"),
                "global_accuracy_percent": payload.get("global_accuracy_percent"),
                "change_summary": payload.get("change_summary"),
                "editorial_status": bank.review_status,
                "loaded_from": "draft" if bank.draft_version_id == target_version.id else "published",
                "version_id": target_version.id,
                "version_number": target_version.version_number,
                "published_version_number": _get_version(db, bank.published_version_id).version_number if bank.published_version_id else None,
                "draft_version_number": _get_version(db, bank.draft_version_id).version_number if bank.draft_version_id else None,
                "quality": {
                    **_quality_summary(quality),
                },
                **state,
            }

    payload = _question_payload_from_projection(db, question_id)
    if not payload:
        return None
    quality = assess_question_quality(payload, db=db)
    return {
        "id": payload["id"],
        "exam_id": payload["exam_id"],
        "prompt": payload["prompt"],
        "multi_select": payload["multi_select"],
        "domain": payload["domain"],
        "difficulty": payload["difficulty"],
        "certification": payload["certification"],
        "subject": payload.get("subject"),
        "subtopic": payload.get("subtopic"),
        "subdomain": payload.get("subdomain"),
        "objective_code": payload.get("objective_code"),
        "blueprint_code": payload.get("blueprint_code"),
        "keywords": payload.get("keywords"),
        "trap_patterns": payload.get("trap_patterns"),
        "question_format": payload.get("question_format"),
        "tags": payload["tags"],
        "citations": payload["citations"],
        "options": payload["options"],
        "correct_keys": [item["key"] for item in payload["options"] if item["is_correct"]],
        "justification": payload["justification"],
        "correct_rationale": payload.get("correct_rationale"),
        "incorrect_rationales": payload.get("incorrect_rationales"),
        "avg_time_seconds": payload.get("avg_time_seconds"),
        "global_accuracy_percent": payload.get("global_accuracy_percent"),
        "change_summary": None,
        "editorial_status": "published",
        "loaded_from": "published",
        "version_id": None,
        "version_number": None,
        "published_version_number": None,
        "draft_version_number": None,
        "quality": {
            **_quality_summary(quality),
        },
        **state,
    }


def list_question_versions(db: Session, question_id: str) -> list[dict[str, Any]]:
    """Read-only: a projection without an editorial bank simply has no versions yet."""
    bank = _get_question_bank(db, question_id)
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
            "metadata": parse_json(row.metadata_json, None),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


def get_question_bank_status(db: Session, question_id: str) -> dict[str, Any] | None:
    bank = _get_question_bank(db, question_id)
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
    quality = assess_question_quality(_clean_payload(payload), db=db)
    clean = quality["normalized"]
    if not clean["id"]:
        raise ValueError("Question ID is required.")

    bank = _ensure_editable_bank(db, clean["id"], actor_user_id=actor_user_id)
    current_draft = _get_version(db, bank.draft_version_id)

    if current_draft and current_draft.question_bank_id == clean["id"]:
        _replace_version_fields(current_draft, clean, actor_user_id=actor_user_id, preserve_status=False)
        _replace_version_options(db, current_draft, clean["options"])
        _replace_version_references(db, current_draft, clean.get("citations") or [])
        _sync_domain_blueprint_catalog(db, clean)
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
        "quality": _quality_summary(quality),
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
    if version.status not in {"draft", "in_review"}:
        raise ValueError("Only the current draft can be submitted for review.")

    quality = assess_question_quality(_question_payload_from_version(version), db=db)
    if quality["blocking_issues"]:
        raise ValueError(
            "Draft has blocking editorial issues: "
            + "; ".join(str(item) for item in quality["blocking_issues"])
        )

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
        "quality": _quality_summary(quality),
    }


def approve_question(
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
        raise ValueError("No draft version available to approve.")
    if version.status != "in_review":
        raise ValueError("Only a version in review can be approved.")

    quality = assess_question_quality(_question_payload_from_version(version), db=db)
    if quality["blocking_issues"]:
        raise ValueError(
            "Version has blocking editorial issues: "
            + "; ".join(str(item) for item in quality["blocking_issues"])
        )

    version.status = "approved"
    version.review_notes = reason or version.review_notes
    version.approved_by_user_id = actor_user_id
    version.updated_by_user_id = actor_user_id
    bank.review_status = "approved"
    bank.updated_by_user_id = actor_user_id
    db.flush()

    _write_audit_log(
        db,
        question_id=question_id,
        version_id=version.id,
        action="approved",
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        reason=reason,
        metadata={"version_number": version.version_number},
    )

    return {
        "ok": True,
        "id": question_id,
        "status": "approved",
        "version_id": version.id,
        "version_number": version.version_number,
        "quality": _quality_summary(quality),
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

    quality = assess_question_quality(_question_payload_from_version(version), db=db)
    if quality["blocking_issues"]:
        raise ValueError(
            "Version has blocking editorial issues: "
            + "; ".join(str(item) for item in quality["blocking_issues"])
        )
    if version.status not in {"approved", "published"}:
        raise ValueError("Approve the current version before publishing it.")

    previous_published = _get_version(db, bank.published_version_id)
    if previous_published and previous_published.id != version.id:
        previous_published.status = "archived"
        previous_published.updated_by_user_id = actor_user_id

    version.status = "published"
    version.approved_by_user_id = actor_user_id
    version.published_at = utcnow()
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
        "quality": _quality_summary(quality),
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
        published_at=utcnow(),
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


def _utcnow_aware() -> datetime:
    return datetime.now(timezone.utc)


def delete_question_with_history(
    db: Session,
    question_id: str,
    *,
    actor_user_id: str | None,
    actor_role: str | None,
    reason: str | None = None,
) -> dict[str, Any]:
    """Soft delete: deactivate the question so student history (answers, attempts,
    review queue, progress) is preserved. Name/signature/return shape are unchanged.

    The question disappears from new sessions (callers filter Question.is_active),
    its editorial bank is archived and the JSON ingest will not resurrect it; use
    reactivate_question to bring it back.
    """
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
        metadata={"soft_delete": True},
    )

    if bank:
        draft = _get_version(db, bank.draft_version_id)
        if draft and draft.id != bank.published_version_id:
            draft.status = "archived"
            draft.updated_by_user_id = actor_user_id
        bank.draft_version_id = None
        published = _get_version(db, bank.published_version_id)
        if published:
            published.status = "archived"
            published.updated_by_user_id = actor_user_id
        bank.review_status = "archived"
        bank.updated_by_user_id = actor_user_id
    if projection:
        projection.is_active = False
        projection.deactivated_reason = QUESTION_DEACTIVATED_DELETED
        projection.deactivated_at = _utcnow_aware()
    db.flush()

    return {
        "ok": True,
        "id": question_id,
        "status": "deleted",
    }


def reactivate_question(
    db: Session,
    question_id: str,
    *,
    actor_user_id: str | None,
    actor_role: str | None,
    reason: str | None = None,
) -> dict[str, Any]:
    """Explicitly re-enable a soft-deleted question (the only way ingest-proof deletes are undone)."""
    projection = db.get(Question, question_id)
    if not projection:
        raise ValueError("Question not found.")
    bank = _get_question_bank(db, question_id)
    if bank:
        published = _get_version(db, bank.published_version_id)
        if published and published.status == "archived":
            published.status = "published"
            published.updated_by_user_id = actor_user_id
        bank.review_status = "published"
        bank.updated_by_user_id = actor_user_id
        if bank.last_import_hash:
            # Imports skipped this question while it was deleted: force the next ingest
            # to re-evaluate it (unchanged source files are otherwise skipped by hash).
            bank.last_import_hash = "legacy-import"
    projection.is_active = True
    projection.deactivated_reason = None
    projection.deactivated_at = None
    _write_audit_log(
        db,
        question_id=question_id,
        version_id=bank.published_version_id if bank else None,
        action="reactivated",
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        reason=reason,
    )
    db.flush()
    return {"ok": True, "id": question_id, "status": "published"}


def is_import_origin_version(version: QuestionVersion | None) -> bool:
    return bool(version is not None and version.import_hash)


def sync_imported_question_publication(
    db: Session,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Publish the imported payload unless an editor owns the current published version.

    - No published version yet -> publish the import (version.import_hash = payload hash).
    - Published version came from the import (import_hash set) -> republish only when the
      imported payload changed.
    - Published version was created editorially (import_hash NULL) -> never overwritten;
      the new import hash is recorded on the bank and an ``import_skipped_editorial``
      audit entry is written once per distinct payload so editors can reconcile.
    """
    quality = assess_question_quality(_clean_payload(payload), db=db)
    clean = quality["normalized"]
    question_id = clean.get("id")
    if not question_id:
        raise ValueError("Question ID is required.")
    if quality["blocking_issues"]:
        raise ValueError(
            "Imported question failed editorial validation: "
            + "; ".join(str(item) for item in quality["blocking_issues"])
        )

    target_hash = _signature_hash(clean)
    bank = _get_question_bank(db, question_id)
    if not bank:
        bank = QuestionBank(
            stable_question_id=question_id,
            review_status="published",
            created_by_user_id=None,
            updated_by_user_id=None,
        )
        db.add(bank)
        db.flush()

    current_published = _get_version(db, bank.published_version_id)
    if current_published and not is_import_origin_version(current_published):
        if bank.last_import_hash != target_hash:
            _write_audit_log(
                db,
                question_id=question_id,
                version_id=current_published.id,
                action="import_skipped_editorial",
                actor_user_id=None,
                actor_role="system",
                reason="Published version was edited editorially; imported content not applied.",
                metadata={"import_hash": target_hash, "version_number": current_published.version_number},
            )
        bank.last_import_hash = target_hash
        if current_published.status == "published":
            _sync_projection_from_version(db, question_id, current_published)
        db.flush()
        return {
            "question_id": question_id,
            "version_id": current_published.id,
            "version_number": current_published.version_number,
            "changed": False,
            "skipped_editorial": True,
            "quality": _quality_summary(quality),
        }

    if current_published:
        if current_published.import_hash in LEGACY_IMPORT_MARKERS:
            unchanged = _payload_signature(_question_payload_from_version(current_published)) == _payload_signature(clean)
            if unchanged:
                current_published.import_hash = target_hash
        else:
            unchanged = current_published.import_hash == target_hash
        if unchanged:
            bank.last_import_hash = target_hash
            _sync_domain_blueprint_catalog(db, clean)
            if current_published.status == "published":
                _sync_projection_from_version(db, question_id, current_published)
            db.flush()
            return {
                "question_id": question_id,
                "version_id": current_published.id,
                "version_number": current_published.version_number,
                "changed": False,
                "skipped_editorial": False,
                "quality": _quality_summary(quality),
            }
        current_published.status = "archived"
        current_published.updated_by_user_id = None

    published_version = _create_version(
        db,
        question_id=question_id,
        payload=clean,
        status="published",
        actor_user_id=None,
        approved_by_user_id=None,
        published_at=utcnow(),
        import_hash=target_hash,
    )
    bank.published_version_id = published_version.id
    bank.last_import_hash = target_hash
    if not bank.draft_version_id and bank.review_status != "archived":
        bank.review_status = "published"
    bank.updated_by_user_id = None

    _sync_projection_from_version(db, question_id, published_version)
    _write_audit_log(
        db,
        question_id=question_id,
        version_id=published_version.id,
        action="import_published",
        actor_user_id=None,
        actor_role="system",
        metadata={
            "version_number": published_version.version_number,
            "completeness_score": quality["completeness_score"],
            "import_hash": target_hash,
        },
    )
    db.flush()
    return {
        "question_id": question_id,
        "version_id": published_version.id,
        "version_number": published_version.version_number,
        "changed": True,
        "skipped_editorial": False,
        "quality": _quality_summary(quality),
    }
