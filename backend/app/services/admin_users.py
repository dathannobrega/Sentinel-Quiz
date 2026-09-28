"""Admin user management rules (L-B2, L-B4, L-B6)."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ExamSession, StudySession, User
from app.services.admin_serialization import iso_or_none as _iso
from app.services.auth import PRIVILEGED_ROLES


logger = logging.getLogger("app.security.admin")

ALLOWED_ROLES = frozenset({"student", "editor", "reviewer", "admin"})


class AdminUserRuleError(ValueError):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message



def serialize_admin_user(user: User, *, exam_session_count: int = 0, study_session_count: int = 0) -> Dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": _iso(user.created_at),
        "updated_at": _iso(user.updated_at),
        "exam_session_count": int(exam_session_count or 0),
        "study_session_count": int(study_session_count or 0),
    }


def count_users(db: Session) -> int:
    return int(db.execute(select(func.count()).select_from(User)).scalar_one() or 0)


def list_admin_users(db: Session, *, limit: int, offset: int) -> List[Dict[str, Any]]:
    users = db.execute(
        select(User).order_by(User.created_at.desc(), User.email.asc()).offset(offset).limit(limit)
    ).scalars().all()
    if not users:
        return []
    user_ids = [user.id for user in users]
    exam_counts = dict(
        db.execute(
            select(ExamSession.user_id, func.count(ExamSession.id))
            .where(ExamSession.user_id.in_(user_ids))
            .group_by(ExamSession.user_id)
        ).all()
    )
    study_counts = dict(
        db.execute(
            select(StudySession.user_id, func.count(StudySession.id))
            .where(StudySession.user_id.in_(user_ids))
            .group_by(StudySession.user_id)
        ).all()
    )
    return [
        serialize_admin_user(
            user,
            exam_session_count=exam_counts.get(user.id, 0),
            study_session_count=study_counts.get(user.id, 0),
        )
        for user in users
    ]


def _count_other_active_admins(db: Session, *, excluding_user_id: str) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(User)
            .where(User.role == "admin", User.is_active.is_(True), User.id != excluding_user_id)
        ).scalar_one()
        or 0
    )


def update_admin_user(
    db: Session,
    *,
    actor: User,
    user_id: str,
    role: Optional[str],
    is_active: Optional[bool],
) -> Dict[str, Any]:
    user = db.get(User, user_id)
    if not user:
        raise AdminUserRuleError(404, "http_404", "User not found.")

    new_role = user.role
    if role is not None:
        new_role = str(role or "").strip().lower()
        if new_role not in ALLOWED_ROLES:
            raise AdminUserRuleError(400, "invalid_role", "Invalid role.")
    new_active = user.is_active if is_active is None else bool(is_active)

    role_changed = new_role != user.role
    active_changed = new_active != user.is_active

    if user.id == actor.id and ((role_changed and new_role != "admin") or (active_changed and not new_active)):
        raise AdminUserRuleError(400, "cannot_modify_self", "Admins cannot demote or deactivate their own account.")

    removes_admin = user.role == "admin" and user.is_active and (new_role != "admin" or not new_active)
    if removes_admin and _count_other_active_admins(db, excluding_user_id=user.id) == 0:
        raise AdminUserRuleError(400, "last_admin", "The last active admin cannot be demoted or deactivated.")

    if role_changed and new_role in PRIVILEGED_ROLES and not user.email_verified:
        raise AdminUserRuleError(
            400,
            "email_not_verified",
            "The user must verify their e-mail before receiving an editorial/admin role.",
        )

    if role_changed or active_changed:
        user.role = new_role
        user.is_active = new_active
        db.commit()
        db.refresh(user)
        logger.info(
            "Admin updated user account",
            extra={
                "event": "admin_user_update",
                "actor_user_id": actor.id,
                "target_user_id": user.id,
                "new_role": user.role,
                "is_active": user.is_active,
            },
        )

    exam_session_count = int(
        db.execute(select(func.count(ExamSession.id)).where(ExamSession.user_id == user.id)).scalar_one() or 0
    )
    study_session_count = int(
        db.execute(select(func.count(StudySession.id)).where(StudySession.user_id == user.id)).scalar_one() or 0
    )
    return serialize_admin_user(
        user,
        exam_session_count=exam_session_count,
        study_session_count=study_session_count,
    )
