"""Sentinel Arena waiting room (Incremento 7): host approval (RF-545) and the overflow
queue above the room cap (DC-16). People waiting are not participants until admitted;
the waiting phone polls with its wait token and receives the join result once admitted.
"""
from __future__ import annotations

from datetime import timedelta

from app.core.clock import utcnow
from app.live import runtime
from app.models import LiveJoinRequest, LiveParticipant, LiveSession
from app.services import live_admission
from tests.live_helpers import ORIGIN, live_on, published_quiz  # noqa: F401


def _session(host, **extra):
    quiz = published_quiz(host)
    response = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], **extra})
    assert response.status_code == 201, response.text
    return response.json()


def _join(client, code, name):
    return client.post(f"/api/live/rooms/{code}/join", json={"display_name": name, "consent": True})


def _poll(client, waiting):
    return client.get(f"/api/live/queue/{waiting['request_id']}", headers={"Authorization": f"Bearer {waiting['wait_token']}"})


def test_overflow_queue_admits_in_order_when_seats_free(live_on, login_client, make_client, db):
    host, _ = login_client()
    session = _session(host, max_participants=2)
    code, sid = session["join_code"], session["id"]
    guest = make_client()
    ana = _join(guest, code, "Ana").json()
    bia = _join(guest, code, "Bia").json()
    assert ana["status"] == "joined" and bia["status"] == "joined"

    caio = _join(guest, code, "Caio")
    assert caio.status_code == 202
    caio = caio.json()
    assert caio["reason"] == "capacity" and caio["position"] == 1 and caio["wait_token"] and caio["retry_after_ms"] >= 3000
    duda = _join(guest, code, "Duda").json()
    assert duda["position"] == 2
    # Waiting people are not participants: the room still counts 2, names stay reserved.
    assert db.query(LiveParticipant).filter_by(session_id=sid).count() == 2
    assert _join(guest, code, "caio").json()["code"] == "name_taken"
    info = guest.get(f"/api/live/rooms/{code}").json()
    assert info["accepting_joins"] is True and info["full"] is True

    still = _poll(guest, caio).json()
    assert still["status"] == "waiting" and still["position"] == 1
    assert guest.get(f"/api/live/queue/{caio['request_id']}", headers={"Authorization": "Bearer nope"}).status_code == 403

    # A kick frees a seat: the first in line gets it (and its token on the next poll).
    runtime.kick(db, sid, participant_id=bia["participant_id"], ban=False)
    admitted = _poll(guest, caio).json()
    assert admitted["status"] == "admitted" and admitted["join"]["token"] and admitted["join"]["return_code"]
    assert admitted["join"]["display_name"] == "Caio"
    again = _poll(guest, caio).json()  # a re-poll rotates the token, without a new return code
    assert again["status"] == "admitted" and again["join"]["return_code"] is None
    assert _poll(guest, duda).json()["position"] == 1

    # The admitted phone is a normal participant (its token works on /me).
    me = guest.get("/api/live/me", headers={"Authorization": f"Bearer {again['join']['token']}"})
    assert me.status_code == 200 and me.json()["participant"]["display_name"] == "Caio"

    # Leaving the queue.
    left = guest.delete(f"/api/live/queue/{duda['request_id']}", headers={"Authorization": f"Bearer {duda['wait_token']}"})
    assert left.json()["status"] == "withdrawn"


def test_host_approval_admit_reject_and_turn_off(live_on, login_client, make_client, db):
    host, owner = login_client()
    session = _session(host, require_approval=True)
    assert session["require_approval"] is True
    code, sid = session["join_code"], session["id"]
    guest = make_client()
    waiting = {name: _join(guest, code, name).json() for name in ("Ana", "Bia", "Caio", "Duda")}
    assert {w["reason"] for w in waiting.values()} == {"approval"} and waiting["Ana"]["position"] is None
    # The host joining their own room never waits.
    assert _join(host, code, "Instrutora").json()["status"] == "joined"

    view = live_admission.host_view(db, db.get(LiveSession, sid))
    assert view["approval_count"] == 4 and [r["display_name"] for r in view["approval"]] == ["Ana", "Bia", "Caio", "Duda"]
    snap = runtime.snapshot(db, runtime.load_room(db, sid), role="host")
    assert snap["waiting_room"]["approval_count"] == 4
    assert "waiting_room" not in runtime.snapshot(db, runtime.load_room(db, sid), role="display")

    outcome = runtime.waiting_room_command(db, sid, "admit", request_ids=[waiting["Ana"]["request_id"]])
    assert outcome.error is None and outcome.lobby_dirty and outcome.resnapshot_hosts
    assert _poll(guest, waiting["Ana"]).json()["status"] == "admitted"
    assert runtime.waiting_room_command(db, sid, "reject", request_id=waiting["Bia"]["request_id"]).error is None
    assert _poll(guest, waiting["Bia"]).json()["status"] == "rejected"
    assert runtime.waiting_room_command(db, sid, "reject", request_id=waiting["Bia"]["request_id"]).error == "not_found"

    # Turning approval off lets everyone still waiting in.
    runtime.waiting_room_command(db, sid, "approval", required=False)
    assert {_poll(guest, waiting[n]).json()["status"] for n in ("Caio", "Duda")} == {"admitted"}
    assert db.get(LiveSession, sid).require_approval is False
    assert _join(guest, code, "Edu").json()["status"] == "joined"


