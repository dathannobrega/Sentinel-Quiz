"""Admin question authoring helpers (moved out of api/admin.py)."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Exam, ExamSession, Option, Question, QuestionBank, QuestionVersion, QuestionVersionOption
from app.schemas import AdminCreateQuestionIn


NO_CERTIFICATION_LABEL = "Sem certificacao"


class AdminQuestionPayloadError(ValueError):
    pass


def _clean_citation_value(value: Any):
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
        cleaned_dict: Dict[str, Any] = {}
        for key, item in value.items():
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            cleaned = _clean_citation_value(item)
            if cleaned is not None:
                cleaned_dict[clean_key] = cleaned
        return cleaned_dict or None
    return None


def _strip_or_none(value: Optional[str]) -> Optional[str]:
    return (value.strip() or None) if value else None


def _normalize_tags(tags: Optional[List[str]]) -> List[str]:
    normalized: List[str] = []
    seen = set()
    for tag in tags or []:
        clean = str(tag or "").strip()
        if not clean:
            continue
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(clean)
    return normalized


def _normalize_citations(citations: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    seen = set()
    for item in citations or []:
        if not isinstance(item, dict):
            continue
        normalized_item: Dict[str, Any] = {}
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


def normalize_admin_question_payload(db: Session, payload: AdminCreateQuestionIn) -> Dict[str, Any]:
    """Validate/normalise an admin question payload into the editorial draft format.

    Raises ``AdminQuestionPayloadError`` with a user facing message.
    """
    exam_id = payload.exam_id.strip()
    question_id = payload.id.strip()
    prompt = payload.prompt.strip()
    if not db.get(Exam, exam_id):
        raise AdminQuestionPayloadError("Exam does not exist. Create exam first.")
    if not question_id:
        raise AdminQuestionPayloadError("Question ID is required.")
    if not prompt:
        raise AdminQuestionPayloadError("Prompt is required.")

    normalized_options: List[Dict[str, Any]] = []
    seen_option_keys = set()
    for opt in payload.options:
        key = opt.key.strip().upper()
        text = opt.text.strip()
        if not key or not text:
            continue
        if key in seen_option_keys:
            raise AdminQuestionPayloadError(f"Duplicate option key: {key}")
        seen_option_keys.add(key)
        normalized_options.append({"key": key, "text": text, "is_correct": opt.is_correct})
    if len(normalized_options) < 2:
        raise AdminQuestionPayloadError("At least two valid options are required.")

    correct_set = {k.strip().upper() for k in payload.correct_keys if k and k.strip()}
    for opt in normalized_options:
        if opt["is_correct"]:
            correct_set.add(opt["key"])
    if not correct_set:
        raise AdminQuestionPayloadError("At least one correct option is required.")
    invalid_correct_keys = sorted(correct_set - seen_option_keys)
    if invalid_correct_keys:
        raise AdminQuestionPayloadError(f"Correct option not found: {', '.join(invalid_correct_keys)}")

    return {
        "id": question_id,
        "exam_id": exam_id,
        "prompt": prompt,
        "multi_select": bool(payload.multi_select or len(correct_set) > 1),
        "domain": _strip_or_none(payload.domain),
        "difficulty": _strip_or_none(payload.difficulty),
        "certification": _strip_or_none(payload.certification),
        "subject": _strip_or_none(payload.subject),
        "subtopic": _strip_or_none(payload.subtopic),
        "subdomain": _strip_or_none(payload.subdomain),
        "objective_code": _strip_or_none(payload.objective_code),
        "blueprint_code": _strip_or_none(payload.blueprint_code),
        "keywords": [str(item).strip() for item in (payload.keywords or []) if str(item).strip()],
        "trap_patterns": [str(item).strip() for item in (payload.trap_patterns or []) if str(item).strip()],
        "question_format": _strip_or_none(payload.question_format),
        "tags": _normalize_tags(payload.tags),
        "citations": _normalize_citations(payload.citations),
        "options": [
            {"key": opt["key"], "text": opt["text"], "is_correct": opt["key"] in correct_set}
            for opt in normalized_options
        ],
        "justification": _strip_or_none(payload.justification),
        "correct_rationale": _strip_or_none(payload.correct_rationale),
        "incorrect_rationales": [
            str(item).strip()
            for item in (payload.incorrect_rationales or [])
            if str(item).strip()
        ],
        "avg_time_seconds": payload.avg_time_seconds,
        "global_accuracy_percent": payload.global_accuracy_percent,
        "change_summary": _strip_or_none(payload.change_summary),
    }


def build_admin_overview(db: Session) -> Dict[str, Any]:
    exam_count = int(db.execute(select(func.count()).select_from(Exam)).scalar_one() or 0)
    completed_session_count = int(
        db.execute(
            select(func.count()).select_from(ExamSession).where(ExamSession.completed_at.is_not(None))
        ).scalar_one()
        or 0
    )
    breakdown: Dict[str, int] = {}
    question_count = 0
    for certification, count in db.execute(
        select(Question.certification, func.count()).group_by(Question.certification)
    ).all():
        label = certification or NO_CERTIFICATION_LABEL
        breakdown[label] = breakdown.get(label, 0) + int(count or 0)
        question_count += int(count or 0)
    return {
        "exam_count": exam_count,
        "question_count": question_count,
        "completed_session_count": completed_session_count,
        "question_breakdown": breakdown,
    }


def _search_term(search: Optional[str]) -> Optional[str]:
    if not search:
        return None
    term = f"%{search.strip()}%"
    return None if term == "%%" else term


def list_admin_questions(
    db: Session,
    *,
    exam_id: Optional[str],
    search: Optional[str],
    limit: int,
) -> List[Dict[str, Any]]:
    """Published questions first, then draft-only questions, up to ``limit`` items."""
    term = _search_term(search)
    normalized_exam_id = exam_id.strip() if exam_id else None

    stmt = select(Question).order_by(Question.id.asc())
    if normalized_exam_id:
        stmt = stmt.where(Question.exam_id == normalized_exam_id)
    if term:
        stmt = stmt.where(
            (Question.id.ilike(term))
            | (Question.prompt.ilike(term))
            | (Question.domain.ilike(term))
            | (Question.certification.ilike(term))
        )
    questions = db.execute(stmt.limit(limit)).scalars().all()
    # NOTE: the previous implementation returned [] here when no published question
    # matched, which hid draft-only questions; drafts are now always listed.
    qids = [q.id for q in questions]
    counts: Dict[str, Dict[str, int]] = {qid: {"option_count": 0, "correct_count": 0} for qid in qids}
    for qid, is_correct in db.execute(
        select(Option.question_id, Option.is_correct).where(Option.question_id.in_(qids))
    ).all():
        bucket = counts.setdefault(qid, {"option_count": 0, "correct_count": 0})
        bucket["option_count"] += 1
        if is_correct:
            bucket["correct_count"] += 1

    bank_rows = db.execute(select(QuestionBank).where(QuestionBank.stable_question_id.in_(qids))).scalars().all()
    bank_map = {row.stable_question_id: row for row in bank_rows}
    version_ids = {
        version_id
        for bank in bank_rows
        for version_id in (bank.draft_version_id, bank.published_version_id)
        if version_id
    }
    version_map: Dict[int, QuestionVersion] = {}
    if version_ids:
        version_map = {
            row.id: row
            for row in db.execute(select(QuestionVersion).where(QuestionVersion.id.in_(version_ids))).scalars().all()
        }

    def _version_number(version_id: Optional[int]) -> Optional[int]:
        if version_id and version_id in version_map:
            return version_map[version_id].version_number
        return None

    items: List[Dict[str, Any]] = []
    for q in questions:
        bank = bank_map.get(q.id)
        items.append({
            "id": q.id,
            "exam_id": q.exam_id,
            "prompt": q.prompt,
            "multi_select": q.multi_select,
            "domain": q.domain,
            "difficulty": q.difficulty,
            "certification": q.certification,
            "option_count": counts.get(q.id, {}).get("option_count", 0),
            "correct_count": counts.get(q.id, {}).get("correct_count", 0),
            "editorial_status": bank.review_status if bank else "published",
            "draft_version_number": _version_number(bank.draft_version_id) if bank else None,
            "published_version_number": _version_number(bank.published_version_id) if bank else None,
            "loaded_from": "published",
        })

    remaining = max(limit - len(items), 0)
    if remaining <= 0:
        return items

    draft_stmt = (
        select(QuestionBank, QuestionVersion)
        .join(QuestionVersion, QuestionVersion.id == QuestionBank.draft_version_id)
        .outerjoin(Question, Question.id == QuestionBank.stable_question_id)
        .where(Question.id.is_(None))
        .order_by(QuestionBank.stable_question_id.asc())
        .limit(remaining)
    )
    if normalized_exam_id:
        draft_stmt = draft_stmt.where(QuestionVersion.exam_id == normalized_exam_id)
    if term:
        draft_stmt = draft_stmt.where(
            (QuestionBank.stable_question_id.ilike(term))
            | (QuestionVersion.prompt.ilike(term))
            | (QuestionVersion.domain.ilike(term))
            | (QuestionVersion.certification.ilike(term))
        )
    draft_rows = db.execute(draft_stmt).all()
    draft_version_ids = [version.id for _bank, version in draft_rows]
    draft_counts: Dict[int, Dict[str, int]] = {
        version_id: {"option_count": 0, "correct_count": 0} for version_id in draft_version_ids
    }
    if draft_version_ids:
        for version_id, is_correct in db.execute(
            select(QuestionVersionOption.version_id, QuestionVersionOption.is_correct)
            .where(QuestionVersionOption.version_id.in_(draft_version_ids))
        ).all():
            bucket = draft_counts.setdefault(version_id, {"option_count": 0, "correct_count": 0})
            bucket["option_count"] += 1
            if is_correct:
                bucket["correct_count"] += 1

    for bank, version in draft_rows:
        count_row = draft_counts.get(version.id, {"option_count": 0, "correct_count": 0})
        items.append({
            "id": bank.stable_question_id,
            "exam_id": version.exam_id,
            "prompt": version.prompt,
            "multi_select": version.multi_select,
            "domain": version.domain,
            "difficulty": version.difficulty,
            "certification": version.certification,
            "option_count": count_row["option_count"],
            "correct_count": count_row["correct_count"],
            "editorial_status": bank.review_status,
            "draft_version_number": version.version_number,
            # Only versions of the published list were preloaded (historical behaviour).
            "published_version_number": _version_number(bank.published_version_id),
            "loaded_from": "draft",
        })
    return items
