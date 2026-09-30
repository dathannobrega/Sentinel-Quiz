"""Signed, stateless tokens for Sentinel Arena (DC-07).

Format: ``v1.<kid>.<payload b64url>.<HMAC-SHA256 b64url>``. The payload carries
``{sid, pid?, role, jti, exp}``; ``role`` is ``participant`` or ``display``. Keys come
from LIVE_TOKEN_KEYS (``kid:secret,...``, the first key signs, every key verifies, so
keys rotate without logging anybody out). Outside production, when none is configured, a
development key derived from DATABASE_URL is used: every worker/replica of the same
deployment derives the same key (a random per-process key would make a token issued
by one uvicorn worker fail on another).

Revocation: the participant row stores ``sha256(jti)``; kicking/rejoining rotates it,
and the gateway compares it on ``hello``.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any

from app.core.config import settings

TOKEN_VERSION = "v1"
_DEV_KEY_ID = "dev"
MIN_SECRET_BYTES = 32


class LiveTokenError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code  # "invalid" | "expired"


@dataclass(frozen=True)
class LiveTokenClaims:
    session_id: str
    role: str
    jti: str
    exp: int
    participant_id: str | None = None


def parse_token_keys(raw: str) -> list[tuple[str, bytes]]:
    keys: list[tuple[str, bytes]] = []
    for chunk in str(raw or "").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        kid, sep, secret = chunk.partition(":")
        kid = kid.strip()
        if not sep or not kid or not kid.isalnum() or len(kid) > 16:
            raise ValueError("each key must look like 'kid:secret' with an alphanumeric kid (≤16 chars).")
        secret_bytes = secret.strip().encode("utf-8")
        if len(secret_bytes) < MIN_SECRET_BYTES:
            raise ValueError(f"secret for kid '{kid}' must have at least {MIN_SECRET_BYTES} bytes.")
        keys.append((kid, secret_bytes))
    return keys


def _keys() -> list[tuple[str, bytes]]:
    keys = parse_token_keys(settings.live_token_keys)
    if keys:
        return keys
    if settings.is_production():  # validate_runtime already refuses this when enabled
        raise LiveTokenError("invalid")
    derived = hashlib.sha256(f"sentinel-arena-dev-token-key:{settings.database_url}".encode("utf-8")).digest()
    return [(_DEV_KEY_ID, derived)]


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def jti_hash(jti: str) -> str:
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def issue_token(*, session_id: str, role: str, ttl_seconds: int, participant_id: str | None = None) -> tuple[str, LiveTokenClaims]:
    kid, secret = _keys()[0]
    claims = LiveTokenClaims(
        session_id=session_id,
        role=role,
        jti=secrets.token_urlsafe(18),
        exp=int(time.time()) + int(ttl_seconds),
        participant_id=participant_id,
    )
    payload: dict[str, Any] = {"sid": claims.session_id, "role": claims.role, "jti": claims.jti, "exp": claims.exp}
    if participant_id:
        payload["pid"] = participant_id
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signing_input = f"{TOKEN_VERSION}.{kid}.{body}".encode("ascii")
    signature = _b64(hmac.new(secret, signing_input, hashlib.sha256).digest())
    return f"{TOKEN_VERSION}.{kid}.{body}.{signature}", claims


def verify_token(token: str, *, now: float | None = None) -> LiveTokenClaims:
    parts = str(token or "").split(".")
    if len(parts) != 4 or parts[0] != TOKEN_VERSION or len(token) > 1024:
        raise LiveTokenError("invalid")
    _version, kid, body, signature = parts
    secret = next((value for key_id, value in _keys() if key_id == kid), None)
    if secret is None:
        raise LiveTokenError("invalid")
    expected = hmac.new(secret, f"{TOKEN_VERSION}.{kid}.{body}".encode("ascii"), hashlib.sha256).digest()
    try:
        provided = _unb64(signature)
        payload = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError):
        raise LiveTokenError("invalid") from None
    if not hmac.compare_digest(expected, provided) or not isinstance(payload, dict):
        raise LiveTokenError("invalid")
    try:
        claims = LiveTokenClaims(
            session_id=str(payload["sid"]),
            role=str(payload["role"]),
            jti=str(payload["jti"]),
            exp=int(payload["exp"]),
            participant_id=str(payload["pid"]) if payload.get("pid") else None,
        )
    except (KeyError, TypeError, ValueError):
        raise LiveTokenError("invalid") from None
    if claims.role not in {"participant", "display"}:
        raise LiveTokenError("invalid")
    if claims.role == "participant" and not claims.participant_id:
        raise LiveTokenError("invalid")
    if claims.exp < int(now if now is not None else time.time()):
        raise LiveTokenError("expired")
    return claims
