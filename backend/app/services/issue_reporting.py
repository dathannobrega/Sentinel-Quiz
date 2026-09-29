from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Question, QuestionBank, QuestionIssue, QuestionVersion
from app.services.owner_scope import require_owner_scope


ALLOWED_ISSUE_CATEGORIES = {"gabarito", "explicacao", "referencia", "clareza"}
ALLOWED_ISSUE_STATUSES = {"open", "triaged", "fix_in_progress", "verified", "released", "dismissed"}
ISSUE_STATUS_TRANSITIONS = {
    "open": {"triaged", "dismissed"},
    "triaged": {"fix_in_progress", "dismissed"},
    "fix_in_progress": {"verified", "dismissed"},
    "verified": {"released", "fix_in_progress", "dismissed"},
    "released": set(),
    "dismissed": set(),
}


def create_question_issue(
    db: Session,
    *,
    question_id: str,
    session_id: str | None,
    mode: str,
    category: str,
    message: str,
    question_version_id: int | None,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> dict[str, Any]:
    owner_user_id, owner_client_key = require_owner_scope(
        owner_user_id,
        owner_client_key,
        message="Issue reporting requires an authenticated owner scope.",
    )
    question = db.get(Question, question_id)
    if not question:
        raise ValueError("Question not found.")

    normalized_category = str(category or "").strip().lower()
    if normalized_category not in ALLOWED_ISSUE_CATEGORIES:
        raise ValueError("Unsupported issue category.")

    normalized_mode = str(mode or "exam").strip().lower() or "exam"
    if normalized_mode not in {"exam", "study", "review"}:
        raise ValueError("Unsupported issue mode.")

    clean_message = str(message or "").strip()
    if len(clean_message) < 8:
        raise ValueError("Issue message must be at least 8 characters.")
    if len(clean_message) > 2000:
        clean_message = clean_message[:2000].rstrip()

    bank = db.get(QuestionBank, question_id)
    resolved_version_id = question_version_id or (bank.published_version_id if bank else None)

    issue = QuestionIssue(
        question_id=question_id,
        question_version_id=resolved_version_id,
        session_id=str(session_id or "").strip() or None,
        user_id=owner_user_id,
        client_key=owner_client_key,
        mode=normalized_mode,
        category=normalized_category,
        status="open",
        message=clean_message,
    )
    db.add(issue)
    db.commit()
    db.refresh(issue)
    return {
        "id": issue.id,
        "question_id": issue.question_id,
        "question_version_id": issue.question_version_id,
        "session_id": issue.session_id,
        "mode": issue.mode,
        "category": issue.category,
        "status": issue.status,
        "message": issue.message,
        "created_at": issue.created_at.isoformat() if issue.created_at else None,
        "updated_at": issue.updated_at.isoformat() if issue.updated_at else None,
        "internal_note": issue.internal_note,
        "triaged_by_user_id": issue.triaged_by_user_id,
        "triaged_at": issue.triaged_at.isoformat() if issue.triaged_at else None,
        "resolved_version_id": issue.resolved_version_id,
        "resolved_by_user_id": issue.resolved_by_user_id,
        "resolved_at": issue.resolved_at.isoformat() if issue.resolved_at else None,
    }


def list_question_issues(
    db: Session,
    *,
    status: str | None = None,
    category: str | None = None,
    certification: str | None = None,
    question_id: str | None = None,
    assigned_state: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    stmt = (
        select(QuestionIssue, Question)
        .join(Question, Question.id == QuestionIssue.question_id)
        .order_by(QuestionIssue.created_at.desc(), QuestionIssue.id.desc())
        .limit(max(min(int(limit or 50), 200), 1))
    )

    normalized_status = str(status or "").strip().lower() or None
    if normalized_status:
        if normalized_status not in ALLOWED_ISSUE_STATUSES:
            raise ValueError("Unsupported issue status.")
        stmt = stmt.where(QuestionIssue.status == normalized_status)

    normalized_category = str(category or "").strip().lower() or None
    if normalized_category:
        if normalized_category not in ALLOWED_ISSUE_CATEGORIES:
            raise ValueError("Unsupported issue category.")
        stmt = stmt.where(QuestionIssue.category == normalized_category)

    normalized_certification = str(certification or "").strip() or None
    if normalized_certification:
        stmt = stmt.where(Question.certification == normalized_certification)

    normalized_question_id = str(question_id or "").strip() or None
    if normalized_question_id:
        stmt = stmt.where(QuestionIssue.question_id == normalized_question_id)

    normalized_assigned_state = str(assigned_state or "").strip().lower() or None
    if normalized_assigned_state == "assigned":
        stmt = stmt.where(QuestionIssue.resolved_version_id.is_not(None))
    elif normalized_assigned_state == "unassigned":
        stmt = stmt.where(QuestionIssue.resolved_version_id.is_(None))
    elif normalized_assigned_state:
        raise ValueError("Unsupported issue assignment state.")

    rows = db.execute(stmt).all()
    items: list[dict[str, Any]] = []
    for issue, question in rows:
        prompt_excerpt = str(question.prompt or "").strip()
        if len(prompt_excerpt) > 180:
            prompt_excerpt = prompt_excerpt[:177].rstrip() + "..."
        items.append(
            {
                "id": issue.id,
                "question_id": issue.question_id,
                "question_version_id": issue.question_version_id,
                "session_id": issue.session_id,
                "mode": issue.mode,
                "category": issue.category,
                "status": issue.status,
                "message": issue.message,
                "created_at": issue.created_at.isoformat() if issue.created_at else None,
                "updated_at": issue.updated_at.isoformat() if issue.updated_at else None,
                "internal_note": issue.internal_note,
                "triaged_by_user_id": issue.triaged_by_user_id,
                "triaged_at": issue.triaged_at.isoformat() if issue.triaged_at else None,
                "resolved_version_id": issue.resolved_version_id,
                "resolved_by_user_id": issue.resolved_by_user_id,
                "resolved_at": issue.resolved_at.isoformat() if issue.resolved_at else None,
                "certification": question.certification,
                "domain": question.domain,
                "prompt_excerpt": prompt_excerpt,
            }
        )
    return items


def update_question_issue(
    db: Session,
    *,
    issue_id: int,
    status: str | None = None,
    internal_note: str | None = None,
    resolved_version_id: int | None = None,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    issue = db.get(QuestionIssue, issue_id)
    if not issue:
        raise ValueError("Issue not found.")

    now = issue.updated_at
    normalized_status = str(status or "").strip().lower() or None
    if normalized_status:
        if normalized_status not in ALLOWED_ISSUE_STATUSES:
            raise ValueError("Unsupported issue status.")
        current_status = str(issue.status or "open").strip().lower() or "open"
        if normalized_status != current_status and normalized_status not in ISSUE_STATUS_TRANSITIONS.get(current_status, set()):
            raise ValueError("Invalid issue status transition.")
        issue.status = normalized_status
        now = None

        now = datetime.utcnow()
        if normalized_status in {"triaged", "fix_in_progress", "verified", "released"}:
            issue.triaged_by_user_id = actor_user_id
            issue.triaged_at = issue.triaged_at or now
        if normalized_status in {"verified", "released"}:
            issue.resolved_by_user_id = actor_user_id
            issue.resolved_at = now
        elif normalized_status == "dismissed":
            issue.resolved_by_user_id = actor_user_id
            issue.resolved_at = now

    if internal_note is not None:
        cleaned_note = str(internal_note or "").strip()
        issue.internal_note = cleaned_note or None

    if resolved_version_id is not None:
        version = db.get(QuestionVersion, resolved_version_id)
        if not version or version.question_bank_id != issue.question_id:
            raise ValueError("Resolved version does not belong to this question.")
        issue.resolved_version_id = version.id
        issue.question_version_id = issue.question_version_id or version.id
        if now is None:
            now = datetime.utcnow()
        issue.resolved_by_user_id = actor_user_id
        issue.resolved_at = now

    db.commit()
    db.refresh(issue)
    return _serialize_issue(issue=issue, question=db.get(Question, issue.question_id))


def assign_issue_current_version(
    db: Session,
    *,
    issue_id: int,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    issue = db.get(QuestionIssue, issue_id)
    if not issue:
        raise ValueError("Issue not found.")
    bank = db.get(QuestionBank, issue.question_id)
    if not bank:
        raise ValueError("Question bank not found for this issue.")
    version_id = bank.published_version_id or bank.draft_version_id
    if not version_id:
        raise ValueError("No active version is available for this question.")
    return update_question_issue(
        db,
        issue_id=issue_id,
        resolved_version_id=version_id,
        actor_user_id=actor_user_id,
    )


def _serialize_issue(*, issue: QuestionIssue, question: Question | None) -> dict[str, Any]:
    prompt_excerpt = str(question.prompt or "").strip() if question else ""
    if len(prompt_excerpt) > 180:
        prompt_excerpt = prompt_excerpt[:177].rstrip() + "..."
    return {
        "id": issue.id,
        "question_id": issue.question_id,
        "question_version_id": issue.question_version_id,
        "session_id": issue.session_id,
        "mode": issue.mode,
        "category": issue.category,
        "status": issue.status,
        "message": issue.message,
        "created_at": issue.created_at.isoformat() if issue.created_at else None,
        "updated_at": issue.updated_at.isoformat() if issue.updated_at else None,
        "internal_note": issue.internal_note,
        "triaged_by_user_id": issue.triaged_by_user_id,
        "triaged_at": issue.triaged_at.isoformat() if issue.triaged_at else None,
        "resolved_version_id": issue.resolved_version_id,
        "resolved_by_user_id": issue.resolved_by_user_id,
        "resolved_at": issue.resolved_at.isoformat() if issue.resolved_at else None,
        "certification": question.certification if question else None,
        "domain": question.domain if question else None,
        "prompt_excerpt": prompt_excerpt or None,
    }
