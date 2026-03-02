from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_required
from app.core.config import settings
from app.db.session import get_db
from app.models import User
from app.services.auth import (
    authenticate_user,
    claim_client_sessions,
    create_user,
    issue_auth_token,
    parse_bearer_token,
    revoke_token,
)
from app.services.study import claim_client_study_state


router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthRegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=200)
    display_name: Optional[str] = Field(default=None, max_length=255)


class AuthLoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=200)


class AuthUserOut(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    role: str
    is_active: bool
    created_at: str


class AuthTokenOut(BaseModel):
    token: str
    token_type: str = "session"
    expires_at: str
    user: AuthUserOut


def _serialize_user(user: User) -> AuthUserOut:
    return AuthUserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if isinstance(user.created_at, datetime) else "",
    )


def _set_auth_cookie(response: Response, token: str, expires_at: datetime) -> None:
    domain = str(settings.auth_cookie_domain or "").strip() or None
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        httponly=True,
        secure=bool(settings.auth_cookie_secure or settings.is_production()),
        samesite=str(settings.auth_cookie_samesite or "lax").strip().lower(),
        expires=expires_at,
        path="/",
        domain=domain,
    )


def _clear_auth_cookie(response: Response) -> None:
    domain = str(settings.auth_cookie_domain or "").strip() or None
    response.delete_cookie(
        key=settings.auth_cookie_name,
        path="/",
        domain=domain,
        httponly=True,
        secure=bool(settings.auth_cookie_secure or settings.is_production()),
        samesite=str(settings.auth_cookie_samesite or "lax").strip().lower(),
    )


@router.post("/register", response_model=AuthTokenOut)
def register(
    payload: AuthRegisterIn,
    response: Response,
    x_client_key: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    try:
        user = create_user(
            db,
            email=payload.email,
            password=payload.password,
            display_name=payload.display_name,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 409 if "already registered" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)

    claim_client_sessions(db, user=user, client_key=x_client_key)
    claim_client_study_state(db, user=user, client_key=x_client_key)
    token, expires_at = issue_auth_token(db, user)
    _set_auth_cookie(response, token, expires_at)
    return AuthTokenOut(
        token=token,
        expires_at=expires_at.isoformat(),
        user=_serialize_user(user),
    )


@router.post("/login", response_model=AuthTokenOut)
def login(
    payload: AuthLoginIn,
    response: Response,
    x_client_key: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user = authenticate_user(db, email=payload.email, password=payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    claim_client_sessions(db, user=user, client_key=x_client_key)
    claim_client_study_state(db, user=user, client_key=x_client_key)
    token, expires_at = issue_auth_token(db, user)
    _set_auth_cookie(response, token, expires_at)
    return AuthTokenOut(
        token=token,
        expires_at=expires_at.isoformat(),
        user=_serialize_user(user),
    )


@router.post("/logout")
def logout(
    response: Response,
    authorization: Optional[str] = Header(default=None),
    auth_cookie: Optional[str] = Cookie(default=None, alias=settings.auth_cookie_name),
    db: Session = Depends(get_db),
):
    token = parse_bearer_token(authorization) or str(auth_cookie or "").strip() or None
    if token:
        revoke_token(db, token)
    _clear_auth_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=AuthUserOut)
def me(current_user: User = Depends(get_current_user_required)):
    return _serialize_user(current_user)
