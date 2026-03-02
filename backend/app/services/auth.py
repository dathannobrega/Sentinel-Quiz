from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AuthToken, ExamSession, User


SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 64
PASSWORD_MIN_LENGTH = 8


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
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
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
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
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
    _token, user = row
    return user


def revoke_token(db: Session, raw_token: str) -> bool:
    token = str(raw_token or "").strip()
    if not token:
        return False
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
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
