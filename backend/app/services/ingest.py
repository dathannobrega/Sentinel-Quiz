from __future__ import annotations

import json
import os
import hashlib
import re
from datetime import datetime, timezone
from typing import Any
from sqlalchemy.orm import Session
from sqlalchemy import exists, func, select
from app.models import (
    QUESTION_DEACTIVATED_REMOVED_FROM_SOURCE,
    DomainBlueprint,
    EditorialAuditLog,
    Exam,
    ExamSession,
    ImportState,
    Question,
    QuestionBank,
    QuestionVersion,
    StudyModule,
    StudySession,
)
from app.services.editorial import LEGACY_IMPORT_MARKERS, sync_imported_question_publication
from app.services.question_quality import build_fallback_rationale


# Official exam outline weights (percent of the exam) per domain. Upserted into
# domain_blueprint (weight column) on every ingest; see get_domain_blueprint_weights.
OFFICIAL_DOMAIN_WEIGHTS: dict[str, list[tuple[str, str, float]]] = {
    "CISSP": [
        ("CISSP-D1", "Security and Risk Management", 16.0),
        ("CISSP-D2", "Asset Security", 10.0),
        ("CISSP-D3", "Security Architecture and Engineering", 13.0),
        ("CISSP-D4", "Communication and Network Security", 13.0),
        ("CISSP-D5", "Identity and Access Management (IAM)", 13.0),
        ("CISSP-D6", "Security Assessment and Testing", 12.0),
        ("CISSP-D7", "Security Operations", 13.0),
        ("CISSP-D8", "Software Development Security", 10.0),
    ],
    "Security+": [
        ("SY0-701-D1", "General Security Concepts", 12.0),
        ("SY0-701-D2", "Threats, Vulnerabilities and Mitigations", 22.0),
        ("SY0-701-D3", "Security Architecture", 18.0),
        ("SY0-701-D4", "Security Operations", 28.0),
        ("SY0-701-D5", "Security Program Management and Oversight", 20.0),
    ],
}

STUDY_MODULE_SOURCES = (
    # (file name inside material/, certification, parser)
    ("Modulos_sec+.md", "Security+", "markdown_modules"),
    ("cissp_domain.json", "CISSP", "domain_json"),
)

SECURITY_PLUS_DOMAIN_KEYWORDS = {
    "Threats, Vulnerabilities and Mitigations": [
        "phishing", "whaling", "smishing", "vishing", "malware", "ransomware", "trojan",
        "vulnerability", "exploit", "attack", "threat actor", "social engineering",
        "mitigation", "injection", "pentest", "reconnaissance", "spoofing", "detection",
    ],
    "Security Architecture": [
        "firewall", "ngfw", "waf", "vpn", "nac", "802.1x", "load balancer", "virtualization",
        "segmentation", "zero trust", "proxy", "hsm", "cloud", "architecture", "network",
        "dmz", "sase", "secure design", "microsegmentation", "wireless",
    ],
    "Security Operations": [
        "incident", "forensic", "siem", "logging", "log review", "monitoring", "backup",
        "recovery", "disaster", "patch", "hardening", "operations", "playbook",
        "containment", "eradication", "mttr", "change management", "rollback",
    ],
    "Security Program Management and Oversight": [
        "policy", "governance", "risk", "compliance", "privacy", "audit", "training",
        "awareness", "vendor", "third-party", "procedure", "legal", "regulation",
        "data retention", "classification", "control owner", "program",
    ],
    "General Security Concepts": [
        "cia", "aaa", "authentication", "authorization", "accounting", "hashing",
        "encryption", "certificate", "access control", "least privilege", "non-repudiation",
        "integrity", "availability", "confidentiality",
    ],
}


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return cleaned or "exam"


def _option_key_from_index(index: int) -> str:
    if index < 0:
        return ""
    chars: list[str] = []
    value = index
    while True:
        value, remainder = divmod(value, 26)
        chars.append(chr(65 + remainder))
        if value == 0:
            break
        value -= 1
    return "".join(reversed(chars))


