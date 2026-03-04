from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Question, QuestionBank, QuestionIssue
from app.services.auth import normalize_client_key


ALLOWED_ISSUE_CATEGORIES = {"gabarito", "explicacao", "referencia", "clareza"}
ALLOWED_ISSUE_STATUSES = {"open", "triaged", "fixed", "dismissed"}


def _owner_scope(owner_user_id: str | None, owner_client_key: str | None) -> tuple[str | None, str | None]:
    if owner_user_id:
        return owner_user_id, None
    normalized_client_key = normalize_client_key(owner_client_key)
    if normalized_client_key:
        return None, normalized_client_key
    raise ValueError("Issue reporting requires an authenticated owner scope.")


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
    owner_user_id, owner_client_key = _owner_scope(owner_user_id, owner_client_key)
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
    }


def list_question_issues(
    db: Session,
    *,
    status: str | None = None,
    category: str | None = None,
    certification: str | None = None,
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
                "certification": question.certification,
                "domain": question.domain,
                "prompt_excerpt": prompt_excerpt,
            }
        )
    return items
