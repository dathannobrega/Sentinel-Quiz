"""Points, streaks and standings (PLANO §6.2–6.3, contract §3).

Points are fixed when the answer is accepted (the grader and the server clock are
known at that moment); streak bonuses and ranks are derived from the answer log, so a
host decision (accepting a typed answer) is reflected everywhere without rewriting
recorded events.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

BASE_POINTS = 1000
FULL_SPEED_MS = 500
STREAK_STEP = 100
STREAK_MAX_STEPS = 5
LATENCY_CREDIT_CAP_MS = 300


def points_for(
    *,
    fraction: float | None,
    scoring: str,
    multiplier: int,
    elapsed_ms: int | None,
    time_limit_s: int | None,
) -> int:
    if fraction is None or scoring == "none" or multiplier <= 0 or fraction <= 0:
        return 0
    base = BASE_POINTS * multiplier
    if scoring == "fixed" or not time_limit_s or elapsed_ms is None:
        return int(round(base * fraction))
    if elapsed_ms < FULL_SPEED_MS:
        factor = 1.0
    else:
        factor = 1.0 - 0.5 * min(elapsed_ms / (time_limit_s * 1000.0), 1.0)
    return int(round(base * factor * fraction))


def credited_elapsed_ms(server_ms: int, rtt_min_ms: int | None) -> int:
    credit = min(max(int(rtt_min_ms or 0), 0), LATENCY_CREDIT_CAP_MS)
    return max(0, int(server_ms) - credit)


@dataclass
class EffectiveAnswer:
    position: int
    participant_id: str
    points: int
    fraction: float | None
    is_correct: bool | None
    server_ms: int | None
    response: dict


@dataclass
class ParticipantRow:
    participant_id: str
    display_name: str
    avatar_seed: str
    joined_at: datetime
    active: bool = True


@dataclass
class Standing:
    participant_id: str
    display_name: str
    avatar_seed: str
    score: int = 0
    correct: int = 0
    answered: int = 0
    correct_ms: int = 0
    streak: int = 0
    best_streak: int = 0
    rank: int = 0
    joined_at: datetime | None = None
    points_by_position: dict[int, int] = field(default_factory=dict)

    def public(self, delta: int = 0) -> dict:
        return {
            "rank": self.rank,
            "participant_id": self.participant_id,
            "display_name": self.display_name,
            "avatar_seed": self.avatar_seed,
            "score": self.score,
            "correct": self.correct,
            "delta": delta,
        }


def effective_answers(events: Iterable) -> dict[tuple[int, str], EffectiveAnswer]:
    """Latest decision per (position, participant): host_accepted overrides submitted."""
    chosen: dict[tuple[int, str], EffectiveAnswer] = {}
    priority: dict[tuple[int, str], int] = {}
    for event in events:
        key = (int(event.position), str(event.participant_id))
        rank = 1 if event.event_type == "host_accepted" else 0
        if key in priority and priority[key] > rank:
            continue
        server_ms = event.server_ms
        chosen[key] = EffectiveAnswer(
            position=key[0],
            participant_id=key[1],
            points=int(event.points or 0),
            fraction=event.score_fraction,
            is_correct=event.is_correct,
            server_ms=server_ms,
            response=dict(event.response_json or {}),
        )
        priority[key] = rank
    return chosen


def compute_standings(
    participants: Iterable[ParticipantRow],
    answers: dict[tuple[int, str], EffectiveAnswer],
    *,
    scored_positions: list[int],
    streak_bonus: bool,
) -> list[Standing]:
    """Rank active participants. Tie-break: points, correct, faster corrects, joined first."""
    table: dict[str, Standing] = {}
    for row in participants:
        if not row.active:
            continue
        table[row.participant_id] = Standing(
            participant_id=row.participant_id,
            display_name=row.display_name,
            avatar_seed=row.avatar_seed,
            joined_at=row.joined_at,
        )
    for position in sorted(scored_positions):
        for pid, standing in table.items():
            answer = answers.get((position, pid))
            if answer is None:
                standing.streak = 0
                continue
            standing.answered += 1
            points = answer.points
            if answer.fraction is not None and answer.fraction >= 1.0:
                standing.correct += 1
                standing.correct_ms += int(answer.server_ms or 0)
                standing.streak += 1
                standing.best_streak = max(standing.best_streak, standing.streak)
                if streak_bonus and standing.streak > 1:
                    points += STREAK_STEP * min(standing.streak - 1, STREAK_MAX_STEPS)
            else:
                standing.streak = 0
            standing.score += points
            standing.points_by_position[position] = points
    ordered = sorted(
        table.values(),
        key=lambda s: (-s.score, -s.correct, s.correct_ms, s.joined_at or datetime.max, s.participant_id),
    )
    for index, standing in enumerate(ordered, start=1):
        standing.rank = index
    return ordered


def rank_deltas(current: list[Standing], previous: list[Standing]) -> dict[str, int]:
    before = {s.participant_id: s.rank for s in previous}
    return {s.participant_id: (before[s.participant_id] - s.rank) if s.participant_id in before else 0 for s in current}
