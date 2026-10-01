"""Sentinel Arena self-paced challenges (Incremento 6, E1.10 / RF-801..RF-813, RF-1029).

The API flow (link, join, attempts, answers, hand-in, leaderboard, owner panel, report)
plus the lazy deadlines with a controlled clock: per item, total time, the challenge's
own close and the cleanup job.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from app.core.clock import utcnow
from app.models import LiveAttempt, LiveParticipant, LiveSession
from app.services import live_challenge, live_items, live_results, live_retention
from tests.live_helpers import add_item, create_quiz, live_on  # noqa: F401

SINGLE = {"item_type": "single_choice", "prompt": "Qual controle mitiga phishing?", "time_limit_s": 20,
          "options": [{"text": "Treinamento", "correct": True}, {"text": "Relay aberto"}, {"text": "Post-it"}]}
MULTI = {"item_type": "multi_choice", "prompt": "Fatores de autenticação?", "time_limit_s": 20,
         "options": [{"text": "Senha", "correct": True}, {"text": "Token", "correct": True}, {"text": "Cor"}]}
TYPED = {"item_type": "type_answer", "prompt": "Phishing por SMS?", "accepted_answers": ["smishing"], "time_limit_s": 20}
CONTENT = {"item_type": "content", "prompt": "Intervalo", "body": "Agora, autenticação."}
POLL = {"item_type": "poll", "prompt": "Usa MFA?", "options": [{"text": "Sim"}, {"text": "Não"}], "time_limit_s": 20}


def _quiz(host, items=(SINGLE, CONTENT, MULTI, TYPED)):
    quiz = create_quiz(host, settings={"reading_phase_s": 0})
    for fields in items:
        quiz = add_item(host, quiz, **fields)
    response = host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
    assert response.status_code == 200, response.text
    return response.json()["quiz"]


def _challenge(host, quiz, **extra):
    body = {"quiz_id": quiz["id"], "closes_at": (utcnow() + timedelta(days=2)).isoformat(), **extra}
    response = host.post("/api/live/challenges", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _join(client, slug, name, dev_h=None):
    response = client.post(f"/api/live/q/{slug}/join", json={"display_name": name, "consent": True, **({"dev_h": dev_h} if dev_h else {})})
    assert response.status_code == 201, response.text
    return response.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _option(state, text):
    return next(o["id"] for o in state["item"]["options"] if o["text"] == text)


def _play(client, slug, token, answers):
    """Walk an attempt answering by prompt: {prompt: payload | None (skip content)}."""
    state = client.post(f"/api/live/q/{slug}/attempts", headers=_auth(token)).json()
    feedbacks = []
    while state["status"] == "in_progress":
        item = state["item"]
        if item["item_type"] == "content":
            state = client.post(f"/api/live/q/{slug}/attempts/{state['attempt_id']}/advance", headers=_auth(token),
                                json={"index": state["index"]}).json()
            continue
        payload = answers[item["prompt"]](state)
        result = client.post(f"/api/live/q/{slug}/attempts/{state['attempt_id']}/answers", headers=_auth(token),
                             json={"answer_id": str(uuid.uuid4()), "qi": item["qi"], **payload}).json()
        assert result["status"] == "accepted", result
        feedbacks.append(result.get("feedback"))
        state = result["state"]
    return state, feedbacks


RIGHT = {
    SINGLE["prompt"]: lambda s: {"choice": [_option(s, "Treinamento")]},
    MULTI["prompt"]: lambda s: {"choice": [_option(s, "Senha"), _option(s, "Token")]},
    TYPED["prompt"]: lambda s: {"text": "Smishing"},
}
HALF = {
    SINGLE["prompt"]: lambda s: {"choice": [_option(s, "Relay aberto")]},
    MULTI["prompt"]: lambda s: {"choice": [_option(s, "Senha")]},
    TYPED["prompt"]: lambda s: {"text": "smishing"},
}


# ----------------------------------------------------------------------------- creation

def test_create_challenge_validates_and_serializes(live_on, login_client):
    host, _ = login_client()
    quiz = _quiz(host)
    soon = (utcnow() + timedelta(seconds=10)).isoformat()
    bad = host.post("/api/live/challenges", json={"quiz_id": quiz["id"], "closes_at": soon})
    assert bad.status_code == 422 and bad.json()["code"] == "invalid_window"
    far = (utcnow() + timedelta(days=120)).isoformat()
    assert host.post("/api/live/challenges", json={"quiz_id": quiz["id"], "closes_at": far}).json()["code"] == "invalid_window"
    no_total = host.post("/api/live/challenges", json={"quiz_id": quiz["id"], "closes_at": (utcnow() + timedelta(days=1)).isoformat(), "time_mode": "total"})
    assert no_total.status_code == 422 and no_total.json()["code"] == "invalid_total_time"

    created = _challenge(host, quiz, leaderboard=True, attempts=2)
    challenge = created["challenge"]
    assert created["mode"] == "self_paced" and challenge["state"] == "open" and len(challenge["slug"]) == 8
    assert not set(challenge["slug"]) & set("ILOU") and challenge["share_url"].endswith(f"/q/{challenge['slug']}")
    # RF-813: a leaderboard hides the key until the deadline by default.
    assert challenge["feedback"] == "after_close" and challenge["attempts"] == 2
    assert _challenge(host, quiz)["challenge"]["feedback"] == "end"
    qr = host.get(f"/api/live/sessions/{created['id']}/qr.svg")
    assert qr.status_code == 200 and b"<svg" in qr.content
    assert host.post(f"/api/live/sessions/{created['id']}/display-token").json()["code"] == "not_a_live_room"


def test_public_info_counts_views_and_gates_the_window(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _quiz(host)
    created = _challenge(host, quiz, opens_at=(utcnow() + timedelta(hours=1)).isoformat())
    slug = created["challenge"]["slug"]
    guest = make_client()
    info = guest.get(f"/api/live/q/{slug.lower().replace('0', 'o')}").json()  # typed loosely still resolves
    assert info["state"] == "scheduled" and info["item_count"] == 3 and info["title"]
    join = guest.post(f"/api/live/q/{slug}/join", json={"display_name": "Ana", "consent": True})
    assert join.status_code == 409 and join.json()["code"] == "challenge_not_open"
    assert guest.get("/api/live/q/ZZZZZZZZ").status_code == 404
    session = db.get(LiveSession, created["id"])
    db.refresh(session)
    assert session.view_count == 1

    session.opens_at = utcnow() - timedelta(minutes=1)
    session.closes_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert guest.get(f"/api/live/q/{slug}").json()["state"] == "closed"
    gone = guest.post(f"/api/live/q/{slug}/join", json={"display_name": "Ana", "consent": True})
    assert gone.status_code == 410 and gone.json()["code"] == "challenge_closed"
    db.refresh(session)
    assert session.status == "finished" and session.ended_at is not None


# ----------------------------------------------------------------------------- playing

def test_full_attempt_with_end_feedback_report_and_my_results(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _quiz(host)
    created = _challenge(host, quiz)
    slug = created["challenge"]["slug"]
    guest = make_client()
    ana = _join(guest, slug, "Ana")
    bia = _join(guest, slug, "Bia")

    state = guest.post(f"/api/live/q/{slug}/attempts", headers=_auth(ana["token"])).json()
    assert state["status"] == "in_progress" and state["total"] == 4 and state["questions_total"] == 3
    # The content slide keeps its slot; the questions are shuffled around it.
    attempt = db.get(LiveAttempt, state["attempt_id"])
    assert attempt.item_order_json[1] == 1 and sorted(attempt.item_order_json) == [0, 1, 2, 3]
    # Resuming returns the same attempt (RF-808).
    again = guest.post(f"/api/live/q/{slug}/attempts", headers=_auth(ana["token"])).json()
    assert again["attempt_id"] == state["attempt_id"]
    current = guest.get(f"/api/live/q/{slug}/attempts/current", headers=_auth(ana["token"])).json()
    assert current["attempt_id"] == state["attempt_id"] and current["item"]["qi"] == state["item"]["qi"]

    # Guards: the wrong item, a bad payload, a duplicate.
    aid = state["attempt_id"]
    wrong_qi = next(p for p in [0, 2, 3] if p != state["item"]["qi"])
    stale = guest.post(f"/api/live/q/{slug}/attempts/{aid}/answers", headers=_auth(ana["token"]),
                       json={"answer_id": str(uuid.uuid4()), "qi": wrong_qi, "text": "x"}).json()
    assert stale["status"] == "stale"
    invalid = guest.post(f"/api/live/q/{slug}/attempts/{aid}/answers", headers=_auth(ana["token"]),
                         json={"answer_id": str(uuid.uuid4()), "qi": state["item"]["qi"], "choice": ["o_forged"]}).json()
    assert invalid["status"] == "invalid" and invalid["state"]["index"] == 0
    other = guest.post(f"/api/live/q/{slug}/attempts/{aid}/answers", headers=_auth(bia["token"]),
                       json={"answer_id": str(uuid.uuid4()), "qi": state["item"]["qi"], "text": "x"})
    assert other.status_code == 404  # someone else's attempt

    final, feedbacks = _play(guest, slug, ana["token"], RIGHT)
    assert feedbacks == [None, None, None]  # policy "end": nothing per item
    summary = final["summary"]
    assert final["status"] == "finished" and summary["finish_reason"] == "completed"
    assert summary["correct"] == 3 and summary["score"] == 3000 and summary["corrections_visible"] is True
    assert [i["correct"] for i in summary["items"]] == [True, True, True] and summary["attempts_left"] == 0
    assert guest.post(f"/api/live/q/{slug}/attempts", headers=_auth(ana["token"])).json()["code"] == "attempts_exhausted"
    _play(guest, slug, bia["token"], HALF)

    mine = guest.get("/api/live/me/results", headers=_auth(bia["token"])).json()
    assert mine["mode"] == "self_paced" and mine["corrections_visible"] is True
    assert {i["prompt"]: i["fraction"] for i in mine["items"]} == {SINGLE["prompt"]: 0.0, MULTI["prompt"]: 0.5, TYPED["prompt"]: 1.0}

    panel = host.get(f"/api/live/sessions/{created['id']}/challenge").json()
    assert panel["funnel"] == {"opened": 0, "joined": 2, "started": 2, "finished": 2}
    assert panel["attempts_per_person"] == {"1": 2} and [r["display_name"] for r in panel["leaderboard"]] == ["Ana", "Bia"]
    report = host.get(f"/api/live/sessions/{created['id']}/report").json()
    assert report["kpis"]["participants"] == 2 and report["challenge"]["funnel"]["finished"] == 2
    assert [p["display_name"] for p in report["participants"]] == ["Ana", "Bia"]
    single = next(i for i in report["items"] if i["prompt"] == SINGLE["prompt"])
    assert single["answered"] == 2 and single["p"] == 0.5
    csv = host.get(f"/api/live/sessions/{created['id']}/export.csv")
    assert csv.status_code == 200 and "Ana" in csv.text


def test_each_feedback_and_after_close_policies(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _quiz(host, items=(SINGLE, TYPED))
    each = _challenge(host, quiz, feedback="each")
    guest = make_client()
    ana = _join(guest, each["challenge"]["slug"], "Ana")
    _final, feedbacks = _play(guest, each["challenge"]["slug"], ana["token"], HALF)
    by_type = {f["item_type"]: f for f in feedbacks}
    assert by_type["single_choice"]["correct"] is False and len(by_type["single_choice"]["correct_option_ids"]) == 1
    assert by_type["type_answer"]["accepted_answers"] == ["smishing"] and by_type["type_answer"]["correct"] is True

    hidden = _challenge(host, quiz, leaderboard=True)  # after_close by default
    slug = hidden["challenge"]["slug"]
    bia = _join(guest, slug, "Bia")
    final, feedbacks = _play(guest, slug, bia["token"], RIGHT)
    assert feedbacks == [None, None]
    summary = final["summary"]
    assert summary["corrections_visible"] is False and summary["items"] == [] and summary["corrections_at"]
    assert summary["rank"] == 1 and summary["ranked"] == 1
    mine = guest.get("/api/live/me/results", headers=_auth(bia["token"])).json()
    assert mine["corrections_visible"] is False and all(i["correct_answer"] is None and i["correct"] is None for i in mine["items"])
    data = guest.get("/api/live/me", headers=_auth(bia["token"])).json()
    assert all(a["correct"] is None and a["points"] is None for a in data["answers"])

    # Closing the challenge reveals the key.
    closed = host.patch(f"/api/live/sessions/{hidden['id']}/challenge", json={"close_now": True}).json()
    assert closed["challenge"]["state"] == "closed"
    after = guest.get(f"/api/live/q/{slug}/attempts/current", headers=_auth(bia["token"])).json()
    assert after["summary"]["corrections_visible"] is True and len(after["summary"]["items"]) == 2
    board = guest.get(f"/api/live/q/{slug}/leaderboard", headers=_auth(bia["token"])).json()
    assert board["final"] is True and board["me"]["rank"] == 1
    assert db.get(LiveParticipant, bia["participant_id"]).final_rank == 1
    no_board = guest.get(f"/api/live/q/{each['challenge']['slug']}/leaderboard", headers=_auth(ana["token"]))
    assert no_board.status_code == 404 and no_board.json()["code"] == "leaderboard_disabled"


def test_attempts_best_counts_and_repeat_device_is_flagged(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _quiz(host, items=(SINGLE, MULTI))
    created = _challenge(host, quiz, attempts=2, leaderboard=True, feedback="end")
    slug = created["challenge"]["slug"]
    guest = make_client()
    ana = _join(guest, slug, "Ana", dev_h="device-1")
    first, _ = _play(guest, slug, ana["token"], RIGHT)
    assert first["summary"]["attempts_left"] == 1 and first["attempt_no"] == 1
    second, _ = _play(guest, slug, ana["token"], HALF)
    assert second["attempt_no"] == 2 and second["summary"]["best_score"] == first["summary"]["score"]
    board = guest.get(f"/api/live/q/{slug}/leaderboard", headers=_auth(ana["token"])).json()
    assert board["me"]["score"] == first["summary"]["score"]  # the best attempt counts

    # Same device, new name (RF-813): allowed but flagged for the owner.
    alt = _join(guest, slug, "Ana Clone", dev_h="device-1")
    _play(guest, slug, alt["token"], RIGHT)
    panel = host.get(f"/api/live/sessions/{created['id']}/challenge").json()
    assert panel["repeat_suspects"] == 1 and panel["attempts_per_person"] == {"2": 1, "1": 1}
    report = host.get(f"/api/live/sessions/{created['id']}/report").json()
    flags = {p["display_name"]: p["repeat_suspect"] for p in report["participants"]}
    assert flags == {"Ana": False, "Ana Clone": True}
    # Tie on score and correct answers: faster correct answers first, then who joined first.
    assert [p["display_name"] for p in report["participants"]][0] in {"Ana", "Ana Clone"}


def test_per_item_deadline_is_lazy_and_late_answers_are_refused(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _quiz(host, items=(SINGLE, MULTI))
    created = _challenge(host, quiz, shuffle_items=False)
    slug = created["challenge"]["slug"]
    guest = make_client()
    ana = _join(guest, slug, "Ana")
    participant = db.get(LiveParticipant, ana["participant_id"])
    t0 = utcnow()
    state = live_challenge.start_attempt(db, participant, now=t0)
    assert state["item"]["qi"] == 0 and state["item_deadline_at"]
    late = live_challenge.answer(
        db, participant, state["attempt_id"], answer_id=str(uuid.uuid4()), qi=0,
        choice=[_option(state, "Treinamento")], text=None, words=None, number=None, now=t0 + timedelta(seconds=25),
    )
    assert late["status"] == "late" and late["state"]["item"]["qi"] == 1  # moved on, the next item starts now
    # Extended time (RF-622): the multiplier stretches the window; 0 = untimed.
    participant.time_multiplier = 2.0
    db.commit()
    t1 = t0 + timedelta(seconds=25)
    ok = live_challenge.answer(
        db, participant, state["attempt_id"], answer_id=str(uuid.uuid4()), qi=1,
        choice=[_option(late["state"], "Senha"), _option(late["state"], "Token")], text=None, words=None, number=None,
        now=t1 + timedelta(seconds=35),
    )
    assert ok["status"] == "accepted" and ok["state"]["status"] == "finished"
    summary = ok["state"]["summary"]
    assert summary["answered"] == 1 and summary["correct"] == 1 and summary["score"] < 1000  # speed scoring


def test_total_time_and_challenge_close_finish_open_attempts(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _quiz(host, items=(SINGLE, MULTI, TYPED))
    created = _challenge(host, quiz, time_mode="total", total_time_s=60)
    slug = created["challenge"]["slug"]
    guest = make_client()
    ana = _join(guest, slug, "Ana")
    bia = _join(guest, slug, "Bia")
    ana_p = db.get(LiveParticipant, ana["participant_id"])
    bia_p = db.get(LiveParticipant, bia["participant_id"])
    t0 = utcnow()
    state = live_challenge.start_attempt(db, ana_p, now=t0)
    assert state["item_deadline_at"] is None and state["deadline_at"]
    expired = live_challenge.current_attempt(db, ana_p, now=t0 + timedelta(seconds=61))
    assert expired["status"] == "finished" and expired["summary"]["finish_reason"] == "time_up"

    live_challenge.start_attempt(db, bia_p, now=t0)
    session = db.get(LiveSession, created["id"])
    session.closes_at = t0 + timedelta(seconds=30)
    db.commit()
    assert live_retention.run(db, now=t0 + timedelta(seconds=31))["challenges_closed"] == 1
    db.refresh(session)
    assert session.status == "finished" and session.ended_at == t0 + timedelta(seconds=30)
    attempt = db.query(LiveAttempt).filter_by(participant_id=bia_p.id).one()
    assert attempt.status == "finished" and attempt.finish_reason == "closed"
    assert live_challenge.close_due_challenges(db, now=t0 + timedelta(seconds=40)) == 0  # idempotent


def test_hand_in_content_advance_and_moderation_removal(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _quiz(host, items=(CONTENT, SINGLE, POLL, MULTI))
    created = _challenge(host, quiz, shuffle_items=False)
    slug = created["challenge"]["slug"]
    session = db.get(LiveSession, created["id"])
    session.hidden_positions = [3]  # removed by moderation: never served
    db.commit()
    guest = make_client()
    ana = _join(guest, slug, "Ana")
    state = guest.post(f"/api/live/q/{slug}/attempts", headers=_auth(ana["token"])).json()
    assert state["total"] == 3 and state["item"]["item_type"] == "content"
    stay = guest.post(f"/api/live/q/{slug}/attempts/{state['attempt_id']}/advance", headers=_auth(ana["token"]), json={"index": 5}).json()
    assert stay["index"] == 0  # idempotent: only the slide being left moves the attempt
    state = guest.post(f"/api/live/q/{slug}/attempts/{state['attempt_id']}/advance", headers=_auth(ana["token"]), json={"index": 0}).json()
    assert state["item"]["qi"] == 1
    done = guest.post(f"/api/live/q/{slug}/attempts/{state['attempt_id']}/finish", headers=_auth(ana["token"])).json()
    assert done["status"] == "finished" and done["summary"]["finish_reason"] == "handed_in" and done["summary"]["answered"] == 0


def test_options_are_shuffled_per_attempt_with_the_same_ids(live_on):
    snap = {"item_type": "single_choice", "prompt": "Q", "payload": {"options": [{"key": k, "text": k} for k in "ABCDEF"]},
            "answer": {"correct_keys": ["A"]}, "points_multiplier": 1, "time_limit_s": 20}
    orders = {tuple(o["text"] for o in live_challenge.shuffled_question("s", 0, snap, f"a{n}")["options"]) for n in range(10)}
    assert len(orders) > 1
    ids = {o["id"] for o in live_challenge.shuffled_question("s", 0, snap, "a1")["options"]}
    assert ids == set(live_items.option_id_map("s", 0, snap))
    tf = {"item_type": "true_false", "prompt": "Q", "payload": {"options": [{"key": "T", "text": "V"}, {"key": "F", "text": "F"}]},
          "answer": {"correct_keys": ["F"]}, "points_multiplier": 1, "time_limit_s": 20}
    assert [o["text"] for o in live_challenge.shuffled_question("s", 0, tf, "a1")["options"]] == ["V", "F"]
    ordering = {"item_type": "ordering", "prompt": "Q", "payload": {"options": [{"key": k, "text": k} for k in "ABC"]},
                "answer": {"method": "kendall"}, "points_multiplier": 1, "time_limit_s": 20}
    for n in range(20):
        assert [o["text"] for o in live_challenge.shuffled_question("s", 0, ordering, f"x{n}")["options"]] != ["A", "B", "C"]


def test_realtime_paths_refuse_challenges(live_on, login_client, make_client):
    from tests.test_live_ws import SUBPROTOCOLS, recv, send

    host, _ = login_client()
    quiz = _quiz(host, items=(SINGLE,))
    created = _challenge(host, quiz)
    guest = make_client()
    ana = _join(guest, created["challenge"]["slug"], "Ana")
    with guest.websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS) as ws:
        send(ws, "hello", {"token": ana["token"]})
        assert recv(ws)["type"] == "__close__"
    ended = host.post(f"/api/live/sessions/{created['id']}/end").json()
    assert ended["challenge"]["state"] == "closed"


def test_admin_force_end_closes_a_challenge(live_on, login_client, make_client, db):
    from app.live import runtime

    host, _ = login_client()
    quiz = _quiz(host, items=(SINGLE,))
    created = _challenge(host, quiz, leaderboard=True)
    guest = make_client()
    ana = _join(guest, created["challenge"]["slug"], "Ana")
    _play(guest, created["challenge"]["slug"], ana["token"], RIGHT)
    assert runtime.end_session(db, created["id"]).error is None
    session = db.get(LiveSession, created["id"])
    db.refresh(session)
    assert session.status == "finished" and db.get(LiveParticipant, ana["participant_id"]).final_score == 1000


def test_rate_limit_buckets_for_challenge_paths():
    from app.middleware.rate_limit import RateLimitMiddleware

    from app.core.config import Settings

    middleware = RateLimitMiddleware(lambda *a: None, Settings(_env_file=None))
    assert middleware._resolve_policy("/api/live/q/ABCD2345")[0] == "live_room"  # noqa: SLF001
    assert middleware._resolve_policy("/api/live/q/ABCD2345/join", "POST")[2] == "Q:ABCD2345"  # noqa: SLF001
    bucket = middleware._resolve_policy("/api/live/q/ABCD2345/attempts/x/answers", "POST", "Bearer tok")  # noqa: SLF001
    assert bucket[0] == "live_token"


@pytest.mark.parametrize("policy,finished,closed,visible", [
    ("each", False, False, True), ("end", False, False, False), ("end", True, False, True),
    ("after_close", True, False, False), ("after_close", True, True, True), ("never", True, True, False),
])
def test_feedback_matrix(policy, finished, closed, visible):
    """RF-806: the four policies, before and after the attempt and the deadline."""
    now = utcnow()
    session = LiveSession(mode="self_paced", status="finished" if closed else "live",
                          closes_at=now + timedelta(days=1), settings_json={"challenge": {"feedback": policy}})
    assert live_challenge._feedback_visible(session, finished, now) is visible  # noqa: SLF001


def test_report_counts_only_the_counted_attempt(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _quiz(host, items=(SINGLE, MULTI))
    created = _challenge(host, quiz, attempts=3)
    slug = created["challenge"]["slug"]
    guest = make_client()
    ana = _join(guest, slug, "Ana")
    _play(guest, slug, ana["token"], HALF)
    _play(guest, slug, ana["token"], RIGHT)
    started = guest.post(f"/api/live/q/{slug}/attempts", headers=_auth(ana["token"])).json()  # third, unfinished
    assert started["attempt_no"] == 3
    report = live_results.build_report(db, db.get(LiveSession, created["id"]))
    single = next(i for i in report["items"] if i["prompt"] == SINGLE["prompt"])
    assert single["answered"] == 1 and single["n_correct"] == 1  # attempt 2 (best), not 1 or 3
    assert report["participants"][0]["score"] == 2000
