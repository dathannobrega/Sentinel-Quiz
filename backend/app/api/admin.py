from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import func, select
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import json

from app.api.deps import get_current_user_required
from app.core.config import settings
from app.db.session import get_db
from app.models import (
    DomainBlueprint,
    DomainCatalog,
    EditorialAuditLog,
    Exam,
    ExamSession,
    Explanation,
    ImportState,
    Option,
    Question,
    QuestionBank,
    QuestionReference,
    QuestionStatsSnapshot,
    QuestionVersion,
    QuestionVersionOption,
    SessionAnswer,
    SessionQuestion,
    StudySession,
    UserDomainMetricDaily,
    UserExamMetricsSnapshot,
    User,
    WeeklyProgressSnapshot,
)
from app.services.admin_analytics import (
    build_admin_question_analytics,
    capture_admin_question_analytics_snapshot,
    list_question_analytics_history,
)
from app.services.editorial import (
    approve_question,
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
from app.services.issue_reporting import (
    assign_issue_current_version,
    list_question_issues,
    update_question_issue,
)
from app.schemas import QuestionIssueOut

router = APIRouter(prefix="/api/admin", tags=["admin"])

logger = logging.getLogger("app.security.admin")


def require_admin_role(*allowed_roles: str):
    normalized_roles = {str(role or "").strip().lower() for role in allowed_roles if str(role or "").strip()}

    def _resolver(
        current_user: User = Depends(get_current_user_required),
    ) -> User:
        if current_user.is_active and current_user.role in normalized_roles:
            return current_user
        raise HTTPException(status_code=403, detail="Forbidden")

    return _resolver


def require_editor(
    current_user: User = Depends(require_admin_role("editor", "reviewer", "admin")),
) -> User:
    return current_user


def require_reviewer(
    current_user: User = Depends(require_admin_role("reviewer", "admin")),
) -> User:
    return current_user


def require_platform_admin(
    current_user: User = Depends(require_admin_role("admin")),
) -> User:
    return current_user


def _actor_role(current_user: User | None) -> str:
    if current_user and current_user.role:
        return current_user.role
    return "unknown"

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
    subject: Optional[str] = None
    subtopic: Optional[str] = None
    subdomain: Optional[str] = None
    objective_code: Optional[str] = None
    blueprint_code: Optional[str] = None
    keywords: Optional[List[str]] = None
    trap_patterns: Optional[List[str]] = None
    question_format: Optional[str] = None
    correct_rationale: Optional[str] = None
    incorrect_rationales: Optional[List[str]] = None
    avg_time_seconds: Optional[float] = None
    global_accuracy_percent: Optional[float] = None
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
    subject: Optional[str] = None
    subtopic: Optional[str] = None
    subdomain: Optional[str] = None
    objective_code: Optional[str] = None
    blueprint_code: Optional[str] = None
    keywords: Optional[List[str]] = None
    trap_patterns: Optional[List[str]] = None
    question_format: Optional[str] = None
    options: List[AdminOptionOut]
    correct_keys: List[str]
    justification: Optional[str] = None
    correct_rationale: Optional[str] = None
    incorrect_rationales: Optional[List[str]] = None
    avg_time_seconds: Optional[float] = None
    global_accuracy_percent: Optional[float] = None
    change_summary: Optional[str] = None
    editorial_status: Optional[str] = None
    loaded_from: Optional[str] = None
    version_id: Optional[int] = None
    version_number: Optional[int] = None
    published_version_number: Optional[int] = None
    draft_version_number: Optional[int] = None
    quality: Optional[Dict[str, Any]] = None

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
    snapshot_batch_count: int = 0
    latest_snapshot_at: Optional[str] = None


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


class AdminAnalyticsSnapshotCaptureOut(BaseModel):
    ok: bool
    schema_ready: bool = True
    message: Optional[str] = None
    capture_batch_id: Optional[str] = None
    captured_at: Optional[str] = None
    snapshot_count: int = 0


class AdminQuestionAnalyticsSnapshotOut(BaseModel):
    id: int
    capture_batch_id: str
    question_id: str
    question_version_id: Optional[int] = None
    version_number: Optional[int] = None
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
    captured_at: Optional[str] = None


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


class AdminDomainCatalogItemOut(BaseModel):
    id: int
    certification: str
    domain: str
    subdomain: Optional[str] = None
    subject: Optional[str] = None
    objective_code: Optional[str] = None
    blueprint_code: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    blueprint_title: Optional[str] = None
    blueprint_description: Optional[str] = None
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AdminDomainCatalogPageOut(BaseModel):
    items: List[AdminDomainCatalogItemOut]
    total: int
    page: int
    page_size: int


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


class AdminQuestionIssueUpdateIn(BaseModel):
    status: Optional[str] = None
    internal_note: Optional[str] = Field(default=None, max_length=4000)
    resolved_version_id: Optional[int] = None


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
def admin_ingest(_: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    res = ingest_questions_from_dir(db, settings.question_json_dir)
    return res

@router.get("/overview", response_model=AdminOverviewOut)
def admin_overview(_: User = Depends(require_editor), db: Session = Depends(get_db)):
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


@router.get("/domain-catalog", response_model=AdminDomainCatalogPageOut)
def admin_domain_catalog(
    certification: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    _: User = Depends(require_editor),
    db: Session = Depends(get_db),
):
    stmt = (
        select(DomainCatalog, DomainBlueprint)
        .outerjoin(
            DomainBlueprint,
            (DomainBlueprint.certification == DomainCatalog.certification)
            & (DomainBlueprint.blueprint_code == DomainCatalog.blueprint_code)
            & (
                (DomainBlueprint.objective_code == DomainCatalog.objective_code)
                | (DomainCatalog.objective_code.is_(None) & DomainBlueprint.objective_code.is_(None))
            ),
        )
        .order_by(
            DomainCatalog.certification.asc(),
            DomainCatalog.domain.asc(),
            DomainCatalog.subdomain.asc(),
            DomainCatalog.id.asc(),
        )
    )
    count_stmt = select(func.count(DomainCatalog.id))

    if certification:
        normalized_certification = certification.strip()
        stmt = stmt.where(DomainCatalog.certification == normalized_certification)
        count_stmt = count_stmt.where(DomainCatalog.certification == normalized_certification)

    if search:
        term = f"%{search.strip()}%"
        if term != "%%":
            predicate = (
                DomainCatalog.domain.ilike(term)
                | DomainCatalog.subdomain.ilike(term)
                | DomainCatalog.title.ilike(term)
                | DomainCatalog.objective_code.ilike(term)
                | DomainCatalog.blueprint_code.ilike(term)
            )
            stmt = stmt.where(predicate)
            count_stmt = count_stmt.where(predicate)

    total = int(db.execute(count_stmt).scalar_one() or 0)
    rows = db.execute(
        stmt.offset((page - 1) * page_size).limit(page_size)
    ).all()

    return AdminDomainCatalogPageOut(
        items=[
            AdminDomainCatalogItemOut(
                id=item.id,
                certification=item.certification,
                domain=item.domain,
                subdomain=item.subdomain,
                subject=item.subject,
                objective_code=item.objective_code,
                blueprint_code=item.blueprint_code,
                title=item.title,
                description=item.description,
                blueprint_title=blueprint.title if blueprint else None,
                blueprint_description=blueprint.description if blueprint else None,
                is_active=item.is_active,
                created_at=item.created_at.isoformat() if item.created_at else None,
                updated_at=item.updated_at.isoformat() if item.updated_at else None,
            )
            for item, blueprint in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/users", response_model=List[AdminUserOut])
def admin_list_users(_: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
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
    current_user: User = Depends(require_platform_admin),
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
    _: User = Depends(require_editor),
    db: Session = Depends(get_db),
):
    return AdminQuestionAnalyticsOut(
        **build_admin_question_analytics(
            db,
            limit=limit,
        )
    )


@router.post("/analytics/questions/snapshots", response_model=AdminAnalyticsSnapshotCaptureOut)
def admin_capture_question_analytics_snapshot(
    current_user: User = Depends(require_editor),
    db: Session = Depends(get_db),
):
    payload = capture_admin_question_analytics_snapshot(
        db,
        actor_user_id=current_user.id,
    )
    db.commit()
    return AdminAnalyticsSnapshotCaptureOut(**payload)


@router.post("/exams")
def admin_create_exam(payload: AdminCreateExamIn, _: User = Depends(require_editor), db: Session = Depends(get_db)):
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
    current_user: User = Depends(require_editor),
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
        "subject": (payload.subject.strip() or None) if payload.subject else None,
        "subtopic": (payload.subtopic.strip() or None) if payload.subtopic else None,
        "subdomain": (payload.subdomain.strip() or None) if payload.subdomain else None,
        "objective_code": (payload.objective_code.strip() or None) if payload.objective_code else None,
        "blueprint_code": (payload.blueprint_code.strip() or None) if payload.blueprint_code else None,
        "keywords": [str(item).strip() for item in (payload.keywords or []) if str(item).strip()],
        "trap_patterns": [str(item).strip() for item in (payload.trap_patterns or []) if str(item).strip()],
        "question_format": (payload.question_format.strip() or None) if payload.question_format else None,
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
        "correct_rationale": (payload.correct_rationale.strip() or None) if payload.correct_rationale else None,
        "incorrect_rationales": [
            str(item).strip()
            for item in (payload.incorrect_rationales or [])
            if str(item).strip()
        ],
        "avg_time_seconds": payload.avg_time_seconds,
        "global_accuracy_percent": payload.global_accuracy_percent,
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
    _: User = Depends(require_editor),
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
def admin_get_question(question_id: str, _: User = Depends(require_editor), db: Session = Depends(get_db)):
    document = build_admin_question_document(db, question_id)
    if not document:
        raise HTTPException(status_code=404, detail="Question not found")
    db.commit()
    return AdminQuestionOut(**document)


@router.get("/questions/{question_id}/versions", response_model=List[AdminQuestionVersionOut])
def admin_question_versions(question_id: str, _: User = Depends(require_editor), db: Session = Depends(get_db)):
    items = [AdminQuestionVersionOut(**item) for item in list_question_versions(db, question_id)]
    db.commit()
    return items


@router.get("/questions/{question_id}/analytics-history", response_model=List[AdminQuestionAnalyticsSnapshotOut])
def admin_question_analytics_history(
    question_id: str,
    limit: int = Query(default=12, ge=1, le=60),
    _: User = Depends(require_editor),
    db: Session = Depends(get_db),
):
    return [
        AdminQuestionAnalyticsSnapshotOut(**item)
        for item in list_question_analytics_history(db, question_id=question_id.strip(), limit=limit)
    ]


@router.get("/audit/logs", response_model=List[AdminAuditLogOut])
def admin_audit_logs(
    question_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(require_editor),
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


@router.get("/question-issues", response_model=List[QuestionIssueOut])
def admin_question_issues(
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    certification: Optional[str] = Query(default=None),
    question_id: Optional[str] = Query(default=None),
    assigned_state: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(require_editor),
    db: Session = Depends(get_db),
):
    try:
        items = list_question_issues(
            db,
            status=status,
            category=category,
            certification=certification,
            question_id=question_id,
            assigned_state=assigned_state,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return [QuestionIssueOut(**item) for item in items]


@router.patch("/question-issues/{issue_id}", response_model=QuestionIssueOut)
def admin_update_question_issue(
    issue_id: int,
    payload: AdminQuestionIssueUpdateIn,
    current_user: User = Depends(require_reviewer),
    db: Session = Depends(get_db),
):
    try:
        item = update_question_issue(
            db,
            issue_id=issue_id,
            status=payload.status,
            internal_note=payload.internal_note,
            resolved_version_id=payload.resolved_version_id,
            actor_user_id=current_user.id if current_user else None,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return QuestionIssueOut(**item)


@router.post("/question-issues/{issue_id}/assign-current-version", response_model=QuestionIssueOut)
def admin_assign_current_issue_version(
    issue_id: int,
    current_user: User = Depends(require_reviewer),
    db: Session = Depends(get_db),
):
    try:
        item = assign_issue_current_version(
            db,
            issue_id=issue_id,
            actor_user_id=current_user.id if current_user else None,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return QuestionIssueOut(**item)


@router.post("/questions/{question_id}/submit-review")
def admin_submit_question_review(
    question_id: str,
    payload: AdminReviewActionIn,
    current_user: User = Depends(require_editor),
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


@router.post("/questions/{question_id}/approve")
def admin_approve_question(
    question_id: str,
    payload: AdminReviewActionIn,
    current_user: User = Depends(require_reviewer),
    db: Session = Depends(get_db),
):
    try:
        result = approve_question(
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
    current_user: User = Depends(require_platform_admin),
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
    current_user: User = Depends(require_platform_admin),
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
    current_user: User = Depends(require_platform_admin),
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
    stats_snapshots = db.execute(
        select(QuestionStatsSnapshot).order_by(QuestionStatsSnapshot.captured_at.desc(), QuestionStatsSnapshot.id.desc())
    ).scalars().all()
    question_references = db.execute(
        select(QuestionReference).order_by(QuestionReference.question_version_id.asc(), QuestionReference.id.asc())
    ).scalars().all()
    domain_catalog = db.execute(
        select(DomainCatalog).order_by(DomainCatalog.certification.asc(), DomainCatalog.domain.asc(), DomainCatalog.id.asc())
    ).scalars().all()
    domain_blueprints = db.execute(
        select(DomainBlueprint).order_by(DomainBlueprint.certification.asc(), DomainBlueprint.blueprint_code.asc(), DomainBlueprint.id.asc())
    ).scalars().all()
    user_domain_metrics = db.execute(
        select(UserDomainMetricDaily).order_by(UserDomainMetricDaily.metric_date.desc(), UserDomainMetricDaily.id.desc())
    ).scalars().all()
    user_exam_metrics = db.execute(
        select(UserExamMetricsSnapshot).order_by(UserExamMetricsSnapshot.completed_at.desc(), UserExamMetricsSnapshot.id.desc())
    ).scalars().all()
    weekly_progress_snapshots = db.execute(
        select(WeeklyProgressSnapshot).order_by(WeeklyProgressSnapshot.week_start.desc(), WeeklyProgressSnapshot.id.desc())
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
    version_reference_map: Dict[int, List[QuestionReference]] = {}
    for item in question_references:
        version_reference_map.setdefault(item.question_version_id, []).append(item)

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
                    "subject": version.subject,
                    "subtopic": version.subtopic,
                    "subdomain": version.subdomain,
                    "objective_code": version.objective_code,
                    "blueprint_code": version.blueprint_code,
                    "keywords": _parse_tags(version.keywords_json),
                    "trap_patterns": _parse_tags(version.trap_patterns_json),
                    "question_format": version.question_format,
                    "tags": _parse_tags(version.tags_json),
                    "citations": [
                        {
                            "source": ref.source,
                            "reference": ref.reference,
                            "chapter": ref.chapter,
                            "locator": ref.locator,
                            "material_path": ref.material_path,
                            "page_start": ref.page_start,
                            "page_end": ref.page_end,
                        }
                        for ref in version_reference_map.get(version.id, [])
                    ] or _parse_citations(version.citations_json),
                    "options": [
                        {
                            "key": option.key,
                            "text": option.text,
                            "is_correct": option.is_correct,
                        }
                        for option in version_option_map.get(version.id, [])
                    ],
                    "justification": version.justification,
                    "correct_rationale": version.correct_rationale,
                    "incorrect_rationales": _parse_tags(version.incorrect_rationales_json),
                    "avg_time_seconds": version.avg_time_seconds,
                    "global_accuracy_percent": version.global_accuracy_percent,
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
            "question_stats_snapshots": [
                {
                    "id": item.id,
                    "capture_batch_id": item.capture_batch_id,
                    "question_id": item.question_id,
                    "question_version_id": item.question_version_id,
                    "exam_id": item.exam_id,
                    "domain": item.domain,
                    "certification": item.certification,
                    "attempts_total": item.attempts_total,
                    "exam_attempts": item.exam_attempts,
                    "study_attempts": item.study_attempts,
                    "wrong_count": item.wrong_count,
                    "wrong_rate_percent": item.wrong_rate_percent,
                    "low_confidence_count": item.low_confidence_count,
                    "low_confidence_rate_percent": item.low_confidence_rate_percent,
                    "review_pressure_count": item.review_pressure_count,
                    "avg_study_elapsed_seconds": item.avg_study_elapsed_seconds,
                    "difficulty_score": item.difficulty_score,
                    "captured_at": _iso(item.captured_at),
                }
                for item in stats_snapshots
            ],
            "domain_catalog": [
                {
                    "id": item.id,
                    "certification": item.certification,
                    "domain": item.domain,
                    "subdomain": item.subdomain,
                    "subject": item.subject,
                    "objective_code": item.objective_code,
                    "blueprint_code": item.blueprint_code,
                    "title": item.title,
                    "description": item.description,
                    "is_active": item.is_active,
                    "created_at": _iso(item.created_at),
                    "updated_at": _iso(item.updated_at),
                }
                for item in domain_catalog
            ],
            "domain_blueprints": [
                {
                    "id": item.id,
                    "certification": item.certification,
                    "blueprint_code": item.blueprint_code,
                    "objective_code": item.objective_code,
                    "domain": item.domain,
                    "subdomain": item.subdomain,
                    "title": item.title,
                    "description": item.description,
                    "created_at": _iso(item.created_at),
                    "updated_at": _iso(item.updated_at),
                }
                for item in domain_blueprints
            ],
        },
        "sessions": session_export,
        "learning_metrics": {
            "user_domain_metrics_daily": [
                {
                    "id": item.id,
                    "user_id": item.user_id,
                    "client_key": item.client_key,
                    "metric_date": _iso(item.metric_date),
                    "exam_id": item.exam_id,
                    "certification": item.certification,
                    "domain": item.domain,
                    "attempts_total": item.attempts_total,
                    "exam_attempts": item.exam_attempts,
                    "study_attempts": item.study_attempts,
                    "correct_count": item.correct_count,
                    "wrong_count": item.wrong_count,
                    "low_confidence_count": item.low_confidence_count,
                    "total_elapsed_seconds": item.total_elapsed_seconds,
                    "timed_attempts": item.timed_attempts,
                    "updated_at": _iso(item.updated_at),
                }
                for item in user_domain_metrics
            ],
            "user_exam_metrics_snapshot": [
                {
                    "id": item.id,
                    "user_id": item.user_id,
                    "client_key": item.client_key,
                    "session_id": item.session_id,
                    "mode": item.mode,
                    "exam_id": item.exam_id,
                    "selection_strategy": item.selection_strategy,
                    "total_questions": item.total_questions,
                    "answered_count": item.answered_count,
                    "correct_count": item.correct_count,
                    "wrong_count": item.wrong_count,
                    "score_percent": item.score_percent,
                    "duration_seconds": item.duration_seconds,
                    "weakest_domains": json.loads(item.weakest_domains_json) if item.weakest_domains_json else [],
                    "review_due_count": item.review_due_count,
                    "review_total_count": item.review_total_count,
                    "completed_at": _iso(item.completed_at),
                    "created_at": _iso(item.created_at),
                    "updated_at": _iso(item.updated_at),
                }
                for item in user_exam_metrics
            ],
            "weekly_progress_snapshot": [
                {
                    "id": item.id,
                    "user_id": item.user_id,
                    "client_key": item.client_key,
                    "week_start": _iso(item.week_start),
                    "questions_answered": item.questions_answered,
                    "review_questions": item.review_questions,
                    "scheduled_reviews": item.scheduled_reviews,
                    "correct_count": item.correct_count,
                    "wrong_count": item.wrong_count,
                    "low_confidence_count": item.low_confidence_count,
                    "completed_exam_sessions": item.completed_exam_sessions,
                    "completed_study_sessions": item.completed_study_sessions,
                    "completed_review_sessions": item.completed_review_sessions,
                    "review_due_count": item.review_due_count,
                    "review_total_count": item.review_total_count,
                    "updated_at": _iso(item.updated_at),
                }
                for item in weekly_progress_snapshots
            ],
        },
        "import_state": [{
            "file_name": i.file_name,
            "file_sha256": i.file_sha256,
            "imported_at": _iso(i.imported_at)
        } for i in imports]
    }

@router.get("/export")
def admin_export_db(_: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    payload = _export_db(db)
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    filename = f"securityplus_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=body, media_type="application/json", headers=headers)
