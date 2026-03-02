from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import func, select
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import json

from app.api.deps import get_current_user_optional
from app.core.config import settings
from app.db.session import get_db
from app.models import (
    EditorialAuditLog,
    Exam,
    ExamSession,
    Explanation,
    ImportState,
    Option,
    Question,
    QuestionBank,
    QuestionVersion,
    QuestionVersionOption,
    SessionAnswer,
    SessionQuestion,
    StudySession,
    User,
)
from app.services.admin_analytics import build_admin_question_analytics
from app.services.editorial import (
    build_admin_question_document,
    delete_question_with_history,
    list_editorial_audit_logs,
    list_question_versions,
    publish_question,
    rollback_question_to_version,
    save_question_draft,
    submit_question_for_review,
)
from app.services.ingest import ingest_questions_from_dir

router = APIRouter(prefix="/api/admin", tags=["admin"])

logger = logging.getLogger("app.security.admin")


def _admin_key_allowed(x_admin_key: Optional[str]) -> bool:
    if x_admin_key and not settings.admin_api_key_enabled():
        logger.warning(
            "X-Admin-Key authentication attempt rejected",
            extra={
                "event": "admin_key_rejected",
                "environment": settings.environment,
            },
        )
        return False
    if not settings.admin_api_key_enabled():
        return False
    return bool(x_admin_key and x_admin_key == settings.admin_api_key)


def _require_roles(
    *,
    allowed_roles: set[str],
    x_admin_key: Optional[str],
    current_user: User | None,
):
    if _admin_key_allowed(x_admin_key):
        return True
    if current_user and current_user.is_active and current_user.role in allowed_roles:
        return True
    if current_user:
        raise HTTPException(status_code=403, detail="Forbidden")
    raise HTTPException(status_code=401, detail="Unauthorized")


def require_admin(
    x_admin_key: Optional[str] = Header(default=None),
    current_user = Depends(get_current_user_optional),
):
    return _require_roles(
        allowed_roles={"admin", "editor"},
        x_admin_key=x_admin_key,
        current_user=current_user,
    )


def require_reviewer(
    x_admin_key: Optional[str] = Header(default=None),
    current_user = Depends(get_current_user_optional),
):
    return _require_roles(
        allowed_roles={"admin", "reviewer"},
        x_admin_key=x_admin_key,
        current_user=current_user,
    )


def require_platform_admin(
    x_admin_key: Optional[str] = Header(default=None),
    current_user = Depends(get_current_user_optional),
):
    return _require_roles(
        allowed_roles={"admin"},
        x_admin_key=x_admin_key,
        current_user=current_user,
    )


def _actor_role(current_user: User | None) -> str:
    if current_user and current_user.role:
        return current_user.role
    return "admin_key"

class AdminCreateExamIn(BaseModel):
    id: str
    title: str
    source: Optional[str] = None
    question_count: Optional[int] = None

class AdminOptionIn(BaseModel):
    key: str
    text: str
    is_correct: Optional[bool] = None

class AdminCreateQuestionIn(BaseModel):
    id: str
    exam_id: str
    prompt: str
    multi_select: bool = False
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    tags: Optional[List[str]] = None
    citations: Optional[List[Dict[str, Any]]] = None
    options: List[AdminOptionIn]
    correct_keys: List[str] = Field(default_factory=list)
    justification: Optional[str] = None
    change_summary: Optional[str] = None

class AdminOptionOut(BaseModel):
    key: str
    text: str
    is_correct: bool

class AdminQuestionOut(BaseModel):
    id: str
    exam_id: str
    prompt: str
    multi_select: bool
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    tags: Optional[List[str]] = None
    citations: Optional[List[Dict[str, Any]]] = None
    options: List[AdminOptionOut]
    correct_keys: List[str]
    justification: Optional[str] = None
    change_summary: Optional[str] = None
    editorial_status: Optional[str] = None
    loaded_from: Optional[str] = None
    version_id: Optional[int] = None
    version_number: Optional[int] = None
    published_version_number: Optional[int] = None
    draft_version_number: Optional[int] = None