def _normalize_tags(raw_tags) -> list[str]:
    if not raw_tags:
        return []
    if isinstance(raw_tags, str):
        raw_tags = [raw_tags]
    if not isinstance(raw_tags, list):
        return []

    seen = set()
    normalized: list[str] = []
    for item in raw_tags:
        text = str(item or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return normalized


def _normalize_text(value) -> str | None:
    text = str(value or "").strip()
    return text or None


def _merge_tags(*groups) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for tag in _normalize_tags(group):
            key = tag.lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(tag)
    return merged


def _clean_citation_value(value):
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, list):
        cleaned_items = []
        for item in value:
            cleaned = _clean_citation_value(item)
            if cleaned is not None:
                cleaned_items.append(cleaned)
        return cleaned_items or None
    if isinstance(value, dict):
        cleaned_dict = {}
        for key, item in value.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            cleaned = _clean_citation_value(item)
            if cleaned is not None:
                cleaned_dict[clean_key] = cleaned
        return cleaned_dict or None
    return None


def _normalize_citations(raw_citations) -> list[dict]:
    if not raw_citations:
        return []
    if not isinstance(raw_citations, list):
        return []

    normalized: list[dict] = []
    seen = set()
    for item in raw_citations:
        if not isinstance(item, dict):
            continue
        normalized_item: dict = {}
        for key, value in item.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            if clean_key in {"source", "reference"}:
                cleaned = str(value or "").strip()
            else:
                cleaned = _clean_citation_value(value)
            if cleaned is None:
                continue
            normalized_item[clean_key] = cleaned

        source = str(normalized_item.get("source") or "").strip()
        reference = str(normalized_item.get("reference") or "").strip()
        locator = str(normalized_item.get("locator") or "").strip()
        material_path = str(normalized_item.get("material_path") or "").strip()
        if not source and not reference and not locator and not material_path:
            continue
        normalized_item["source"] = source
        normalized_item["reference"] = reference
        key = json.dumps(normalized_item, ensure_ascii=False, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(normalized_item)
    return normalized


def _detect_certification(*values: str | None) -> str | None:
    haystack = " ".join([str(v or "") for v in values]).lower()
    if "security+" in haystack or "security plus" in haystack:
        return "Security+"
    if "cissp" in haystack:
        return "CISSP"
    if "ccsp" in haystack:
        return "CCSP"
    return None


def _infer_security_plus_domain(question_text: str, options: list[dict], justification: str | None) -> str:
    corpus = " ".join([
        question_text or "",
        " ".join([opt.get("text", "") for opt in options]),
        justification or "",
    ]).lower()

    best_domain = "General Security Concepts"
    best_score = 0
    for domain, keywords in SECURITY_PLUS_DOMAIN_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in corpus)
        if score > best_score:
            best_domain = domain
            best_score = score
    return best_domain


def _normalize_options(raw_options) -> list[dict]:
    if not isinstance(raw_options, list):
        return []

    normalized: list[dict] = []
    for index, raw in enumerate(raw_options):
        if isinstance(raw, dict):
            key = str(raw.get("key") or _option_key_from_index(index)).strip().upper()
            text = str(raw.get("text") or "").strip()
        else:
            key = _option_key_from_index(index)
            text = str(raw or "").strip()
        if not key or not text:
            continue
        normalized.append({"key": key, "text": text})
    return normalized


def _normalize_correct_keys(raw_question: dict, options: list[dict]) -> list[str]:
    option_keys = [opt["key"] for opt in options]
    option_key_set = set(option_keys)
    resolved: list[str] = []

    def add_key(value) -> None:
        if isinstance(value, int):
            if 0 <= value < len(option_keys):
                resolved.append(option_keys[value])
            return

        text = str(value or "").strip().upper()
        if not text:
            return
        if text in option_key_set:
            resolved.append(text)
            return
        if text.isdigit():
            add_key(int(text))

    if isinstance(raw_question.get("correct_options"), list):
        for item in raw_question.get("correct_options") or []:
            add_key(item)
    else:
        answer = raw_question.get("correct_answer")
        if isinstance(answer, list):
            for item in answer:
                add_key(item)
        else:
            add_key(answer)

    deduped: list[str] = []
    seen = set()
    for key in resolved:
        if key in seen:
            continue
        seen.add(key)
        deduped.append(key)
    return deduped


def _normalize_multi_select(raw_question: dict, correct_options: list[str]) -> bool:
    # Derived from the answer key, never trusted from the file (M-A5).
    return len(correct_options) > 1


