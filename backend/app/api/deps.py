from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import User
from app.services.auth import get_user_for_token, normalize_client_key, parse_bearer_token


def get_current_user_optional(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    token = parse_bearer_token(authorization)
    if not token:
        return None

    user = get_user_for_token(db, token)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_current_user_required(current_user: User | None = Depends(get_current_user_optional)) -> User:
    if not current_user:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


def get_client_key(x_client_key: Optional[str] = Header(default=None)) -> str | None:
    return normalize_client_key(x_client_key)
