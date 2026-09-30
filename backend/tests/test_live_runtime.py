"""Sentinel Arena room state machine with a controlled clock (timer lock, late answers,
automatic leaderboard, content items, idempotent transitions)."""
from __future__ import annotations

import uuid
from datetime import timedelta

from app.core.clock import utcnow
from app.live import runtime
from app.models import LiveSession
from app.services import live_items
from tests.live_helpers import add_item, create_quiz, live_on  # noqa: F401


def _session(host, *, settings_patch, items):
    quiz = create_quiz(host, settings=settings_patch)
    for fields in items:
        quiz = add_item(host, quiz, **fields)
    quiz = host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]}).json()["quiz"]
    return host.post("/api/live/sessions", json={"quiz_id": quiz["id"]}).json()


SINGLE = {"item_type": "single_choice", "prompt": "P", "options": [{"text": "a", "correct": True}, {"text": "b"}], "time_limit_s": 10}


def _join(client, code, name):
    # Guests (no cookie): a logged-in client would reuse the same seat on every join.
    return client.post(f"/api/live/rooms/{code}/join", json={"display_name": name, "consent": True}).json()


def _choice(db, sid, qi, text):
    room = runtime.load_room(db, sid)
    ids = {o["text"]: o["id"] for o in live_items.public_question(sid, qi, room.items[qi])["options"]}
    return [ids[text]]


def test_timer_lock_and_late_answers(live_on, login_client, make_client, db):
    host, _ = login_client()
    guest = make_client()
    session = _session(host, settings_patch={"reading_phase_s": 2, "grace_ms": 500}, items=[SINGLE, SINGLE])
    ana = _join(guest, session["join_code"], "Ana")
    t0 = utcnow()
    start = runtime.start(db, session["id"], now=t0)
    assert start.lock_at is not None and start.lock_at[0] == 0
    assert start.lock_at[1] == t0 + timedelta(seconds=2 + 10, milliseconds=500)

    # Too early (reading phase) and too late (after deadline + grace).
    early = runtime.submit_answer(
        db, session["id"], participant_id=ana["participant_id"], answer_id=str(uuid.uuid4()), qi=0,
        choice=_choice(db, session["id"], 0, "a"), text=None, client_elapsed_ms=None, rtt_min_ms=None, now=t0,
    )
    assert early.status == "closed"
    assert runtime.auto_lock_if_due(db, session["id"], now=t0 + timedelta(seconds=12)).broadcasts == []
    late = runtime.submit_answer(
        db, session["id"], participant_id=ana["participant_id"], answer_id=str(uuid.uuid4()), qi=0,
        choice=_choice(db, session["id"], 0, "a"), text=None, client_elapsed_ms=None, rtt_min_ms=None,
        now=t0 + timedelta(seconds=13),
    )
    assert late.status == "late"
    assert [b.type for b in late.outcome.broadcasts] == ["question.locked"]
    assert late.outcome.broadcasts[0].data["reason"] == "timer"
    # A second timer tick from another worker is a no-op.
    assert runtime.auto_lock_if_due(db, session["id"], now=t0 + timedelta(seconds=14)).broadcasts == []
    assert db.get(LiveSession, session["id"], populate_existing=True).phase == "locked"


def test_speed_points_use_server_time(live_on, login_client, make_client, db):
    host, _ = login_client()
    guest = make_client()
    session = _session(host, settings_patch={"reading_phase_s": 0}, items=[SINGLE])
    ana = _join(guest, session["join_code"], "Ana")
    bia = _join(guest, session["join_code"], "Bia")
    t0 = utcnow()
    runtime.start(db, session["id"], now=t0)
    for who, delay in ((ana, 0.2), (bia, 10.0)):
        result = runtime.submit_answer(
            db, session["id"], participant_id=who["participant_id"], answer_id=str(uuid.uuid4()), qi=0,
            choice=_choice(db, session["id"], 0, "a"), text=None, client_elapsed_ms=0, rtt_min_ms=50,
            now=t0 + timedelta(seconds=delay),
        )
        assert result.status == "accepted"
    room = runtime.load_room(db, session["id"])
    board = runtime.standings(db, room, up_to=0)
    assert [s.display_name for s in board] == ["Ana", "Bia"]
    # 10 s of 10 s, minus the 50 ms latency credit: 1000 × (1 − 0.5 × 9.95/10) = 502.
    assert board[0].score == 1000 and board[1].score == 502
    # Client-reported elapsed time far from the server's is flagged, never trusted.
    from app.models import LiveAnswerEvent

    flags = {e.participant_id: e.suspicious for e in db.query(LiveAnswerEvent).all()}
    assert flags[bia["participant_id"]] is True and flags[ana["participant_id"]] is False


