from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AuthChallenge, AuthToken, ExamSession, User


logger = logging.getLogger("app.auth")

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 64
PASSWORD_MIN_LENGTH = 8
EMAIL_VERIFICATION_CHALLENGE = "email_verification"
PASSWORD_RESET_CHALLENGE = "password_reset"


def normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def normalize_client_key(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if len(raw) > 64:
        raw = raw[:64]
    return raw


def parse_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = token.strip()
    return token or None


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("utf-8").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("utf-8"))


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(str(raw_token or "").encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    password = str(password or "")
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {PASSWORD_MIN_LENGTH} characters.")

    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_DKLEN,
    )
    return (
        f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${SCRYPT_DKLEN}"
        f"${_b64encode(salt)}${_b64encode(derived)}"
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algo, n_raw, r_raw, p_raw, dklen_raw, salt_raw, digest_raw = (stored_hash or "").split("$", 6)
    except ValueError:
        return False
    if algo != "scrypt":
        return False

    try:
        salt = _b64decode(salt_raw)
        expected = _b64decode(digest_raw)
        derived = hashlib.scrypt(
            str(password or "").encode("utf-8"),
            salt=salt,
            n=int(n_raw),
            r=int(r_raw),
            p=int(p_raw),
            dklen=int(dklen_raw),
        )
    except (ValueError, TypeError):
        return False

    return hmac.compare_digest(derived, expected)


def create_user(db: Session, *, email: str, password: str, display_name: str | None = None) -> User:
    normalized_email = normalize_email(email)
    if not normalized_email:
        raise ValueError("Email is required.")
    if "@" not in normalized_email or normalized_email.startswith("@") or normalized_email.endswith("@"):
        raise ValueError("Email is invalid.")

    exists = db.execute(
        select(User.id).where(User.email == normalized_email)
    ).scalar_one_or_none()
    if exists:
        raise ValueError("Email already registered.")

    user = User(
        email=normalized_email,
        display_name=(str(display_name or "").strip() or None),
        password_hash=hash_password(password),
        role="student",
        is_active=True,
        email_verified=False,
        email_verified_at=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, *, email: str, password: str) -> User | None:
    normalized_email = normalize_email(email)
    if not normalized_email or "@" not in normalized_email:
        return None
    user = db.execute(
        select(User).where(User.email == normalized_email)
    ).scalar_one_or_none()
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def issue_auth_token(db: Session, user: User) -> tuple[str, datetime]:
    raw_token = secrets.token_urlsafe(max(settings.auth_token_bytes, 24))
    token_hash = _token_hash(raw_token)
    expires_at = datetime.utcnow() + timedelta(hours=max(settings.auth_token_ttl_hours, 1))

    auth_token = AuthToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(auth_token)
    db.commit()
    return raw_token, expires_at


def claim_client_sessions(db: Session, *, user: User, client_key: str | None) -> int:
    normalized_client_key = normalize_client_key(client_key)
    if not normalized_client_key:
        return 0

    sessions = db.execute(
        select(ExamSession).where(
            ExamSession.user_id.is_(None),
            ExamSession.client_key == normalized_client_key,
        )
    ).scalars().all()
    for session in sessions:
        session.user_id = user.id
        session.client_key = None
    return len(sessions)


def get_user_for_token(db: Session, raw_token: str) -> User | None:
    token = str(raw_token or "").strip()
    if not token:
        return None
    token_hash = _token_hash(token)
    now = datetime.utcnow()
    row = db.execute(
        select(AuthToken, User)
        .join(User, User.id == AuthToken.user_id)
        .where(
            AuthToken.token_hash == token_hash,
            AuthToken.revoked_at.is_(None),
            AuthToken.expires_at > now,
            User.is_active.is_(True),
        )
    ).first()
    if not row:
        return None
    auth_token, user = row
    auth_token.last_used_at = now
    db.commit()
    return user


def revoke_token(db: Session, raw_token: str) -> bool:
    token = str(raw_token or "").strip()
    if not token:
        return False
    token_hash = _token_hash(token)
    auth_token = db.execute(
        select(AuthToken).where(
            AuthToken.token_hash == token_hash,
            AuthToken.revoked_at.is_(None),
        )
    ).scalar_one_or_none()
    if not auth_token:
        return False
    auth_token.revoked_at = datetime.utcnow()
    db.commit()
    return True


def revoke_all_user_tokens(db: Session, *, user: User) -> int:
    tokens = db.execute(
        select(AuthToken).where(
            AuthToken.user_id == user.id,
            AuthToken.revoked_at.is_(None),
        )
    ).scalars().all()
    now = datetime.utcnow()
    for token in tokens:
        token.revoked_at = now
    db.commit()
    return len(tokens)


def _smtp_is_configured() -> bool:
    return bool(
        str(settings.smtp_host or "").strip()
        and str(settings.smtp_from_email or "").strip()
    )


def _build_public_web_origin() -> str:
    return str(settings.public_web_origin or "").strip().rstrip("/") or "http://127.0.0.1:3000"


def _send_email_message(message: EmailMessage) -> None:
    if not _smtp_is_configured():
        raise RuntimeError("SMTP is not configured.")

    host = str(settings.smtp_host or "").strip()
    port = max(int(settings.smtp_port or 0), 1)
    username = str(settings.smtp_username or "").strip()
    password = str(settings.smtp_password or "").strip()

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.ehlo()
        if settings.smtp_use_tls:
            smtp.starttls()
            smtp.ehlo()
        if username:
            smtp.login(username, password)
        smtp.send_message(message)


def _deliver_auth_email(
    *,
    to_email: str,
    subject: str,
    body_lines: list[str],
    fallback_log_context: dict[str, str],
) -> None:
    sender_email = str(settings.smtp_from_email or "").strip()
    sender_name = str(settings.smtp_from_name or "").strip() or "Sentinel Quiz"

    if _smtp_is_configured():
        message = EmailMessage()
        message["To"] = to_email
        message["From"] = f"{sender_name} <{sender_email}>"
        message["Subject"] = subject
        message.set_content("\n\n".join(body_lines))
        _send_email_message(message)
        return

    if settings.is_production():
        logger.error(
            "SMTP is not configured in production. Auth email delivery aborted.",
            extra={
                "event": "auth_email_delivery_unavailable",
                "challenge_type": fallback_log_context.get("challenge_type"),
                "delivery_target": to_email,
            },
        )
        raise RuntimeError("SMTP is required in production for auth email delivery.")

    logger.warning(
        "SMTP not configured. Auth email link emitted to server logs for local development only.",
        extra={
            "event": "auth_email_fallback_log",
            **fallback_log_context,
            "delivery_target": to_email,
            "environment": settings.environment,
        },
    )


def _issue_challenge(
    db: Session,
    *,
    user: User,
    challenge_type: str,
    ttl_minutes: int,
) -> tuple[AuthChallenge, str]:
    active_challenges = db.execute(
        select(AuthChallenge).where(
            AuthChallenge.user_id == user.id,
            AuthChallenge.challenge_type == challenge_type,
            AuthChallenge.consumed_at.is_(None),
        )
    ).scalars().all()
    now = datetime.utcnow()
    for existing in active_challenges:
        existing.consumed_at = now

    raw_token = secrets.token_urlsafe(32)
    challenge = AuthChallenge(
        user_id=user.id,
        challenge_type=challenge_type,
        token_hash=_token_hash(raw_token),
        delivery_target=user.email,
        expires_at=now + timedelta(minutes=max(int(ttl_minutes), 1)),
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return challenge, raw_token


def send_email_verification(db: Session, *, user: User) -> AuthChallenge:
    challenge, raw_token = _issue_challenge(
        db,
        user=user,
        challenge_type=EMAIL_VERIFICATION_CHALLENGE,
        ttl_minutes=settings.auth_email_verification_ttl_minutes,
    )
    verify_url = f"{_build_public_web_origin()}/verify-email?token={raw_token}"
    _deliver_auth_email(
        to_email=user.email,
        subject="Verifique seu email no Sentinel Quiz",
        body_lines=[
            f"Ola {user.display_name or user.email},",
            "Clique no link abaixo para verificar seu email e reforcar a seguranca da conta:",
            verify_url,
            "Se voce nao solicitou isso, ignore este email.",
        ],
        fallback_log_context={
            "challenge_type": EMAIL_VERIFICATION_CHALLENGE,
            "verification_url": verify_url,
        },
    )
    return challenge


def request_password_reset(db: Session, *, email: str) -> None:
    normalized_email = normalize_email(email)
    if not normalized_email:
        return
    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if not user or not user.is_active:
        return

    challenge, raw_token = _issue_challenge(
        db,
        user=user,
        challenge_type=PASSWORD_RESET_CHALLENGE,
        ttl_minutes=settings.auth_password_reset_ttl_minutes,
    )
    reset_url = f"{_build_public_web_origin()}/reset-password?token={raw_token}"
    _deliver_auth_email(
        to_email=user.email,
        subject="Redefinicao de senha do Sentinel Quiz",
        body_lines=[
            f"Ola {user.display_name or user.email},",
            "Use o link abaixo para redefinir sua senha:",
            reset_url,
            "Se voce nao solicitou a redefinicao, ignore este email.",
        ],
        fallback_log_context={
            "challenge_type": PASSWORD_RESET_CHALLENGE,
            "reset_url": reset_url,
        },
    )


def _consume_challenge(
    db: Session,
    *,
    raw_token: str,
    challenge_type: str,
) -> AuthChallenge:
    token = str(raw_token or "").strip()
    if not token:
        raise ValueError("Token is required.")
    now = datetime.utcnow()
    challenge = db.execute(
        select(AuthChallenge).where(
            AuthChallenge.token_hash == _token_hash(token),
            AuthChallenge.challenge_type == challenge_type,
            AuthChallenge.consumed_at.is_(None),
            AuthChallenge.expires_at > now,
        )
    ).scalar_one_or_none()
    if not challenge:
        raise ValueError("Token is invalid or expired.")
    challenge.consumed_at = now
    return challenge


def verify_email_address(db: Session, *, raw_token: str) -> User:
    challenge = _consume_challenge(
        db,
        raw_token=raw_token,
        challenge_type=EMAIL_VERIFICATION_CHALLENGE,
    )
    user = db.get(User, challenge.user_id)
    if not user:
        raise ValueError("User not found.")
    user.email_verified = True
    user.email_verified_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user


def reset_password_with_token(db: Session, *, raw_token: str, new_password: str) -> User:
    challenge = _consume_challenge(
        db,
        raw_token=raw_token,
        challenge_type=PASSWORD_RESET_CHALLENGE,
    )
    user = db.get(User, challenge.user_id)
    if not user:
        raise ValueError("User not found.")
    user.password_hash = hash_password(new_password)
    db.commit()
    db.refresh(user)
    revoke_all_user_tokens(db, user=user)
    return user
