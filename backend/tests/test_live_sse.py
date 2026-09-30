"""Sentinel Arena SSE + POST fallback (RNF-309): same frames as the socket."""
from __future__ import annotations

import json
import uuid

from tests.live_helpers import ORIGIN, live_on, published_quiz  # noqa: F401


def _events(response, limit: int):
    """Parse ``data:`` frames (and ``event: close``) from a streaming response."""
    frames = []
    event = None
    for line in response.iter_lines():
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            payload = json.loads(line[6:])
            frames.append({"type": "__close__", **payload} if event == "close" else payload)
            event = None
            if len(frames) >= limit:
                break
    return frames


def _setup(login_client, make_client):
    host, _ = login_client()
    quiz = published_quiz(host)
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"]}).json()
    guest = make_client()
    ana = guest.post(f"/api/live/rooms/{session['join_code']}/join", json={"display_name": "Ana", "consent": True}).json()
    return host, session, guest, ana


def test_sse_stream_and_commands(live_on, login_client, make_client):
    host, session, guest, ana = _setup(login_client, make_client)
    with guest.stream("GET", "/api/live/sse", params={"token": ana["token"]}) as stream:
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        assert stream.headers["x-accel-buffering"] == "no"
        welcome, snapshot = _events(stream, 2)
    assert welcome["type"] == "welcome" and welcome["data"]["transport"] == "sse"
    assert welcome["data"]["me"]["display_name"] == "Ana"
    assert snapshot["type"] == "room.snapshot" and snapshot["data"]["phase"] == "lobby"

    # Commands: host over cookie + Origin, participant over Bearer; replies in the body.
    auth_host = {"session_id": session["id"], "role": "host"}
    no_origin = host.post("/api/live/cmd", json={"auth": auth_host, "frame": {"v": 1, "type": "host.start", "data": {}}})
    assert no_origin.status_code == 401  # the cookie is only honoured with a trusted Origin
    started = host.post(
        "/api/live/cmd", headers={"origin": ORIGIN},
        json={"auth": auth_host, "frame": {"v": 1, "type": "host.start", "data": {}}},
    )
    assert started.status_code == 200 and started.json() == {"frames": []}

    sync = guest.post("/api/live/cmd", headers={"Authorization": f"Bearer {ana['token']}"},
                      json={"auth": {}, "frame": {"v": 1, "type": "time.sync", "data": {"t0": 5}}})
    assert sync.json()["frames"][0]["type"] == "time.sync.reply"

    forbidden = guest.post("/api/live/cmd", json={"auth": {"token": ana["token"]}, "frame": {"v": 1, "type": "host.next", "mid": "x", "data": {"expected_qi": 0}}})
    assert forbidden.json()["frames"][0]["data"] == {"code": "forbidden", "ref_mid": "x"}

    with guest.stream("GET", "/api/live/sse", params={"token": ana["token"]}) as stream:
        _, snap = _events(stream, 2)
    question = snap["data"]["question"]
    choice = next(o["id"] for o in question["options"] if o["text"] == "Treinamento")
    answer_id = str(uuid.uuid4())
    frame = {"v": 1, "type": "answer.submit", "data": {"answer_id": answer_id, "qi": 0, "choice": [choice]}}
    ack = guest.post("/api/live/cmd", json={"auth": {"token": ana["token"]}, "frame": frame}).json()["frames"]
    assert ack[0]["type"] == "answer.ack" and ack[0]["data"]["status"] == "accepted"
    again = guest.post("/api/live/cmd", json={"auth": {"token": ana["token"]}, "frame": frame}).json()["frames"]
    assert again[0]["data"]["status"] == "duplicate"

    bad = guest.post("/api/live/cmd", json={"auth": {"token": ana["token"]}, "frame": {"v": 1, "type": "hello", "data": {}}})
    assert bad.json()["frames"][0]["type"] == "error"


def test_sse_rejects_bad_tokens(live_on, login_client, make_client):
    _, session, guest, _ = _setup(login_client, make_client)
    assert guest.get("/api/live/sse", params={"token": "v1.bogus"}).status_code == 401
    assert guest.get("/api/live/sse", params={"session_id": session["id"], "role": "host"}).status_code == 401
    assert guest.post("/api/live/cmd", json={"auth": {"token": "nope"}, "frame": {"v": 1, "type": "pong", "data": {"ts": 1}}}).status_code == 401


def test_sse_disabled(client):
    assert client.get("/api/live/sse", params={"token": "x"}).status_code == 404
