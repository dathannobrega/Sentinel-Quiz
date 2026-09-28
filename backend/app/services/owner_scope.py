"""Owner scope helpers shared by the exam (quiz) and study services (M-C6).

Every learner-owned row (sessions, bookmarks, notes, review queue, progress...) is
scoped either to an authenticated ``user_id`` or, for anonymous learners, to a
device ``client_key`` with ``user_id IS NULL``. These helpers centralise how that
scope is turned into SQL filters and how session ownership is checked.
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import false

from app.services.auth import normalize_client_key


class OwnerScopeRequired(ValueError):
    """Raised when an operation needs an owner scope but none was given."""


def normalize_owner_scope(
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    """``(user_id, client_key)`` with the client key dropped when a user is present."""
    normalized_user_id = str(owner_user_id or "").strip() or None
    normalized_client_key = None if normalized_user_id else normalize_client_key(owner_client_key)
    return normalized_user_id, normalized_client_key


def owner_clauses(model: Any, owner_user_id: Optional[str], owner_client_key: Optional[str]) -> list[Any]:
    """SQL clauses restricting ``model`` to the owner; ``[false()]`` without a scope."""
    user_id, client_key = normalize_owner_scope(owner_user_id, owner_client_key)
    if user_id:
        return [model.user_id == user_id]
    if client_key:
        return [model.user_id.is_(None), model.client_key == client_key]
    return [false()]


def apply_owner_filters(
    stmt,
    model: Any,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
    *,
    required: bool = False,
):
    """Restrict ``stmt`` to rows of ``model`` owned by the given scope.

    Without any scope the statement matches nothing, or raises
    :class:`OwnerScopeRequired` when ``required`` is true (study flows).
    """
    user_id, client_key = normalize_owner_scope(owner_user_id, owner_client_key)
    if not user_id and not client_key and required:
        raise OwnerScopeRequired("Owner scope is required.")
    return stmt.where(*owner_clauses(model, user_id, client_key))


def require_owner_filters(stmt, model: Any, owner_user_id: Optional[str], owner_client_key: Optional[str]):
    """:func:`apply_owner_filters` that raises when no scope is given (study flows)."""
    return apply_owner_filters(stmt, model, owner_user_id, owner_client_key, required=True)


def session_owner_scope(session: Any) -> tuple[Optional[str], Optional[str]]:
    """Owner scope of an exam/study session row."""
    return session.user_id, None if session.user_id else session.client_key


def session_belongs_to(session: Any, *, user_id: Optional[str], client_key: Optional[str]) -> bool:
    """Ownership check shared by the exam and study routers.

    Sessions without any owner are never readable (deny by default).
    """
    if session is None:
        return False
    if session.user_id:
        return bool(user_id) and session.user_id == user_id
    if session.client_key:
        return bool(client_key) and session.client_key == client_key
    return False
