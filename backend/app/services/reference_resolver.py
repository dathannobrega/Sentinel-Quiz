from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    DomainCatalog,
    Explanation,
    Question,
    QuestionBank,
    QuestionReference,
    QuestionVersion,
    ReferenceCatalog,
)


SAFE_FEEDBACK_MAX_CHARS = 280


def _clean_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _load_citation_dicts(value: str | None) -> list[dict[str, Any]]:
    if not value:
        return []
    try:
        payload = json.loads(value)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


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


def _matches_specific_identity(version: QuestionVersion, row: DomainCatalog) -> bool:
    version_subdomain = _clean_text(version.subdomain)
    row_subdomain = _clean_text(row.subdomain)
    if version_subdomain and row_subdomain and version_subdomain != row_subdomain:
        return False
    if version_subdomain and not row_subdomain:
        return False

    version_objective = _clean_text(version.objective_code)
    row_objective = _clean_text(row.objective_code)
    if version_objective and row_objective and version_objective != row_objective:
        return False
    if version_objective and not row_objective:
        return False

    version_blueprint = _clean_text(version.blueprint_code)
    row_blueprint = _clean_text(row.blueprint_code)
    if version_blueprint and row_blueprint and version_blueprint != row_blueprint:
        return False
    if version_blueprint and not row_blueprint:
        return False

    return True


def _catalog_match_score(version: QuestionVersion, row: DomainCatalog) -> int:
    score = 0
    if _clean_text(version.subdomain) and _clean_text(version.subdomain) == _clean_text(row.subdomain):
        score += 4
    if _clean_text(version.objective_code) and _clean_text(version.objective_code) == _clean_text(row.objective_code):
        score += 3
    if _clean_text(version.blueprint_code) and _clean_text(version.blueprint_code) == _clean_text(row.blueprint_code):
        score += 3
    if _clean_text(row.subdomain):
        score += 1
    if _clean_text(row.objective_code):
        score += 1
    if _clean_text(row.blueprint_code):
        score += 1
    return score


def _best_domain_catalog_match(db: Session, version: QuestionVersion) -> DomainCatalog | None:
    certification = _clean_text(version.certification)
    domain = _clean_text(version.domain)
    if not certification or not domain:
        return None

    candidates = db.execute(
        select(DomainCatalog)
        .where(
            DomainCatalog.certification == certification,
            DomainCatalog.domain == domain,
            DomainCatalog.is_active == True,
        )
        .order_by(DomainCatalog.id.asc())
    ).scalars().all()

    filtered = [row for row in candidates if _matches_specific_identity(version, row)]
    if not filtered:
        return None
    filtered.sort(
        key=lambda row: (
            -_catalog_match_score(version, row),
            row.id,
        )
    )
    return filtered[0]


def _build_domain_map_row(version: QuestionVersion, catalog_match: DomainCatalog, now) -> ReferenceCatalog:
    details = [
        _clean_text(version.certification),
        _clean_text(version.domain),
        _clean_text(version.subdomain) or _clean_text(catalog_match.subdomain),
        _clean_text(version.objective_code) or _clean_text(catalog_match.objective_code),
        _clean_text(version.blueprint_code) or _clean_text(catalog_match.blueprint_code),
    ]
    reference_text = " | ".join(part for part in details if part) or None
    title = _clean_text(catalog_match.title) or _clean_text(catalog_match.subject) or _clean_text(version.domain) or "Dominio"
    return ReferenceCatalog(
        question_version_id=version.id,
        certification=version.certification,
        domain=version.domain,
        subdomain=version.subdomain,
        objective_code=version.objective_code,
        blueprint_code=version.blueprint_code,
        source_kind="domain_map",
        label=f"Dominio {title}",
        reference_text=reference_text,
        is_official=True,
        created_at=now,
        updated_at=now,
    )


def _normalize_explicit_reference_label(reference: QuestionReference) -> str:
    return (
        _clean_text(reference.source)
        or _clean_text(reference.chapter)
        or _clean_text(reference.reference)
        or "Material interno"
    )