def test_approval_without_a_seat_moves_to_the_capacity_queue(live_on, login_client, make_client, db):
    host, _ = login_client()
    session = _session(host, require_approval=True, max_participants=1)
    code, sid = session["join_code"], session["id"]
    guest = make_client()
    ana = _join(guest, code, "Ana").json()
    bia = _join(guest, code, "Bia").json()
    runtime.waiting_room_command(db, sid, "admit", request_ids=None)  # approve everyone
    assert _poll(guest, ana).json()["status"] == "admitted"
    waiting = _poll(guest, bia).json()
    assert waiting["status"] == "waiting" and waiting["reason"] == "capacity" and waiting["position"] == 1
    # Raising the cap admits the queue (never above the platform cap).
    runtime.waiting_room_command(db, sid, "capacity", max_participants=10**6)
    assert db.get(LiveSession, sid).max_participants == live_admission.settings.live_max_participants
    assert _poll(guest, bia).json()["status"] == "admitted"


def test_stale_waiters_lose_their_turn_and_the_end_closes_the_queue(live_on, login_client, make_client, db):
    host, _ = login_client()
    session = _session(host, max_participants=1)
    code, sid = session["join_code"], session["id"]
    guest = make_client()
    ana = _join(guest, code, "Ana").json()
    gone = _join(guest, code, "Bia").json()
    present = _join(guest, code, "Caio").json()
    request = db.get(LiveJoinRequest, gone["request_id"])
    request.last_seen_at = utcnow() - timedelta(minutes=5)  # closed the tab long ago
    db.commit()
    runtime.kick(db, sid, participant_id=ana["participant_id"], ban=False)
    assert _poll(guest, gone).json()["status"] == "expired"
    assert _poll(guest, present).json()["status"] == "admitted"

    late = _join(guest, code, "Duda").json()
    assert late["status"] == "waiting"
    runtime.end_session(db, sid)
    assert _poll(guest, late).json()["status"] == "expired"


def test_waiting_room_limit_and_locked_room(live_on, login_client, make_client, db, monkeypatch):
    host, _ = login_client()
    session = _session(host, max_participants=1)
    code, sid = session["join_code"], session["id"]
    guest = make_client()
    _join(guest, code, "Ana")
    monkeypatch.setattr(live_admission.settings, "live_waiting_room_max", 1)
    assert _join(guest, code, "Bia").status_code == 202
    over = _join(guest, code, "Caio")
    assert over.status_code == 409 and over.json()["code"] == "room_full"
    room = db.get(LiveSession, sid)
    room.room_locked = True
    db.commit()
    assert _join(guest, code, "Duda").status_code == 423


def test_challenges_keep_the_cap_as_a_hard_limit(live_on, login_client, make_client):
    host, _ = login_client()
    quiz = published_quiz(host)
    created = host.post("/api/live/challenges", json={
        "quiz_id": quiz["id"], "closes_at": (utcnow() + timedelta(days=1)).isoformat(), "max_participants": 1,
    }).json()
    slug = created["challenge"]["slug"]
    guest = make_client()
    assert guest.post(f"/api/live/q/{slug}/join", json={"display_name": "Ana", "consent": True}).status_code == 201
    full = guest.post(f"/api/live/q/{slug}/join", json={"display_name": "Bia", "consent": True})
    assert full.status_code == 409 and full.json()["code"] == "room_full"


def test_host_waiting_room_commands_over_websocket(live_on, login_client, make_client, db):
    from tests.test_live_ws import SUBPROTOCOLS, expect, send

    host, _ = login_client()
    session = _session(host, require_approval=True)
    guest = make_client()
    ana = _join(guest, session["join_code"], "Ana").json()
    with host.websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS, headers={"origin": ORIGIN}) as ws:
        send(ws, "hello", {"session_id": session["id"], "role": "host"})
        snap = expect(ws, "room.snapshot")["data"]
        assert snap["waiting_room"]["approval"][0]["display_name"] == "Ana"
        send(ws, "host.admit", {"all": True})
        updated = expect(ws, "room.snapshot")["data"]
        assert updated["waiting_room"]["approval_count"] == 0 and updated["participant_count"] == 1
        send(ws, "host.set_capacity", {"max_participants": 5})
        # Snapshots of the admission may still be in flight: wait for the one with the new cap.
        for _ in range(5):
            if expect(ws, "room.snapshot")["data"]["max_participants"] == 5:
                break
        else:
            raise AssertionError("no snapshot with the new capacity")
    assert _poll(guest, ana).json()["status"] == "admitted"
