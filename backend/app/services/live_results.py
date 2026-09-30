"""Post-session report, CSV export and the participant's own results (PLANO §14, contract §7).

Psychometrics use only ``score_fraction`` (never points):
- ``p``: proportion correct among those who answered;
- ``D``: upper-27% minus lower-27% proportion correct (N ≥ 10), groups by total score;
- distractor analysis: option share overall and in the upper/lower groups;
- KR-20 over dichotomised scored items (≥ 3 items and ≥ 5 participants).
"""
from __future__ import annotations

import csv
import io
import statistics
from collections import Counter, defaultdict
from typing import Any, Iterator

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models import LiveAnswerEvent, LiveParticipant, LiveQuizVersion, LiveSession, LiveSessionItem
from app.services import live_items as registry
from app.services import live_scoring as scoring
from app.services.exam_policy import pass_threshold_for
from app.services.live_session import serialize_session

MIN_GROUP_N = 10
GROUP_SHARE = 0.27
DOMAIN_MIN_ANSWERS = 10


class _Data:
    def __init__(self, db: Session, session: LiveSession) -> None:
        version = db.get(LiveQuizVersion, session.quiz_version_id)
        self.session = session
        self.version = version
        self.items: list[dict[str, Any]] = list(version.items_snapshot_json or []) if version else []
        reached = {
            row.position
            for row in db.execute(select(LiveSessionItem).where(LiveSessionItem.session_id == session.id)).scalars()
        }
        self.reached = sorted(p for p in reached if 0 <= p < len(self.items))
        self.participants = list(
            db.execute(
                select(LiveParticipant)
                .where(LiveParticipant.session_id == session.id, LiveParticipant.kicked_at.is_(None))
                .order_by(LiveParticipant.joined_at)
            ).scalars()
        )
        events = list(
            db.execute(
                select(LiveAnswerEvent).where(LiveAnswerEvent.session_id == session.id).order_by(LiveAnswerEvent.id)
            ).scalars()
        )
        active = {p.id for p in self.participants}
        self.answers = {k: v for k, v in scoring.effective_answers(events).items() if k[1] in active}
        self._by_position: dict[int, dict[str, scoring.EffectiveAnswer]] = {}
        for (position, pid), answer in self.answers.items():
            self._by_position.setdefault(position, {})[pid] = answer
        self.scored = [
            p for p in self.reached
            if registry.is_scored(self.items[p]["item_type"], int(self.items[p].get("points_multiplier", 1)))
        ]
        self.interactive = [p for p in self.reached if self.items[p]["item_type"] in registry.INTERACTIVE_TYPES]
        self.standings = scoring.compute_standings(
            [
                scoring.ParticipantRow(p.id, p.display_name, p.avatar_seed, p.joined_at)
                for p in self.participants
            ],
            self.answers,
            scored_positions=self.scored,
            streak_bonus=bool((session.settings_json or {}).get("streak_bonus")),
        )

    def answers_by_participant(self, position: int) -> dict[str, scoring.EffectiveAnswer]:
        return self._by_position.get(position, {})

    def answers_at(self, position: int) -> list[scoring.EffectiveAnswer]:
        return list(self._by_position.get(position, {}).values())

    def fraction(self, position: int, pid: str) -> float:
        answer = self.answers.get((position, pid))
        return float(answer.fraction or 0.0) if answer else 0.0

    def score_pct(self, pid: str) -> float:
        if not self.scored:
            return 0.0
        return 100.0 * sum(self.fraction(p, pid) for p in self.scored) / len(self.scored)


def _band(pct: float | None, answers: int, certification: str | None) -> str:
    if pct is None or answers < DOMAIN_MIN_ANSWERS:
        return "insufficient_data"
    threshold = pass_threshold_for(certification)
    if pct >= threshold:
        return "ready"
    if pct >= threshold - 15:
        return "approaching"
    return "not_ready"


def _kr20(data: _Data) -> float | None:
    k = len(data.scored)
    n = len(data.participants)
    if k < 3 or n < 5:
        return None
    totals = []
    variances = 0.0
    for position in data.scored:
        p = sum(1 for part in data.participants if data.fraction(position, part.id) >= 1) / n
        variances += p * (1 - p)
    for part in data.participants:
        totals.append(sum(1 for position in data.scored if data.fraction(position, part.id) >= 1))
    total_var = statistics.pvariance(totals)
    if total_var <= 0:
        return None
    return round((k / (k - 1)) * (1 - variances / total_var), 3)