def _normalize_question_format(raw_question: dict, correct_options: list[str]) -> str | None:
    explicit = _normalize_text(raw_question.get("question_format"))
    if explicit:
        return explicit

    if len(correct_options) > 1:
        return "multiple_response"
    question_type = str(raw_question.get("question_type") or "").strip().lower()
    if question_type == "best_answer":
        return "best_answer"
    # question_type vocabulary (schema v3): single_response | multiple_response.
    # Legacy CISSP values (application/knowledge) are cognitive levels, not formats.
    if question_type in {"single_response", "multiple_response", "application", "knowledge"}:
        return "single_choice"
    return None


def _normalize_language(raw_question: dict, default_language: str | None = None) -> str | None:
    value = _normalize_text(raw_question.get("language")) or _normalize_text(default_language)
    if not value:
        return None
    lowered = value.lower()
    if lowered in {"pt", "pt-br", "pt_br"}:
        return "pt-BR"
    if lowered.startswith("en"):
        return "en"
    return value[:8]


def _resolve_rationale(
    raw_question: dict,
    options: list[dict],
    correct_options: list[str],
    language: str | None = None,
) -> tuple[str, bool]:
    """(rationale, explanation_missing). Missing explanations get a localized placeholder."""
    written = (
        _normalize_text(raw_question.get("correct_rationale"))
        or _normalize_text(raw_question.get("justification"))
        or _normalize_text(raw_question.get("explanation"))
    )
    if written:
        return written, False
    return build_fallback_rationale(options, correct_options, language), True


def _normalize_question(raw: dict, *, certification, domain, language) -> dict | None:
    qid = str(raw.get("id") or "").strip()
    prompt = str(raw.get("question") or "").strip()
    if not qid or not prompt:
        return None

    options = _normalize_options(raw.get("options"))
    correct_options = _normalize_correct_keys(raw, options)
    if not options or not correct_options:
        return None

    justification, explanation_missing = _resolve_rationale(raw, options, correct_options, language)
    if not domain and certification == "Security+":
        domain = _infer_security_plus_domain(prompt, options, None if explanation_missing else justification)

    return {
        "id": qid,
        "question": prompt,
        "multi_select": _normalize_multi_select(raw, correct_options),
        "options": options,
        "correct_options": correct_options,
        "justification": justification,
        "explanation_missing": explanation_missing,
        "needs_review": bool(raw.get("needs_review")),
        "language": language,
        "domain": domain,
        "difficulty": raw.get("difficulty"),
        "certification": certification,
        "subject": raw.get("subject"),
        "subtopic": raw.get("subtopic"),
        "subdomain": raw.get("subdomain"),
        "objective_code": raw.get("objective_code"),
        "blueprint_code": raw.get("blueprint_code"),
        "keywords": raw.get("keywords"),
        "trap_patterns": raw.get("trap_patterns"),
        "question_format": _normalize_question_format(raw, correct_options),
        "correct_rationale": _normalize_text(raw.get("correct_rationale")) or justification,
        "incorrect_rationales": raw.get("incorrect_rationales"),
        "avg_time_seconds": raw.get("avg_time_seconds"),
        "global_accuracy_percent": raw.get("global_accuracy_percent"),
        "tags": _merge_tags(raw.get("tags"), raw.get("cross_domain_tags")),
        "citations": _normalize_citations(raw.get("citations")),
    }


def _normalize_wrapped_payload(file_name: str, payload: dict) -> list[dict]:
    exam = payload.get("exam") or {}
    questions = payload.get("questions") or []
    if not isinstance(questions, list):
        raise ValueError("Invalid questions payload")

    stem = os.path.splitext(file_name)[0]
    exam_id = str(exam.get("id") or _slugify(stem)).strip()
    title = str(exam.get("title") or exam_id or stem).strip()
    source = exam.get("source")
    default_certification = exam.get("certification") or _detect_certification(title, source, file_name)

    normalized_questions: list[dict] = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        normalized = _normalize_question(
            q,
            certification=q.get("certification") or default_certification,
            domain=q.get("domain") or q.get("topic"),
            language=_normalize_language(q, exam.get("language")),
        )
        if normalized:
            normalized_questions.append(normalized)

    return [{
        "exam": {
            "id": exam_id,
            "title": title,
            "source": source,
            # Computed, never trusted from the file (the declared count drifted: 995 vs 1260).
            "question_count": len(normalized_questions),
        },
        "questions": normalized_questions,
    }]


