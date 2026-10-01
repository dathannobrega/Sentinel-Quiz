"""Room state machine of Sentinel Arena (PLANO §10.6, contract §6).

Pure, synchronous domain logic over the database: every function receives a SQLAlchemy
session, applies ONE transition and returns :class:`Outcome` (frames to broadcast plus
an optional timer to schedule). The WebSocket gateway only transports; REST uses the
same functions (``end_session``), so behaviour is identical on every path.

Concurrency across processes/replicas: transitions are compare-and-set UPDATEs on
``live_session`` (``WHERE phase = … AND current_position = …``) so a double click, two
host tabs or two workers racing on the timer apply a transition exactly once. Answers
are protected by UNIQUE constraints (idempotency key and one answer per item).
"""
from __future__ import annotations

import logging
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Iterable

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.models import (
    LiveAnswerEvent,
    LiveParticipant,
    LiveQuizVersion,
    LiveSession,
    LiveSessionItem,
)
from app.services import live_items as registry
from app.services import live_scoring as scoring

logger = logging.getLogger("app.live.runtime")

EARLY_TOLERANCE_MS = 300
RECENT_LOBBY = 12
PRESENCE_WINDOW = timedelta(seconds=60)

# Audiences a broadcast can target.
ALL = "all"
HOST = "host"
DISPLAY = "display"
PARTICIPANTS = "participants"
STAFF = "staff"  # host + display


@dataclass
class Broadcast:
    type: str
    data: dict[str, Any]
    audience: str = ALL
    seq: int | None = None
    # When set, the gateway adds a per-participant ``my`` block ("reveal" | "leaderboard" | "podium").
    personalize: str | None = None
    # Target a single participant (e.g. participant.kicked).
    participant_id: str | None = None


@dataclass
class Outcome:
    broadcasts: list[Broadcast] = field(default_factory=list)
    # (qi, when) — the gateway schedules auto_lock at ``when``.
    lock_at: tuple[int, datetime] | None = None
    error: str | None = None
    ack: str | None = None
    kicked_participant: tuple[str, bool] | None = None
    # The pending auto-lock no longer applies (pause, untimed participant).
    clear_lock: bool = False
    # Every connection needs a fresh snapshot (moderation removed visible content).
    resnapshot: bool = False


class RoomNotFound(LookupError):
    pass


# ----------------------------------------------------------------------------- loading

@dataclass
class Room:
    session: LiveSession
    items: list[dict[str, Any]]
    title: str

    @property
    def settings(self) -> dict[str, Any]:
        return self.session.settings_json or {}

    @property
    def total(self) -> int:
        return len(self.items)

    def item(self, position: int | None) -> dict[str, Any] | None:
        if position is None or not 0 <= position < len(self.items):
            return None
        return self.items[position]

    def scored_positions(self, *, up_to: int | None) -> list[int]:
        if up_to is None:
            return []
        return [
            index
            for index, item in enumerate(self.items[: up_to + 1])
            if registry.is_scored(item["item_type"], int(item.get("points_multiplier", 1)))
        ]


_version_cache: dict[str, tuple[list[dict[str, Any]], str]] = {}
# (session, positions, streak, answers signature, roster signature) -> (monotonic, table).
# Every kick/unkick changes the kicked count or max(kicked_at) and every join max(joined_at);
# the TTL only bounds memory and pathological same-timestamp edits.
STANDINGS_TTL_S = 60.0
_standings_cache: dict[tuple[Any, ...], tuple[float, list[scoring.Standing]]] = {}
_standings_lock = threading.Lock()
_standings_inflight: dict[tuple[Any, ...], threading.Lock] = {}


def load_room(db: Session, session_id: str) -> Room:
    session = db.get(LiveSession, session_id, populate_existing=True)
    if session is None:
        raise RoomNotFound(session_id)
    cached = _version_cache.get(session.quiz_version_id)
    if cached is None:
        version = db.get(LiveQuizVersion, session.quiz_version_id)
        if version is None:
            raise RoomNotFound(session_id)
        # Published versions are immutable: safe to cache per process.
        cached = (list(version.items_snapshot_json or []), version.title)
        if len(_version_cache) > 512:
            _version_cache.clear()
        _version_cache[session.quiz_version_id] = cached
    items = cached[0]
    hidden = {int(p) for p in (session.hidden_positions or [])}
    if hidden:
        # Removed by moderation: a neutral, unscored content slide with no original text.
        items = [removed_placeholder(item) if index in hidden else item for index, item in enumerate(items)]
    return Room(session=session, items=items, title=cached[1])


def removed_placeholder(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "item_id": item.get("item_id"), "position": item.get("position"), "item_type": "content", "prompt": "",
        "payload": {"body": ""}, "answer": {}, "explanation": None, "presenter_notes": None, "time_limit_s": None,
        "points_multiplier": 0, "license_scope": item.get("license_scope"), "removed": True,
    }


def _ms(value: datetime | None) -> int | None:
    return int(value.timestamp() * 1000) if value else None


def _grace(room: Room) -> timedelta:
    return timedelta(milliseconds=int(room.settings.get("grace_ms", settings.live_grace_ms_default)))


TIME_MULTIPLIERS = (0.0, 1.0, 1.5, 2.0)  # 0 = untimed (RF-622)
EXTEND_MIN_S, EXTEND_MAX_S = 5, 300


def _time_accommodations(db: Session, session_id: str) -> tuple[float, bool]:
    """(largest multiplier among active participants, anyone untimed)."""
    largest, smallest = db.execute(
        select(func.max(LiveParticipant.time_multiplier), func.min(LiveParticipant.time_multiplier)).where(
            LiveParticipant.session_id == session_id,
            LiveParticipant.kicked_at.is_(None),
            LiveParticipant.time_multiplier != 1.0,
        )
    ).one()
    return float(largest or 1.0), smallest is not None and float(smallest) == 0.0


def effective_lock_at(db: Session, room: Room) -> datetime | None:
    """When the open question auto-locks: the base deadline stretched to the largest
    extended time in the room (RF-622); never while paused or with an untimed participant."""
    session = room.session
    if session.phase != "question" or session.deadline_at is None or session.answers_open_at is None:
        return None
    if session.paused_at is not None:
        return None
    largest, untimed = _time_accommodations(db, session.id)
    if untimed:
        return None
    window = session.deadline_at - session.answers_open_at
    return session.answers_open_at + window * max(largest, 1.0) + _grace(room)


def _multiplier(value: float | None) -> float:
    return 1.0 if value is None else float(value)  # 0 (untimed) is a real value


def participant_deadline(session: LiveSession, multiplier: float) -> datetime | None:
    """A participant's own deadline (None: no timer or untimed)."""
    if session.deadline_at is None or session.answers_open_at is None or multiplier == 0:
        return None
    return session.answers_open_at + (session.deadline_at - session.answers_open_at) * max(multiplier, 1.0)


def _timer_payload(session: LiveSession, now: datetime | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "answers_open_at_ms": _ms(session.answers_open_at),
        "deadline_ms": _ms(session.deadline_at),
        "paused": session.paused_at is not None,
    }
    if session.paused_at is not None:
        payload["paused_at_ms"] = _ms(session.paused_at)
        if session.deadline_at is not None:
            payload["remaining_ms"] = max(0, int((session.deadline_at - session.paused_at).total_seconds() * 1000))
    return payload


# ----------------------------------------------------------------------------- queries

def active_participants(db: Session, session_id: str) -> list[LiveParticipant]:
    return list(
        db.execute(
            select(LiveParticipant)
            .where(LiveParticipant.session_id == session_id, LiveParticipant.kicked_at.is_(None))
            .order_by(LiveParticipant.joined_at)
        ).scalars()
    )


def participant_count(db: Session, session_id: str) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(LiveParticipant)
            .where(LiveParticipant.session_id == session_id, LiveParticipant.kicked_at.is_(None))
        ).scalar_one()
    )


def _events(db: Session, session_id: str, position: int | None = None) -> list[LiveAnswerEvent]:
    stmt = select(LiveAnswerEvent).where(LiveAnswerEvent.session_id == session_id)
    if position is not None:
        stmt = stmt.where(LiveAnswerEvent.position == position)
    return list(db.execute(stmt.order_by(LiveAnswerEvent.id)).scalars())


def _answered_count(db: Session, session_id: str, position: int) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(LiveAnswerEvent)
            .where(
                LiveAnswerEvent.session_id == session_id,
                LiveAnswerEvent.position == position,
                LiveAnswerEvent.event_type == "submitted",
            )
        ).scalar_one()
    )