def _groups(data: _Data) -> tuple[set[str], set[str]]:
    n = len(data.participants)
    if n < MIN_GROUP_N:
        return set(), set()
    size = max(1, int(round(n * GROUP_SHARE)))
    ordered = sorted(data.participants, key=lambda p: (data.score_pct(p.id), p.id))
    return {p.id for p in ordered[-size:]}, {p.id for p in ordered[:size]}


def _item_report(data: _Data, position: int, upper: set[str], lower: set[str]) -> dict[str, Any]:
    item = data.items[position]
    item_type = item["item_type"]
    scored = registry.is_scored(item_type, int(item.get("points_multiplier", 1)))
    answers = data.answers_by_participant(position)
    answered = len(answers)
    n_correct = sum(1 for a in answers.values() if a.fraction is not None and a.fraction >= 1)
    times = sorted(a.server_ms for a in answers.values() if a.server_ms is not None)
    p_value = round(n_correct / answered, 3) if scored and answered else None
    discrimination = None
    if scored and upper and lower:
        p_up = sum(1 for pid in upper if data.fraction(position, pid) >= 1) / len(upper)
        p_low = sum(1 for pid in lower if data.fraction(position, pid) >= 1) / len(lower)
        discrimination = round(p_up - p_low, 3)
    correct_keys = set((item.get("answer") or {}).get("correct_keys") or [])
    options = []
    counts: Counter[str] = Counter()
    upper_counts: Counter[str] = Counter()
    lower_counts: Counter[str] = Counter()
    for pid, answer in answers.items():
        for key in answer.response.get("keys") or []:
            counts[key] += 1
            if pid in upper:
                upper_counts[key] += 1
            if pid in lower:
                lower_counts[key] += 1
    for option in (item.get("payload") or {}).get("options") or []:
        key = option["key"]
        options.append(
            {
                "key": key,
                "text": option.get("text") or "",
                "correct": key in correct_keys and item_type != "poll",
                "count": counts[key],
                "pct": round(100.0 * counts[key] / answered, 1) if answered else 0.0,
                "upper_pct": round(100.0 * upper_counts[key] / len(upper), 1) if upper else None,
                "lower_pct": round(100.0 * lower_counts[key] / len(lower), 1) if lower else None,
            }
        )
    flags: list[str] = []
    if p_value is not None and answered >= 5:
        if p_value > 0.9:
            flags.append("too_easy")
        if p_value < 0.2:
            flags.append("too_hard")
    if discrimination is not None:
        if discrimination < 0:
            flags.append("negative_discrimination")
        elif discrimination < 0.2:
            flags.append("low_discrimination")
    if scored and options and answered >= 5:
        correct_max = max((o["count"] for o in options if o["correct"]), default=0)
        if any(not o["correct"] and o["count"] > correct_max for o in options):
            flags.append("distractor_dominant")
    report = {
        "position": position,
        "item_type": item_type,
        "prompt": item.get("prompt") or "",
        "scored": scored,
        "answered": answered,
        "n_correct": n_correct if scored else 0,
        "p": p_value,
        "discrimination": discrimination,
        "avg_ms": int(sum(times) / len(times)) if times else None,
        "median_ms": int(statistics.median(times)) if times else None,
        "flags": flags,
        "options": options,
        "domain": item.get("domain"),
    }
    if item_type == "type_answer":
        typed: Counter[str] = Counter()
        shown: dict[str, str] = {}
        accepted: dict[str, bool] = {}
        for answer in answers.values():
            norm = answer.response.get("normalized") or registry.normalize_text_answer(answer.response.get("text") or "")
            typed[norm] += 1
            shown.setdefault(norm, answer.response.get("text") or norm)
            accepted[norm] = accepted.get(norm, False) or bool(answer.fraction and answer.fraction >= 1)
        report["top_answers"] = [{"text": shown[k], "n": n, "accepted": accepted[k]} for k, n in typed.most_common(20)]
    return report


