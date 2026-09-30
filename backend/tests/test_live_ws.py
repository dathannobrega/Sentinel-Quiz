"""Sentinel Arena end-to-end over the WebSocket gateway (protocol sq.live.v1).

A host, a projector (display token) and two guests play a 4-item quiz: live answers,
all-answered auto lock, reveal with personalised feedback, host-accepted typed answer,
poll, podium, end, report and CSV export; plus authorization and protocol guards.
"""
from __future__ import annotations

import json
import uuid
from contextlib import ExitStack
from typing import Any

import anyio
import pytest
from starlette.websockets import WebSocketDisconnect

from tests.live_helpers import ORIGIN, live_on, published_quiz  # noqa: F401

SUBPROTOCOLS = ["sq.live.v1"]
TIMEOUT_S = 5.0


def recv(ws) -> dict[str, Any] | None:
    async def _receive():
        with anyio.fail_after(TIMEOUT_S):
            return await ws._send_rx.receive()

    message = ws.portal.call(_receive)
    if message["type"] == "websocket.close":
        return {"type": "__close__", "code": message.get("code")}
    return json.loads(message["text"])


def expect(ws, type_: str, *, skip: tuple[str, ...] | None = None, qi: int | None = None) -> dict:
    """Next frame of ``type_``. Other frames are skipped (every socket receives the whole
    room stream), except errors and closes, which always fail unless expected. With
    ``skip`` only those types may be skipped (ordering assertions)."""
    for _ in range(80):
        frame = recv(ws)
        if frame["type"] == type_ and (qi is None or frame["data"].get("qi") == qi):
            return frame
        if frame["type"] == type_:
            continue
        if skip is not None:
            assert frame["type"] in skip, f"expected {type_}, got {frame}"
        else:
            assert frame["type"] not in {"error", "__close__"}, f"expected {type_}, got {frame}"
    raise AssertionError(f"{type_} not received")


def send(ws, type_: str, data: dict | None = None, mid: str | None = None) -> None:
    ws.send_text(json.dumps({"v": 1, "type": type_, "mid": mid, "data": data or {}}))


def answer(ws, qi: int, **data) -> str:
    answer_id = str(uuid.uuid4())
    send(ws, "answer.submit", {"answer_id": answer_id, "qi": qi, **data})
    return answer_id


def option_ids(intro: dict) -> dict[str, str]:
    return {o["text"]: o["id"] for o in intro["data"]["question"]["options"]}


@pytest.fixture()
def room(live_on, login_client, make_client):
    host, _ = login_client()
    quiz = published_quiz(host)
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"]}).json()
    guests = {}
    for name in ("Ana", "Bia"):
        guest = make_client()
        guests[name] = guest.post(
            f"/api/live/rooms/{session['join_code']}/join", json={"display_name": name, "consent": True}
        ).json()
    display = host.post(f"/api/live/sessions/{session['id']}/display-token").json()["token"]
    return {"host": host, "quiz": quiz, "session": session, "guests": guests, "display": display, "make_client": make_client}


def _open_host(stack: ExitStack, room):
    conn = stack.enter_context(
        room["host"].websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS, headers={"origin": ORIGIN})
    )
    send(conn, "hello", {"session_id": room["session"]["id"], "role": "host"})
    return conn


def _open_token(stack: ExitStack, client, token):
    # All sockets of one test share ONE TestClient: each TestClient runs the app in its own
    # event loop, while a real process serves every connection from a single loop.
    conn = stack.enter_context(client.websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS))
    send(conn, "hello", {"token": token})
    return conn


def test_full_game_over_websocket(room):
    with ExitStack() as stack:
        _play_full_game(stack, room)
    _check_reports(room)