class AdminQuestionSummaryOut(BaseModel):
    id: str
    exam_id: str
    prompt: str
    multi_select: bool
    domain: Optional[str] = None
    difficulty: Optional[str] = None
    certification: Optional[str] = None
    option_count: int
    correct_count: int
    editorial_status: Optional[str] = None
    draft_version_number: Optional[int] = None
    published_version_number: Optional[int] = None
    loaded_from: Optional[str] = None

class AdminOverviewOut(BaseModel):
    exam_count: int
    question_count: int
    completed_session_count: int
    question_breakdown: Dict[str, int]


class AdminAnalyticsSummaryOut(BaseModel):
    tracked_questions: int
    questions_with_signals: int
    total_attempts: int
    exam_attempts: int
    study_attempts: int
    total_review_pressure: int
    average_wrong_rate_percent: float


class AdminHardestQuestionOut(BaseModel):
    id: str
    exam_id: str
    exam_title: Optional[str] = None
    prompt: str
    domain: Optional[str] = None
    certification: Optional[str] = None
    difficulty: Optional[str] = None
    attempts_total: int
    exam_attempts: int
    study_attempts: int
    wrong_count: int
    wrong_rate_percent: float
    low_confidence_count: int
    low_confidence_rate_percent: float
    review_pressure_count: int
    avg_study_elapsed_seconds: Optional[float] = None
    difficulty_score: float


class AdminWeakDomainOut(BaseModel):
    domain: str
    tracked_questions: int
    attempts_total: int
    wrong_count: int
    wrong_rate_percent: float
    low_confidence_count: int
    review_pressure_count: int


class AdminWeakExamOut(BaseModel):
    exam_id: str
    exam_title: str
    tracked_questions: int
    attempts_total: int
    wrong_count: int
    wrong_rate_percent: float
    low_confidence_count: int
    review_pressure_count: int


class AdminQuestionAnalyticsOut(BaseModel):
    summary: AdminAnalyticsSummaryOut
    hardest_questions: List[AdminHardestQuestionOut]
    weakest_domains: List[AdminWeakDomainOut]
    weakest_exams: List[AdminWeakExamOut]


class AdminQuestionVersionOut(BaseModel):
    id: int
    question_id: str
    version_number: int
    status: str
    change_summary: Optional[str] = None
    review_notes: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    published_at: Optional[str] = None
    option_count: int
    correct_count: int
    is_current_draft: bool = False
    is_current_published: bool = False


class AdminAuditLogOut(BaseModel):
    id: int
    question_id: Optional[str] = None
    question_version_id: Optional[int] = None
    actor_user_id: Optional[str] = None
    actor_role: Optional[str] = None
    action: str
    reason: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None


class AdminReviewActionIn(BaseModel):
    reason: Optional[str] = None


class AdminRollbackIn(BaseModel):
    version_id: int
    reason: Optional[str] = None