def option_counts(db: Session, room: Room, position: int) -> dict[str, int]:
    item = room.item(position)
    if item is None or item["item_type"] not in registry.OPTION_TYPES:
        return {}
    key_to_id = {key: oid for oid, key in registry.option_id_map(room.session.id, position, item).items()}
    counts = {oid: 0 for oid in key_to_id.values()}
    rows = db.execute(
        select(LiveAnswerEvent.response_json).where(
            LiveAnswerEvent.session_id == room.session.id,
            LiveAnswerEvent.position == position,
            LiveAnswerEvent.event_type == "submitted",
        )
    ).scalars()
    for response in rows:
        for key in (response or {}).get("keys") or []:
            if key in key_to_id:
                counts[key_to_id[key]] += 1
    return counts


def _submitted_responses(db: Session, session_id: str, position: int) -> list[dict[str, Any]]:
    return [
        r or {}
        for r in db.execute(
            select(LiveAnswerEvent.response_json).where(
                LiveAnswerEvent.session_id == session_id,
                LiveAnswerEvent.position == position,
                LiveAnswerEvent.event_type == "submitted",
            )
        ).scalars()
    ]


def hidden_words(session: LiveSession, position: int) -> set[str]:
    return set(((session.hidden_words or {}).get(str(position))) or [])


