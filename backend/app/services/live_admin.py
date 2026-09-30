"""Sentinel Arena administration and moderation (PLANO §7.11).

Synchronous DB work only: the API layer runs these in the threadpool and publishes the
returned room outcomes on the bus (so removals and forced ends reach every replica).

* Audit trail (``live_audit_event``) for every administrative action, nominal report
  access and LGPD request (RF-1103/1110/1114, RF-650).
* Content moderation at publish (RF-1112): flagged versions stay out of rooms with
  guests until an admin approves them.
* Reports from participants (RF-1104) and the moderation queue (RF-1114).
* Admin-managed filter terms (RF-1107).
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.errors import api_error
from app.live import runtime
from app.models import (
    LIVE_ACTIVE_SESSION_STATUSES,
    LiveAuditEvent,
    LiveModerationCase,
    LiveModerationTerm,
    LiveParticipant,
    LiveQuiz,
    LiveQuizVersion,
    LiveSession,
    User,
)
from app.services import live_moderation

logger = logging.getLogger("app.live.admin")

RESOLUTIONS = ("dismiss", "approve", "remove_item", "end_session", "block_quiz")
REPORT_REASONS = ("offensive", "spam", "cheating", "copyright", "privacy", "other")
MAX_OPEN_REPORTS_PER_PARTICIPANT = 5
MAX_OPEN_REPORTS_PER_SESSION = 50


def _iso(value: Any) -> str | None:
    return value.isoformat() if value else None


# ----------------------------------------------------------------------------- audit

def audit(
    db: Session,
    *,
    action: str,
    actor: User | None = None,
    actor_kind: str = "user",
    session_id: str | None = None,
    quiz_id: str | None = None,
    target: str | None = None,
    reason: str | None = None,
    meta: dict[str, Any] | None = None,
) -> LiveAuditEvent:
    """Adds one audit row (the caller commits with its own change)."""
    event = LiveAuditEvent(
        actor_user_id=actor.id if actor else None,
        actor_kind=actor_kind if actor is None else "user",
        action=action,
        session_id=session_id,
        quiz_id=quiz_id,
        target=target,
        reason=(reason or None) and str(reason)[:500],
        meta_json=meta,
        created_at=utcnow(),
    )
    db.add(event)
    return event


ACCESS_DEDUP = timedelta(minutes=10)


def audit_access(db: Session, user: User, *, action: str, session: LiveSession, reason: str | None = None) -> None:
    """RF-1110: who opened a nominal report or export. Repeated views by the same person
    within ACCESS_DEDUP are one entry (the report page refetches)."""
    recent = db.execute(
        select(LiveAuditEvent.id).where(
            LiveAuditEvent.actor_user_id == user.id,
            LiveAuditEvent.action == action,
            LiveAuditEvent.session_id == session.id,
            LiveAuditEvent.created_at >= utcnow() - ACCESS_DEDUP,
        )
    ).first()
    if recent and action != "export_csv":
        return
    audit(db, actor=user, action=action, session_id=session.id, quiz_id=session.quiz_id, reason=reason,
          meta={"owner": session.owner_user_id == user.id})
    db.commit()


def list_audit(db: Session, *, session_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    stmt = select(LiveAuditEvent, User.email).join(User, User.id == LiveAuditEvent.actor_user_id, isouter=True)
    if session_id:
        stmt = stmt.where(LiveAuditEvent.session_id == session_id)
    rows = db.execute(stmt.order_by(LiveAuditEvent.created_at.desc(), LiveAuditEvent.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [
        {
            "id": event.id, "action": event.action, "actor_email": email, "actor_kind": event.actor_kind,
            "session_id": event.session_id, "quiz_id": event.quiz_id, "target": event.target, "reason": event.reason,
            "meta": event.meta_json, "created_at": _iso(event.created_at),
        }
        for event, email in rows
    ]


def require_reason(reason: str | None) -> str:
    text = str(reason or "").strip()
    if len(text) < 5:
        raise api_error(422, "reason_required", "Explain the reason (at least 5 characters).")
    return text[:500]


# ----------------------------------------------------------------------------- content moderation

def moderate_version(db: Session, version: LiveQuizVersion, quiz: LiveQuiz) -> list[dict[str, Any]]:
    """Scan a freshly published version (RF-1112). Findings flag it and open one case."""
    findings = live_moderation.scan_snapshot(db, list(version.items_snapshot_json or []))
    if not findings:
        version.moderation_state = "clear"
        return []
    version.moderation_state = "flagged"
    version.moderation_json = {"findings": findings[:50]}
    db.flush()
    db.add(
        LiveModerationCase(
            source="filter", status="open", reason="filter_match", quiz_id=quiz.id, quiz_version_id=version.id,
            position=findings[0].get("position"), excerpt=str(findings[0].get("excerpt") or "")[:500],
            details_json={"findings": findings[:50], "version_no": version.version_no}, created_at=utcnow(),
        )
    )
    logger.info("live content flagged", extra={"event": "live_content_flagged", "quiz_id": quiz.id, "findings": len(findings)})
    return findings


def session_gate(quiz: LiveQuiz, version: LiveQuizVersion, *, allow_guests: bool) -> None:
    """Blocks presenting blocked quizzes and flagged content to guests."""
    if quiz.blocked_at is not None or version.moderation_state == "blocked":
        raise api_error(403, "quiz_blocked", "This quiz was blocked by moderation.")
    if allow_guests and version.moderation_state == "flagged":
        exc = api_error(422, "moderation_pending", "Some content awaits moderation before it can be shown to guests.")
        exc.detail["details"] = {"findings": (version.moderation_json or {}).get("findings", [])[:10]}  # type: ignore[index]
        raise exc


def version_hidden_positions(version: LiveQuizVersion) -> list[int]:
    return sorted({int(p) for p in (version.moderation_json or {}).get("hidden_positions", [])})


# ----------------------------------------------------------------------------- participant reports

def report(
    db: Session, participant: LiveParticipant, *, target: str, qi: int | None, reason: str, note: str | None
) -> LiveModerationCase:
    """A participant reports the session or one item (RF-1104), with a copy of the text."""
    if reason not in REPORT_REASONS:
        raise api_error(422, "invalid_reason", "Unknown reason.")
    session = db.get(LiveSession, participant.session_id)
    if session is None:
        raise api_error(404, "room_not_found", "Session not found.")
    open_count = db.execute(
        select(func.count()).select_from(LiveModerationCase).where(
            LiveModerationCase.reporter_participant_id == participant.id, LiveModerationCase.status == "open"
        )
    ).scalar_one()
    if open_count >= MAX_OPEN_REPORTS_PER_PARTICIPANT:
        raise api_error(429, "too_many_reports", "You already sent several reports; the team is reviewing them.")
    # A room flooded with fresh guests cannot bury the queue: one session, bounded cases.
    session_open = db.execute(
        select(func.count()).select_from(LiveModerationCase).where(
            LiveModerationCase.session_id == participant.session_id, LiveModerationCase.status == "open",
            LiveModerationCase.source == "participant",
        )
    ).scalar_one()
    if session_open >= MAX_OPEN_REPORTS_PER_SESSION:
        raise api_error(429, "too_many_reports", "This room was already reported; the team is reviewing it.")
    room = runtime.load_room(db, session.id)
    position = qi if target == "item" else None
    excerpt = None
    if position is not None:
        item = room.item(position)
        if item is None:
            raise api_error(422, "invalid_item", "Unknown item.")
        options = " | ".join(o.get("text") or "" for o in (item.get("payload") or {}).get("options") or [])
        excerpt = f"{item.get('prompt') or ''} {('— ' + options) if options else ''}".strip()[:500]
    case = LiveModerationCase(
        source="participant", status="open", reason=reason, note=(note or "").strip()[:500] or None, excerpt=excerpt,
        quiz_id=session.quiz_id, quiz_version_id=session.quiz_version_id, session_id=session.id, position=position,
        reporter_participant_id=participant.id, created_at=utcnow(),
        details_json={"target": target, "join_code": session.join_code},
    )
    db.add(case)
    db.commit()
    logger.warning(
        "live content reported",
        extra={"event": "live_content_reported", "session_id": session.id, "reason": reason, "position": position},
    )
    return case


# ----------------------------------------------------------------------------- queue

def _serialize_case(case: LiveModerationCase, quiz_title: str | None, join_code: str | None, owner_email: str | None) -> dict[str, Any]:
    return {
        "id": case.id, "source": case.source, "status": case.status, "reason": case.reason, "note": case.note,
        "excerpt": case.excerpt, "details": case.details_json or {}, "quiz_id": case.quiz_id, "quiz_title": quiz_title,
        "owner_email": owner_email, "quiz_version_id": case.quiz_version_id, "session_id": case.session_id,
        "join_code": join_code, "position": case.position, "created_at": _iso(case.created_at),
        "resolved_at": _iso(case.resolved_at), "resolution": case.resolution, "resolution_note": case.resolution_note,
    }


def list_cases(db: Session, *, status: str | None = "open", limit: int = 50, offset: int = 0) -> dict[str, Any]:
    stmt = (
        select(LiveModerationCase, LiveQuiz.title, LiveSession.join_code, User.email)
        .join(LiveQuiz, LiveQuiz.id == LiveModerationCase.quiz_id, isouter=True)
        .join(LiveSession, LiveSession.id == LiveModerationCase.session_id, isouter=True)
        .join(User, User.id == LiveQuiz.owner_user_id, isouter=True)
    )
    count = select(func.count()).select_from(LiveModerationCase)
    if status:
        stmt = stmt.where(LiveModerationCase.status == status)
        count = count.where(LiveModerationCase.status == status)
    rows = db.execute(stmt.order_by(LiveModerationCase.created_at.desc()).limit(max(1, min(limit, 200))).offset(max(0, offset))).all()
    return {"items": [_serialize_case(*row) for row in rows], "total": int(db.execute(count).scalar_one())}


def resolve_case(
    db: Session, admin: User, case_id: str, *, action: str, note: str | None
) -> list[tuple[str, runtime.Outcome]]:
    """Apply a moderation decision; returns room outcomes the caller must publish."""
    if action not in RESOLUTIONS:
        raise api_error(422, "invalid_action", "Unknown action.")
    case = db.get(LiveModerationCase, case_id)
    if case is None:
        raise api_error(404, "case_not_found", "Case not found.")
    if case.status != "open":
        raise api_error(409, "case_closed", "This case was already resolved.")
    if action != "dismiss" and action != "approve":
        note = require_reason(note)
    outcomes: list[tuple[str, runtime.Outcome]] = []
    version = db.get(LiveQuizVersion, case.quiz_version_id) if case.quiz_version_id else None
    quiz = db.get(LiveQuiz, case.quiz_id) if case.quiz_id else None
    if action == "approve":
        if version is None:
            raise api_error(422, "no_version", "This case is not about a published version.")
        version.moderation_state = "approved"
    elif action == "remove_item":
        if version is None or case.position is None:
            raise api_error(422, "no_item", "This case does not point to an item.")
        meta = dict(version.moderation_json or {})
        meta["hidden_positions"] = sorted({*version_hidden_positions(version), int(case.position)})
        version.moderation_json = meta
        db.commit()
        for session in _active_sessions(db, version_id=version.id):
            outcome = runtime.remove_item(db, session.id, position=int(case.position))
            if outcome.error is None:
                outcomes.append((session.id, outcome))
    elif action == "end_session":
        if not case.session_id:
            raise api_error(422, "no_session", "This case is not about a session.")
        outcome = runtime.end_session(db, case.session_id)
        if outcome.error is None:
            outcomes.append((case.session_id, outcome))
    elif action == "block_quiz":
        if quiz is None:
            raise api_error(422, "no_quiz", "This case is not about a quiz.")
        quiz.blocked_at = utcnow()
        if version is not None:
            version.moderation_state = "blocked"
        db.commit()
        for session in _active_sessions(db, quiz_id=quiz.id):
            outcome = runtime.end_session(db, session.id)
            if outcome.error is None:
                outcomes.append((session.id, outcome))
    case = db.get(LiveModerationCase, case_id)
    case.status = "dismissed" if action == "dismiss" else "actioned"
    case.resolution = action
    case.resolution_note = (note or "").strip()[:500] or None
    case.resolved_by_user_id = admin.id
    case.resolved_at = utcnow()
    audit(
        db, actor=admin, action=f"case_{action}", session_id=case.session_id, quiz_id=case.quiz_id, target=case.id,
        reason=case.resolution_note, meta={"position": case.position, "sessions": [sid for sid, _ in outcomes]},
    )
    db.commit()
    return outcomes


def _active_sessions(db: Session, *, version_id: str | None = None, quiz_id: str | None = None) -> list[LiveSession]:
    stmt = select(LiveSession).where(LiveSession.status.in_(LIVE_ACTIVE_SESSION_STATUSES))
    if version_id:
        stmt = stmt.where(LiveSession.quiz_version_id == version_id)
    if quiz_id:
        stmt = stmt.where(LiveSession.quiz_id == quiz_id)
    return list(db.execute(stmt).scalars())


def unblock_quiz(db: Session, admin: User, quiz_id: str, *, reason: str | None) -> None:
    quiz = db.get(LiveQuiz, quiz_id)
    if quiz is None:
        raise api_error(404, "quiz_not_found", "Quiz not found.")
    quiz.blocked_at = None
    audit(db, actor=admin, action="quiz_unblocked", quiz_id=quiz_id, reason=require_reason(reason))
    db.commit()


# ----------------------------------------------------------------------------- sessions (admin)

def force_end(db: Session, admin: User, session_id: str, *, reason: str | None) -> runtime.Outcome:
    """RF-1103: end any session (abuse), audited with the reason."""
    text = require_reason(reason)
    if db.get(LiveSession, session_id) is None:
        raise api_error(404, "session_not_found", "Session not found.")
    outcome = runtime.end_session(db, session_id)
    if outcome.error:
        raise api_error(409, "session_not_active", "The session is not active.")
    audit(db, actor=admin, action="force_end", session_id=session_id, reason=text)
    db.commit()
    logger.warning("live session force-ended", extra={"event": "live_force_end", "session_id": session_id})
    return outcome


def overview(db: Session, *, presence_window_s: int = 60) -> dict[str, Any]:
    """RF-1102: active rooms with their owner, phase and people (bots/previews apart)."""
    cutoff = utcnow() - timedelta(seconds=presence_window_s)
    humans = (
        select(
            LiveParticipant.session_id.label("sid"),
            func.count().label("people"),
            func.count(LiveParticipant.last_seen_at).filter(LiveParticipant.last_seen_at >= cutoff).label("online"),
        )
        .where(LiveParticipant.kicked_at.is_(None), LiveParticipant.is_bot.is_(False), LiveParticipant.is_preview.is_(False))
        .group_by(LiveParticipant.session_id)
        .subquery()
    )
    rows = db.execute(
        select(LiveSession, LiveQuiz.title, User.email, humans.c.people, humans.c.online)
        .join(LiveQuiz, LiveQuiz.id == LiveSession.quiz_id)
        .join(User, User.id == LiveSession.owner_user_id)
        .join(humans, humans.c.sid == LiveSession.id, isouter=True)
        .where(LiveSession.status.in_(LIVE_ACTIVE_SESSION_STATUSES))
        .order_by(LiveSession.created_at.desc())
        .limit(200)
    ).all()
    sessions = [
        {
            "id": s.id, "join_code": s.join_code, "quiz_title": title, "owner_email": email, "status": s.status,
            "phase": s.phase, "rehearsal": s.mode == "rehearsal", "allow_guests": s.allow_guests,
            "participants": int(people or 0), "online": int(online or 0), "max_participants": s.max_participants,
            "created_at": _iso(s.created_at), "started_at": _iso(s.started_at),
        }
        for s, title, email, people, online in rows
    ]
    open_cases = db.execute(
        select(func.count()).select_from(LiveModerationCase).where(LiveModerationCase.status == "open")
    ).scalar_one()
    return {
        "active_sessions": sessions,
        "totals": {
            "active_sessions": len(sessions),
            "participants": sum(s["participants"] for s in sessions),
            "online": sum(s["online"] for s in sessions),
            "open_cases": int(open_cases),
        },
    }


# ----------------------------------------------------------------------------- terms

def list_terms(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(select(LiveModerationTerm).order_by(LiveModerationTerm.created_at.desc())).scalars()
    return [
        {"id": t.id, "term": t.term, "match": t.match, "kind": t.kind, "scope": t.scope, "note": t.note, "created_at": _iso(t.created_at)}
        for t in rows
    ]


def add_term(db: Session, admin: User, *, term: str, match: str, kind: str, scope: str, note: str | None) -> dict[str, Any]:
    folded = live_moderation.fold(term).strip()
    if not 2 <= len(folded) <= 64:
        raise api_error(422, "invalid_term", "Use 2 to 64 characters.")
    if match not in live_moderation.MATCHES or kind not in live_moderation.KINDS or scope not in live_moderation.SCOPES:
        raise api_error(422, "invalid_term", "Invalid match, kind or scope.")
    exists = db.execute(
        select(LiveModerationTerm.id).where(
            LiveModerationTerm.term == folded, LiveModerationTerm.kind == kind, LiveModerationTerm.scope == scope
        )
    ).first()
    if exists:
        raise api_error(409, "term_exists", "This term is already in the list.")
    row = LiveModerationTerm(
        term=folded, match=match, kind=kind, scope=scope, note=(note or "").strip()[:200] or None,
        created_by_user_id=admin.id, created_at=utcnow(),
    )
    db.add(row)
    audit(db, actor=admin, action="term_added", target=folded, meta={"kind": kind, "scope": scope, "match": match})
    db.commit()
    live_moderation.invalidate_cache()
    return {"id": row.id, "term": row.term, "match": row.match, "kind": row.kind, "scope": row.scope, "note": row.note,
            "created_at": _iso(row.created_at)}


def delete_term(db: Session, admin: User, term_id: str) -> None:
    row = db.get(LiveModerationTerm, term_id)
    if row is None:
        raise api_error(404, "term_not_found", "Term not found.")
    audit(db, actor=admin, action="term_removed", target=row.term, meta={"kind": row.kind, "scope": row.scope})
    db.delete(row)
    db.commit()
    live_moderation.invalidate_cache()