def _normalize_flat_payload(file_name: str, payload: list) -> list[dict]:
    stem = os.path.splitext(file_name)[0]
    grouped: dict[str, list[dict]] = {}

    for raw in payload:
        if not isinstance(raw, dict):
            continue
        certification = raw.get("certification") or _detect_certification(file_name, stem) or "Question Bank"
        grouped.setdefault(str(certification), []).append(raw)

    bundles: list[dict] = []
    multi_group = len(grouped) > 1

    for certification, group_items in sorted(grouped.items(), key=lambda item: item[0]):
        if multi_group:
            exam_id = _slugify(f"{stem}-{certification}")
        else:
            exam_id = _slugify(stem)

        normalized_questions: list[dict] = []
        for raw in group_items:
            normalized = _normalize_question(
                raw,
                certification=raw.get("certification") or certification,
                domain=raw.get("domain") or raw.get("domain_primary"),
                language=_normalize_language(raw),
            )
            if normalized:
                normalized_questions.append(normalized)

        bundles.append({
            "exam": {
                "id": exam_id,
                "title": f"{certification} - Banco de Questoes",
                "source": file_name,
                "question_count": len(normalized_questions),
            },
            "questions": normalized_questions,
        })

    return bundles


def _normalize_payload(file_name: str, payload) -> list[dict]:
    if isinstance(payload, dict):
        return _normalize_wrapped_payload(file_name, payload)
    if isinstance(payload, list):
        return _normalize_flat_payload(file_name, payload)
    raise ValueError("Unsupported JSON structure")


def _is_deleted(question: Question | None) -> bool:
    """Deleted by an editor (not merely missing from the source file)."""
    return bool(
        question is not None
        and not question.is_active
        and question.deactivated_reason != QUESTION_DEACTIVATED_REMOVED_FROM_SOURCE
    )


def _imported_active_question_ids(db: Session, exam_id: str) -> set[str]:
    rows = db.execute(
        select(Question.id)
        .join(QuestionBank, QuestionBank.stable_question_id == Question.id)
        .where(
            Question.exam_id == exam_id,
            Question.is_active.is_(True),
            QuestionBank.last_import_hash.is_not(None),
        )
    ).scalars().all()
    return set(rows)


_REFRESH_LOOKUP_CHUNK = 500


def _chunked(values: list, size: int = _REFRESH_LOOKUP_CHUNK):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def _refresh_lookup_rows(db: Session, question_ids: list[str]) -> tuple[dict, dict, dict]:
    """Bulk-load the columns :func:`_needs_metadata_refresh` compares (3 queries per chunk).

    Returns ``(questions, banks, versions)`` keyed by question id / version id. Plain
    rows (no ORM identity map) keep an unchanged re-ingest cheap (L: ~4 queries per
    question before).
    """
    questions: dict[str, Any] = {}
    banks: dict[str, Any] = {}
    versions: dict[int, Any] = {}
    for chunk in _chunked(question_ids):
        for row in db.execute(
            select(
                Question.id,
                Question.is_active,
                Question.deactivated_reason,
                Question.language,
                Question.needs_review,
                Question.domain,
                Question.difficulty,
                Question.certification,
                Question.tags_json,
                Question.citations_json,
            ).where(Question.id.in_(chunk))
        ).all():
            questions[row.id] = row
        for row in db.execute(
            select(
                QuestionBank.stable_question_id,
                QuestionBank.published_version_id,
                QuestionBank.last_import_hash,
            ).where(QuestionBank.stable_question_id.in_(chunk))
        ).all():
            banks[row.stable_question_id] = row
    version_ids = sorted({row.published_version_id for row in banks.values() if row.published_version_id})
    for chunk in _chunked(version_ids):
        for row in db.execute(
            select(
                QuestionVersion.id,
                QuestionVersion.question_format,
                QuestionVersion.correct_rationale,
                QuestionVersion.objective_code,
                QuestionVersion.blueprint_code,
            ).where(QuestionVersion.id.in_(chunk))
        ).all():
            versions[row.id] = row
    return questions, banks, versions