def word_cloud(db: Session, room: Room, position: int, responses: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Top words of a word cloud (RF-316): one count per participant and word, offensive
    words (filter terms) and words the host hid never reach the projector. ``filtered``
    counts the words removed while filling the top list."""
    from app.services import live_moderation

    counts: Counter[str] = Counter()
    display: dict[str, Counter[str]] = {}
    for response in responses:
        for word, norm in zip(response.get("words") or [], response.get("normalized") or []):
            if not norm:
                continue
            counts[norm] += 1
            display.setdefault(norm, Counter())[word] += 1
    hidden = hidden_words(room.session, position)
    words: list[dict[str, Any]] = []
    filtered = 0
    for norm, n in counts.most_common():
        if len(words) >= registry.WORD_CLOUD_TOP:
            break  # the filter only runs on what could be shown (800 distinct words: ~35 ms)
        text = display[norm].most_common(1)[0][0]
        if norm in hidden or live_moderation.text_is_offensive(db, text):
            filtered += 1
            continue
        words.append({"text": text, "key": norm, "n": n})
    return {"words": words, "distinct": len(counts), "filtered": filtered}


def numeric_summary(item: dict[str, Any], numbers: list[float]) -> dict[str, Any]:
    """Histogram (20 bins over the author's range), mean and median of numeric answers."""
    payload = item.get("payload") or {}
    low = float(payload.get("min") or 0.0)
    high = float(payload.get("max") or 0.0)
    bins = [0] * registry.NUMERIC_BINS
    span = high - low
    for value in numbers:
        index = int((value - low) / span * registry.NUMERIC_BINS) if span > 0 else 0
        bins[min(max(index, 0), registry.NUMERIC_BINS - 1)] += 1
    ordered = sorted(numbers)
    median = None
    if ordered:
        mid = len(ordered) // 2
        median = ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2
    return {
        "min": low,
        "max": high,
        "bins": bins,
        "n": len(numbers),
        "mean": round(sum(numbers) / len(numbers), 4) if numbers else None,
        "median": round(median, 4) if median is not None else None,
    }


def ordering_summary(session_id: str, position: int, item: dict[str, Any], orders: list[list[str]]) -> dict[str, Any]:
    """Per-slot accuracy: the share of answers with the right item in each position."""
    solution = [str(o["key"]) for o in (item.get("payload") or {}).get("options") or []]
    key_to_id = {key: oid for oid, key in registry.option_id_map(session_id, position, item).items()}
    slots = [
        round(100.0 * sum(1 for order in orders if len(order) > i and order[i] == key) / len(orders), 1) if orders else None
        for i, key in enumerate(solution)
    ]
    return {
        "correct_order_ids": [key_to_id[k] for k in solution if k in key_to_id],
        "slot_pct_correct": slots,
        "exact": sum(1 for order in orders if order == solution),
    }


def type_results(db: Session, room: Room, position: int, item: dict[str, Any], responses: list[dict[str, Any]]) -> dict[str, Any]:
    """Live/reveal aggregates of the GA types (empty for choice/typed items)."""
    kind = item.get("item_type")
    if kind == "word_cloud":
        return {"word_cloud": word_cloud(db, room, position, responses)}
    if kind == "numeric":
        numbers = [float(r["number"]) for r in responses if isinstance(r.get("number"), (int, float))]
        return {"numeric": numeric_summary(item, numbers)}
    if kind == "ordering":
        orders = [list(r.get("order") or []) for r in responses]
        return {"ordering": ordering_summary(room.session.id, position, item, orders)}
    return {}


def lobby_state(db: Session, session_id: str) -> dict[str, Any]:
    rows = db.execute(
        select(LiveParticipant.id, LiveParticipant.display_name, LiveParticipant.avatar_seed)
        .where(LiveParticipant.session_id == session_id, LiveParticipant.kicked_at.is_(None))
        .order_by(LiveParticipant.joined_at.desc())
        .limit(RECENT_LOBBY)
    ).all()
    return {
        "count": participant_count(db, session_id),
        "recent": [{"participant_id": pid, "display_name": name, "avatar_seed": seed} for pid, name, seed in rows],
    }


def _participant_rows(participants: list[LiveParticipant]) -> list[scoring.ParticipantRow]:
    return [
        scoring.ParticipantRow(
            participant_id=p.id, display_name=p.display_name, avatar_seed=p.avatar_seed, joined_at=p.joined_at
        )
        for p in participants
    ]


def standings(db: Session, room: Room, *, up_to: int | None, exclude_last_scored: bool = False) -> list[scoring.Standing]:
    positions = room.scored_positions(up_to=up_to)
    # Only items whose answers are closed count (the current one while open does not).
    session = room.session
    if session.phase == "question" and session.current_position in positions:
        positions = [p for p in positions if p != session.current_position]
    if exclude_last_scored and positions:
        positions = positions[:-1]
    streak_bonus = bool(room.settings.get("streak_bonus"))
    # Standings are read by every snapshot (a reconnect storm is N reads) and by each
    # reveal/leaderboard; they only change when an answer of a scored position or the
    # roster changes. Two aggregate queries decide whether the cached table is current.
    answers_sig = (
        tuple(
            db.execute(
                select(func.count(), func.max(LiveAnswerEvent.id)).where(
                    LiveAnswerEvent.session_id == session.id, LiveAnswerEvent.position.in_(positions)
                )
            ).one()
        )
        if positions
        else (0, None)
    )
    roster_sig = tuple(
        db.execute(
            select(
                func.count(),
                func.count(LiveParticipant.kicked_at),
                func.max(LiveParticipant.joined_at),
                func.max(LiveParticipant.kicked_at),
            ).where(LiveParticipant.session_id == session.id)
        ).one()
    )
    key = (session.id, tuple(positions), streak_bonus, answers_sig, roster_sig)
    hit = _cached_standings(key)
    if hit is not None:
        return hit
    # Single flight: when 1,000 participants open their results at once, one thread
    # computes the table and the others wait for it instead of all hitting the DB.
    with _standings_lock:
        key_lock = _standings_inflight.setdefault(key, threading.Lock())
    with key_lock:
        hit = _cached_standings(key)
        if hit is not None:
            return hit
        table = _compute_standings(db, session.id, positions, streak_bonus)
        with _standings_lock:
            if len(_standings_cache) > 256:
                _standings_cache.clear()
            _standings_cache[key] = (time.monotonic(), table)
            _standings_inflight.pop(key, None)
        return table


def _cached_standings(key: tuple[Any, ...]) -> list[scoring.Standing] | None:
    with _standings_lock:
        hit = _standings_cache.get(key)
    if hit is not None and time.monotonic() - hit[0] < STANDINGS_TTL_S:
        return hit[1]
    return None


def _compute_standings(db: Session, session_id: str, positions: list[int], streak_bonus: bool) -> list[scoring.Standing]:
    # Column-only rows: ORM objects for 1,000 participants x N answers cost ~100 ms.
    events = (
        db.execute(
            select(
                LiveAnswerEvent.position,
                LiveAnswerEvent.participant_id,
                LiveAnswerEvent.event_type,
                LiveAnswerEvent.points,
                LiveAnswerEvent.score_fraction,
                LiveAnswerEvent.is_correct,
                LiveAnswerEvent.server_ms,
            )
            .where(LiveAnswerEvent.session_id == session_id, LiveAnswerEvent.position.in_(positions))
            .order_by(LiveAnswerEvent.id)
        ).all()
        if positions
        else []
    )
    roster = db.execute(
        select(LiveParticipant.id, LiveParticipant.display_name, LiveParticipant.avatar_seed, LiveParticipant.joined_at)
        .where(LiveParticipant.session_id == session_id, LiveParticipant.kicked_at.is_(None))
        .order_by(LiveParticipant.joined_at)
    ).all()
    return scoring.compute_standings(
        [
            scoring.ParticipantRow(participant_id=pid, display_name=name, avatar_seed=seed, joined_at=joined)
            for pid, name, seed, joined in roster
        ],
        scoring.effective_answers(events, with_response=False),
        scored_positions=positions,
        streak_bonus=streak_bonus,
    )


def leaderboard_payload(db: Session, room: Room, *, limit: int = 10) -> tuple[dict[str, Any], list[scoring.Standing]]:
    up_to = room.session.current_position
    current = standings(db, room, up_to=up_to)
    previous = standings(db, room, up_to=up_to, exclude_last_scored=True)
    deltas = scoring.rank_deltas(current, previous)
    return {
        "top": [s.public(deltas.get(s.participant_id, 0)) for s in current[:limit]],
        "total": len(current),
    }, current


def reveal_payload(db: Session, room: Room, position: int) -> dict[str, Any]:
    item = room.item(position) or {}
    session_id = room.session.id
    events = _events(db, session_id, position)
    answers = scoring.effective_answers(events)
    total = participant_count(db, session_id)
    item_type = item.get("item_type")
    mapping = registry.option_id_map(session_id, position, item)
    key_to_id = {key: oid for oid, key in mapping.items()}
    correct_keys = set((item.get("answer") or {}).get("correct_keys") or [])
    counts = {oid: 0 for oid in key_to_id.values()}
    fractions: list[float] = []
    times: list[int] = []
    fastest: tuple[int, str] | None = None
    typed: Counter[str] = Counter()
    typed_display: dict[str, str] = {}
    typed_accepted: dict[str, bool] = {}
    names = {p.id: p.display_name for p in active_participants(db, session_id)}
    for (_pos, pid), answer in answers.items():
        if pid not in names:
            continue
        for key in answer.response.get("keys") or []:
            if key in key_to_id:
                counts[key_to_id[key]] += 1
        if item_type == "type_answer":
            norm = answer.response.get("normalized") or registry.normalize_text_answer(answer.response.get("text") or "")
            typed[norm] += 1
            typed_display.setdefault(norm, answer.response.get("text") or norm)
            typed_accepted[norm] = typed_accepted.get(norm, False) or bool(answer.fraction and answer.fraction >= 1)
        if answer.fraction is not None:
            fractions.append(answer.fraction)
        if answer.server_ms is not None:
            times.append(answer.server_ms)
            if answer.fraction is not None and answer.fraction >= 1 and (fastest is None or answer.server_ms < fastest[0]):
                fastest = (answer.server_ms, names.get(pid, ""))
    answered = sum(1 for (_p, pid) in answers if pid in names)
    scored = registry.is_scored(item_type or "", int(item.get("points_multiplier", 1)))
    payload: dict[str, Any] = {
        "qi": position,
        "item_type": item_type,
        "correct_option_ids": [key_to_id[k] for k in sorted(correct_keys) if k in key_to_id] if item_type != "poll" else [],
        "accepted_answers": list((item.get("answer") or {}).get("accepted_answers") or []),
        "counts": counts,
        "answered": answered,
        "total": total,
        "pct_correct": round(100.0 * sum(1 for f in fractions if f >= 1) / len(fractions), 1) if fractions and item_type != "poll" else None,
        "avg_ms": int(sum(times) / len(times)) if times else None,
        "fastest": {"display_name": fastest[1], "ms": fastest[0]} if fastest and scored else None,
        "explanation": item.get("explanation") if room.settings.get("show_explanation", True) else None,
    }
    if not room.settings.get("show_correct_on_device", True):
        payload["hide_correct_on_device"] = True
    if item_type == "type_answer":
        from app.services import live_moderation

        # The projector shows the most common typed answers: offensive ones are masked
        # (never an accepted answer, which the author wrote).
        payload["top_answers"] = [
            {
                "text": "•••" if masked else typed_display[norm],
                "n": n,
                "accepted": typed_accepted.get(norm, False),
                **({"masked": True} if masked else {}),
            }
            for norm, n in typed.most_common(12)
            for masked in [not typed_accepted.get(norm, False) and live_moderation.text_is_offensive(db, typed_display[norm])]
        ]
    responses = [answer.response for (_p, pid), answer in answers.items() if pid in names]
    payload.update(type_results(db, room, position, item, responses))
    if item_type == "numeric":
        answer_cfg = item.get("answer") or {}
        payload["numeric"].update({
            "value": answer_cfg.get("value"),
            "tolerance": float(answer_cfg.get("tolerance") or 0.0),
            "unit": (item.get("payload") or {}).get("unit") or "",
        })
    return payload


def without_correct(reveal: dict[str, Any]) -> dict[str, Any]:
    """The reveal a participant sees when ``show_correct_on_device`` is off: counts and
    their own result stay, the right answer does not."""
    data = dict(reveal)
    data["correct_option_ids"] = []
    data["accepted_answers"] = []
    if "ordering" in data:
        data["ordering"] = {**data["ordering"], "correct_order_ids": [], "slot_pct_correct": []}
    if "numeric" in data:
        data["numeric"] = {**data["numeric"], "value": None, "tolerance": None}
    return data


def personal_blocks(db: Session, room: Room, kind: str, participant_ids: list[str]) -> dict[str, dict[str, Any]]:
    """``my`` blocks for participants connected to THIS process (one standings pass)."""
    if not participant_ids:
        return {}
    position = room.session.current_position
    current = standings(db, room, up_to=position)
    previous = standings(db, room, up_to=position, exclude_last_scored=True)
    deltas = scoring.rank_deltas(current, previous)
    by_id = {s.participant_id: s for s in current}
    result: dict[str, dict[str, Any]] = {}
    if kind == "reveal" and position is not None:
        answers = scoring.effective_answers(_events(db, room.session.id, position))
        for pid in participant_ids:
            standing = by_id.get(pid)
            answer = answers.get((position, pid))
            result[pid] = {
                "answered": answer is not None,
                "correct": (answer.fraction >= 1) if answer and answer.fraction is not None else None,
                "fraction": answer.fraction if answer else None,
                "points": (standing.points_by_position.get(position, 0) if standing else 0),
                "total_score": standing.score if standing else 0,
                "rank": standing.rank if standing else None,
                "rank_delta": deltas.get(pid, 0),
                "streak": standing.streak if standing else 0,
            }
        return result
    for pid in participant_ids:
        standing = by_id.get(pid)
        if kind == "leaderboard":
            ahead = next((s for s in current if standing and s.rank == standing.rank - 1), None)
            result[pid] = {
                "rank": standing.rank if standing else None,
                "score": standing.score if standing else 0,
                "behind_by": (ahead.score - standing.score) if (ahead and standing) else None,
            }
        else:
            result[pid] = {"rank": standing.rank if standing else None, "score": standing.score if standing else 0}
    return result


# ----------------------------------------------------------------------------- snapshots

def snapshot(db: Session, room: Room, *, role: str, participant_id: str | None = None) -> dict[str, Any]:
    session = room.session
    position = session.current_position
    item = room.item(position)
    count = participant_count(db, session.id)
    show_distribution = bool(room.settings.get("show_live_distribution"))
    data: dict[str, Any] = {
        "session_id": session.id,
        "title": room.title,
        "theme_key": session.theme_key,
        "join_code": session.join_code,
        "join_url": f"{settings.public_web_origin.rstrip('/')}/j/{session.join_code}",
        "status": session.status,
        "phase": session.phase,
        "qi": position,
        "total": room.total,
        "settings": {
            "scoring": room.settings.get("scoring", "speed"),
            "show_live_distribution": show_distribution,
            "show_correct_on_device": bool(room.settings.get("show_correct_on_device", True)),
            "show_explanation": bool(room.settings.get("show_explanation", True)),
            "music": bool(room.settings.get("music", True)),
            "reading_phase_s": int(room.settings.get("reading_phase_s", 3)),
        },
        "room_locked": bool(session.room_locked),
        "participant_count": count,
        "max_participants": int(session.max_participants),  # host warning at 80% (RF-1205)
        "rehearsal": session.mode == "rehearsal",
    }
    if session.phase == "lobby":
        data["lobby"] = lobby_state(db, session.id)
    if item is not None and session.phase in {"question", "locked", "reveal", "content"}:
        data["question"] = registry.public_question(session.id, position, item)
        data["timer"] = _timer_payload(session)
        if role in {HOST, DISPLAY} and item["item_type"] in registry.INTERACTIVE_TYPES:
            data["answered"] = _answered_count(db, session.id, position)
            if role == HOST or show_distribution or item["item_type"] in {"poll", "word_cloud"}:
                data["counts"] = option_counts(db, room, position)
                if session.phase != "reveal":
                    data.update(live_extra(db, room, position, item))
    if session.phase == "reveal" and position is not None:
        reveal = reveal_payload(db, room, position)
        hidden = bool(reveal.pop("hide_correct_on_device", False))
        if participant_id:
            reveal["my"] = personal_blocks(db, room, "reveal", [participant_id]).get(participant_id)
            if hidden:
                reveal = without_correct(reveal)
        data["reveal"] = reveal
    if session.phase == "leaderboard":
        data["leaderboard"], _ = leaderboard_payload(db, room)
    if session.phase in {"podium", "finished"}:
        data["podium"] = podium_payload(db, room)
    if role == HOST:
        if item is not None:
            data["presenter"] = {
                "item": _presenter_item(item),
                "hidden_words": sorted(hidden_words(session, position)) if item["item_type"] == "word_cloud" else [],
                "next_prompt": (room.item(position + 1) or {}).get("prompt") if position is not None else None,
            }
        board = {s.participant_id: s.score for s in standings(db, room, up_to=position)}
        cutoff = utcnow() - PRESENCE_WINDOW
        data["participants"] = [
            {
                "participant_id": p.id,
                "display_name": p.display_name,
                "avatar_seed": p.avatar_seed,
                "score": board.get(p.id, 0),
                "connected": bool(p.is_bot or (p.last_seen_at and p.last_seen_at >= cutoff)),
                "time_multiplier": _multiplier(p.time_multiplier),
                "is_bot": bool(p.is_bot),
                "is_preview": bool(p.is_preview),
            }
            for p in active_participants(db, session.id)
        ]
    if role == "participant" and participant_id:
        participant = db.get(LiveParticipant, participant_id)
        board = standings(db, room, up_to=position)
        mine = next((s for s in board if s.participant_id == participant_id), None)
        last_answer = None
        if position is not None:
            event = db.execute(
                select(LiveAnswerEvent).where(
                    LiveAnswerEvent.session_id == session.id,
                    LiveAnswerEvent.position == position,
                    LiveAnswerEvent.participant_id == participant_id,
                    LiveAnswerEvent.event_type == "submitted",
                )
            ).scalar_one_or_none()
            if event is not None and item is not None:
                key_to_id = {key: oid for oid, key in registry.option_id_map(session.id, position, item).items()}
                response = event.response_json or {}
                if "text" in response:
                    last_answer = {"text": response.get("text")}
                elif "order" in response:
                    last_answer = {"order": [key_to_id[k] for k in response.get("order") or [] if k in key_to_id]}
                elif "number" in response:
                    last_answer = {"number": response.get("number")}
                elif "words" in response:
                    last_answer = {"words": list(response.get("words") or [])}
                else:
                    last_answer = {"choice": [key_to_id[k] for k in response.get("keys") or [] if k in key_to_id]}
        data["my"] = {
            "participant_id": participant_id,
            "display_name": participant.display_name if participant else "",
            "avatar_seed": participant.avatar_seed if participant else "",
            "answered_current": last_answer is not None,
            "last_answer": last_answer,
            "score": mine.score if mine else 0,
            "rank": mine.rank if mine else None,
            "time_multiplier": _multiplier(participant.time_multiplier) if participant else 1.0,
        }
    return data


def _presenter_item(item: dict[str, Any]) -> dict[str, Any]:
    payload = item.get("payload") or {}
    answer = item.get("answer") or {}
    correct = set(answer.get("correct_keys") or [])
    return {
        "id": item.get("item_id"),
        "position": item.get("position"),
        "item_type": item.get("item_type"),
        "prompt": item.get("prompt") or "",
        "options": [{"key": o["key"], "text": o.get("text") or "", "correct": o["key"] in correct} for o in payload.get("options") or []],
        "accepted_answers": list(answer.get("accepted_answers") or []),
        "allow_multiple": bool(payload.get("allow_multiple")),
        "all_or_nothing": bool(payload.get("all_or_nothing")),
        "body": payload.get("body"),
        "time_limit_s": item.get("time_limit_s"),
        "points_multiplier": item.get("points_multiplier", 1),
        "explanation": item.get("explanation"),
        "presenter_notes": item.get("presenter_notes"),
        **registry.type_fields(item.get("item_type") or "", payload, answer),
        "source_kind": item.get("source_kind", "custom"),
        "source_question_id": item.get("source_question_id"),
        "source_version_id": item.get("source_version_id"),
        "license_scope": item.get("license_scope", "own"),
        "review_state": "ok",
        "domain": item.get("domain"),
        "certification": item.get("certification"),
        "difficulty": item.get("difficulty"),
        "updated_at": None,
    }


def podium_payload(db: Session, room: Room) -> dict[str, Any]:
    board = standings(db, room, up_to=room.total - 1)
    scored = room.scored_positions(up_to=room.total - 1)
    hardest: tuple[float, int] | None = None
    answers = scoring.effective_answers(_events(db, room.session.id))
    for position in scored:
        fractions = [a.fraction for (p, _pid), a in answers.items() if p == position and a.fraction is not None]
        if fractions:
            pct = sum(1 for f in fractions if f >= 1) / len(fractions)
            if hardest is None or pct < hardest[0]:
                hardest = (pct, position)
    avg_pct = (
        round(100.0 * sum(s.correct for s in board) / (len(board) * len(scored)), 1) if board and scored else None
    )
    return {
        "top": [s.public() for s in board[:3]],
        "stats": {"participants": len(board), "avg_pct": avg_pct, "hardest_qi": hardest[1] if hardest else None},
    }


# ----------------------------------------------------------------------------- transitions

def _cas(db: Session, room: Room, *, expect_phase: set[str], expect_position: int | None | str = "any", values: dict[str, Any]) -> int | None:
    """Compare-and-set the session row. Returns the new seq, or None if the state moved."""
    session = room.session
    stmt = update(LiveSession).where(LiveSession.id == session.id, LiveSession.phase.in_(sorted(expect_phase)))
    if expect_position != "any":
        stmt = stmt.where(
            LiveSession.current_position.is_(None) if expect_position is None else LiveSession.current_position == expect_position
        )
    new_seq = int(session.state_seq or 0) + 1
    stmt = stmt.where(LiveSession.state_seq == session.state_seq).values(
        state_seq=new_seq, updated_at=utcnow(), **values
    )
    result = db.execute(stmt.execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        return None
    return new_seq


def _enter_item(db: Session, room: Room, position: int, now: datetime) -> Outcome:
    item = room.item(position)
    if item is None:
        return _enter_podium(db, room, now)
    item_type = item["item_type"]
    outcome = Outcome()
    if item_type == "leaderboard":
        seq = _cas(db, room, expect_phase={room.session.phase}, values={
            "phase": "leaderboard", "current_position": position, "answers_open_at": None, "deadline_at": None,
            "status": "live", **({"started_at": now} if room.session.started_at is None else {}),
        })
        if seq is None:
            return Outcome(error="stale")
        db.commit()
        room = load_room(db, room.session.id)
        payload, _ = leaderboard_payload(db, room)
        outcome.broadcasts.append(Broadcast("leaderboard.show", payload, seq=seq, personalize="leaderboard"))
        return outcome
    reading = int(room.settings.get("reading_phase_s", 3)) if item_type in registry.INTERACTIVE_TYPES else 0
    answers_open_at = now + timedelta(seconds=reading)
    time_limit = item.get("time_limit_s") if item_type in registry.INTERACTIVE_TYPES else None
    deadline = answers_open_at + timedelta(seconds=int(time_limit)) if time_limit else None
    phase = "question" if item_type in registry.INTERACTIVE_TYPES else "content"
    seq = _cas(db, room, expect_phase={room.session.phase}, values={
        "phase": phase,
        "status": "live",
        "current_position": position,
        "answers_open_at": answers_open_at if phase == "question" else None,
        "deadline_at": deadline,
        "paused_at": None,
        **({"started_at": now} if room.session.started_at is None else {}),
    })
    if seq is None:
        return Outcome(error="stale")
    existing = db.get(LiveSessionItem, (room.session.id, position))
    if existing is None:
        db.add(LiveSessionItem(
            session_id=room.session.id, position=position, state="open" if phase == "question" else "shown",
            opened_at=now, answers_open_at=answers_open_at if phase == "question" else None, deadline_at=deadline,
        ))
    db.commit()
    question = registry.public_question(room.session.id, position, item)
    outcome.broadcasts.append(
        Broadcast(
            "question.intro",
            {
                "qi": position,
                "total": room.total,
                "question": question,
                "answers_open_at_ms": _ms(answers_open_at) if phase == "question" else None,
                "deadline_ms": _ms(deadline),
            },
            seq=seq,
        )
    )
    if deadline is not None:
        lock_at = effective_lock_at(db, load_room(db, room.session.id))
        if lock_at is not None:
            outcome.lock_at = (position, lock_at)
    return outcome


def _enter_podium(db: Session, room: Room, now: datetime) -> Outcome:
    seq = _cas(db, room, expect_phase={room.session.phase}, values={
        "phase": "podium", "answers_open_at": None, "deadline_at": None,
    })
    if seq is None:
        return Outcome(error="stale")
    db.commit()
    room = load_room(db, room.session.id)
    payload = podium_payload(db, room)
    return Outcome(broadcasts=[Broadcast("podium.show", payload, seq=seq, personalize="podium")])


def start(db: Session, session_id: str, *, now: datetime | None = None) -> Outcome:
    room = load_room(db, session_id)
    if room.session.phase != "lobby":
        return Outcome(error="stale")
    return _enter_item(db, room, 0, now or utcnow())


def lock(db: Session, session_id: str, *, expected_qi: int | None, reason: str, now: datetime | None = None) -> Outcome:
    room = load_room(db, session_id)
    session = room.session
    now = now or utcnow()
    if session.phase != "question" or (expected_qi is not None and expected_qi != session.current_position):
        return Outcome(error="stale")
    if reason == "timer":
        due = effective_lock_at(db, room)
        if due is None or now < due:
            return Outcome(error="too_early")
    position = session.current_position
    seq = _cas(db, room, expect_phase={"question"}, expect_position=position, values={"phase": "locked", "paused_at": None})
    if seq is None:
        return Outcome(error="stale")
    row = db.get(LiveSessionItem, (session.id, position))
    if row is not None:
        row.state = "locked"
        row.locked_at = now
        row.lock_reason = reason
    db.commit()
    return Outcome(broadcasts=[Broadcast("question.locked", {"qi": position, "reason": reason}, seq=seq)])


def auto_lock_if_due(db: Session, session_id: str, *, now: datetime | None = None) -> Outcome:
    """Timer path: idempotent, safe to call from every process."""
    now = now or utcnow()
    room = load_room(db, session_id)
    session = room.session
    due = effective_lock_at(db, room)
    if due is None or now < due:
        return Outcome()
    outcome = lock(db, session_id, expected_qi=session.current_position, reason="timer", now=now)
    return outcome if outcome.error is None else Outcome()


def reveal(db: Session, session_id: str, *, expected_qi: int | None, now: datetime | None = None) -> Outcome:
    now = now or utcnow()
    room = load_room(db, session_id)
    session = room.session
    if expected_qi is not None and expected_qi != session.current_position:
        return Outcome(error="stale")
    outcome = Outcome()
    if session.phase == "question":
        locked = lock(db, session_id, expected_qi=session.current_position, reason="host", now=now)
        if locked.error:
            return locked
        outcome.broadcasts.extend(locked.broadcasts)
        room = load_room(db, session_id)
        session = room.session
    if session.phase != "locked":
        return Outcome(error="stale")
    position = session.current_position
    seq = _cas(db, room, expect_phase={"locked"}, expect_position=position, values={"phase": "reveal"})
    if seq is None:
        return Outcome(error="stale")
    row = db.get(LiveSessionItem, (session.id, position))
    if row is not None:
        row.state = "revealed"
        row.revealed_at = now
    db.commit()
    room = load_room(db, session_id)
    outcome.broadcasts.append(Broadcast("question.reveal", reveal_payload(db, room, position), seq=seq, personalize="reveal"))
    return outcome


def _revealed_scored_since_board(room: Room, db: Session) -> int:
    """Scored items revealed since the last leaderboard (drives leaderboard_every)."""
    position = room.session.current_position or 0
    count = 0
    for index in range(position, -1, -1):
        item = room.items[index]
        if item["item_type"] == "leaderboard":
            break
        if registry.is_scored(item["item_type"], int(item.get("points_multiplier", 1))):
            count += 1
    return count


def show_leaderboard(db: Session, session_id: str) -> Outcome:
    room = load_room(db, session_id)
    if room.session.phase not in {"reveal", "locked", "content"}:
        return Outcome(error="stale")
    seq = _cas(db, room, expect_phase={room.session.phase}, expect_position=room.session.current_position, values={"phase": "leaderboard"})
    if seq is None:
        return Outcome(error="stale")
    db.commit()
    room = load_room(db, session_id)
    payload, _ = leaderboard_payload(db, room)
    return Outcome(broadcasts=[Broadcast("leaderboard.show", payload, seq=seq, personalize="leaderboard")])


def next_step(db: Session, session_id: str, *, expected_qi: int | None, now: datetime | None = None) -> Outcome:
    now = now or utcnow()
    room = load_room(db, session_id)
    session = room.session
    if session.phase == "lobby":
        return start(db, session_id, now=now)
    if expected_qi is not None and expected_qi != session.current_position:
        return Outcome(error="stale")
    if session.phase == "question":
        return Outcome(error="too_early")
    if session.phase == "locked":
        return reveal(db, session_id, expected_qi=session.current_position, now=now)
    if session.phase == "podium":
        return end_session(db, session_id, now=now)
    if session.phase == "finished":
        return Outcome(error="stale")
    position = session.current_position if session.current_position is not None else -1
    has_next = position + 1 < room.total
    every = int(room.settings.get("leaderboard_every", 3) or 0)
    next_is_board = has_next and room.items[position + 1]["item_type"] == "leaderboard"
    if (
        session.phase == "reveal"
        and has_next
        and every > 0
        and not next_is_board
        and _revealed_scored_since_board(room, db) >= every
        and _revealed_scored_since_board(room, db) % every == 0
        and participant_count(db, session_id) > 0
    ):
        return show_leaderboard(db, session_id)
    if session.phase == "reveal" and not has_next:
        return _enter_podium(db, room, now)
    if not has_next:
        return _enter_podium(db, room, now)
    return _enter_item(db, room, position + 1, now)


def end_session(db: Session, session_id: str, *, now: datetime | None = None) -> Outcome:
    now = now or utcnow()
    room = load_room(db, session_id)
    session = room.session
    if session.status == "finished":
        return Outcome(error="stale")
    if session.mode == "self_paced":
        # A challenge has no room to broadcast to: ending it closes it now (final ranking
        # from the counted attempts, open attempts finished).
        from app.services import live_challenge

        session.closes_at = min(session.closes_at or now, now)
        db.commit()
        live_challenge.close_if_due(db, session, now=now)
        return Outcome()
    podium_already_shown = session.phase == "podium"
    seq = _cas(db, room, expect_phase=set(("lobby", "question", "locked", "reveal", "leaderboard", "content", "podium")), values={
        "phase": "finished", "status": "finished", "ended_at": now, "answers_open_at": None, "deadline_at": None,
    })
    if seq is None:
        return Outcome(error="stale")
    db.commit()
    room = load_room(db, session_id)
    board = standings(db, room, up_to=room.total - 1)
    by_id = {s.participant_id: s for s in board}
    for participant in active_participants(db, session_id):
        standing = by_id.get(participant.id)
        participant.final_score = standing.score if standing else 0
        participant.final_rank = standing.rank if standing else None
    db.commit()
    logger.info("live session finished", extra={"event": "live_session_finished", "session_id": session_id, "participants": len(board)})
    outcome = Outcome()
    if not podium_already_shown and board:
        outcome.broadcasts.append(Broadcast("podium.show", podium_payload(db, room), seq=seq, personalize="podium"))
    outcome.broadcasts.append(Broadcast("session.ended", {"report_available": True}, seq=seq))
    return outcome


def set_room_lock(db: Session, session_id: str, *, locked: bool) -> Outcome:
    room = load_room(db, session_id)
    if room.session.status == "finished":
        return Outcome(error="stale")
    room.session.room_locked = bool(locked)
    room.session.updated_at = utcnow()
    db.commit()
    return Outcome(broadcasts=[Broadcast("room.locked", {"locked": bool(locked)})])


def kick(db: Session, session_id: str, *, participant_id: str, ban: bool) -> Outcome:
    participant = db.get(LiveParticipant, participant_id)
    if participant is None or participant.session_id != session_id:
        return Outcome(error="not_found")
    if participant.kicked_at is None:
        participant.kicked_at = utcnow()
    participant.banned = participant.banned or bool(ban)
    participant.token_hash = None  # revokes the current token
    db.commit()
    outcome = Outcome(kicked_participant=(participant_id, participant.banned))
    outcome.broadcasts.append(Broadcast("lobby.update", lobby_state(db, session_id)))
    return outcome


def hide_word(db: Session, session_id: str, *, qi: int, word: str, hidden: bool = True) -> Outcome:
    """Host hides (or shows again) a word of the current word cloud on every screen."""
    room = load_room(db, session_id)
    session = room.session
    item = room.item(qi)
    if item is None or item["item_type"] != "word_cloud" or session.current_position != qi or session.phase not in {"question", "locked", "reveal"}:
        return Outcome(error="stale")
    key = registry.normalize_word(word)
    if not key:
        return Outcome(error="invalid")
    by_position = {k: list(v) for k, v in (session.hidden_words or {}).items()}
    current = set(by_position.get(str(qi)) or [])
    current = current | {key} if hidden else current - {key}
    by_position[str(qi)] = sorted(current)[:500]
    session.hidden_words = by_position
    db.commit()
    room = load_room(db, session_id)
    active = {p.id for p in active_participants(db, session_id)}
    answers = scoring.effective_answers(_events(db, session_id, qi))
    responses = [a.response for (_p, pid), a in answers.items() if pid in active]
    cloud = word_cloud(db, room, qi, responses)
    data = {"qi": qi, "word_cloud": cloud}
    return Outcome(broadcasts=[
        # Only the host gets the hidden list (to show a word again from any device).
        Broadcast("word_cloud.update", {**data, "hidden_words": sorted(current)}, audience=HOST),
        Broadcast("word_cloud.update", data, audience=DISPLAY),
        Broadcast("word_cloud.update", data, audience=PARTICIPANTS),
    ])


def accept_typed_answer(db: Session, session_id: str, *, qi: int, text: str, now: datetime | None = None) -> Outcome:
    """Host accepts a typed answer after the lock: every matching answer becomes correct."""
    room = load_room(db, session_id)
    session = room.session
    item = room.item(qi)
    if item is None or item["item_type"] != "type_answer" or session.current_position != qi or session.phase not in {"locked", "reveal"}:
        return Outcome(error="stale")
    normalized = registry.normalize_text_answer(text)
    if not normalized:
        return Outcome(error="invalid")
    events = [e for e in _events(db, session_id, qi)]
    already = {e.participant_id for e in events if e.event_type == "host_accepted"}
    multiplier = int(item.get("points_multiplier", 1))
    scoring_mode = room.settings.get("scoring", "speed")
    changed = 0
    for event in events:
        if event.event_type != "submitted" or event.participant_id in already or (event.score_fraction or 0) >= 1:
            continue
        if (event.response_json or {}).get("normalized") != normalized:
            continue
        db.add(
            LiveAnswerEvent(
                session_id=session_id,
                position=qi,
                participant_id=event.participant_id,
                event_type="host_accepted",
                response_json=dict(event.response_json or {}),
                is_correct=True,
                score_fraction=1.0,
                points=scoring.points_for(
                    fraction=1.0, scoring=scoring_mode, multiplier=multiplier,
                    elapsed_ms=event.latency_ms, time_limit_s=item.get("time_limit_s"),
                ),
                server_ms=event.server_ms,
                latency_ms=event.latency_ms,
                client_elapsed_ms=event.client_elapsed_ms,
                suspicious=event.suspicious,
                idempotency_key=_uuid(),
                received_at=now or utcnow(),
            )
        )
        changed += 1
    db.commit()
    outcome = Outcome()
    if changed and session.phase == "reveal":
        room = load_room(db, session_id)
        outcome.broadcasts.append(Broadcast("question.reveal", reveal_payload(db, room, qi), personalize="reveal"))
    return outcome


def _uuid() -> str:
    import uuid

    return str(uuid.uuid4())


# ----------------------------------------------------------------------------- timer control

def pause(db: Session, session_id: str, *, expected_qi: int | None, now: datetime | None = None) -> Outcome:
    """Freeze the open question: no answers, no auto-lock, countdown stopped."""
    now = now or utcnow()
    room = load_room(db, session_id)
    session = room.session
    if session.phase != "question" or (expected_qi is not None and expected_qi != session.current_position):
        return Outcome(error="stale")
    if session.paused_at is not None:
        return Outcome(error="already_paused")
    position = session.current_position
    seq = _cas(db, room, expect_phase={"question"}, expect_position=position, values={"paused_at": now})
    if seq is None:
        return Outcome(error="stale")
    db.commit()
    session = load_room(db, session_id).session
    return Outcome(broadcasts=[Broadcast("question.paused", {"qi": position, **_timer_payload(session)}, seq=seq)])


def resume(db: Session, session_id: str, *, expected_qi: int | None, now: datetime | None = None) -> Outcome:
    """Unfreeze: the reading phase and the deadline move forward by the pause, so the
    time left and speed points are what they were when the host paused."""
    now = now or utcnow()
    room = load_room(db, session_id)
    session = room.session
    if session.phase != "question" or (expected_qi is not None and expected_qi != session.current_position):
        return Outcome(error="stale")
    if session.paused_at is None:
        return Outcome(error="not_paused")
    shift = max(now - session.paused_at, timedelta(0))
    return _retime(db, room, now=now, open_shift=shift, deadline_shift=shift, reason="resume", clear_pause=True)


def extend(db: Session, session_id: str, *, expected_qi: int | None, seconds: int, now: datetime | None = None) -> Outcome:
    now = now or utcnow()
    room = load_room(db, session_id)
    session = room.session
    if session.phase != "question" or (expected_qi is not None and expected_qi != session.current_position):
        return Outcome(error="stale")
    if session.deadline_at is None:
        return Outcome(error="no_timer")
    if session.paused_at is not None:
        return Outcome(error="paused")
    seconds = max(EXTEND_MIN_S, min(EXTEND_MAX_S, int(seconds)))
    return _retime(db, room, now=now, open_shift=timedelta(0), deadline_shift=timedelta(seconds=seconds), reason="extend")


def _retime(
    db: Session, room: Room, *, now: datetime, open_shift: timedelta, deadline_shift: timedelta, reason: str,
    clear_pause: bool = False,
) -> Outcome:
    session = room.session
    position = session.current_position
    values: dict[str, Any] = {}
    if session.answers_open_at is not None:
        values["answers_open_at"] = session.answers_open_at + open_shift
    if session.deadline_at is not None:
        values["deadline_at"] = session.deadline_at + deadline_shift
    if clear_pause:
        values["paused_at"] = None
    seq = _cas(db, room, expect_phase={"question"}, expect_position=position, values=values)
    if seq is None:
        return Outcome(error="stale")
    row = db.get(LiveSessionItem, (session.id, position))
    if row is not None:
        row.answers_open_at = values.get("answers_open_at", row.answers_open_at)
        row.deadline_at = values.get("deadline_at", row.deadline_at)
    db.commit()
    room = load_room(db, session.id)
    outcome = Outcome(broadcasts=[Broadcast("question.timer", {"qi": position, "reason": reason, **_timer_payload(room.session)}, seq=seq)])
    lock_at = effective_lock_at(db, room)
    if lock_at is not None:
        outcome.lock_at = (position, lock_at)
    return outcome


def set_time_multiplier(db: Session, session_id: str, *, participant_id: str, multiplier: float) -> Outcome:
    """Extended time for one participant (RF-622): 1, 1.5, 2 or 0 (untimed). Speed points
    are scaled by the multiplier, so extra time never costs points."""
    if float(multiplier) not in TIME_MULTIPLIERS:
        return Outcome(error="invalid")
    room = load_room(db, session_id)
    participant = db.get(LiveParticipant, participant_id)
    if participant is None or participant.session_id != session_id:
        return Outcome(error="not_found")
    participant.time_multiplier = float(multiplier)
    db.commit()
    room = load_room(db, session_id)
    session = room.session
    personal: dict[str, Any] = {"time_multiplier": float(multiplier)}
    deadline = participant_deadline(session, float(multiplier))
    if session.phase == "question":
        personal["qi"] = session.current_position
        personal["deadline_ms"] = _ms(deadline)
    outcome = Outcome(broadcasts=[
        Broadcast("participant.time", personal, participant_id=participant_id),
        Broadcast("participant.updated", {"participant_id": participant_id, "time_multiplier": float(multiplier)}, audience=HOST),
    ])
    lock_at = effective_lock_at(db, room)
    if lock_at is not None:
        outcome.lock_at = (session.current_position, lock_at)
    elif session.phase == "question":
        outcome.clear_lock = True  # someone became untimed: the host locks
    return outcome


# ----------------------------------------------------------------------------- moderation

def remove_item(db: Session, session_id: str, *, position: int) -> Outcome:
    """Hide one item in an open room (RF-1114). The current item turns into the neutral
    placeholder at once; the gateway then re-sends a snapshot to every connection."""
    room = load_room(db, session_id)
    session = room.session
    if session.status == "finished" or not 0 <= position < room.total:
        return Outcome(error="stale")
    hidden = sorted({int(p) for p in (session.hidden_positions or [])} | {int(position)})
    values: dict[str, Any] = {"hidden_positions": hidden}
    current = session.current_position == position and session.phase in {"question", "locked", "reveal"}
    if current:
        values.update({"phase": "content", "answers_open_at": None, "deadline_at": None, "paused_at": None})
    seq = _cas(db, room, expect_phase={session.phase}, values=values)
    if seq is None:
        return Outcome(error="stale")
    db.commit()
    return Outcome(broadcasts=[Broadcast("item.removed", {"qi": position, "current": current}, seq=seq)], resnapshot=True)


def erase_participant(db: Session, participant: LiveParticipant, *, now: datetime | None = None) -> None:
    """LGPD erasure (RF-650): the person disappears from every nominal view; answers stay
    as anonymous statistics of the session."""
    now = now or utcnow()
    participant.erased_at = now
    participant.display_name = "Participante removido"[:24]
    participant.nickname_norm = f"erased{participant.id.replace('-', '')[:16]}"
    participant.avatar_seed = "erased"
    participant.user_id = None
    participant.token_hash = None
    participant.return_code_hash = None
    participant.dev_hash = None
    participant.kicked_at = participant.kicked_at or now  # leaves live rankings at once


# ----------------------------------------------------------------------------- rehearsal bots

BOT_ACCURACY = 0.7
BOT_WORDS = ["segurança", "rede", "firewall", "senha", "nuvem", "backup", "criptografia", "phishing"]
_BOT_NAMESPACE = __import__("uuid").UUID("6f1c2e0a-3b7d-4e55-9a41-5c0de7b0a7e1")


@dataclass
class BotAnswer:
    delay_s: float  # from now
    answer: "AnswerIn"


def bot_plan(db: Session, session_id: str, qi: int, *, now: datetime | None = None, rng: Any = None) -> list[BotAnswer]:
    """Answers of the rehearsal bots for the open question (RF-513): ~70% right, spread
    over the answer window. Answer ids are deterministic, so two processes driving the
    same bots only produce duplicates."""
    import random
    import uuid

    now = now or utcnow()
    rng = rng or random.Random()
    room = load_room(db, session_id)
    session = room.session
    if session.mode != "rehearsal" or session.phase != "question" or session.current_position != qi:
        return []
    item = room.item(qi)
    if item is None or item["item_type"] not in registry.INTERACTIVE_TYPES or session.answers_open_at is None:
        return []
    bots = [
        pid for (pid,) in db.execute(
            select(LiveParticipant.id).where(
                LiveParticipant.session_id == session_id, LiveParticipant.is_bot.is_(True), LiveParticipant.kicked_at.is_(None)
            )
        )
    ]
    if not bots:
        return []
    ids_by_key = {key: oid for oid, key in registry.option_id_map(session_id, qi, item).items()}
    option_ids = list(ids_by_key.values())
    correct_keys = list((item.get("answer") or {}).get("correct_keys") or [])
    accepted = list((item.get("answer") or {}).get("accepted_answers") or [])
    open_in = max((session.answers_open_at - now).total_seconds(), 0.0)
    window = (session.deadline_at - session.answers_open_at).total_seconds() if session.deadline_at else 10.0
    plan: list[BotAnswer] = []
    for pid in bots:
        right = rng.random() < BOT_ACCURACY
        choice: list[str] | None = None
        text: str | None = None
        words: list[str] | None = None
        number: float | None = None
        kind = item["item_type"]
        if kind == "ordering":
            solution = [ids_by_key[str(o["key"])] for o in (item.get("payload") or {}).get("options") or []]
            choice = list(solution)
            if not right:
                while choice == solution and len(choice) > 1:
                    rng.shuffle(choice)
        elif kind == "numeric":
            payload = item.get("payload") or {}
            target = (item.get("answer") or {}).get("value")
            low, high = float(payload.get("min") or 0.0), float(payload.get("max") or 0.0)
            number = float(target) if (right and target is not None) else round(rng.uniform(low, high), 2)
        elif kind == "word_cloud":
            words = rng.sample(BOT_WORDS, k=min(int((item.get("payload") or {}).get("max_words") or 1), len(BOT_WORDS)))
        elif kind == "type_answer":
            text = accepted[0] if (right and accepted) else rng.choice(["não sei", "talvez", "outro"])
        elif kind == "poll" or not correct_keys:
            choice = [rng.choice(option_ids)] if option_ids else None
        elif kind == "multi_choice":
            wrong = [oid for key, oid in ids_by_key.items() if key not in correct_keys]
            choice = [ids_by_key[k] for k in correct_keys if k in ids_by_key] if right else rng.sample(
                option_ids, k=max(1, min(len(option_ids), len(correct_keys)))
            )
            if not right and sorted(choice) == sorted(ids_by_key[k] for k in correct_keys if k in ids_by_key) and wrong:
                choice = [wrong[0]]
        else:
            wrong = [oid for key, oid in ids_by_key.items() if key not in correct_keys]
            choice = [ids_by_key[correct_keys[0]]] if (right or not wrong) else [rng.choice(wrong)]
        answer_id = str(uuid.uuid5(_BOT_NAMESPACE, f"{session_id}:{qi}:{pid}"))
        delay = open_in + window * rng.uniform(0.1, 0.8)
        plan.append(BotAnswer(delay, AnswerIn(session_id, pid, answer_id, qi, choice=choice, text=text, words=words, number=number)))
    plan.sort(key=lambda b: b.delay_s)
    return plan


# ----------------------------------------------------------------------------- answers

@dataclass
class AnswerResult:
    status: str
    outcome: Outcome


@dataclass
class AnswerIn:
    session_id: str
    participant_id: str
    answer_id: str
    qi: int
    choice: list[str] | None = None
    text: str | None = None
    client_elapsed_ms: int | None = None
    rtt_min_ms: int | None = None
    words: list[str] | None = None
    number: float | None = None


def submit_answer(
    db: Session,
    session_id: str,
    *,
    participant_id: str,
    answer_id: str,
    qi: int,
    choice: list[str] | None,
    text: str | None,
    client_elapsed_ms: int | None,
    rtt_min_ms: int | None,
    words: list[str] | None = None,
    number: float | None = None,
    now: datetime | None = None,
) -> AnswerResult:
    answer = AnswerIn(session_id, participant_id, answer_id, qi, choice, text, client_elapsed_ms, rtt_min_ms, words, number)
    return submit_answers(db, [answer], now=now)[0]


def submit_answers(db: Session, answers: list[AnswerIn], *, now: datetime | None = None) -> list[AnswerResult]:
    """Validate, grade and persist a batch of answers with ONE commit (group commit).

    The gateway acks each answer only after this returns, so an ack still means "stored"
    (RPO 0) while a 1,000-answer burst costs a handful of statements instead of ~8 round
    trips and a commit per answer (RNF-103/RNF-204). Results keep the input order.
    """
    now = now or utcnow()
    results: list[AnswerResult | None] = [None] * len(answers)
    by_session: dict[str, list[int]] = {}
    for index, answer in enumerate(answers):
        by_session.setdefault(answer.session_id, []).append(index)
    for session_id, indexes in by_session.items():
        try:
            session_results = _submit_session_batch(db, session_id, [answers[i] for i in indexes], now)
        except RoomNotFound:
            session_results = [AnswerResult("closed", Outcome()) for _ in indexes]
        for index, result in zip(indexes, session_results):
            results[index] = result
    return [r or AnswerResult("closed", Outcome()) for r in results]


def _submit_session_batch(db: Session, session_id: str, answers: list[AnswerIn], now: datetime) -> list[AnswerResult]:
    results: list[AnswerResult | None] = [None] * len(answers)
    keys = list({a.answer_id for a in answers})
    stored = set(
        db.execute(select(LiveAnswerEvent.idempotency_key).where(LiveAnswerEvent.idempotency_key.in_(keys))).scalars()
    )
    room = load_room(db, session_id)
    session = room.session
    pids = list({a.participant_id for a in answers})
    multipliers = {
        pid: float(mult if mult is not None else 1.0)
        for pid, sid, kicked, mult in db.execute(
            select(
                LiveParticipant.id, LiveParticipant.session_id, LiveParticipant.kicked_at, LiveParticipant.time_multiplier
            ).where(LiveParticipant.id.in_(pids))
        ).all()
        if sid == session_id and kicked is None
    }
    active = set(multipliers)
    late_lock: Outcome | None = None
    rows: list[dict[str, Any]] = []
    row_index: list[int] = []
    seen_keys: set[str] = set()
    seen_pids: set[tuple[int, str]] = set()
    for index, answer in enumerate(answers):
        qi = answer.qi
        if answer.answer_id in stored or answer.answer_id in seen_keys:
            results[index] = AnswerResult("duplicate", Outcome())
            continue
        if answer.participant_id not in active or session.current_position != qi:
            results[index] = AnswerResult("closed", Outcome())
            continue
        if session.phase in {"locked", "reveal", "leaderboard"}:
            results[index] = AnswerResult("late", Outcome())
            continue
        if session.phase != "question" or session.answers_open_at is None:
            results[index] = AnswerResult("closed", Outcome())
            continue
        item = room.item(qi)
        if item is None or item["item_type"] not in registry.INTERACTIVE_TYPES:
            results[index] = AnswerResult("invalid", Outcome())
            continue
        if session.paused_at is not None:
            results[index] = AnswerResult("paused", Outcome())
            continue
        if now < session.answers_open_at - timedelta(milliseconds=EARLY_TOLERANCE_MS):
            results[index] = AnswerResult("closed", Outcome())
            continue
        multiplier = multipliers[answer.participant_id]
        own_deadline = participant_deadline(session, multiplier)
        if own_deadline is not None and now > own_deadline + _grace(room):
            if late_lock is None:
                late_lock = auto_lock_if_due(db, session_id, now=now)
                results[index] = AnswerResult("late", late_lock)
            else:
                results[index] = AnswerResult("late", Outcome())
            continue
        if (qi, answer.participant_id) in seen_pids:
            results[index] = AnswerResult("already_answered", Outcome())
            continue
        try:
            graded = registry.grade(session_id, qi, item, choice=answer.choice, text=answer.text, words=answer.words, number=answer.number)
        except registry.InvalidAnswer:
            results[index] = AnswerResult("invalid", Outcome())
            continue
        server_ms = max(0, int((now - session.answers_open_at).total_seconds() * 1000))
        credited = scoring.credited_elapsed_ms(server_ms, answer.rtt_min_ms)
        client_ms = answer.client_elapsed_ms
        # Extended time never costs points: speed is measured against the participant's
        # own window; untimed participants get the neutral mid-window speed.
        limit_s = item.get("time_limit_s")
        if multiplier == 0:
            speed_ms = int(limit_s * 500) if limit_s else None
        else:
            speed_ms = int(credited / max(multiplier, 1.0))
        rows.append(
            {
                "session_id": session_id,
                "position": qi,
                "participant_id": answer.participant_id,
                "event_type": "submitted",
                "response_json": graded.response,
                "is_correct": graded.is_correct,
                "score_fraction": graded.fraction,
                "points": scoring.points_for(
                    fraction=graded.fraction,
                    scoring=room.settings.get("scoring", "speed"),
                    multiplier=int(item.get("points_multiplier", 1)),
                    elapsed_ms=speed_ms,
                    time_limit_s=limit_s,
                ),
                "server_ms": server_ms,
                "latency_ms": credited,
                "client_elapsed_ms": client_ms,
                "suspicious": client_ms is not None and abs(int(client_ms) - credited) > 1500,
                "idempotency_key": answer.answer_id,
                "received_at": now,
            }
        )
        row_index.append(index)
        seen_keys.add(answer.answer_id)
        seen_pids.add((qi, answer.participant_id))
    if rows:
        inserted = _insert_answers(db, rows)
        db.commit()
        lost = [i for i, row in zip(row_index, rows) if row["idempotency_key"] not in inserted]
        if lost:  # another process stored them first (or a retry raced): tell which case
            again = set(
                db.execute(
                    select(LiveAnswerEvent.idempotency_key).where(
                        LiveAnswerEvent.idempotency_key.in_([answers[i].answer_id for i in lost])
                    )
                ).scalars()
            )
            for i in lost:
                results[i] = AnswerResult("duplicate" if answers[i].answer_id in again else "already_answered", Outcome())
        for i in row_index:
            if results[i] is None:
                results[i] = AnswerResult("accepted", Outcome())
        # participant.progress is coalesced by results_tick (one frame per tick).
        qi = session.current_position
        if qi is not None and inserted:
            total = participant_count(db, session_id)
            if total and _answered_count(db, session_id, qi) >= total:
                locked = lock(db, session_id, expected_qi=qi, reason="all_answered", now=now)
                last_accepted = max(i for i in row_index if results[i] is not None and results[i].status == "accepted")
                results[last_accepted] = AnswerResult("accepted", locked)
    return [r or AnswerResult("closed", Outcome()) for r in results]


def _insert_answers(db: Session, rows: list[dict[str, Any]]) -> set[str]:
    """INSERT ... ON CONFLICT DO NOTHING RETURNING idempotency_key (PostgreSQL and SQLite)."""
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as dialect_insert
    else:
        from sqlalchemy.dialects.sqlite import insert as dialect_insert
    stmt = dialect_insert(LiveAnswerEvent).on_conflict_do_nothing().returning(LiveAnswerEvent.idempotency_key)
    return set(db.execute(stmt, rows).scalars())


def results_tick(db: Session, session_id: str) -> list[Broadcast]:
    """Live counters: the host always sees the distribution; the projector only when
    ``show_live_distribution`` is on or for polls (no spoilers on the big screen)."""
    room = load_room(db, session_id)
    session = room.session
    position = session.current_position
    item = room.item(position)
    if item is None or session.phase not in {"question", "locked"} or item["item_type"] not in registry.INTERACTIVE_TYPES:
        return []
    base = {
        "qi": position,
        "answered": _answered_count(db, session_id, position),
        "total": participant_count(db, session_id),
    }
    counts = option_counts(db, room, position)
    extra = live_extra(db, room, position, item)
    public = bool(room.settings.get("show_live_distribution")) or item["item_type"] in {"poll", "word_cloud"}
    return [
        Broadcast("participant.progress", base, audience=PARTICIPANTS),
        Broadcast("results.tick", {**base, "counts": counts, **extra}, audience=HOST),
        Broadcast("results.tick", {**base, **({"counts": counts, **extra} if public else {})}, audience=DISPLAY),
    ]


def live_extra(db: Session, room: Room, position: int, item: dict[str, Any]) -> dict[str, Any]:
    """Live aggregates while the question is open. Ordering shows nothing live (the
    per-slot accuracy is the answer); numeric shows the histogram only (no target)."""
    if item["item_type"] not in {"word_cloud", "numeric"}:
        return {}
    return type_results(db, room, position, item, _submitted_responses(db, room.session.id, position))


def touch_participant(db: Session, participant_id: str, *, now: datetime | None = None) -> None:
    touch_participants(db, [participant_id], now=now)


def touch_participants(db: Session, participant_ids: list[str], *, now: datetime | None = None) -> set[str]:
    """Presence for the host list: one UPDATE for everyone seen since the last flush.
    Returns the sessions where someone became "seen" again (their hosts need a refresh)."""
    if not participant_ids:
        return set()
    now = now or utcnow()
    stale = (LiveParticipant.last_seen_at.is_(None)) | (LiveParticipant.last_seen_at < now - timedelta(seconds=20))
    sessions = {
        sid for (sid,) in db.execute(
            select(LiveParticipant.session_id).where(LiveParticipant.id.in_(participant_ids), stale).distinct()
        )
    }
    if sessions:
        db.execute(
            update(LiveParticipant)
            .where(LiveParticipant.id.in_(participant_ids), stale)
            .values(last_seen_at=now)
            .execution_options(synchronize_session=False)
        )
    db.commit()
    return sessions


def pending_lock_at_ms(db: Session, session_id: str) -> int | None:
    """When the current question must auto-lock (deadline + grace, extended time), if one is open."""
    return _ms(effective_lock_at(db, load_room(db, session_id)))
