"""Content licence classification (PLANO §11.1, DC-21) and live-quiz exposure policy.

A question's ``license_scope`` is derived from its PROVENANCE, never from the directory
it happens to live in:

1. an explicit ``license_scope`` in the question (or its exam block) wins — this is how
   an editorial audit records "own" content;
2. ``usage_restriction == "personal_use"`` or a file under ``questions/local/`` →
   ``personal_use`` (private study only);
3. a third-party ``source_repo`` (imported through scripts/question_sources) →
   ``platform``;
4. anything else → ``pending_audit`` (fail closed).

Exposure in live quizzes (§15.4): ``personal_use`` is never allowed; rooms that accept
guests only take ``own`` items (plus ``platform`` when LIVE_PLATFORM_GUEST_OK, decision
Q-19). Rooms that require login accept ``own``, ``platform`` and ``pending_audit``,
i.e. the same audience the study product already serves.
"""
from __future__ import annotations

from typing import Any, Mapping

from app.models import LICENSE_SCOPES

OWN = "own"
PLATFORM = "platform"
PENDING_AUDIT = "pending_audit"
PERSONAL_USE = "personal_use"


def _valid_scope(value: Any) -> str | None:
    scope = str(value or "").strip().lower()
    return scope if scope in LICENSE_SCOPES else None


def classify_license_scope(
    question: Mapping[str, Any],
    *,
    exam: Mapping[str, Any] | None = None,
    source_path: str | None = None,
) -> tuple[str, str | None]:
    """Return ``(license_scope, source_license)`` for one raw/normalized question."""
    exam = exam or {}
    source_license = str(question.get("source_license") or exam.get("source_license") or "").strip() or None
    explicit = _valid_scope(question.get("license_scope")) or _valid_scope(exam.get("license_scope"))
    restriction = str(question.get("usage_restriction") or exam.get("usage_restriction") or "").strip().lower()
    normalized_path = str(source_path or "").replace("\\", "/")
    is_local = "/local/" in f"/{normalized_path}" or normalized_path.startswith("local/")

    if restriction == PERSONAL_USE or is_local:
        return PERSONAL_USE, (source_license[:64] if source_license else None)
    if explicit:
        return explicit, (source_license[:64] if source_license else None)
    if str(question.get("source_repo") or exam.get("source_repo") or "").strip():
        return PLATFORM, (source_license[:64] if source_license else None)
    return PENDING_AUDIT, (source_license[:64] if source_license else None)


def allowed_scopes(*, allow_guests: bool, platform_guest_ok: bool) -> frozenset[str]:
    """Licence scopes a live room may show."""
    if allow_guests:
        return frozenset({OWN, PLATFORM} if platform_guest_ok else {OWN})
    return frozenset({OWN, PLATFORM, PENDING_AUDIT})


def is_guest_eligible(scope: str, *, platform_guest_ok: bool) -> bool:
    return scope in allowed_scopes(allow_guests=True, platform_guest_ok=platform_guest_ok)


def is_live_usable(scope: str) -> bool:
    """Whether a bank question may be added to a live quiz at all."""
    return scope in {OWN, PLATFORM, PENDING_AUDIT}
