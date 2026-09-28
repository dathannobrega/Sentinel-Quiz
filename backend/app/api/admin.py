from __future__ import annotations

import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_required
from app.core.config import settings
from app.core.errors import api_error
from app.db.session import SessionLocal, get_db
from app.models import DomainBlueprint, DomainCatalog, Exam, User
from app.schemas import (
    AdminAnalyticsSnapshotCaptureOut,
    AdminAuditLogOut,
    AdminCreateExamIn,
    AdminCreateQuestionIn,
    AdminDomainCatalogItemOut,
    AdminDomainCatalogPageOut,
    AdminExamUpsertOut,
    AdminIngestResultOut,
    AdminOverviewOut,
    AdminQuestionAnalyticsOut,
    AdminQuestionAnalyticsSnapshotOut,
    AdminQuestionIssueUpdateIn,
    AdminQuestionOut,
    AdminQuestionSummaryOut,
    AdminQuestionVersionOut,
    AdminReviewActionIn,
    AdminRollbackIn,
    AdminUserOut,
    AdminUserUpdateIn,
    EditorialActionOut,
    QuestionIssueOut,
)
from app.services.admin_analytics import (
    build_admin_question_analytics,
    capture_admin_question_analytics_snapshot,
    list_question_analytics_history,
)
from app.services.admin_export import export_filename, stream_export
from app.services.admin_questions import (
    build_admin_overview,
    list_admin_questions,
    normalize_admin_question_payload,
)
from app.services.admin_users import AdminUserRuleError, count_users, list_admin_users, update_admin_user
from app.services.editorial import (
    approve_question,
    build_admin_question_document,
    delete_question_with_history,
    list_editorial_audit_logs,
    list_question_versions,
    publish_question,
    reactivate_question,
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

router = APIRouter(prefix="/api/admin", tags=["admin"])

logger = logging.getLogger("app.security.admin")

ADMIN_USERS_DEFAULT_LIMIT = 500
ADMIN_USERS_MAX_LIMIT = 1000


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


def _clean_reason(reason: Optional[str]) -> Optional[str]:
    return (reason.strip() or None) if reason else None


@router.post("/ingest", response_model=AdminIngestResultOut)
def admin_ingest(_: User = Depends(require_platform_admin), db: Session = Depends(get_db)):
    return ingest_questions_from_dir(db, settings.question_json_dir)

@router.get("/overview", response_model=AdminOverviewOut)
def admin_overview(_: User = Depends(require_editor), db: Session = Depends(get_db)):
    return AdminOverviewOut(**build_admin_overview(db))


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
def admin_list_users(
    response: Response,
    limit: int = Query(default=ADMIN_USERS_DEFAULT_LIMIT, ge=1, le=ADMIN_USERS_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    response.headers["X-Total-Count"] = str(count_users(db))
    return [AdminUserOut(**item) for item in list_admin_users(db, limit=limit, offset=offset)]


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def admin_update_user(
    user_id: str,
    payload: AdminUserUpdateIn,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    try:
        item = update_admin_user(
            db,
            actor=current_user,
            user_id=user_id,
            role=payload.role,
            is_active=payload.is_active,
        )
    except AdminUserRuleError as exc:
        if exc.status_code == 404:
            raise HTTPException(status_code=404, detail=exc.message)
        raise api_error(exc.status_code, exc.code, exc.message)
    return AdminUserOut(**item)


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


@router.post("/exams", response_model=AdminExamUpsertOut)
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
    return AdminExamUpsertOut(ok=True, id=exam.id)


@router.post("/questions", response_model=EditorialActionOut, response_model_exclude_unset=True)
def admin_create_question(
    payload: AdminCreateQuestionIn,
    current_user: User = Depends(require_editor),
    db: Session = Depends(get_db),
):
    try:
        normalized_payload = normalize_admin_question_payload(db, payload)
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
    exam_id: Optional[str] = Query(default=None, max_length=128),
    search: Optional[str] = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
    status: Literal["active", "inactive", "all"] = Query(
        default="active",
        description="Question lifecycle filter (Question.is_active). Inactive = soft-deleted or removed from source.",
    ),
    needs_review: Optional[bool] = Query(default=None, description="Filter on the ingest needs_review flag."),
    explanation_missing: Optional[bool] = Query(
        default=None, description="Filter on the ingest explanation_missing flag (placeholder rationale)."
    ),
    _: User = Depends(require_editor),
    db: Session = Depends(get_db)
):
    return [
        AdminQuestionSummaryOut(**item)
        for item in list_admin_questions(
            db,
            exam_id=exam_id,
            search=search,
            limit=limit,
            status=status,
            needs_review=needs_review,
            explanation_missing=explanation_missing,
        )
    ]


# GET handlers are read-only: they never seed the editorial bank nor commit (M-B7).
@router.get("/questions/{question_id}", response_model=AdminQuestionOut)
def admin_get_question(question_id: str, _: User = Depends(require_editor), db: Session = Depends(get_db)):
    document = build_admin_question_document(db, question_id)
    if not document:
        raise HTTPException(status_code=404, detail="Question not found")
    return AdminQuestionOut(**document)


@router.get("/questions/{question_id}/versions", response_model=List[AdminQuestionVersionOut])
def admin_question_versions(question_id: str, _: User = Depends(require_editor), db: Session = Depends(get_db)):
    return [AdminQuestionVersionOut(**item) for item in list_question_versions(db, question_id)]


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


@router.post("/questions/{question_id}/submit-review", response_model=EditorialActionOut, response_model_exclude_unset=True)
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
            reason=_clean_reason(payload.reason),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    return result


@router.post("/questions/{question_id}/approve", response_model=EditorialActionOut, response_model_exclude_unset=True)
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
            reason=_clean_reason(payload.reason),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    return result


@router.post("/questions/{question_id}/publish", response_model=EditorialActionOut, response_model_exclude_unset=True)
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
            reason=_clean_reason(payload.reason),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    return result


@router.post("/questions/{question_id}/rollback", response_model=EditorialActionOut, response_model_exclude_unset=True)
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
            reason=_clean_reason(payload.reason),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    return result

@router.delete("/questions/{question_id}", response_model=EditorialActionOut, response_model_exclude_unset=True)
def admin_delete_question(
    question_id: str,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Deactivate (soft delete) a question: hidden from new sessions, student history kept.

    The response keeps ``status: "deleted"`` for compatibility; undo with
    POST /questions/{question_id}/reactivate.
    """
    normalized_id = question_id.strip()
    try:
        result = delete_question_with_history(
            db,
            normalized_id,
            actor_user_id=current_user.id if current_user else None,
            actor_role=_actor_role(current_user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    db.commit()
    logger.info("admin.question.deactivated question_id=%s actor=%s", normalized_id, current_user.id)
    return result


@router.post(
    "/questions/{question_id}/reactivate",
    response_model=EditorialActionOut,
    response_model_exclude_unset=True,
)
def admin_reactivate_question(
    question_id: str,
    payload: Optional[AdminReviewActionIn] = None,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Re-enable a deactivated question (writes a ``reactivated`` editorial audit entry)."""
    normalized_id = question_id.strip()
    try:
        result = reactivate_question(
            db,
            normalized_id,
            actor_user_id=current_user.id if current_user else None,
            actor_role=_actor_role(current_user),
            reason=_clean_reason(payload.reason) if payload else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    db.commit()
    logger.info("admin.question.reactivated question_id=%s actor=%s", normalized_id, current_user.id)
    return result

@router.get(
    "/export",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/json": {}}, "description": "Streaming JSON export (file download)."}},
)
def admin_export_db(_: User = Depends(require_platform_admin)):
    # The export streams with its own short-lived DB session (see services/admin_export.py).
    headers = {"Content-Disposition": f'attachment; filename="{export_filename()}"'}
    return StreamingResponse(stream_export(SessionLocal), media_type="application/json", headers=headers)