def _needs_metadata_refresh(db: Session, bundles: list[dict]) -> bool:
    """Whether an already-imported file (same hash) still needs a metadata backfill.

    Loads everything it compares in bulk (a handful of queries per file instead of
    ~4 per question).
    """
    for bundle in bundles:
        exam = bundle.get("exam") or {}
        exam_id = str(exam.get("id") or "").strip()
        db_exam = db.get(Exam, exam_id) if exam_id else None
        if exam_id and not db_exam:
            return True
        if db_exam is not None and db_exam.question_count != exam.get("question_count"):
            return True

        file_ids = {str(q.get("id") or "").strip() for q in bundle.get("questions") or []}
        if exam_id and _imported_active_question_ids(db, exam_id) - file_ids:
            return True

        wanted_ids = sorted(qid for qid in file_ids if qid)
        questions, banks, versions = _refresh_lookup_rows(db, wanted_ids)

        for q in bundle.get("questions") or []:
            qid = str(q.get("id") or "").strip()
            if not qid:
                continue
            existing = questions.get(qid)
            if existing is None:
                return True
            if not existing.is_active and existing.deactivated_reason != QUESTION_DEACTIVATED_REMOVED_FROM_SOURCE:
                continue  # deleted by an editor (see _is_deleted): never resurrected
            if not existing.is_active:
                return True
            bank = banks.get(qid)
            if bank is None or not bank.published_version_id or not bank.last_import_hash:
                return True
            if bank.last_import_hash in LEGACY_IMPORT_MARKERS:
                return True
            published_version = versions.get(bank.published_version_id)
            if published_version is None:
                return True
            if not published_version.question_format or not published_version.correct_rationale:
                return True
            if (existing.language or None) != (q.get("language") or None):
                return True
            if bool(q.get("needs_review")) and not existing.needs_review:
                return True
            if q.get("domain") and existing.domain != q.get("domain"):
                return True
            if q.get("difficulty") and existing.difficulty != q.get("difficulty"):
                return True
            if q.get("certification") and existing.certification != q.get("certification"):
                return True
            if q.get("objective_code") and published_version.objective_code != q.get("objective_code"):
                return True
            if q.get("blueprint_code") and published_version.blueprint_code != q.get("blueprint_code"):
                return True
            if q.get("tags") and not existing.tags_json:
                return True
            if q.get("citations") and not existing.citations_json:
                return True
    return False


def _delete_empty_exams(db: Session) -> None:
    """Delete exams without any question (active or not) that nothing else references."""
    empty_exam_ids = db.execute(
        select(Exam.id)
        .outerjoin(Question, Question.exam_id == Exam.id)
        .group_by(Exam.id)
        .having(func.count(Question.id) == 0)
    ).scalars().all()

    for exam_id in empty_exam_ids:
        referenced = db.execute(
            select(
                exists().where(ExamSession.exam_id == exam_id)
                | exists().where(StudySession.exam_id == exam_id)
                | exists().where(QuestionVersion.exam_id == exam_id)
            )
        ).scalar()
        if referenced:
            continue
        exam = db.get(Exam, exam_id)
        if exam:
            db.delete(exam)


def _deactivate_removed_questions(db: Session, exam_id: str, file_ids: set[str]) -> int:
    """Soft-deactivate previously imported questions that disappeared from the source file.

    Questions created editorially (bank.last_import_hash IS NULL) are never touched.
    """
    removed_ids = sorted(_imported_active_question_ids(db, exam_id) - file_ids)
    now = datetime.now(timezone.utc)
    for qid in removed_ids:
        question = db.get(Question, qid)
        if question is None:
            continue
        question.is_active = False
        question.deactivated_reason = QUESTION_DEACTIVATED_REMOVED_FROM_SOURCE
        question.deactivated_at = now
        db.add(
            EditorialAuditLog(
                question_bank_id=qid,
                actor_role="system",
                action="import_deactivated",
                reason="Question no longer present in the source JSON.",
            )
        )
    return len(removed_ids)


