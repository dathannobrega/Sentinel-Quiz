from __future__ import annotations

from typing import Optional

from fastapi import Cookie, Depends, Header, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import api_error
from app.db.session import get_db
from app.models import User
from app.services.auth import normalize_client_key, parse_bearer_token, resolve_auth_token


def get_current_user_optional(
    response: Response,
    authorization: Optional[str] = Header(default=None),
    auth_cookie: Optional[str] = Cookie(default=None, alias=settings.auth_cookie_name),
    db: Session = Depends(get_db),
) -> User | None:
    bearer = parse_bearer_token(authorization)
    token = bearer or str(auth_cookie or "").strip() or None
    if not token:
        return None

    user, renewed_expires_at = resolve_auth_token(db, token)
    if not user:
        return None
    if renewed_expires_at is not None and not bearer:
        # Sliding session (L-B1): keep the cookie lifetime in step with the token.
        from app.api.auth import _set_auth_cookie  # local import: app.api.auth imports this module

        _set_auth_cookie(response, token, renewed_expires_at)
    return user


def get_current_user_required(current_user: User | None = Depends(get_current_user_optional)) -> User:
    if not current_user:
        raise api_error(
            401,
            "auth_required",
            "Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


def get_client_key(x_client_key: Optional[str] = Header(default=None)) -> str | None:
    return normalize_client_key(x_client_key)
