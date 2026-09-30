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


def test_answer_batch_group_commit(live_on, login_client, make_client, db):
    """One batch: duplicates, a second answer from the same person, a kicked participant,
    ordering of results, and the all-answered lock attached to the last accepted answer."""
    host, _ = login_client()
    guest = make_client()
    session = _session(host, settings_patch={"reading_phase_s": 0}, items=[SINGLE, SINGLE])
    sid = session["id"]
    ana = _join(guest, session["join_code"], "Ana")
    bia = _join(guest, session["join_code"], "Bia")
    caio = _join(guest, session["join_code"], "Caio")
    runtime.kick(db, sid, participant_id=caio["participant_id"], ban=False)
    t0 = utcnow()
    runtime.start(db, sid, now=t0)
    choice = _choice(db, sid, 0, "a")
    same_id = str(uuid.uuid4())

    def answer_in(who, answer_id=None, qi=0):
        return runtime.AnswerIn(sid, who["participant_id"], answer_id or str(uuid.uuid4()), qi, choice=choice)

    results = runtime.submit_answers(
        db,
        [
            answer_in(ana, same_id),
            answer_in(ana, same_id),  # retry of the same frame
            answer_in(ana),  # a second answer from Ana
            answer_in(caio),  # kicked
            answer_in(bia, qi=1),  # not the open question
            answer_in(bia),
        ],
        now=t0 + timedelta(seconds=1),
    )
    assert [r.status for r in results] == ["accepted", "duplicate", "already_answered", "closed", "closed", "accepted"]
    # Everyone active answered: the lock rides on the last accepted answer only.
    assert [b.type for b in results[5].outcome.broadcasts] == ["question.locked"]
    assert all(not r.outcome.broadcasts for r in results[:5])
    # A retry in a later batch is still a duplicate (idempotency across batches).
    again = runtime.submit_answers(db, [answer_in(ana, same_id)], now=t0 + timedelta(seconds=2))
    assert again[0].status == "duplicate"


def test_standings_cache_tracks_answers_and_roster(live_on, login_client, make_client, db):
    host, _ = login_client()
    guest = make_client()
    session = _session(host, settings_patch={"reading_phase_s": 0}, items=[SINGLE, SINGLE])
    sid = session["id"]
    ana = _join(guest, session["join_code"], "Ana")
    bia = _join(guest, session["join_code"], "Bia")
    runtime.start(db, sid)
    runtime.submit_answer(
        db, sid, participant_id=ana["participant_id"], answer_id=str(uuid.uuid4()), qi=0,
        choice=_choice(db, sid, 0, "a"), text=None, client_elapsed_ms=None, rtt_min_ms=None,
    )
    runtime.lock(db, sid, expected_qi=0, reason="host")
    room = runtime.load_room(db, sid)
    first = runtime.standings(db, room, up_to=0)
    assert runtime.standings(db, room, up_to=0) is first  # cached
    assert [s.display_name for s in first] == ["Ana", "Bia"]
    runtime.kick(db, sid, participant_id=bia["participant_id"], ban=False)
    after_kick = runtime.standings(db, runtime.load_room(db, sid), up_to=0)
    assert after_kick is not first and [s.display_name for s in after_kick] == ["Ana"]
    _join(guest, session["join_code"], "Caio")
    assert [s.display_name for s in runtime.standings(db, runtime.load_room(db, sid), up_to=0)] == ["Ana", "Caio"]


def _submit(db, sid, who, qi, text, now):
    return runtime.submit_answer(
        db, sid, participant_id=who["participant_id"], answer_id=str(uuid.uuid4()), qi=qi,
        choice=_choice(db, sid, qi, text), text=None, client_elapsed_ms=None, rtt_min_ms=None, now=now,
    )