def _import_payload(exam_id: str, q: dict) -> dict:
    correct_set = set(q.get("correct_options") or [])
    return {
        "id": q.get("id"),
        "exam_id": exam_id,
        "prompt": q.get("question"),
        "multi_select": bool(q.get("multi_select", False)),
        "domain": q.get("domain"),
        "difficulty": q.get("difficulty"),
        "certification": q.get("certification"),
        "subject": q.get("subject"),
        "subtopic": q.get("subtopic"),
        "subdomain": q.get("subdomain"),
        "objective_code": q.get("objective_code"),
        "blueprint_code": q.get("blueprint_code"),
        "keywords": q.get("keywords"),
        "trap_patterns": q.get("trap_patterns"),
        "question_format": q.get("question_format"),
        "tags": _normalize_tags(q.get("tags")),
        "citations": _normalize_citations(q.get("citations")),
        "options": [
            {
                "key": str(opt.get("key", "")).strip().upper(),
                "text": str(opt.get("text", "")).strip(),
                "is_correct": str(opt.get("key", "")).strip().upper() in correct_set,
            }
            for opt in (q.get("options") or [])
            if str(opt.get("key", "")).strip() and str(opt.get("text", "")).strip()
        ],
        "justification": q.get("justification"),
        "correct_rationale": q.get("correct_rationale"),
        "incorrect_rationales": q.get("incorrect_rationales"),
        "avg_time_seconds": q.get("avg_time_seconds"),
        "global_accuracy_percent": q.get("global_accuracy_percent"),
        "change_summary": "Import refresh",
    }


# --------------------------------------------------------------------------- domain weights (M-A6)

def sync_domain_blueprint_weights(db: Session) -> int:
    """Upsert the official domain weights (domain-level domain_blueprint rows)."""
    touched = 0
    for certification, rows in OFFICIAL_DOMAIN_WEIGHTS.items():
        for blueprint_code, domain, weight in rows:
            row = db.execute(
                select(DomainBlueprint).where(
                    DomainBlueprint.certification == certification,
                    DomainBlueprint.domain == domain,
                    DomainBlueprint.weight.is_not(None),
                )
            ).scalar_one_or_none()
            if row is None:
                row = db.execute(
                    select(DomainBlueprint).where(
                        DomainBlueprint.certification == certification,
                        DomainBlueprint.blueprint_code == blueprint_code,
                        DomainBlueprint.objective_code.is_(None),
                    )
                ).scalar_one_or_none()
            if row is None:
                db.add(
                    DomainBlueprint(
                        certification=certification,
                        blueprint_code=blueprint_code,
                        objective_code=None,
                        domain=domain,
                        title=domain,
                        description=f"Official {certification} exam domain weight ({weight:g}%).",
                        weight=weight,
                    )
                )
                touched += 1
                continue
            if row.weight != weight or row.domain != domain:
                row.weight = weight
                row.domain = domain
                row.updated_at = datetime.utcnow()
                touched += 1
    db.flush()
    return touched


def get_domain_blueprint_weights(db: Session, certification: str) -> dict[str, float]:
    """{domain: weight} for a certification (case-insensitive), from domain_blueprint."""
    wanted = str(certification or "").strip().lower()
    rows = db.execute(
        select(DomainBlueprint.certification, DomainBlueprint.domain, DomainBlueprint.weight).where(
            DomainBlueprint.weight.is_not(None),
            DomainBlueprint.domain.is_not(None),
        )
    ).all()
    return {domain: float(weight) for cert, domain, weight in rows if str(cert or "").strip().lower() == wanted}


# --------------------------------------------------------------------------- study modules (M-A7)

_MODULE_HEADING = re.compile(r"^##\s+M[óo]dulo\s+(\d+)\s*[–—-]\s*(.+?)\s*$", re.IGNORECASE)


def parse_markdown_modules(text: str) -> list[dict]:
    """Parse '## Módulo N – Title' sections (objective bullets + 'Principais tópicos')."""
    modules: list[dict] = []
    current: dict | None = None
    body: list[str] = []

    def close() -> None:
        if current is None:
            return
        lines = [line.rstrip() for line in body]
        while lines and not lines[0].strip():
            lines.pop(0)
        while lines and not lines[-1].strip():
            lines.pop()
        current["description"] = "\n".join(lines) or None
        modules.append(current)

    for line in text.splitlines():
        match = _MODULE_HEADING.match(line.strip())
        if match:
            close()
            number = int(match.group(1))
            current = {
                "code": f"M{number:02d}",
                "position": number,
                "title": match.group(2).strip(),
                "domain": None,
            }
            body = []
            continue
        if current is not None:
            body.append(line)
    close()
    return modules


