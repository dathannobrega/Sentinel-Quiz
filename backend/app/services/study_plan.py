"""Study plan recommendations, placement state and the study track (modules).

Every task carries a stable ``code`` + ``params`` (M-C7); ``title``/``description``/
``cta_label`` remain as a pt-BR fallback for clients without the code in their catalog.
"""
from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import PlacementState, StudyModule, StudySession, UserDomainMetricDaily
from app.services.auth import normalize_client_key
from app.services.exam_policy import normalize_certification
from app.services.owner_scope import require_owner_filters, session_owner_scope
from app.services.readiness import build_readiness_snapshot
from app.services.study_state import build_study_overview

PLACEMENT_MIN_QUESTION_COUNT = 20


# --------------------------------------------------------------------------- placement

def _find_placement_state(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> PlacementState | None:
    stmt = require_owner_filters(select(PlacementState), PlacementState, owner_user_id, owner_client_key)
    return db.execute(stmt).scalar_one_or_none()


def _get_or_create_placement_state(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> PlacementState:
    state = _find_placement_state(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    if state:
        return state
    state = PlacementState(
        user_id=owner_user_id,
        client_key=None if owner_user_id else normalize_client_key(owner_client_key),
    )
    db.add(state)
    db.flush()
    return state


def _count_owner_attempts(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> int:
    stmt = select(func.sum(UserDomainMetricDaily.attempts_total))
    stmt = require_owner_filters(stmt, UserDomainMetricDaily, owner_user_id, owner_client_key)
    return int(db.execute(stmt).scalar_one() or 0)


def _mark_placement_complete(
    db: Session,
    *,
    session: StudySession,
    answered_count: int,
) -> bool:
    """Persist placement completion (mutating flow: called when a study session ends)."""
    owner_user_id, owner_client_key = session_owner_scope(session)
    attempts_total = _count_owner_attempts(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    if max(attempts_total, answered_count) < PLACEMENT_MIN_QUESTION_COUNT:
        return False

    state = _get_or_create_placement_state(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    if state.placement_completed_at:
        return False
    state.placement_completed_at = session.completed_at or utcnow()
    state.placement_exam_id = session.exam_id
    state.placement_question_count = answered_count
    db.flush()
    return True


def placement_completed_by_session(db: Session, *, session: StudySession, answered_count: int) -> bool:
    """Read-only: did this (completed) session complete the placement?

    True when the persisted placement marker points at this session, or when no marker
    exists yet but the owner already has enough attempts (legacy sessions finished
    before the marker was written at completion time).
    """
    owner_user_id, owner_client_key = session_owner_scope(session)
    state = _find_placement_state(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    if state and state.placement_completed_at:
        return state.placement_completed_at == session.completed_at
    attempts_total = _count_owner_attempts(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    return max(attempts_total, answered_count) >= PLACEMENT_MIN_QUESTION_COUNT


# --------------------------------------------------------------------------- study modules (M-A7)

def serialize_study_module(module: StudyModule) -> dict[str, Any]:
    return {
        "id": module.id,
        "certification": module.certification,
        "code": module.code,
        "position": module.position,
        "title": module.title,
        "description": module.description,
        "domain": module.domain,
    }


def list_study_modules(db: Session, certification: Optional[str] = None) -> list[dict[str, Any]]:
    """Ordered study track of a certification (all certifications when omitted)."""
    rows = db.execute(
        select(StudyModule).order_by(StudyModule.certification.asc(), StudyModule.position.asc(), StudyModule.code.asc())
    ).scalars().all()
    if certification:
        wanted = normalize_certification(certification)
        rows = [row for row in rows if normalize_certification(row.certification) == wanted]
    return [serialize_study_module(row) for row in rows]


def _module_position_index(modules: list[dict[str, Any]]) -> dict[tuple[str, str], int]:
    index: dict[tuple[str, str], int] = {}
    for module in modules:
        if not module.get("domain"):
            continue
        key = (normalize_certification(module["certification"]), str(module["domain"]).strip().lower())
        index.setdefault(key, int(module["position"]))
    return index


def _recommend_module(
    modules: list[dict[str, Any]],
    *,
    certification: Optional[str],
    domain: Optional[str],
) -> Optional[dict[str, Any]]:
    """Next module for the weakest domain: first module (by position) of that domain;
    otherwise the first module of the certification track."""
    if not modules or not certification:
        return None
    wanted_cert = normalize_certification(certification)
    track = [module for module in modules if normalize_certification(module["certification"]) == wanted_cert]
    if not track:
        return None
    if domain:
        wanted_domain = str(domain).strip().lower()
        for module in track:
            if str(module.get("domain") or "").strip().lower() == wanted_domain:
                return module
    return track[0]


# --------------------------------------------------------------------------- plan

def _task(kind: str, *, title: str, description: str, cta_label: str, cta_href: str, preset_key: str,
          domain: Optional[str] = None, certification: Optional[str] = None, **params: Any) -> dict[str, Any]:
    return {
        "kind": kind,
        "code": f"study_plan.{kind}",
        "params": {
            key: value
            for key, value in {**params, "domain": domain, "certification": certification}.items()
            if value is not None
        },
        "title": title,
        "description": description,
        "cta_label": cta_label,
        "cta_href": cta_href,
        "preset_key": preset_key,
        "domain": domain,
        "certification": certification,
    }


def build_study_plan(
    db: Session,
    *,
    owner_user_id: Optional[str],
    owner_client_key: Optional[str],
) -> dict[str, Any]:
    """Read-only study plan: placement > review backlog > weakest (certification, domain)."""
    overview = build_study_overview(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    readiness = build_readiness_snapshot(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    state = _find_placement_state(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    attempts_total = _count_owner_attempts(db, owner_user_id=owner_user_id, owner_client_key=owner_client_key)
    placement_required = not bool(state and state.placement_completed_at) and attempts_total < PLACEMENT_MIN_QUESTION_COUNT

    plan_certification = readiness.get("certification")
    modules = list_study_modules(db)
    positions = _module_position_index(modules)

    risk_details: list[dict[str, Any]] = []
    for item in readiness.get("weakest_domains") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("domain") or "").strip()
        if label:
            risk_details.append({
                "certification": item.get("certification"),
                "domain": label,
                "score_percent": item.get("score_percent"),
            })
    # Tie-breaker: equal scores follow the study track order (module position).
    risk_details.sort(
        key=lambda item: (
            round(float(item["score_percent"] or 0.0), 1),
            positions.get((normalize_certification(item["certification"]), item["domain"].lower()), 10_000),
            item["domain"].lower(),
        )
    )
    risk_details = risk_details[:3]
    risk_domains = [item["domain"] for item in risk_details]
    top_risk = risk_details[0] if risk_details else None

    recommended_module = _recommend_module(
        modules,
        certification=(top_risk or {}).get("certification") or plan_certification,
        domain=(top_risk or {}).get("domain"),
    )

    due_count = int(overview.get("due_review_count") or 0)
    if placement_required:
        primary_task = _task(
            "placement",
            title="Fazer diagnóstico inicial",
            description="Monte uma baseline curta por domínio antes de entrar em simulados mais pesados.",
            cta_label="Iniciar diagnóstico",
            cta_href="/start?preset=placement",
            preset_key="placement",
            domain=risk_domains[0] if risk_domains else None,
        )
    elif due_count > 0:
        primary_task = _task(
            "review_backlog",
            title="Limpar revisões vencidas",
            description=f"{due_count} revisão(ões) estão vencidas agora.",
            cta_label="Abrir revisão",
            cta_href="/review?auto_start=true",
            preset_key="daily_review",
            count=due_count,
        )
    elif top_risk:
        domain = top_risk["domain"]
        primary_task = _task(
            "risk_domain",
            title=f"Atacar risco de prova em {domain}",
            description="Seu pior domínio atual merece um bloco focado curto antes do próximo simulado misto.",
            cta_label="Abrir bloco focado",
            cta_href=f"/start?preset=risk_focus&domain={quote(domain)}",
            preset_key="risk_focus",
            domain=domain,
            certification=top_risk.get("certification"),
        )
    else:
        primary_task = _task(
            "momentum",
            title="Manter ritmo com um bloco curto",
            description="Sem backlog crítico no momento. Preserve variedade e consistência.",
            cta_label="Iniciar sprint",
            cta_href="/start?preset=sprint_25",
            preset_key="sprint_25",
        )

    secondary_tasks: list[dict[str, Any]] = []
    if int(overview.get("note_count") or 0) > 0:
        secondary_tasks.append(_task(
            "notes",
            title="Revisar seu caderno",
            description="Use suas notas recentes para reforçar os pontos com mais atrito.",
            cta_label="Abrir configurações",
            cta_href="/settings",
            preset_key="notes_review",
            count=int(overview.get("note_count") or 0),
        ))
    if top_risk:
        domain = top_risk["domain"]
        secondary_tasks.append(_task(
            "targeted_review",
            title=f"Revisão focada em {domain}",
            description="Transforme o sinal de prontidão em revisão orientada por domínio.",
            cta_label="Filtrar revisão",
            cta_href=f"/review?domains={quote(domain)}&auto_start=true",
            preset_key="targeted_review",
            domain=domain,
            certification=top_risk.get("certification"),
        ))
    secondary_tasks.append(_task(
        "quick_exam",
        title="Medir retenção com um simulado curto",
        description="Use um bloco rápido para validar se o reforço já consolidou.",
        cta_label="Abrir simulado",
        cta_href="/start?preset=quick_15",
        preset_key="quick_15",
    ))

    suggested_presets = ["daily_review", "quick_15", "comptia_exam", "sprint_25"]
    if placement_required:
        suggested_presets = ["placement", *suggested_presets]

    return {
        "placement_required": placement_required,
        "primary_task": primary_task,
        "secondary_tasks": secondary_tasks[:3],
        "suggested_presets": suggested_presets,
        "risk_domains": risk_domains,
        "risk_domain_details": risk_details,
        "review_backlog_due": due_count,
        "certification": (top_risk or {}).get("certification") or plan_certification,
        "recommended_module": recommended_module,
        "generated_at": utcnow().isoformat(),
    }