def build_report(db: Session, session: LiveSession, *, data: _Data | None = None) -> dict[str, Any]:
    data = data or _Data(db, session)
    upper, lower = _groups(data)
    participants = data.participants
    by_id = {p.id: p for p in participants}
    pcts = [data.score_pct(p.id) for p in participants]
    times = [a.server_ms for a in data.answers.values() if a.server_ms is not None]
    possible = len(participants) * len(data.interactive)
    interactive = set(data.interactive)
    scored = set(data.scored)
    # One pass over the answers (the report of 1,000 x 20 must stay O(answers), RNF-109).
    answered_by: dict[str, int] = defaultdict(int)
    scored_by: dict[str, int] = defaultdict(int)
    times_by: dict[str, list[int]] = defaultdict(list)
    for (pos, pid), answer in data.answers.items():
        if pos in interactive:
            answered_by[pid] += 1
        if pos in scored:
            scored_by[pid] += 1
        if answer.server_ms is not None:
            times_by[pid].append(answer.server_ms)
    answered_total = sum(answered_by.values())
    completion = (
        sum(1 for p in participants if scored_by[p.id] >= 0.8 * len(data.scored)) / len(participants)
        if participants and data.scored else 0.0
    )
    participant_rows = []
    for standing in data.standings:
        part = by_id[standing.participant_id]
        own_times = times_by.get(part.id) or []
        participant_rows.append(
            {
                "participant_id": part.id,
                "display_name": part.display_name,
                "is_guest": part.user_id is None,
                "rank": standing.rank,
                "score": standing.score,
                "correct": standing.correct,
                "answered": answered_by.get(part.id, 0),
                "score_pct": round(data.score_pct(part.id), 1),
                "avg_ms": int(sum(own_times) / len(own_times)) if own_times else None,
            }
        )
    domain_acc: dict[tuple[str | None, str], dict[str, Any]] = defaultdict(lambda: {"items": 0, "answers": 0, "sum": 0.0})
    for position in data.scored:
        item = data.items[position]
        if not item.get("domain"):
            continue
        bucket = domain_acc[(item.get("certification"), item["domain"])]
        bucket["items"] += 1
        for answer in data.answers_at(position):
            bucket["answers"] += 1
            bucket["sum"] += float(answer.fraction or 0.0)
    domains = []
    for (cert, domain), bucket in sorted(domain_acc.items(), key=lambda kv: (kv[0][0] or "", kv[0][1])):
        pct = round(100.0 * bucket["sum"] / bucket["answers"], 1) if bucket["answers"] else None
        domains.append(
            {
                "certification": cert,
                "domain": domain,
                "items": bucket["items"],
                "answers": bucket["answers"],
                "pct_correct": pct or 0.0,
                "band": _band(pct, bucket["answers"], cert),
            }
        )
    return {
        "session": serialize_session(db, session, version=data.version),
        "generated_at": utcnow().isoformat(),
        "kpis": {
            "participants": len(participants),
            "scored_items": len(data.scored),
            "answered_rate": round(100.0 * answered_total / possible, 1) if possible else 0.0,
            "completion_rate": round(100.0 * completion, 1),
            "avg_score_pct": round(statistics.fmean(pcts), 1) if pcts else 0.0,
            "median_score_pct": round(statistics.median(pcts), 1) if pcts else 0.0,
            "avg_response_ms": int(sum(times) / len(times)) if times else None,
            "kr20": _kr20(data),
        },
        "items": [_item_report(data, position, upper, lower) for position in data.reached],
        "participants": participant_rows,
        "domains": domains,
    }