def parse_domain_json_modules(payload: dict) -> list[dict]:
    modules: list[dict] = []
    for index, item in enumerate(payload.get("domains") or [], start=1):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        number = int(item.get("id") or index)
        modules.append({
            "code": f"D{number}",
            "position": number,
            "title": name,
            "domain": name,
            "description": str(item.get("description") or "").strip() or None,
        })
    return modules


def _study_track_dirs(*dirs: str | None) -> list[str]:
    """Existing, de-duplicated directories in lookup order."""
    resolved: list[str] = []
    for candidate in dirs:
        if not candidate or not os.path.isdir(candidate):
            continue
        absolute = os.path.abspath(candidate)
        if absolute not in resolved:
            resolved.append(absolute)
    return resolved


def load_study_modules(*search_dirs: str | None) -> dict[str, dict]:
    """{certification: {"source_file": ..., "modules": [...]}} for the known study-track files.

    Each file is looked up in ``search_dirs`` in order (first hit wins), so the
    non-licensed track files shipped in the image (``STUDY_TRACK_DIR``) are found even
    when the ``material/`` volume is empty. ``source_file`` keeps the stable
    ``material/<file>`` label whatever directory the file came from.
    """
    loaded: dict[str, dict] = {}
    directories = _study_track_dirs(*search_dirs)
    for file_name, certification, parser in STUDY_MODULE_SOURCES:
        path = next(
            (os.path.join(directory, file_name) for directory in directories if os.path.isfile(os.path.join(directory, file_name))),
            None,
        )
        if path is None:
            continue
        with open(path, "r", encoding="utf-8") as handle:
            if parser == "markdown_modules":
                modules = parse_markdown_modules(handle.read())
            else:
                payload = json.load(handle)
                certification = str(payload.get("certification") or certification)
                modules = parse_domain_json_modules(payload)
        loaded[certification] = {"source_file": f"material/{file_name}", "modules": modules}
    return loaded


def _configured_study_track_dir() -> str | None:
    try:
        from app.core.config import settings

        return str(getattr(settings, "study_track_dir", "") or "").strip() or None
    except Exception:  # pragma: no cover - settings unavailable
        return None


def sync_study_modules(
    db: Session,
    material_dir: str | None,
    *,
    study_track_dir: str | None = None,
) -> int:
    """Upsert the study track modules.

    Source files are looked up first in ``study_track_dir`` (default: the
    ``STUDY_TRACK_DIR`` setting) and then in ``material_dir`` (MATERIAL_DIR).
    """
    track_dir = study_track_dir if study_track_dir is not None else _configured_study_track_dir()
    search_dirs = _study_track_dirs(track_dir, material_dir)
    if not search_dirs:
        return 0
    total = 0
    for certification, spec in load_study_modules(*search_dirs).items():
        source_file = spec["source_file"]
        wanted = {module["code"]: module for module in spec["modules"]}
        existing = {
            row.code: row
            for row in db.execute(
                select(StudyModule).where(StudyModule.certification == certification)
            ).scalars().all()
        }
        for code, row in existing.items():
            if code not in wanted and row.source_file == source_file:
                db.delete(row)
        for code, module in wanted.items():
            row = existing.get(code)
            if row is None:
                row = StudyModule(certification=certification, code=code, source_file=source_file,
                                  position=module["position"], title=module["title"])
                db.add(row)
            row.position = module["position"]
            row.title = module["title"][:255]
            row.description = module.get("description")
            row.domain = module.get("domain")
            row.source_file = source_file
            total += 1
    db.flush()
    return total


def _resolve_material_dir(questions_dir: str, material_dir: str | None) -> str | None:
    candidates = []
    if material_dir:
        candidates.append(material_dir)
    try:
        from app.core.config import settings

        candidates.append(settings.material_dir)
    except Exception:  # pragma: no cover - settings unavailable
        pass
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(questions_dir)), "material"))
    for candidate in candidates:
        if candidate and os.path.isdir(candidate):
            return os.path.abspath(candidate)
    return None


