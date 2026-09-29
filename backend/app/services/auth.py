from __future__ import annotations

import base64
import functools
import hashlib
import hmac
import logging
import secrets
import smtplib
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage

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
EMAIL_MAX_LENGTH = 255
EMAIL_VERIFICATION_CHALLENGE = "email_verification"
PASSWORD_RESET_CHALLENGE = "password_reset"
PRIVILEGED_ROLES = frozenset({"editor", "reviewer", "admin"})


class RegistrationUnavailable(ValueError):
    """Raised when an account cannot be created (e.g. e-mail already registered).

    The API maps it to a generic message so the response does not state whether the
    address is registered.
    """


@dataclass(frozen=True)
class OutgoingEmail:
    """A fully rendered e-mail, ready to be delivered outside the request/DB session."""

    to_email: str
    subject: str
    body_lines: tuple[str, ...]
    challenge_type: str
    challenge_id: int | None = None


def normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def validate_email_address(value: str) -> str:
    """Validate and normalise an e-mail address for account creation.

    Rejects control characters (CR/LF header injection), missing domain dots and
    reserved/special-use domains. Deliverability (DNS) is not checked.
    """
    raw = str(value or "")
    if any(ch in raw for ch in ("\r", "\n", "\x00")):
        raise ValueError("Email is invalid.")
    normalized = normalize_email(raw)
    if not normalized:
        raise ValueError("Email is required.")
    if len(normalized) > EMAIL_MAX_LENGTH:
        raise ValueError("Email is invalid.")
    try:
        from email_validator import EmailNotValidError, validate_email

        try:
            result = validate_email(normalized, check_deliverability=False)
        except EmailNotValidError as exc:
            raise ValueError("Email is invalid.") from exc
        return normalize_email(result.normalized)
    except ImportError:  # pragma: no cover - email-validator is a pinned dependency
        local, sep, domain = normalized.partition("@")
        if not sep or not local or "." not in domain or " " in normalized:
            raise ValueError("Email is invalid.")
        return normalized


def _looks_like_email(value: str) -> bool:
    return "@" in value and not any(ch in value for ch in ("\r", "\n", "\x00"))


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


def token_fingerprint(raw_token: str) -> str:
    """Short, non-reversible identifier of a token that is safe to log."""
    return _token_hash(raw_token)[:12]


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


@functools.lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    # Same scrypt parameters as real hashes so a failed lookup costs the same time.
    return hash_password(secrets.token_urlsafe(24))


