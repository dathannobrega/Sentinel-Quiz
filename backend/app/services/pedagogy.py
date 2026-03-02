from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    DomainCatalog,
    Question,
    QuestionBank,
    QuestionHint,
    QuestionReference,
    QuestionVersion,
    ReferenceCatalog,
)


CONFIDENCE_SIGNAL_TO_LEVEL = {
    "guess": "low",
    "not_sure": "medium",
    "confident": "high",
    "low": "low",
    "medium": "medium",
    "high": "high",
}

CONFIDENCE_LEVEL_TO_SIGNAL = {
    "low": "guess",
    "medium": "not_sure",
    "high": "confident",
}

HINT_CAUTION = "O hint orienta o raciocinio, mas nao entrega a alternativa correta."


def normalize_confidence_level(value: str | None) -> str:
    normalized = str(value or "medium").strip().lower()
    resolved = CONFIDENCE_SIGNAL_TO_LEVEL.get(normalized)
    if not resolved:
        raise ValueError("Confidence must be one of: guess, not_sure, confident.")
    return resolved


def confidence_signal_from_level(value: str | None) -> str:
    normalized = normalize_confidence_level(value)
    return CONFIDENCE_LEVEL_TO_SIGNAL[normalized]


def _clean_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _load_json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        payload = json.loads(value)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    items: list[str] = []
    seen: set[str] = set()
    for entry in payload:
        text = _clean_text(entry)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        items.append(text)
    return items


def _load_citation_dicts(value: str | None) -> list[dict[str, Any]]:
    if not value:
        return []
    try:
        payload = json.loads(value)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    items: list[dict[str, Any]] = []
    for entry in payload:
        if isinstance(entry, dict):
            items.append(entry)
    return items


def _load_question_version(db: Session, question_id: str) -> tuple[Question | None, QuestionVersion | None]:
    question = db.get(Question, question_id)
    if not question:
        return None, None
    bank = db.get(QuestionBank, question_id)
    version: QuestionVersion | None = None
    if bank and bank.published_version_id:
        version = db.get(QuestionVersion, bank.published_version_id)
    if version is None:
        version = db.execute(
            select(QuestionVersion)
            .where(
                QuestionVersion.question_bank_id == question_id,
                QuestionVersion.status == "published",
            )
            .order_by(QuestionVersion.version_number.desc())
        ).scalars().first()
    return question, version


def _is_official_reference(source_kind: str, label: str, reference_text: str | None) -> bool:
    haystack = " ".join(
        part.lower()
        for part in [source_kind, label, reference_text or ""]
        if part
    )
    if source_kind in {"blueprint", "objective", "domain_map"}:
        return True
    return "nist" in haystack or "iso" in haystack or "official" in haystack