# --------------------------------------------------------------------------- entrypoint

def ingest_questions_from_dir(db: Session, dir_path: str, *, material_dir: str | None = None) -> dict:
    dir_path = os.path.abspath(dir_path)
    if not os.path.isdir(dir_path):
        return {"imported": 0, "skipped": 0, "errors": [f"QUESTION_JSON_DIR not found: {dir_path}"]}

    imported = 0
    skipped = 0
    errors: list[str] = []
    stats = {
        "questions_imported": 0,
        "skipped_deleted": 0,
        "skipped_editorial": 0,
        "reactivated": 0,
        "deactivated": 0,
    }

    for name in sorted(os.listdir(dir_path)):
        if not name.lower().endswith(".json"):
            continue
        file_path = os.path.join(dir_path, name)
        try:
            digest = _sha256_file(file_path)

            with open(file_path, "r", encoding="utf-8") as f:
                payload = json.load(f)

            bundles = _normalize_payload(name, payload)
            if not bundles:
                raise ValueError("No supported questions found")

            # skip if exact file hash already imported and no metadata backfill is needed
            exists_stmt = select(ImportState).where(ImportState.file_name == name, ImportState.file_sha256 == digest)
            existing_import = db.execute(exists_stmt).scalar_one_or_none()
            if existing_import and not _needs_metadata_refresh(db, bundles):
                skipped += 1
                continue

            imported_questions = 0
            file_errors: list[str] = []
            file_stats = dict.fromkeys(stats, 0)

            for bundle in bundles:
                exam = bundle.get("exam") or {}
                questions = bundle.get("questions") or []
                exam_id = str(exam.get("id") or "").strip()
                title = str(exam.get("title") or exam_id or name).strip()
                if not exam_id:
                    raise ValueError("Missing exam.id")

                db_exam = db.get(Exam, exam_id)
                if not db_exam:
                    db_exam = Exam(id=exam_id, title=title, source=exam.get("source"))
                    db.add(db_exam)
                db_exam.title = title
                db_exam.source = exam.get("source")
                db_exam.question_count = len(questions)
                db.flush()

                for q in questions:
                    qid = q.get("id")
                    if not qid or not q.get("question"):
                        continue
                    existing = db.get(Question, qid)
                    if _is_deleted(existing):
                        # Deleted by an editor: never resurrected by the import.
                        file_stats["skipped_deleted"] += 1
                        continue
                    try:
                        with db.begin_nested():
                            result = sync_imported_question_publication(db, _import_payload(exam_id, q))
                            db_q = db.get(Question, qid)
                            if db_q is None:
                                raise ValueError("Question projection was not created.")
                            db_q.language = q.get("language")
                            db_q.needs_review = bool(q.get("needs_review")) or bool(db_q.explanation_missing)
                            if not db_q.is_active:
                                db_q.is_active = True
                                db_q.deactivated_reason = None
                                db_q.deactivated_at = None
                                file_stats["reactivated"] += 1
                            db.flush()
                        if result.get("skipped_editorial"):
                            file_stats["skipped_editorial"] += 1
                        imported_questions += 1
                    except Exception as exc:
                        file_errors.append(f"{name}:{qid}: {exc}")

                if questions:
                    file_ids = {str(q.get("id") or "").strip() for q in questions}
                    file_stats["deactivated"] += _deactivate_removed_questions(db, exam_id, file_ids)

            _delete_empty_exams(db)

            if imported_questions == 0 and file_errors:
                db.rollback()
                errors.extend(file_errors)
                continue

            if not existing_import:
                db.add(ImportState(file_name=name, file_sha256=digest))
            db.commit()
            errors.extend(file_errors)
            imported += 1
            file_stats["questions_imported"] = imported_questions
            for key, value in file_stats.items():
                stats[key] += value

        except Exception as e:
            db.rollback()
            errors.append(f"{name}: {e}")

    try:
        weights = sync_domain_blueprint_weights(db)
        modules = sync_study_modules(db, _resolve_material_dir(dir_path, material_dir))
        db.commit()
    except Exception as exc:
        db.rollback()
        weights = 0
        modules = 0
        errors.append(f"reference data: {exc}")

    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
        **stats,
        "domain_weights_updated": weights,
        "study_modules": modules,
    }