# ----------------------------------------------------------------------------- CSV

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _cell(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value  # CSV/formula injection guard
    return value


def iter_csv(db: Session, session: LiveSession) -> Iterator[str]:
    data = _Data(db, session)
    report = build_report(db, session, data=data)
    items = report["items"]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    header = ["rank", "name", "guest", "score", "correct", "answered", "score_pct", "avg_ms"]
    header += [f"Q{item['position'] + 1}" for item in items]
    writer.writerow(header)
    yield "﻿" + buffer.getvalue()  # BOM: Excel opens UTF-8 correctly
    for row in report["participants"]:
        buffer.seek(0)
        buffer.truncate()
        cells: list[Any] = [
            row["rank"], _cell(row["display_name"]), "yes" if row["is_guest"] else "no", row["score"], row["correct"],
            row["answered"], row["score_pct"], row["avg_ms"] if row["avg_ms"] is not None else "",
        ]
        for item in items:
            answer = data.answers.get((item["position"], row["participant_id"]))
            if answer is None:
                cells.append("")
            elif item["scored"]:
                cells.append(round(float(answer.fraction or 0.0), 3))
            else:
                cells.append(_cell(",".join(answer.response.get("keys") or []) or answer.response.get("text") or ""))
        writer.writerow(cells)
        yield buffer.getvalue()


# ----------------------------------------------------------------------------- participant

def _answer_view(item: dict[str, Any], answer: scoring.EffectiveAnswer | None) -> Any:
    if answer is None:
        return None
    if "text" in answer.response:
        return answer.response.get("text")
    texts = {o["key"]: o.get("text") or "" for o in (item.get("payload") or {}).get("options") or []}
    return [texts.get(key, key) for key in answer.response.get("keys") or []]


def my_results(db: Session, participant: LiveParticipant) -> dict[str, Any]:
    """Personal results. Every participant asks at the end of the session at once, so this
    reads the cached room standings and only this participant's answers (never the whole
    session's answer log per request)."""
    from app.live import runtime  # local: the runtime imports the services package

    room = runtime.load_room(db, participant.session_id)
    session = room.session
    reached = sorted(
        {
            position
            for (position,) in db.execute(select(LiveSessionItem.position).where(LiveSessionItem.session_id == session.id))
            if 0 <= position < len(room.items)
        }
    )
    board = runtime.standings(db, room, up_to=session.current_position)
    standing = next((s for s in board if s.participant_id == participant.id), None)
    events = db.execute(
        select(LiveAnswerEvent)
        .where(LiveAnswerEvent.session_id == session.id, LiveAnswerEvent.participant_id == participant.id)
        .order_by(LiveAnswerEvent.id)
    ).scalars()
    answers = scoring.effective_answers(events)
    items_snapshot = room.items
    scored_positions = [
        p for p in reached if registry.is_scored(items_snapshot[p]["item_type"], int(items_snapshot[p].get("points_multiplier", 1)))
    ]
    finished = session.status == "finished"
    show_correct = bool((session.settings_json or {}).get("show_correct_on_device", True))
    show_explanation = bool((session.settings_json or {}).get("show_explanation", True))
    items = []
    for position in reached:
        item = items_snapshot[position]
        if item["item_type"] not in registry.INTERACTIVE_TYPES:
            continue
        # Never reveal the key of the item that is still open.
        closed = finished or session.current_position != position or session.phase not in {"question", "locked"}
        answer = answers.get((position, participant.id))
        scored = registry.is_scored(item["item_type"], int(item.get("points_multiplier", 1)))
        texts = {o["key"]: o.get("text") or "" for o in (item.get("payload") or {}).get("options") or []}
        correct_answer = None
        if closed and show_correct and item["item_type"] != "poll":
            keys = (item.get("answer") or {}).get("correct_keys") or []
            correct_answer = [texts.get(k, k) for k in keys] or list((item.get("answer") or {}).get("accepted_answers") or [])
        items.append(
            {
                "position": position,
                "prompt": item.get("prompt") or "",
                "item_type": item["item_type"],
                "correct": (answer.fraction is not None and answer.fraction >= 1) if (answer and scored and closed) else None,
                "fraction": answer.fraction if (answer and scored and closed) else None,
                "points": (standing.points_by_position.get(position, 0) if standing and closed else 0),
                "your_answer": _answer_view(item, answer),
                "correct_answer": correct_answer,
                "explanation": item.get("explanation") if (closed and show_explanation) else None,
            }
        )
    return {
        "session_id": session.id,
        "title": room.title,
        "display_name": participant.display_name,
        "rank": standing.rank if standing else None,
        "participant_count": len(board),
        "score": standing.score if standing else 0,
        "correct": standing.correct if standing else 0,
        "answered": len(answers),
        "total_scored": len(scored_positions),
        "items": items,
    }