def _sync_reference_catalog_for_version(db: Session, version: QuestionVersion) -> list[ReferenceCatalog]:
    existing_rows = db.execute(
        select(ReferenceCatalog)
        .where(ReferenceCatalog.question_version_id == version.id)
        .order_by(ReferenceCatalog.id.asc())
    ).scalars().all()
    latest_row_update = max((row.updated_at for row in existing_rows if row.updated_at), default=None)
    needs_rebuild = not existing_rows or (version.updated_at and latest_row_update and latest_row_update < version.updated_at)
    if needs_rebuild and existing_rows:
        db.execute(delete(ReferenceCatalog).where(ReferenceCatalog.question_version_id == version.id))
        db.flush()
        existing_rows = []

    if existing_rows:
        return existing_rows

    now = datetime.utcnow()
    rows: list[ReferenceCatalog] = []

    if version.blueprint_code:
        rows.append(
            ReferenceCatalog(
                question_version_id=version.id,
                certification=version.certification,
                domain=version.domain,
                subdomain=version.subdomain,
                objective_code=version.objective_code,
                blueprint_code=version.blueprint_code,
                source_kind="blueprint",
                label=f"Blueprint {version.blueprint_code}",
                reference_text=" | ".join(
                    part
                    for part in [
                        _clean_text(version.certification),
                        _clean_text(version.domain),
                        _clean_text(version.subdomain),
                    ]
                    if part
                )
                or None,
                is_official=True,
                created_at=now,
                updated_at=now,
            )
        )

    if version.objective_code:
        rows.append(
            ReferenceCatalog(
                question_version_id=version.id,
                certification=version.certification,
                domain=version.domain,
                subdomain=version.subdomain,
                objective_code=version.objective_code,
                blueprint_code=version.blueprint_code,
                source_kind="objective",
                label=f"Objective {version.objective_code}",
                reference_text="Use este codigo para localizar o objetivo oficial no blueprint desta certificacao.",
                is_official=True,
                created_at=now,
                updated_at=now,
            )
        )

    if version.certification and version.domain:
        catalog_match = db.execute(
            select(DomainCatalog)
            .where(
                DomainCatalog.certification == version.certification,
                DomainCatalog.domain == version.domain,
            )
            .order_by(DomainCatalog.id.asc())
        ).scalars().first()
        if catalog_match:
            rows.append(
                ReferenceCatalog(
                    question_version_id=version.id,
                    certification=version.certification,
                    domain=version.domain,
                    subdomain=version.subdomain,
                    objective_code=version.objective_code,
                    blueprint_code=version.blueprint_code,
                    source_kind="domain_map",
                    label=f"Dominio {version.domain}",
                    reference_text=_clean_text(catalog_match.description) or _clean_text(catalog_match.title),
                    is_official=True,
                    created_at=now,
                    updated_at=now,
                )
            )

    explicit_references = db.execute(
        select(QuestionReference)
        .where(QuestionReference.question_version_id == version.id)
        .order_by(QuestionReference.id.asc())
    ).scalars().all()
    if not explicit_references:
        for item in _load_citation_dicts(version.citations_json):
            explicit_references.append(
                QuestionReference(
                    question_version_id=version.id,
                    source=_clean_text(item.get("source")),
                    reference=_clean_text(item.get("reference")),
                    chapter=_clean_text(item.get("chapter")),
                    locator=_clean_text(item.get("locator")),
                    material_path=_clean_text(item.get("material_path")),
                    page_start=int(item["page_start"]) if isinstance(item.get("page_start"), int) else None,
                    page_end=int(item["page_end"]) if isinstance(item.get("page_end"), int) else None,
                    created_at=now,
                )
            )

    for reference in explicit_references:
        label = (
            _clean_text(reference.reference)
            or _clean_text(reference.chapter)
            or _clean_text(reference.source)
            or "Material interno"
        )
        reference_text = _clean_text(reference.reference)
        source_kind = "material" if reference.material_path else "citation"
        rows.append(
            ReferenceCatalog(
                question_version_id=version.id,
                certification=version.certification,
                domain=version.domain,
                subdomain=version.subdomain,
                objective_code=version.objective_code,
                blueprint_code=version.blueprint_code,
                source_kind=source_kind,
                label=label,
                reference_text=reference_text,
                material_path=_clean_text(reference.material_path),
                locator=_clean_text(reference.locator),
                page_start=reference.page_start,
                page_end=reference.page_end,
                is_official=_is_official_reference(
                    source_kind,
                    label,
                    " ".join(part for part in [reference.source or "", reference.reference or ""] if part),
                ),
                created_at=now,
                updated_at=now,
            )
        )

    for row in rows:
        db.add(row)
    db.flush()
    return rows


def build_official_reference_summaries(
    db: Session,
    question_id: str,
    *,
    limit: int = 4,
) -> list[dict[str, Any]]:
    question, version = _load_question_version(db, question_id)
    if not question:
        return []

    if version:
        rows = _sync_reference_catalog_for_version(db, version)
    else:
        rows = []

    if not rows:
        citations = _load_citation_dicts(question.citations_json)
        items: list[dict[str, Any]] = []
        for citation in citations[:limit]:
            items.append(
                {
                    "source_kind": "citation",
                    "label": _clean_text(citation.get("reference")) or _clean_text(citation.get("source")) or "Material interno",
                    "reference": _clean_text(citation.get("reference")),
                    "material_path": _clean_text(citation.get("material_path")),
                    "locator": _clean_text(citation.get("locator")),
                    "page_start": citation.get("page_start"),
                    "page_end": citation.get("page_end"),
                    "is_official": False,
                }
            )
        return items

    sorted_rows = sorted(
        rows,
        key=lambda item: (
            0 if item.is_official else 1,
            item.source_kind,
            item.id,
        ),
    )
    items: list[dict[str, Any]] = []
    for row in sorted_rows[:limit]:
        items.append(
            {
                "source_kind": row.source_kind,
                "label": row.label,
                "reference": row.reference_text,
                "material_path": row.material_path,
                "locator": row.locator,
                "page_start": row.page_start,
                "page_end": row.page_end,
                "is_official": bool(row.is_official),
            }
        )
    return items


