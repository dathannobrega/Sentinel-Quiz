"""Envelope helpers and inbound message validation for ``sq.live.v1``.

Outbound frames: ``{"v": 1, "type", "seq"?, "sts", "data"}``. Inbound frames are
validated with strict pydantic models (unknown fields rejected) and authorized by role
through ``ROLE_COMMANDS``.
"""
from __future__ import annotations

import json
import time
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

SUBPROTOCOL = "sq.live.v1"
PROTOCOL_VERSION = 1

CLOSE_POLICY = 1008
CLOSE_TOO_BIG = 1009
CLOSE_RESTART = 1012
CLOSE_AUTH = 4001
CLOSE_TOKEN_EXPIRED = 4002
CLOSE_KICKED = 4003
CLOSE_BANNED = 4004
CLOSE_ROOM_FULL = 4008
CLOSE_SESSION_ENDED = 4010
CLOSE_PROTOCOL = 4011
CLOSE_RATE_LIMITED = 4029

HOST_COMMANDS = frozenset(
    {
        "host.start",
        "host.next",
        "host.lock",
        "host.reveal",
        "host.leaderboard",
        "host.end",
        "host.kick",
        "host.room_lock",
        "host.accept_answer",
        "host.pause",
        "host.resume",
        "host.extend",
        "host.set_time",
    }
)
COMMON_COMMANDS = frozenset({"time.sync", "pong"})
ROLE_COMMANDS: dict[str, frozenset[str]] = {
    "host": HOST_COMMANDS | COMMON_COMMANDS,
    "display": COMMON_COMMANDS,
    "participant": COMMON_COMMANDS | {"answer.submit"},
}


def now_ms() -> int:
    return int(time.time() * 1000)


def envelope(type_: str, data: dict[str, Any], *, seq: int | None = None) -> dict[str, Any]:
    frame: dict[str, Any] = {"v": PROTOCOL_VERSION, "type": type_, "sts": now_ms(), "data": data}
    if seq is not None:
        frame["seq"] = seq
    return frame


def dumps(frame: dict[str, Any]) -> str:
    return json.dumps(frame, separators=(",", ":"), ensure_ascii=False, default=str)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClientFrame(BaseModel):
    model_config = ConfigDict(extra="ignore")  # forward compatible envelope

    v: Literal[1]
    type: str = Field(max_length=32)
    mid: Optional[str] = Field(default=None, max_length=64)
    data: dict[str, Any] = Field(default_factory=dict)


class HelloData(_Strict):
    token: Optional[str] = Field(default=None, max_length=1024)
    session_id: Optional[str] = Field(default=None, max_length=36)
    role: Optional[Literal["host"]] = None


class TimeSyncData(_Strict):
    t0: float


class PongData(_Strict):
    ts: int


class AnswerSubmitData(_Strict):
    answer_id: str = Field(min_length=8, max_length=36)
    qi: int = Field(ge=0, le=10000)
    choice: Optional[list[str]] = Field(default=None, max_length=6)
    text: Optional[str] = Field(default=None, max_length=120)
    client_elapsed_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)


class ExpectedQiData(_Strict):
    expected_qi: Optional[int] = Field(default=None, ge=0, le=10000)


class EmptyData(_Strict):
    pass


class KickData(_Strict):
    participant_id: str = Field(max_length=36)
    ban: bool = False


class RoomLockData(_Strict):
    locked: bool


class AcceptAnswerData(_Strict):
    qi: int = Field(ge=0, le=10000)
    text: str = Field(min_length=1, max_length=120)


class ExtendData(_Strict):
    expected_qi: Optional[int] = Field(default=None, ge=0, le=10000)
    seconds: int = Field(ge=5, le=300)


class SetTimeData(_Strict):
    participant_id: str = Field(max_length=36)
    multiplier: Literal[0, 1, 1.5, 2]


DATA_MODELS: dict[str, type[BaseModel]] = {
    "hello": HelloData,
    "time.sync": TimeSyncData,
    "pong": PongData,
    "answer.submit": AnswerSubmitData,
    "host.start": EmptyData,
    "host.next": ExpectedQiData,
    "host.lock": ExpectedQiData,
    "host.reveal": ExpectedQiData,
    "host.leaderboard": EmptyData,
    "host.end": EmptyData,
    "host.kick": KickData,
    "host.room_lock": RoomLockData,
    "host.accept_answer": AcceptAnswerData,
    "host.pause": ExpectedQiData,
    "host.resume": ExpectedQiData,
    "host.extend": ExtendData,
    "host.set_time": SetTimeData,
}


class FrameError(ValueError):
    def __init__(self, code: str, detail: str = "", mid: str | None = None) -> None:
        super().__init__(detail or code)
        self.code = code
        self.detail = detail
        self.mid = mid


def parse_frame(raw: str) -> tuple[ClientFrame, BaseModel]:
    try:
        frame = ClientFrame.model_validate_json(raw)
    except ValidationError:
        raise FrameError("invalid", "malformed frame") from None
    model = DATA_MODELS.get(frame.type)
    if model is None:
        raise FrameError("invalid", f"unknown type {frame.type!r}", frame.mid)
    try:
        return frame, model.model_validate(frame.data)
    except ValidationError as exc:
        raise FrameError("invalid", exc.errors()[0].get("msg", "invalid data") if exc.errors() else "invalid data", frame.mid) from None