def _play_full_game(stack: ExitStack, room) -> None:
    host = _open_host(stack, room)
    welcome = expect(host, "welcome")
    assert welcome["data"]["role"] == "host"
    snap = expect(host, "room.snapshot")["data"]
    assert snap["phase"] == "lobby" and snap["lobby"]["count"] == 2 and len(snap["participants"]) == 2

    display = _open_token(stack, room["host"], room["display"])
    assert expect(display, "welcome")["data"]["role"] == "display"
    assert "participants" not in expect(display, "room.snapshot")["data"]

    ana = _open_token(stack, room["host"], room["guests"]["Ana"]["token"])
    assert expect(ana, "welcome")["data"]["me"]["display_name"] == "Ana"
    ana_snap = expect(ana, "room.snapshot")["data"]
    assert ana_snap["my"]["display_name"] == "Ana" and "presenter" not in ana_snap
    bia = _open_token(stack, room["host"], room["guests"]["Bia"]["token"])
    expect(bia, "welcome"), expect(bia, "room.snapshot")

    # Clock sync.
    send(ana, "time.sync", {"t0": 123})
    assert expect(ana, "time.sync.reply")["data"]["t0"] == 123

    # Guards: participants cannot drive the room; stale host commands are refused.
    send(ana, "host.start", mid="m1")
    err = expect(ana, "error")
    assert err["data"]["code"] == "forbidden" and err["data"]["ref_mid"] == "m1"
    send(host, "host.lock", {"expected_qi": 3})
    assert expect(host, "error")["data"]["code"] == "stale"

    # Q0 single choice.
    send(host, "host.start")
    intro = expect(ana, "question.intro")
    assert intro["seq"] > snap.get("seq", 0) if "seq" in snap else True
    assert "correct" not in json.dumps(intro["data"]["question"])
    ids = option_ids(intro)
    expect(bia, "question.intro"), expect(host, "question.intro"), expect(display, "question.intro")
    first = answer(ana, 0, choice=[ids["Treinamento"]], client_elapsed_ms=800)
    assert expect(ana, "answer.ack", skip=("participant.progress", "srv.ping"))["data"] == {"answer_id": first, "qi": 0, "status": "accepted"}
    send(ana, "answer.submit", {"answer_id": first, "qi": 0, "choice": [ids["Treinamento"]]})
    assert expect(ana, "answer.ack")["data"]["status"] == "duplicate"
    answer(bia, 0, choice=[ids["Relay aberto"]])
    assert expect(bia, "answer.ack")["data"]["status"] == "accepted"
    locked = expect(host, "question.locked")
    assert locked["data"] == {"qi": 0, "reason": "all_answered"}
    assert expect(ana, "question.locked")["data"]["reason"] == "all_answered"
    answer(ana, 0, choice=[ids["Treinamento"]])
    assert expect(ana, "answer.ack")["data"]["status"] == "late"

    send(host, "host.reveal", {"expected_qi": 0})
    reveal_host = expect(host, "question.reveal")["data"]
    assert reveal_host["correct_option_ids"] == [ids["Treinamento"]] and "my" not in reveal_host
    assert reveal_host["counts"] == {ids["Treinamento"]: 1, ids["Relay aberto"]: 1}
    assert reveal_host["pct_correct"] == 50.0 and reveal_host["fastest"]["display_name"] == "Ana"
    reveal_ana = expect(ana, "question.reveal")["data"]
    assert reveal_ana["my"]["correct"] is True and reveal_ana["my"]["points"] > 500 and reveal_ana["my"]["rank"] == 1
    reveal_bia = expect(bia, "question.reveal")["data"]
    assert reveal_bia["my"]["correct"] is False and reveal_bia["my"]["points"] == 0
    assert "my" not in expect(display, "question.reveal")["data"]

    # Q1 multi choice with partial credit, locked by the host.
    send(host, "host.next", {"expected_qi": 0})
    # Hosts get a fresh snapshot after every transition, with the answer key and notes.
    for _ in range(10):
        host_snap = expect(host, "room.snapshot")["data"]
        if host_snap["qi"] == 1:
            break
    assert [o["correct"] for o in host_snap["presenter"]["item"]["options"]] == [True, True, False]
    assert "presenter" not in expect(display, "question.intro", qi=1)["data"]
    intro = expect(ana, "question.intro")
    ids = option_ids(intro)
    assert intro["data"]["question"]["select_count"] == 2
    expect(bia, "question.intro")
    answer(ana, 1, choice=[ids["Senha"], ids["Token"]])
    answer(bia, 1, choice=[ids["Senha"]])
    expect(ana, "answer.ack"), expect(bia, "answer.ack")
    expect(host, "question.locked")  # all answered
    send(host, "host.reveal", {"expected_qi": 1})
    assert expect(bia, "question.reveal")["data"]["my"]["fraction"] == 0.5
    expect(ana, "question.reveal")

    # Q2 typed answer; host accepts a variant after the lock.
    send(host, "host.next", {"expected_qi": 1})
    expect(ana, "question.intro"), expect(bia, "question.intro")
    answer(ana, 2, text="Smishing!")
    answer(bia, 2, text="SMS phishing")
    expect(ana, "answer.ack"), expect(bia, "answer.ack")
    expect(host, "question.locked", qi=2)
    send(host, "host.accept_answer", {"qi": 2, "text": "sms phishing"})
    send(host, "host.reveal", {"expected_qi": 2})
    host_reveal = expect(host, "question.reveal", qi=2)["data"]
    assert host_reveal["pct_correct"] == 100.0, host_reveal
    reveal = expect(bia, "question.reveal", qi=2)["data"]
    assert reveal["my"]["correct"] is True
    assert {a["text"]: a["accepted"] for a in reveal["top_answers"]} == {"Smishing!": True, "SMS phishing": True}
    expect(ana, "question.reveal")

    # Q3 poll: no correct answer, distribution visible.
    send(host, "host.next", {"expected_qi": 2})
    ids = option_ids(expect(ana, "question.intro"))
    expect(bia, "question.intro")
    answer(ana, 3, choice=[ids["Sim"]])
    answer(bia, 3, choice=[ids["Sim"]])
    expect(ana, "answer.ack"), expect(bia, "answer.ack")
    expect(host, "question.locked")
    send(host, "host.reveal", {"expected_qi": 3})
    poll = expect(display, "question.reveal", qi=3)["data"]
    assert poll["correct_option_ids"] == [] and poll["pct_correct"] is None and poll["counts"][ids["Sim"]] == 2

    # Podium then end.
    send(host, "host.next", {"expected_qi": 3})
    podium = expect(ana, "podium.show")["data"]
    assert [p["display_name"] for p in podium["top"]] == ["Ana", "Bia"] and podium["my"]["rank"] == 1
    send(host, "host.next", {})
    assert expect(bia, "session.ended")["data"]["report_available"] is True
    final = expect(host, "session.ended")
    assert final["seq"] >= 10