def create_user(db: Session, *, email: str, password: str, display_name: str | None = None) -> User:
    normalized_email = validate_email_address(email)
    password_hash = hash_password(password)

    exists = db.execute(
        select(User.id).where(User.email == normalized_email)
    ).scalar_one_or_none()
    if exists:
        raise RegistrationUnavailable("Email already registered.")

    user = User(
        email=normalized_email,
        display_name=(str(display_name or "").strip() or None),
        password_hash=password_hash,
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
    """Verify credentials in (roughly) constant time.

    When the user does not exist or is inactive, the password is still checked
    against a dummy scrypt hash so the response time does not reveal whether the
    account exists.
    """
    normalized_email = normalize_email(email)
    user = None
    if normalized_email and _looks_like_email(normalized_email):
        user = db.execute(
            select(User).where(User.email == normalized_email)
        ).scalar_one_or_none()

    if not user or not user.is_active:
        verify_password(password, _dummy_password_hash())
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
    """Attach anonymous exam sessions created with ``X-Client-Key`` to ``user``.

    Security note (L-B8): the client key is a random identifier generated by the
    browser and stored locally; it is a bearer secret for anonymous progress. Anyone
    who knows it can read that anonymous progress and, by logging in/registering while
    sending it, claim those anonymous sessions into their own account. This is an
    accepted trade-off for the "try without an account" flow: anonymous sessions hold
    no personal data, keys are never exposed by the API, and once claimed the sessions
    are owned by the user (``client_key`` is cleared) so the key no longer grants
    access. Do not reuse client keys across devices/users.
    """
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
    user, _renewed_expires_at = resolve_auth_token(db, raw_token)
    return user


def resolve_auth_token(db: Session, raw_token: str) -> tuple[User | None, datetime | None]:
    """User owning ``raw_token`` plus the new expiry when the session was renewed (L-B1).

    ``last_used_at`` is written at most once every AUTH_LAST_USED_THROTTLE_SECONDS. In
    that same throttled write, when AUTH_SLIDING_SESSION is on and less than half of
    AUTH_TOKEN_TTL_HOURS remains (i.e. more than half elapsed since it was issued or
    last renewed), ``expires_at`` slides to ``now + TTL``. The second element is that
    new expiry (``None`` when nothing was renewed) so callers can refresh the cookie.
    """
    token = str(raw_token or "").strip()
    if not token:
        return None, None
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
        return None, None
    auth_token, user = row
    renewed_expires_at: datetime | None = None
    throttle = timedelta(seconds=max(int(settings.auth_last_used_throttle_seconds or 0), 0))
    if auth_token.last_used_at is None or (now - auth_token.last_used_at) >= throttle:
        # At most one write per token every AUTH_LAST_USED_THROTTLE_SECONDS.
        auth_token.last_used_at = now
        if settings.auth_sliding_session:
            ttl = timedelta(hours=max(int(settings.auth_token_ttl_hours or 0), 1))
            if auth_token.expires_at - now < ttl / 2:
                auth_token.expires_at = now + ttl
                renewed_expires_at = auth_token.expires_at
        db.commit()
    return user, renewed_expires_at


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
    timeout = max(float(settings.smtp_timeout_seconds or 0), 1.0)

    with smtplib.SMTP(host, port, timeout=timeout) as smtp:
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
    body_lines: list[str] | tuple[str, ...],
    fallback_log_context: dict[str, object],
) -> None:
    """Deliver an auth e-mail via SMTP.

    Never logs the link/token. Without SMTP outside production only a notice with the
    challenge id is logged (developers can read the token from the database); in
    production missing SMTP is an error.
    """
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

    safe_context = {
        key: value
        for key, value in fallback_log_context.items()
        if key in {"challenge_type", "challenge_id"}
    }
    if settings.is_production():
        logger.error(
            "SMTP is not configured in production. Auth email delivery aborted.",
            extra={"event": "auth_email_delivery_unavailable", **safe_context},
        )
        raise RuntimeError("SMTP is required in production for auth email delivery.")

    logger.warning(
        "SMTP not configured; auth email was not sent (development only). "
        "Look up the challenge in the auth_challenges table if needed.",
        extra={
            "event": "auth_email_not_sent",
            **safe_context,
            "environment": settings.environment,
        },
    )


def deliver_email_safely(email: OutgoingEmail | None) -> bool:
    """Send an e-mail, swallowing and logging any failure. Safe for background tasks."""
    if email is None:
        return False
    try:
        _deliver_auth_email(
            to_email=email.to_email,
            subject=email.subject,
            body_lines=email.body_lines,
            fallback_log_context={"challenge_type": email.challenge_type, "challenge_id": email.challenge_id},
        )
        return True
    except Exception as exc:
        logger.error(
            "Auth email delivery failed",
            extra={
                "event": "auth_email_delivery_failed",
                "challenge_type": email.challenge_type,
                "challenge_id": email.challenge_id,
                "error_type": type(exc).__name__,
            },
        )
        return False


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