def _normalize_explicit_reference_text(reference: QuestionReference, label: str) -> str | None:
    parts = [
        _clean_text(reference.reference),
        _clean_text(reference.chapter),
        _clean_text(reference.locator),
    ]
    seen: list[str] = []
    for part in parts:
        if not part or part == label or part in seen:
            continue
        seen.append(part)
    if seen:
        return " | ".join(seen)
    return None


def _sync_reference_catalog_for_version(db: Session, version: QuestionVersion) -> list[ReferenceCatalog]:
    existing_rows = db.execute(
        select(ReferenceCatalog)
        .where(ReferenceCatalog.question_version_id == version.id)
        .order_by(ReferenceCatalog.id.asc())
    ).scalars().all()
    latest_row_update = max((row.updated_at for row in existing_rows if row.updated_at), default=None)
    needs_rebuild = not existing_rows or (version.updated_at and latest_row_update and latest_row_update < version.updated_at)
    if needs_rebuild and existing_rows:
        for row in list(existing_rows):
            db.delete(row)
        db.flush()
        existing_rows = []

    if existing_rows:
        return existing_rows

    from datetime import datetime

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

    catalog_match = _best_domain_catalog_match(db, version)
    if catalog_match:
        rows.append(_build_domain_map_row(version, catalog_match, now))

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
        label = _normalize_explicit_reference_label(reference)
        reference_text = _normalize_explicit_reference_text(reference, label)
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
                    " ".join(part for part in [reference.source or "", reference.reference or "", reference.chapter or ""] if part),
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

    rows = _sync_reference_catalog_for_version(db, version) if version else []
    if not rows:
        citations = _load_citation_dicts(question.citations_json)
        items: list[dict[str, Any]] = []
        for citation in citations[:limit]:
            label = _clean_text(citation.get("source")) or _clean_text(citation.get("chapter")) or "Material interno"
            ref_text = _clean_text(citation.get("reference"))
            if ref_text == label:
                ref_text = _clean_text(citation.get("locator"))
            items.append(
                {
                    "source_kind": "citation",
                    "label": label,
                    "reference": ref_text,
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


def resolve_full_explanation_text(db: Session, question_id: str) -> str | None:
    _question, version = _load_question_version(db, question_id)
    if version:
        return _clean_text(version.correct_rationale) or _clean_text(version.justification)
    explanation = db.get(Explanation, question_id)
    if explanation:
        return _clean_text(explanation.justification)
    return None


def _sanitize_feedback_source(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    cleaned_lines: list[str] = []
    for line in raw.splitlines():
        stripped = re.sub(r"[*_`#>-]+", "", line).strip()
        if not stripped:
            continue
        lowered = stripped.lower()
        if lowered.startswith("correct answer:") or lowered.startswith("correct answer") or lowered.startswith("resposta correta:"):
            continue
        if lowered.startswith("while the other options"):
            break
        if lowered.startswith("think like a manager"):
            break
        cleaned_lines.append(stripped)

    normalized = " ".join(cleaned_lines).strip()
    if not normalized:
        return None

    first_sentence = normalized.split(". ", 2)[:2]
    summary = ". ".join(first_sentence).strip()
    if summary and not summary.endswith("."):
        summary += "."
    if len(summary) > SAFE_FEEDBACK_MAX_CHARS:
        summary = summary[: SAFE_FEEDBACK_MAX_CHARS - 3].rstrip() + "..."
    return summary or None


def build_feedback_summary(
    db: Session,
    question_id: str,
    *,
    is_correct: bool,
    fallback_text: str | None = None,
) -> str:
    source = _clean_text(fallback_text) or resolve_full_explanation_text(db, question_id)
    cleaned = _sanitize_feedback_source(source)
    if cleaned:
        prefix = "Conceito-chave: " if is_correct else "Revise este conceito: "
        return f"{prefix}{cleaned}"
    if is_correct:
        return "Resposta correta. A revisao completa continua disponivel no resumo final da sessao."
    return "Resposta incorreta. O conceito foi registrado para revisao e a explicacao completa fica na tela final."
