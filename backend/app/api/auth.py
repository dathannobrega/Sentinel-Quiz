from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.api.deps import get_current_user_optional, get_current_user_required
from app.core.config import settings
from app.core.errors import api_error
from app.db.session import get_db
from app.models import User
from app.schemas import (
    AuthLoginIn,
    AuthRegisterIn,
    AuthTokenOut,
    AuthUserOut,
    EmailChallengeConsumeIn,
    EmailChallengeRequestIn,
    OkMessageOut,
    OkOut,
    PasswordResetIn,
)
from app.services.auth import (
    RegistrationUnavailable,
    authenticate_user,
    claim_client_sessions,
    create_user,
    deliver_email_safely,
    issue_auth_token,
    parse_bearer_token,
    prepare_email_verification,
    revoke_token,
    reset_password_with_token,
    run_email_verification_request,
    run_password_reset_request,
    verify_email_address,
)
from app.services.study import claim_client_study_state


router = APIRouter(prefix="/api/auth", tags=["auth"])

GENERIC_VERIFICATION_MESSAGE = "If the account exists, a verification email was sent."
GENERIC_RESET_MESSAGE = "If the account exists, a password reset email was sent."
REGISTRATION_UNAVAILABLE_MESSAGE = (
    "We could not create an account with these details. "
    "If you already have an account, sign in or reset your password."
)


def _serialize_user(user: User) -> AuthUserOut:
    created_at = user.created_at if isinstance(user.created_at, datetime) else utcnow()
    return AuthUserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        email_verified=bool(user.email_verified),
        created_at=created_at.isoformat(),
    )


def _token_response(user: User, token: str, expires_at: datetime) -> AuthTokenOut:
    return AuthTokenOut(
        token=token if settings.auth_return_token_in_body else None,
        expires_at=expires_at.isoformat(),
        user=_serialize_user(user),
    )


def _set_auth_cookie(response: Response, token: str, expires_at: datetime) -> None:
    domain = str(settings.auth_cookie_domain or "").strip() or None
    expires_at_utc = (
        expires_at.replace(tzinfo=timezone.utc)
        if expires_at.tzinfo is None or expires_at.utcoffset() is None
        else expires_at.astimezone(timezone.utc)
    )
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        httponly=True,
        secure=settings.effective_cookie_secure(),
        samesite=str(settings.auth_cookie_samesite or "lax").strip().lower(),
        expires=expires_at_utc,
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
        secure=settings.effective_cookie_secure(),
        samesite=str(settings.auth_cookie_samesite or "lax").strip().lower(),
    )


@router.post("/register", response_model=AuthTokenOut)
def register(
    payload: AuthRegisterIn,
    response: Response,
    background_tasks: BackgroundTasks,
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
    except RegistrationUnavailable:
        # Generic answer: the message does not confirm that the e-mail is registered.
        # (Full anti-enumeration requires an e-mail-first sign-up flow.)
        raise api_error(409, "registration_unavailable", REGISTRATION_UNAVAILABLE_MESSAGE)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    claim_client_sessions(db, user=user, client_key=x_client_key)
    claim_client_study_state(db, user=user, client_key=x_client_key)
    outgoing_email = prepare_email_verification(db, user=user, enforce_cooldown=False)
    token, expires_at = issue_auth_token(db, user)
    _set_auth_cookie(response, token, expires_at)
    result = _token_response(user, token, expires_at)
    # SMTP happens after the response, outside the request DB session.
    background_tasks.add_task(deliver_email_safely, outgoing_email)
    return result


@router.post("/login", response_model=AuthTokenOut)
def login(
    payload: AuthLoginIn,
    response: Response,
    x_client_key: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user = authenticate_user(db, email=payload.email, password=payload.password)
    if not user:
        raise api_error(401, "invalid_credentials", "Invalid credentials.")

    claim_client_sessions(db, user=user, client_key=x_client_key)
    claim_client_study_state(db, user=user, client_key=x_client_key)
    token, expires_at = issue_auth_token(db, user)
    _set_auth_cookie(response, token, expires_at)
    return _token_response(user, token, expires_at)


@router.post("/logout", response_model=OkOut)
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
    return OkOut(ok=True)


@router.get("/me", response_model=AuthUserOut)
def me(current_user: User = Depends(get_current_user_required)):
    return _serialize_user(current_user)


@router.post("/request-email-verification", response_model=OkMessageOut)
def request_email_verification(
    payload: EmailChallengeRequestIn,
    background_tasks: BackgroundTasks,
    current_user: User | None = Depends(get_current_user_optional),
):
    # Always the same answer; lookup, cooldown check and SMTP run after the response
    # in a background task with its own DB session.
    if current_user:
        background_tasks.add_task(run_email_verification_request, user_id=current_user.id)
    elif payload.email:
        background_tasks.add_task(run_email_verification_request, email=payload.email)
    return OkMessageOut(ok=True, message=GENERIC_VERIFICATION_MESSAGE)


@router.post("/verify-email", response_model=AuthUserOut)
def verify_email(
    payload: EmailChallengeConsumeIn,
    db: Session = Depends(get_db),
):
    try:
        user = verify_email_address(db, raw_token=payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize_user(user)


@router.post("/request-password-reset", response_model=OkMessageOut)
def request_password_reset_endpoint(
    payload: EmailChallengeRequestIn,
    background_tasks: BackgroundTasks,
):
    if payload.email:
        background_tasks.add_task(run_password_reset_request, payload.email)
    return OkMessageOut(ok=True, message=GENERIC_RESET_MESSAGE)


@router.post("/reset-password", response_model=OkOut)
def reset_password(
    payload: PasswordResetIn,
    db: Session = Depends(get_db),
):
    try:
        reset_password_with_token(
            db,
            raw_token=payload.token,
            new_password=payload.new_password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return OkOut(ok=True)