class AdminUserOut(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    role: str
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    exam_session_count: int = 0
    study_session_count: int = 0


class AdminUserUpdateIn(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


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

@router.post("/ingest")
def admin_ingest(_: bool = Depends(require_platform_admin), db: Session = Depends(get_db)):
    res = ingest_questions_from_dir(db, settings.question_json_dir)
    return res

@router.get("/overview", response_model=AdminOverviewOut)
def admin_overview(_: bool = Depends(require_admin), db: Session = Depends(get_db)):
    exams = db.execute(select(Exam)).scalars().all()
    questions = db.execute(select(Question)).scalars().all()
    completed_sessions = db.execute(
        select(ExamSession.id).where(ExamSession.completed_at.is_not(None))
    ).scalars().all()

    breakdown: Dict[str, int] = {}
    for q in questions:
        key = q.certification or "Sem certificacao"
        breakdown[key] = breakdown.get(key, 0) + 1

    return AdminOverviewOut(
        exam_count=len(exams),
        question_count=len(questions),
        completed_session_count=len(completed_sessions),
        question_breakdown=breakdown,
    )


@router.get("/users", response_model=List[AdminUserOut])
def admin_list_users(_: bool = Depends(require_platform_admin), db: Session = Depends(get_db)):
    exam_counts = {
        user_id: count
        for user_id, count in db.execute(
            select(ExamSession.user_id, func.count(ExamSession.id))
            .where(ExamSession.user_id.is_not(None))
            .group_by(ExamSession.user_id)
        ).all()
    }
    study_counts = {
        user_id: count
        for user_id, count in db.execute(
            select(StudySession.user_id, func.count(StudySession.id))
            .where(StudySession.user_id.is_not(None))
            .group_by(StudySession.user_id)
        ).all()
    }
    users = db.execute(select(User).order_by(User.created_at.desc(), User.email.asc())).scalars().all()
    return [
        AdminUserOut(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            role=user.role,
            is_active=user.is_active,
            created_at=user.created_at.isoformat() if user.created_at else None,
            updated_at=user.updated_at.isoformat() if user.updated_at else None,
            exam_session_count=int(exam_counts.get(user.id, 0) or 0),
            study_session_count=int(study_counts.get(user.id, 0) or 0),
        )
        for user in users
    ]


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def admin_update_user(
    user_id: str,
    payload: AdminUserUpdateIn,
    current_user: User | None = Depends(get_current_user_optional),
    _: bool = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    allowed_roles = {"student", "editor", "reviewer", "admin"}
    changed = False

    if payload.role is not None:
        normalized_role = str(payload.role or "").strip().lower()
        if normalized_role not in allowed_roles:
            raise HTTPException(status_code=400, detail="Invalid role.")
        if user.role != normalized_role:
            user.role = normalized_role
            changed = True

    if payload.is_active is not None and user.is_active != bool(payload.is_active):
        user.is_active = bool(payload.is_active)
        changed = True

    if changed:
        db.commit()
        db.refresh(user)
        logger.info(
            "Admin updated user account",
            extra={
                "event": "admin_user_update",
                "actor_user_id": current_user.id if current_user else None,
                "target_user_id": user.id,
                "new_role": user.role,
                "is_active": user.is_active,
            },
        )

    exam_session_count = int(
        db.execute(
            select(func.count(ExamSession.id)).where(ExamSession.user_id == user.id)
        ).scalar_one()
        or 0
    )
    study_session_count = int(
        db.execute(
            select(func.count(StudySession.id)).where(StudySession.user_id == user.id)
        ).scalar_one()
        or 0
    )
    return AdminUserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else None,
        updated_at=user.updated_at.isoformat() if user.updated_at else None,
        exam_session_count=exam_session_count,
        study_session_count=study_session_count,
    )


@router.get("/analytics/questions", response_model=AdminQuestionAnalyticsOut)
def admin_question_analytics(
    limit: int = Query(default=10, ge=3, le=30),
    _: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return AdminQuestionAnalyticsOut(
        **build_admin_question_analytics(
            db,
            limit=limit,
        )
    )

@router.post("/exams")
def admin_create_exam(payload: AdminCreateExamIn, _: bool = Depends(require_platform_admin), db: Session = Depends(get_db)):
    exam = db.get(Exam, payload.id)
    if not exam:
        exam = Exam(id=payload.id, title=payload.title, source=payload.source, question_count=payload.question_count)
        db.add(exam)
    else:
        exam.title = payload.title
        exam.source = payload.source
        exam.question_count = payload.question_count
    db.commit()
    return {"ok": True, "id": exam.id}

@router.post("/questions")
def admin_create_question(
    payload: AdminCreateQuestionIn,
    _: bool = Depends(require_admin),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    exam_id = payload.exam_id.strip()
    question_id = payload.id.strip()
    prompt = payload.prompt.strip()
    if not db.get(Exam, exam_id):
        raise HTTPException(status_code=400, detail="Exam does not exist. Create exam first.")
    if not question_id:
        raise HTTPException(status_code=400, detail="Question ID is required.")
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    normalized_tags = []
    seen_tags = set()
    for tag in payload.tags or []:
        clean = str(tag or "").strip()
        if not clean:
            continue
        key = clean.lower()
        if key in seen_tags:
            continue
        seen_tags.add(key)
        normalized_tags.append(clean)

    normalized_citations = []
    seen_citations = set()
    for item in payload.citations or []:
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
        if key in seen_citations:
            continue
        seen_citations.add(key)
        normalized_citations.append(normalized_item)

    normalized_options: List[AdminOptionIn] = []
    seen_option_keys = set()
    for opt in payload.options:
        key = opt.key.strip().upper()
        text = opt.text.strip()
        if not key or not text:
            continue
        if key in seen_option_keys:
            raise HTTPException(status_code=400, detail=f"Duplicate option key: {key}")
        seen_option_keys.add(key)
        normalized_options.append(AdminOptionIn(key=key, text=text, is_correct=opt.is_correct))
    if len(normalized_options) < 2:
        raise HTTPException(status_code=400, detail="At least two valid options are required.")

    correct_set = {k.strip().upper() for k in payload.correct_keys if k and k.strip()}
    for opt in normalized_options:
        if opt.is_correct:
            correct_set.add(opt.key.strip().upper())
    if not correct_set:
        raise HTTPException(status_code=400, detail="At least one correct option is required.")
    invalid_correct_keys = sorted(correct_set - seen_option_keys)
    if invalid_correct_keys:
        raise HTTPException(status_code=400, detail=f"Correct option not found: {', '.join(invalid_correct_keys)}")

    final_multi_select = bool(payload.multi_select or len(correct_set) > 1)
    normalized_payload = {
        "id": question_id,
        "exam_id": exam_id,
        "prompt": prompt,
        "multi_select": final_multi_select,
        "domain": (payload.domain.strip() or None) if payload.domain else None,
        "difficulty": (payload.difficulty.strip() or None) if payload.difficulty else None,
        "certification": (payload.certification.strip() or None) if payload.certification else None,
        "tags": normalized_tags,
        "citations": normalized_citations,
        "options": [
            {
                "key": opt.key,
                "text": opt.text,
                "is_correct": opt.key in correct_set,
            }
            for opt in normalized_options
        ],
        "justification": (payload.justification.strip() or None) if payload.justification else None,
        "change_summary": (payload.change_summary.strip() or None) if payload.change_summary else None,
    }

    try:
        result = save_question_draft(
            db,
            normalized_payload,
            actor_user_id=current_user.id if current_user else None,
            actor_role=_actor_role(current_user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db.commit()
    return result

@router.get("/questions", response_model=List[AdminQuestionSummaryOut])
def admin_list_questions(
    exam_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _: bool = Depends(require_admin),
    db: Session = Depends(get_db)
):
    stmt = select(Question).order_by(Question.id.asc())
    if exam_id:
        stmt = stmt.where(Question.exam_id == exam_id.strip())
    if search:
        term = f"%{search.strip()}%"
        if term != "%%":
            stmt = stmt.where(
                (Question.id.ilike(term)) |
                (Question.prompt.ilike(term)) |
                (Question.domain.ilike(term)) |
                (Question.certification.ilike(term))
            )
    questions = db.execute(stmt.limit(limit)).scalars().all()
    if not questions:
        return []

    qids = [q.id for q in questions]
    opt_rows = db.execute(
        select(Option.question_id, Option.is_correct)
        .where(Option.question_id.in_(qids))
    ).all()
    bank_rows = db.execute(
        select(QuestionBank)
        .where(QuestionBank.stable_question_id.in_(qids))
    ).scalars().all()
    counts: Dict[str, Dict[str, int]] = {qid: {"option_count": 0, "correct_count": 0} for qid in qids}
    for qid, is_correct in opt_rows:
        counts.setdefault(qid, {"option_count": 0, "correct_count": 0})
        counts[qid]["option_count"] += 1
        if is_correct:
            counts[qid]["correct_count"] += 1
    bank_map = {row.stable_question_id: row for row in bank_rows}
    version_ids = {
        version_id
        for bank in bank_rows
        for version_id in (bank.draft_version_id, bank.published_version_id)
        if version_id
    }
    version_map = {}
    if version_ids:
        version_rows = db.execute(
            select(QuestionVersion)
            .where(QuestionVersion.id.in_(version_ids))
        ).scalars().all()
        version_map = {row.id: row for row in version_rows}

    items = [
        AdminQuestionSummaryOut(
            id=q.id,
            exam_id=q.exam_id,
            prompt=q.prompt,
            multi_select=q.multi_select,
            domain=q.domain,
            difficulty=q.difficulty,
            certification=q.certification,
            option_count=counts.get(q.id, {}).get("option_count", 0),
            correct_count=counts.get(q.id, {}).get("correct_count", 0),
            editorial_status=bank_map.get(q.id).review_status if bank_map.get(q.id) else "published",
            draft_version_number=(
                version_map[bank_map[q.id].draft_version_id].version_number
                if q.id in bank_map and bank_map[q.id].draft_version_id and bank_map[q.id].draft_version_id in version_map
                else None
            ),
            published_version_number=(
                version_map[bank_map[q.id].published_version_id].version_number
                if q.id in bank_map and bank_map[q.id].published_version_id and bank_map[q.id].published_version_id in version_map
                else None
            ),
            loaded_from="published",
        )
        for q in questions
    ]

    remaining = max(limit - len(items), 0)
    if remaining > 0:
        draft_stmt = (
            select(QuestionBank, QuestionVersion)
            .join(QuestionVersion, QuestionVersion.id == QuestionBank.draft_version_id)
            .outerjoin(Question, Question.id == QuestionBank.stable_question_id)
            .where(Question.id.is_(None))
            .order_by(QuestionBank.stable_question_id.asc())
            .limit(remaining)
        )
        if exam_id:
            draft_stmt = draft_stmt.where(QuestionVersion.exam_id == exam_id.strip())
        if search:
            term = f"%{search.strip()}%"
            if term != "%%":
                draft_stmt = draft_stmt.where(
                    (QuestionBank.stable_question_id.ilike(term)) |
                    (QuestionVersion.prompt.ilike(term)) |
                    (QuestionVersion.domain.ilike(term)) |
                    (QuestionVersion.certification.ilike(term))
                )

        draft_rows = db.execute(draft_stmt).all()
        draft_version_ids = [version.id for _bank, version in draft_rows]
        draft_counts: Dict[int, Dict[str, int]] = {
            version_id: {"option_count": 0, "correct_count": 0}
            for version_id in draft_version_ids
        }
        if draft_version_ids:
            draft_opt_rows = db.execute(
                select(QuestionVersionOption.version_id, QuestionVersionOption.is_correct)
                .where(QuestionVersionOption.version_id.in_(draft_version_ids))
            ).all()
            for version_id, is_correct in draft_opt_rows:
                draft_counts.setdefault(version_id, {"option_count": 0, "correct_count": 0})
                draft_counts[version_id]["option_count"] += 1
                if is_correct:
                    draft_counts[version_id]["correct_count"] += 1

        for bank, version in draft_rows:
            count_row = draft_counts.get(version.id, {"option_count": 0, "correct_count": 0})
            items.append(
                AdminQuestionSummaryOut(
                    id=bank.stable_question_id,
                    exam_id=version.exam_id,
                    prompt=version.prompt,
                    multi_select=version.multi_select,
                    domain=version.domain,
                    difficulty=version.difficulty,
                    certification=version.certification,
                    option_count=count_row["option_count"],
                    correct_count=count_row["correct_count"],
                    editorial_status=bank.review_status,
                    draft_version_number=version.version_number,
                    published_version_number=(
                        version_map[bank.published_version_id].version_number
                        if bank.published_version_id and bank.published_version_id in version_map
                        else None
                    ),
                    loaded_from="draft",
                )
            )

    return items

@router.get("/questions/{question_id}", response_model=AdminQuestionOut)
def admin_get_question(question_id: str, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    document = build_admin_question_document(db, question_id)
    if not document:
        raise HTTPException(status_code=404, detail="Question not found")
    db.commit()
    return AdminQuestionOut(**document)


@router.get("/questions/{question_id}/versions", response_model=List[AdminQuestionVersionOut])
def admin_question_versions(question_id: str, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    items = [AdminQuestionVersionOut(**item) for item in list_question_versions(db, question_id)]
    db.commit()
    return items


@router.get("/audit/logs", response_model=List[AdminAuditLogOut])
def admin_audit_logs(
    question_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _: bool = Depends(require_admin),
    db: Session = Depends(get_db),
):
    normalized_question_id = question_id.strip() if question_id else None
    return [
        AdminAuditLogOut(**item)
        for item in list_editorial_audit_logs(
            db,
            question_id=normalized_question_id or None,
            limit=limit,
        )
    ]


@router.post("/questions/{question_id}/submit-review")
def admin_submit_question_review(
    question_id: str,
    payload: AdminReviewActionIn,
    _: bool = Depends(require_admin),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    try:
        result = submit_question_for_review(
            db,
            question_id.strip(),
            actor_user_id=current_user.id if current_user else None,
            actor_role=_actor_role(current_user),
            reason=(payload.reason.strip() or None) if payload.reason else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    return result


@router.post("/questions/{question_id}/publish")
def admin_publish_question(
    question_id: str,
    payload: AdminReviewActionIn,
    _: bool = Depends(require_reviewer),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    try:
        result = publish_question(
            db,
            question_id.strip(),
            actor_user_id=current_user.id if current_user else None,
            actor_role=_actor_role(current_user),
            reason=(payload.reason.strip() or None) if payload.reason else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    return result


@router.post("/questions/{question_id}/rollback")
def admin_rollback_question(
    question_id: str,
    payload: AdminRollbackIn,
    _: bool = Depends(require_reviewer),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    try:
        result = rollback_question_to_version(
            db,
            question_id.strip(),
            payload.version_id,
            actor_user_id=current_user.id if current_user else None,
            actor_role=_actor_role(current_user),
            reason=(payload.reason.strip() or None) if payload.reason else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    return result

@router.delete("/questions/{question_id}")
def admin_delete_question(
    question_id: str,
    _: bool = Depends(require_platform_admin),
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    try:
        result = delete_question_with_history(
            db,
            question_id.strip(),
            actor_user_id=current_user.id if current_user else None,
            actor_role=_actor_role(current_user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    db.commit()
    return result

def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None

def _parse_tags(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    return [str(item).strip() for item in payload if str(item).strip()]

def _parse_citations(raw: Optional[str]) -> List[Dict[str, Any]]:
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]

def _export_db(db: Session) -> Dict[str, Any]:
    exams = db.execute(select(Exam).order_by(Exam.title.asc())).scalars().all()
    questions = db.execute(select(Question)).scalars().all()
    options = db.execute(select(Option)).scalars().all()
    explanations = db.execute(select(Explanation)).scalars().all()
    imports = db.execute(select(ImportState).order_by(ImportState.imported_at.desc())).scalars().all()
    banks = db.execute(select(QuestionBank).order_by(QuestionBank.stable_question_id.asc())).scalars().all()
    versions = db.execute(
        select(QuestionVersion).order_by(QuestionVersion.question_bank_id.asc(), QuestionVersion.version_number.asc())
    ).scalars().all()
    version_options = db.execute(
        select(QuestionVersionOption).order_by(QuestionVersionOption.version_id.asc(), QuestionVersionOption.key.asc())
    ).scalars().all()
    audit_logs = db.execute(select(EditorialAuditLog).order_by(EditorialAuditLog.created_at.desc())).scalars().all()

    opt_map: Dict[str, List[Option]] = {}
    for opt in options:
        opt_map.setdefault(opt.question_id, []).append(opt)

    exp_map: Dict[str, Explanation] = {e.question_id: e for e in explanations}
    version_option_map: Dict[int, List[QuestionVersionOption]] = {}
    for item in version_options:
        version_option_map.setdefault(item.version_id, []).append(item)

    exam_map: Dict[str, Dict[str, Any]] = {
        e.id: {
            "id": e.id,
            "title": e.title,
            "source": e.source,
            "question_count": e.question_count,
            "questions": []
        } for e in exams
    }

    for q in questions:
        q_opts = sorted(opt_map.get(q.id, []), key=lambda o: o.key)
        correct_keys = [o.key for o in q_opts if o.is_correct]
        exam_map.setdefault(q.exam_id, {
            "id": q.exam_id,
            "title": q.exam_id,
            "source": None,
            "question_count": None,
            "questions": []
        })["questions"].append({
            "id": q.id,
            "exam_id": q.exam_id,
            "prompt": q.prompt,
            "multi_select": q.multi_select,
            "domain": q.domain,
            "difficulty": q.difficulty,
            "certification": q.certification,
            "tags": _parse_tags(q.tags_json),
            "citations": _parse_citations(q.citations_json),
            "options": [{"key": o.key, "text": o.text, "is_correct": o.is_correct} for o in q_opts],
            "correct_keys": correct_keys,
            "justification": exp_map.get(q.id).justification if exp_map.get(q.id) else None,
        })

    sessions = db.execute(select(ExamSession)).scalars().all()
    session_questions = db.execute(select(SessionQuestion)).scalars().all()
    session_answers = db.execute(select(SessionAnswer)).scalars().all()

    sq_map: Dict[str, List[SessionQuestion]] = {}
    for sq in session_questions:
        sq_map.setdefault(sq.session_id, []).append(sq)

    sa_map: Dict[str, List[SessionAnswer]] = {}
    for sa in session_answers:
        sa_map.setdefault(sa.session_id, []).append(sa)

    session_export = []
    for s in sessions:
        q_list = sorted(sq_map.get(s.id, []), key=lambda row: row.position)
        a_list = sorted(sa_map.get(s.id, []), key=lambda row: row.answered_at)
        session_export.append({
            "id": s.id,
            "exam_id": s.exam_id,
            "created_at": _iso(s.created_at),
            "total_questions": s.total_questions,
            "current_index": s.current_index,
            "correct_count": s.correct_count,
            "wrong_count": s.wrong_count,
            "completed_at": _iso(s.completed_at),
            "questions": [{"position": q.position, "question_id": q.question_id} for q in q_list],
            "answers": [{
                "question_id": a.question_id,
                "selected_keys": a.selected_keys.split(",") if a.selected_keys else [],
                "is_correct": a.is_correct,
                "answered_at": _iso(a.answered_at)
            } for a in a_list]
        })

    return {
        "meta": {
            "exported_at": datetime.utcnow().isoformat(),
            "version": "1.0.0"
        },
        "exams": list(exam_map.values()),
        "editorial": {
            "question_banks": [
                {
                    "question_id": bank.stable_question_id,
                    "published_version_id": bank.published_version_id,
                    "draft_version_id": bank.draft_version_id,
                    "review_status": bank.review_status,
                    "created_by_user_id": bank.created_by_user_id,
                    "updated_by_user_id": bank.updated_by_user_id,
                    "created_at": _iso(bank.created_at),
                    "updated_at": _iso(bank.updated_at),
                }
                for bank in banks
            ],
            "versions": [
                {
                    "id": version.id,
                    "question_id": version.question_bank_id,
                    "version_number": version.version_number,
                    "status": version.status,
                    "exam_id": version.exam_id,
                    "prompt": version.prompt,
                    "multi_select": version.multi_select,
                    "domain": version.domain,
                    "difficulty": version.difficulty,
                    "certification": version.certification,
                    "tags": _parse_tags(version.tags_json),
                    "citations": _parse_citations(version.citations_json),
                    "options": [
                        {
                            "key": option.key,
                            "text": option.text,
                            "is_correct": option.is_correct,
                        }
                        for option in version_option_map.get(version.id, [])
                    ],
                    "justification": version.justification,
                    "change_summary": version.change_summary,
                    "review_notes": version.review_notes,
                    "created_by_user_id": version.created_by_user_id,
                    "updated_by_user_id": version.updated_by_user_id,
                    "approved_by_user_id": version.approved_by_user_id,
                    "created_at": _iso(version.created_at),
                    "updated_at": _iso(version.updated_at),
                    "published_at": _iso(version.published_at),
                }
                for version in versions
            ],
            "audit_log": [
                {
                    "id": item.id,
                    "question_id": item.question_bank_id,
                    "question_version_id": item.question_version_id,
                    "actor_user_id": item.actor_user_id,
                    "actor_role": item.actor_role,
                    "action": item.action,
                    "reason": item.reason,
                    "metadata": json.loads(item.metadata_json) if item.metadata_json else None,
                    "created_at": _iso(item.created_at),
                }
                for item in audit_logs
            ],
        },
        "sessions": session_export,
        "import_state": [{
            "file_name": i.file_name,
            "file_sha256": i.file_sha256,
            "imported_at": _iso(i.imported_at)
        } for i in imports]
    }

@router.get("/export")
def admin_export_db(_: bool = Depends(require_platform_admin), db: Session = Depends(get_db)):
    payload = _export_db(db)
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    filename = f"securityplus_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=body, media_type="application/json", headers=headers)