def _check_reports(room) -> None:
    report = room["host"].get(f"/api/live/sessions/{room['session']['id']}/report").json()
    assert report["session"]["status"] == "finished"
    assert [p["display_name"] for p in report["participants"]] == ["Ana", "Bia"]
    items = {item["position"]: item for item in report["items"]}
    assert items[0]["p"] == 0.5 and items[3]["scored"] is False and items[3]["p"] is None
    assert items[2]["top_answers"][0]["accepted"] is True
    assert report["kpis"]["participants"] == 2 and report["kpis"]["answered_rate"] == 100.0
    csv_text = room["host"].get(f"/api/live/sessions/{room['session']['id']}/export.csv").text
    assert csv_text.lstrip("﻿").splitlines()[0].startswith("rank,name,guest,score")
    assert "Ana" in csv_text

    mine = room["make_client"]().get(
        "/api/live/me/results", headers={"Authorization": f"Bearer {room['guests']['Bia']['token']}"}
    ).json()
    assert mine["rank"] == 2 and mine["items"][1]["fraction"] == 0.5 and mine["items"][0]["correct_answer"] == ["Treinamento"]


def test_kick_closes_connection_and_revokes_token(room):
    with ExitStack() as stack:
        host = _open_host(stack, room)
        expect(host, "welcome"), expect(host, "room.snapshot")
        ana = _open_token(stack, room["host"], room["guests"]["Ana"]["token"])
        expect(ana, "welcome"), expect(ana, "room.snapshot")
        send(host, "host.kick", {"participant_id": room["guests"]["Ana"]["participant_id"], "ban": True})
        assert expect(ana, "participant.kicked")["data"]["banned"] is True
        assert expect(ana, "__close__")["code"] == 4004
        retry = _open_token(stack, room["host"], room["guests"]["Ana"]["token"])
        assert expect(retry, "__close__")["code"] in {4001, 4004}


def test_handshake_guards(room):
    client = room["host"]
    # Missing subprotocol.
    with client.websocket_connect("/api/live/ws") as ws:
        assert recv(ws)["code"] == 4011
    # Bad token.
    with client.websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS) as ws:
        send(ws, "hello", {"token": "v1.x.y.z"})
        assert recv(ws)["code"] == 4001
    # First frame must be hello.
    with client.websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS) as ws:
        send(ws, "time.sync", {"t0": 1})
        assert recv(ws)["code"] == 4011
    # Host needs a trusted Origin (CSWSH) and must own the session.
    with pytest.raises(WebSocketDisconnect) as denied:
        with room["host"].websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS, headers={"origin": "https://evil.example"}):
            pass
    assert denied.value.code == 1008
    with room["host"].websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS) as ws:
        send(ws, "hello", {"session_id": room["session"]["id"], "role": "host"})
        assert recv(ws)["code"] == 4001