def _build_hint_rows(
    question: Question,
    version: QuestionVersion | None,
    references: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    domain = _clean_text(version.domain if version else question.domain) or "o dominio central"
    subject = _clean_text(version.subject if version else question.certification) or _clean_text(question.certification) or "a trilha atual"
    subtopic = _clean_text(version.subtopic if version else question.domain) or domain
    subdomain = _clean_text(version.subdomain if version else None)
    objective_code = _clean_text(version.objective_code if version else None)
    blueprint_code = _clean_text(version.blueprint_code if version else None)
    question_format = _clean_text(version.question_format if version else None) or (
        "multiple_response" if question.multi_select else "single_choice"
    )
    keywords = _load_json_list(version.keywords_json if version else None)
    trap_patterns = _load_json_list(version.trap_patterns_json if version else None)
    incorrect_rationales = _load_json_list(version.incorrect_rationales_json if version else None)

    keyword_slice = ", ".join(keywords[:3]) if keywords else None
    level_one_text = (
        f"Foque primeiro em {subtopic} dentro de {subject}. "
        f"Antes de comparar alternativas, recupere o conceito central de {domain}."
    )
    if keyword_slice:
        level_one_text += f" Termos que merecem atencao: {keyword_slice}."

    narrowing_bits = []
    if subdomain:
        narrowing_bits.append(f"o recorte de {subdomain}")
    if objective_code:
        narrowing_bits.append(f"o objetivo {objective_code}")
    if blueprint_code and blueprint_code != objective_code:
        narrowing_bits.append(f"o blueprint {blueprint_code}")
    if question_format == "best_answer":
        narrowing_bits.append("a melhor resposta, nao apenas uma resposta possivel")
    elif question_format == "multiple_response":
        narrowing_bits.append("a combinacao completa de controles exigida")
    else:
        narrowing_bits.append("o criterio mais direto que o enunciado esta testando")
    level_two_text = "Restringa o raciocinio para " + ", ".join(narrowing_bits) + "."

    trap_source = trap_patterns[0] if trap_patterns else None
    if not trap_source and incorrect_rationales:
        trap_source = incorrect_rationales[0]
    if trap_source:
        level_three_text = f"Evite a pegadinha mais comum: {trap_source}."
    else:
        level_three_text = (
            "Evite escolher a alternativa mais familiar sem validar se ela responde exatamente ao risco, controle "
            "ou criterio pedido no enunciado."
        )
    if references:
        top_ref = references[0]
        if top_ref.get("label"):
            level_three_text += f" Se travar, revise o contexto base em {top_ref['label']}."

    return [
        {
            "level": 1,
            "title": "Direcione o conceito",
            "hint_text": level_one_text,
            "hint_kind": "concept",
        },
        {
            "level": 2,
            "title": "Restrinja o dominio",
            "hint_text": level_two_text,
            "hint_kind": "domain",
        },
        {
            "level": 3,
            "title": "Evite o erro comum",
            "hint_text": level_three_text,
            "hint_kind": "trap",
        },
    ]


def _ensure_question_hints(
    db: Session,
    question: Question,
    version: QuestionVersion | None,
    references: list[dict[str, Any]],
) -> list[QuestionHint]:
    if version is None:
        return []

    existing_rows = db.execute(
        select(QuestionHint)
        .where(QuestionHint.question_version_id == version.id)
        .order_by(QuestionHint.level.asc())
    ).scalars().all()
    latest_update = max((row.updated_at for row in existing_rows if row.updated_at), default=None)
    needs_rebuild = len(existing_rows) != 3 or (version.updated_at and latest_update and latest_update < version.updated_at)
    if needs_rebuild and existing_rows:
        db.execute(delete(QuestionHint).where(QuestionHint.question_version_id == version.id))
        db.flush()
        existing_rows = []

    if existing_rows:
        return existing_rows

    now = datetime.utcnow()
    rows: list[QuestionHint] = []
    for item in _build_hint_rows(question, version, references):
        row = QuestionHint(
            question_version_id=version.id,
            level=item["level"],
            title=item["title"],
            hint_text=item["hint_text"],
            hint_kind=item["hint_kind"],
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def build_question_hint(
    db: Session,
    question_id: str,
    *,
    level: int,
) -> dict[str, Any]:
    if level not in {1, 2, 3}:
        raise ValueError("Hint level must be between 1 and 3.")

    question, version = _load_question_version(db, question_id)
    if not question:
        raise ValueError("Question not found.")

    references = build_official_reference_summaries(db, question_id, limit=3)
    persisted_hints = _ensure_question_hints(db, question, version, references)
    if persisted_hints:
        hint_map = {row.level: row for row in persisted_hints}
        row = hint_map[level]
        title = row.title
        message = row.hint_text
        hint_kind = row.hint_kind
    else:
        fallback = {item["level"]: item for item in _build_hint_rows(question, version, references)}
        row = fallback[level]
        title = row["title"]
        message = row["hint_text"]
        hint_kind = row["hint_kind"]

    return {
        "question_id": question_id,
        "level": level,
        "available_levels": [1, 2, 3],
        "title": title,
        "hint_kind": hint_kind,
        "message": message,
        "caution": HINT_CAUTION,
        "references": references,
    }