def _verification_on_cooldown(db: Session, *, user: User) -> bool:
    cooldown = max(int(settings.auth_verification_resend_cooldown_seconds or 0), 0)
    if cooldown <= 0:
        return False
    latest = db.execute(
        select(AuthChallenge.created_at)
        .where(
            AuthChallenge.user_id == user.id,
            AuthChallenge.challenge_type == EMAIL_VERIFICATION_CHALLENGE,
        )
        .order_by(AuthChallenge.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest is None:
        return False
    return (datetime.utcnow() - latest) < timedelta(seconds=cooldown)


def prepare_email_verification(db: Session, *, user: User, enforce_cooldown: bool = True) -> OutgoingEmail | None:
    """Create a verification challenge and render the e-mail (does NOT send it).

    Returns ``None`` when nothing should be sent (already verified, inactive user or
    resend cooldown still active).
    """
    if not user or not user.is_active or user.email_verified:
        return None
    if enforce_cooldown and _verification_on_cooldown(db, user=user):
        logger.info(
            "Email verification resend skipped (cooldown)",
            extra={"event": "auth_email_verification_cooldown", "user_id": user.id},
        )
        return None
    challenge, raw_token = _issue_challenge(
        db,
        user=user,
        challenge_type=EMAIL_VERIFICATION_CHALLENGE,
        ttl_minutes=settings.auth_email_verification_ttl_minutes,
    )
    verify_url = f"{_build_public_web_origin()}/verify-email?token={raw_token}"
    return OutgoingEmail(
        to_email=user.email,
        subject="Verifique seu email no Sentinel Quiz",
        body_lines=(
            f"Ola {user.display_name or user.email},",
            "Clique no link abaixo para verificar seu email e reforcar a seguranca da conta:",
            verify_url,
            "Se voce nao solicitou isso, ignore este email.",
        ),
        challenge_type=EMAIL_VERIFICATION_CHALLENGE,
        challenge_id=challenge.id,
    )


def send_email_verification(db: Session, *, user: User) -> OutgoingEmail | None:
    """Backwards compatible helper: prepare and synchronously deliver (errors swallowed)."""
    email = prepare_email_verification(db, user=user)
    deliver_email_safely(email)
    return email


def prepare_password_reset(db: Session, *, email: str) -> OutgoingEmail | None:
    normalized_email = normalize_email(email)
    if not normalized_email or not _looks_like_email(normalized_email):
        return None
    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if not user or not user.is_active:
        return None

    challenge, raw_token = _issue_challenge(
        db,
        user=user,
        challenge_type=PASSWORD_RESET_CHALLENGE,
        ttl_minutes=settings.auth_password_reset_ttl_minutes,
    )
    reset_url = f"{_build_public_web_origin()}/reset-password?token={raw_token}"
    return OutgoingEmail(
        to_email=user.email,
        subject="Redefinicao de senha do Sentinel Quiz",
        body_lines=(
            f"Ola {user.display_name or user.email},",
            "Use o link abaixo para redefinir sua senha:",
            reset_url,
            "Se voce nao solicitou a redefinicao, ignore este email.",
        ),
        challenge_type=PASSWORD_RESET_CHALLENGE,
        challenge_id=challenge.id,
    )


def request_password_reset(db: Session, *, email: str) -> None:
    """Issue a reset challenge (if the account exists) and deliver it; never raises for delivery."""
    deliver_email_safely(prepare_password_reset(db, email=email))


def run_password_reset_request(email: str) -> None:
    """Background entry point: uses its own short-lived DB session."""
    from app.db.session import session_scope

    try:
        with session_scope() as db:
            outgoing = prepare_password_reset(db, email=email)
    except Exception as exc:
        logger.error(
            "Password reset request failed",
            extra={"event": "auth_password_reset_request_failed", "error_type": type(exc).__name__},
        )
        return
    deliver_email_safely(outgoing)


def run_email_verification_request(*, user_id: str | None = None, email: str | None = None) -> None:
    """Background entry point for verification e-mails (own DB session, errors logged)."""
    from app.db.session import session_scope

    try:
        with session_scope() as db:
            user = None
            if user_id:
                user = db.get(User, user_id)
            elif email:
                normalized = normalize_email(email)
                if normalized and _looks_like_email(normalized):
                    user = db.execute(select(User).where(User.email == normalized)).scalar_one_or_none()
            outgoing = prepare_email_verification(db, user=user) if user else None
    except Exception as exc:
        logger.error(
            "Email verification request failed",
            extra={"event": "auth_email_verification_request_failed", "error_type": type(exc).__name__},
        )
        return
    deliver_email_safely(outgoing)


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