def test_invalid_frames_are_reported_not_fatal(room):
    with ExitStack() as stack:
        ana = _open_token(stack, room["host"], room["guests"]["Ana"]["token"])
        expect(ana, "welcome"), expect(ana, "room.snapshot")
        ana.send_text("not json")
        assert expect(ana, "error")["data"]["code"] == "invalid"
        send(ana, "answer.submit", {"answer_id": "short", "qi": 0})
        assert expect(ana, "error")["data"]["code"] == "invalid"
        send(ana, "answer.submit", {"answer_id": str(uuid.uuid4()), "qi": 0, "choice": ["o_x"]})
        assert expect(ana, "answer.ack")["data"]["status"] == "closed"  # still in the lobby


def test_lobby_and_progress_are_coalesced(room):
    """Joins and answers do not fan out one frame each: the room tick sends one
    lobby.update / participant.progress per interval (RNF-205, RNF-204)."""
    with ExitStack() as stack:
        host = _open_host(stack, room)
        expect(host, "welcome"), expect(host, "room.snapshot")
        ana = _open_token(stack, room["host"], room["guests"]["Ana"]["token"])
        expect(ana, "welcome"), expect(ana, "room.snapshot")
        for name in ("Caio", "Duda", "Edu"):
            joined = room["make_client"]().post(
                f"/api/live/rooms/{room['session']['join_code']}/join", json={"display_name": name, "consent": True}
            )
            assert joined.status_code == 201
        lobby = expect(ana, "lobby.update")
        # Coalesced: the first update after the burst may already count all three.
        counts = [lobby["data"]["count"]]
        while counts[-1] < 5:
            counts.append(expect(ana, "lobby.update")["data"]["count"])
        assert counts[-1] == 5 and len(counts) <= 3

        send(host, "host.start")
        intro = expect(ana, "question.intro")
        answer(ana, 0, choice=[option_ids(intro)["Treinamento"]])
        assert expect(ana, "answer.ack")["data"]["status"] == "accepted"
        progress = expect(ana, "participant.progress")
        assert progress["data"] == {"qi": 0, "answered": 1, "total": 5}


def test_metrics_endpoint(live_on, client):
    body = client.get("/api/live/metrics")
    # TestClient's peer is "testclient", not loopback: refused without a token.
    assert body.status_code == 404
    from app.core.config import settings

    original = settings.live_metrics_token
    settings.live_metrics_token = "scrape-me"
    try:
        assert client.get("/api/live/metrics", headers={"Authorization": "Bearer nope"}).status_code == 404
        text = client.get("/api/live/metrics", headers={"Authorization": "Bearer scrape-me"})
        assert text.status_code == 200 and "# TYPE live_connections gauge" in text.text
        summary = client.get("/api/live/metrics?format=json", headers={"Authorization": "Bearer scrape-me"}).json()
        assert set(summary) == {"counters", "gauges", "histograms"}
    finally:
        settings.live_metrics_token = original


def test_rehearsal_bots_are_driven_by_the_host_process(live_on, login_client, monkeypatch):
    from app.live import runtime

    real_plan = runtime.bot_plan

    def instant_plan(db, session_id, qi, **kwargs):
        plan = real_plan(db, session_id, qi, **kwargs)
        for bot in plan:
            bot.delay_s = 0.0
        return plan

    monkeypatch.setattr(runtime, "bot_plan", instant_plan)
    host, _ = login_client()
    quiz = published_quiz(host)
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], "rehearsal": True, "bots": 5}).json()
    with ExitStack() as stack:
        conn = stack.enter_context(host.websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS, headers={"origin": ORIGIN}))
        send(conn, "hello", {"session_id": session["id"], "role": "host"})
        snap = expect(conn, "room.snapshot")["data"]
        assert sum(p["is_bot"] for p in snap["participants"]) == 5
        send(conn, "host.start")
        expect(conn, "question.intro")
        locked = expect(conn, "question.locked")  # all 5 bots answered
        assert locked["data"]["reason"] == "all_answered"