def test_pause_resume_and_extend(live_on, login_client, make_client, db):
    host, _ = login_client()
    guest = make_client()
    session = _session(host, settings_patch={"reading_phase_s": 0, "grace_ms": 0}, items=[SINGLE])
    sid = session["id"]
    ana = _join(guest, session["join_code"], "Ana")
    _join(guest, session["join_code"], "Bia")
    t0 = utcnow()
    assert runtime.start(db, sid, now=t0).lock_at[1] == t0 + timedelta(seconds=10)

    paused = runtime.pause(db, sid, expected_qi=0, now=t0 + timedelta(seconds=4))
    assert paused.broadcasts[0].type == "question.paused"
    assert paused.broadcasts[0].data["remaining_ms"] == 6000 and paused.broadcasts[0].data["paused"] is True
    assert runtime.pause(db, sid, expected_qi=0).error == "already_paused"
    assert runtime.pending_lock_at_ms(db, sid) is None  # frozen: no auto-lock
    assert runtime.auto_lock_if_due(db, sid, now=t0 + timedelta(seconds=60)).broadcasts == []
    assert _submit(db, sid, ana, 0, "a", t0 + timedelta(seconds=5)).status == "paused"
    assert runtime.extend(db, sid, expected_qi=0, seconds=10).error == "paused"

    # 30 s later: the 6 s that were left are still left.
    resumed = runtime.resume(db, sid, expected_qi=0, now=t0 + timedelta(seconds=34))
    timer = resumed.broadcasts[0]
    assert timer.type == "question.timer" and timer.data["reason"] == "resume" and timer.data["paused"] is False
    assert resumed.lock_at[1] == t0 + timedelta(seconds=40)
    assert runtime.resume(db, sid, expected_qi=0).error == "not_paused"

    extended = runtime.extend(db, sid, expected_qi=0, seconds=15, now=t0 + timedelta(seconds=35))
    assert extended.lock_at[1] == t0 + timedelta(seconds=55)
    # Speed excludes the pause: 4 s before it + 1 s after resuming = 5 s elapsed.
    assert _submit(db, sid, ana, 0, "a", t0 + timedelta(seconds=35)).status == "accepted"
    from app.models import LiveAnswerEvent

    assert db.query(LiveAnswerEvent).one().server_ms == 5000


def test_extended_time_per_participant(live_on, login_client, make_client, db):
    host, _ = login_client()
    guest = make_client()
    session = _session(host, settings_patch={"reading_phase_s": 0, "grace_ms": 0}, items=[SINGLE, SINGLE])
    sid = session["id"]
    ana = _join(guest, session["join_code"], "Ana")
    bia = _join(guest, session["join_code"], "Bia")
    assert runtime.set_time_multiplier(db, sid, participant_id=bia["participant_id"], multiplier=3).error == "invalid"
    outcome = runtime.set_time_multiplier(db, sid, participant_id=bia["participant_id"], multiplier=2)
    assert [b.type for b in outcome.broadcasts] == ["participant.time", "participant.updated"]
    assert outcome.broadcasts[0].participant_id == bia["participant_id"]

    t0 = utcnow()
    start = runtime.start(db, sid, now=t0)
    assert start.lock_at[1] == t0 + timedelta(seconds=20)  # stretched to Bia's 2x window
    # Ana is late after 10 s; Bia is not, and 15 s at 2x scores like 7.5 s.
    assert _submit(db, sid, ana, 0, "a", t0 + timedelta(seconds=11)).status == "late"
    assert runtime.auto_lock_if_due(db, sid, now=t0 + timedelta(seconds=11)).broadcasts == []
    assert _submit(db, sid, bia, 0, "a", t0 + timedelta(seconds=15)).status == "accepted"
    from app.models import LiveAnswerEvent

    assert db.query(LiveAnswerEvent).one().points == round(1000 * (1 - 0.5 * 7.5 / 10))

    # Untimed: no auto-lock at all, the host (or everyone answering) closes it.
    runtime.lock(db, sid, expected_qi=0, reason="host")
    runtime.reveal(db, sid, expected_qi=0)
    runtime.set_time_multiplier(db, sid, participant_id=bia["participant_id"], multiplier=0)
    assert runtime.next_step(db, sid, expected_qi=0).lock_at is None
    snap = runtime.snapshot(db, runtime.load_room(db, sid), role="host")
    assert {p["display_name"]: p["time_multiplier"] for p in snap["participants"]} == {"Ana": 1.0, "Bia": 0.0}