def test_auto_leaderboard_content_and_podium(live_on, login_client, make_client, db):
    host, _ = login_client()
    guest = make_client()
    content = {"item_type": "content", "body": "Pausa"}
    session = _session(
        host, settings_patch={"reading_phase_s": 0, "leaderboard_every": 1}, items=[SINGLE, content, SINGLE]
    )
    ana = _join(guest, session["join_code"], "Ana")
    sid = session["id"]
    runtime.start(db, sid)
    runtime.submit_answer(
        db, sid, participant_id=ana["participant_id"], answer_id=str(uuid.uuid4()), qi=0,
        choice=_choice(db, sid, 0, "a"), text=None, client_elapsed_ms=None, rtt_min_ms=None,
    )
    assert runtime.load_room(db, sid).session.phase == "locked"  # everyone answered
    assert runtime.reveal(db, sid, expected_qi=0).broadcasts[-1].type == "question.reveal"
    board = runtime.next_step(db, sid, expected_qi=0)
    assert [b.type for b in board.broadcasts] == ["leaderboard.show"]
    assert board.broadcasts[0].data["top"][0]["display_name"] == "Ana"
    shown = runtime.next_step(db, sid, expected_qi=0)
    assert shown.broadcasts[0].type == "question.intro" and shown.broadcasts[0].data["question"]["body"] == "Pausa"
    assert runtime.load_room(db, sid).session.phase == "content"
    # Double click on "next" with a stale expectation is refused.
    assert runtime.next_step(db, sid, expected_qi=0).error == "stale"
    assert runtime.next_step(db, sid, expected_qi=1).broadcasts[0].data["qi"] == 2
    assert runtime.next_step(db, sid, expected_qi=2).error == "too_early"
    runtime.lock(db, sid, expected_qi=2, reason="host")
    runtime.reveal(db, sid, expected_qi=2)
    podium = runtime.next_step(db, sid, expected_qi=2)
    assert podium.broadcasts[0].type == "podium.show"
    ended = runtime.next_step(db, sid, expected_qi=2)
    assert [b.type for b in ended.broadcasts] == ["session.ended"]
    assert runtime.end_session(db, sid).error == "stale"
    from app.models import LiveParticipant

    assert db.get(LiveParticipant, ana["participant_id"], populate_existing=True).final_rank == 1


def test_participant_snapshot_hides_answer_key(live_on, login_client, make_client, db):
    host, _ = login_client()
    guest = make_client()
    session = _session(host, settings_patch={"reading_phase_s": 0, "show_correct_on_device": False}, items=[SINGLE])
    ana = _join(guest, session["join_code"], "Ana")
    sid = session["id"]
    runtime.start(db, sid)
    room = runtime.load_room(db, sid)
    snap = runtime.snapshot(db, room, role="participant", participant_id=ana["participant_id"])
    assert "presenter" not in snap and "counts" not in snap and "correct" not in str(snap["question"])
    host_snap = runtime.snapshot(db, room, role="host")
    assert host_snap["presenter"]["item"]["options"][0]["correct"] is True
    runtime.reveal(db, sid, expected_qi=0)
    room = runtime.load_room(db, sid)
    revealed = runtime.snapshot(db, room, role="participant", participant_id=ana["participant_id"])
    assert revealed["reveal"]["correct_option_ids"] == []  # show_correct_on_device = false
    assert runtime.snapshot(db, room, role="host")["reveal"]["correct_option_ids"]
