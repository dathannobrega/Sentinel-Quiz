"""Sentinel Arena GA item types (Incremento 5): ordering (T05), numeric (T06) and word
cloud (T08). Registry rules, the room runtime (answers, live results, reveal, bots,
host hiding words), reports, "my results", the WebSocket path and the bank's PBQ
ordering conversion."""
from __future__ import annotations

import json
import random
import uuid
from contextlib import ExitStack
from datetime import timedelta

import pytest

from app.core.clock import utcnow
from app.live import runtime
from app.services import live_items, live_results
from tests.live_helpers import ORIGIN, add_item, create_quiz, live_on  # noqa: F401

ORDERING = {
    "item_type": "ordering", "prompt": "Ordene as fases de resposta a incidentes", "time_limit_s": 30,
    "options": [{"text": "Preparação"}, {"text": "Detecção"}, {"text": "Contenção"}, {"text": "Lições aprendidas"}],
}
NUMERIC = {
    "item_type": "numeric", "prompt": "Quantos bits tem uma chave AES-256?", "time_limit_s": 30,
    "min": 0, "max": 1000, "step": 1, "unit": "bits", "value": 256, "tolerance": 10, "partial": True,
}
WORDS = {"item_type": "word_cloud", "prompt": "Uma palavra sobre segurança", "time_limit_s": 30, "max_words": 2}


def _snap(item_type, payload, answer):
    return {"item_type": item_type, "prompt": "Q", "payload": payload, "answer": answer, "points_multiplier": 1, "time_limit_s": 20}


def _publish(host, items, settings_patch=None):
    quiz = create_quiz(host, settings=settings_patch or {"reading_phase_s": 0, "leaderboard_every": 0})
    for fields in items:
        quiz = add_item(host, quiz, **fields)
    response = host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
    assert response.status_code == 200, response.text
    return response.json()["quiz"]


def _session(host, items, **extra):
    quiz = _publish(host, items)
    response = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], **extra})
    assert response.status_code == 201, response.text
    return response.json()


def _join(client, code, name):
    return client.post(f"/api/live/rooms/{code}/join", json={"display_name": name, "consent": True}).json()


def _submit(db, sid, participant, qi, now, **data):
    return runtime.submit_answer(
        db, sid, participant_id=participant["participant_id"], answer_id=str(uuid.uuid4()), qi=qi,
        choice=data.get("choice"), text=data.get("text"), words=data.get("words"), number=data.get("number"),
        client_elapsed_ms=None, rtt_min_ms=None, now=now,
    )


def _public(db, sid, qi):
    room = runtime.load_room(db, sid)
    return live_items.public_question(sid, qi, room.items[qi])


# ----------------------------------------------------------------------------- registry

def test_ordering_registry_shuffles_and_grades_by_kendall_or_exact():
    options = [{"key": k, "text": t} for k, t in zip("ABCD", ["um", "dois", "três", "quatro"])]
    snap = _snap("ordering", {"options": options}, {"method": "kendall"})
    for position in range(20):  # never shown in the correct order
        public = live_items.public_question("s", position, snap)
        assert [o["text"] for o in public["options"]] != ["um", "dois", "três", "quatro"]
        assert "answer" not in public and "method" not in json.dumps(public)
    ids = {key: oid for oid, key in live_items.option_id_map("s", 0, snap).items()}
    right = live_items.grade("s", 0, snap, choice=[ids[k] for k in "ABCD"], text=None)
    assert right.fraction == 1.0 and right.is_correct is True and right.response == {"order": list("ABCD")}
    swap = live_items.grade("s", 0, snap, choice=[ids[k] for k in "BACD"], text=None)
    assert 0 < swap.fraction < 1 and swap.is_correct is False
    assert live_items.grade("s", 0, snap, choice=[ids[k] for k in "DCBA"], text=None).fraction == 0.0
    exact = _snap("ordering", {"options": options}, {"method": "exact"})
    assert live_items.grade("s", 0, exact, choice=[ids[k] for k in "BACD"], text=None).fraction == 0.0
    for bad in ([ids["A"], ids["B"], ids["C"]], [ids["A"]] * 4, [ids["A"], ids["B"], ids["C"], "o_forged"]):
        with pytest.raises(live_items.InvalidAnswer):
            live_items.grade("s", 0, snap, choice=bad, text=None)


def test_numeric_registry_parses_locales_and_gives_partial_credit():
    snap = _snap("numeric", {"min": 0.0, "max": 5000.0, "step": 1.0, "unit": "ms"}, {"value": 1000.0, "tolerance": 10.0, "partial": True})
    public = live_items.public_question("s", 0, snap)
    assert public["numeric"] == {"min": 0.0, "max": 5000.0, "step": 1.0, "unit": "ms"} and "1000" not in json.dumps(public)
    assert live_items.grade("s", 0, snap, choice=None, text="1.005").fraction == 1.0  # pt-BR thousands
    assert live_items.grade("s", 0, snap, choice=None, text="1005,0").is_correct is True
    partial = live_items.grade("s", 0, snap, choice=None, text="1020")
    assert 0 < partial.fraction < 1 and partial.is_correct is False and partial.response == {"number": 1020.0}
    assert live_items.grade("s", 0, snap, choice=None, text="1031").fraction == 0.0
    no_partial = _snap("numeric", snap["payload"], {"value": 1000.0, "tolerance": 10.0, "partial": False})
    assert live_items.grade("s", 0, no_partial, choice=None, text="1020").fraction == 0.0
    exact = _snap("numeric", snap["payload"], {"value": 1000.0, "tolerance": 0.0, "partial": True})
    assert live_items.grade("s", 0, exact, choice=None, text="1000").fraction == 1.0
    assert live_items.grade("s", 0, exact, choice=None, text="1001").fraction == 0.0
    for bad in ("", "abc", "-1", "5001"):
        with pytest.raises(live_items.InvalidAnswer):
            live_items.grade("s", 0, snap, choice=None, text=bad)
    # A number parsed on the device wins over the text (no locale ambiguity: 1.005 en-US).
    assert live_items.grade("s", 0, snap, choice=None, text="1.005", number=1.005).fraction == 0.0
    assert live_items.grade("s", 0, snap, choice=None, text=None, number=995.5).fraction == 1.0
    with pytest.raises(live_items.InvalidAnswer):
        live_items.grade("s", 0, snap, choice=None, text=None, number=float("nan"))


def test_word_cloud_registry_limits_and_dedupes_words():
    snap = _snap("word_cloud", {"max_words": 2}, {})
    assert live_items.public_question("s", 0, snap)["max_words"] == 2
    graded = live_items.grade("s", 0, snap, choice=None, text=None, words=["Senha ", "SENHA", "MFA"][:2])
    assert graded.fraction is None and graded.response == {"words": ["Senha"], "normalized": ["senha"]}
    both = live_items.grade("s", 0, snap, choice=None, text=None, words=["Firewall", "Criptografia"])
    assert both.response["normalized"] == ["firewall", "criptografia"]
    for bad in ([], ["a", "b", "c"], ["x" * 26], ["  "]):
        with pytest.raises(live_items.InvalidAnswer):
            live_items.grade("s", 0, snap, choice=None, text=None, words=bad)


def test_ga_write_validation_and_publish_issues():
    payload, answer = live_items.default_payload("numeric")
    values = live_items.apply_write("numeric", {"min": "1.000", "max": "2.000,5", "value": 1500, "tolerance": "0,5"}, payload=payload, answer=answer)
    assert values["payload_json"]["min"] == 1000.0 and values["payload_json"]["max"] == 2000.5
    assert values["answer_json"] == {"value": 1500.0, "tolerance": 0.5, "partial": True}
    with pytest.raises(live_items.ItemInputError):
        live_items.apply_write("numeric", {"tolerance": -1}, payload=payload, answer=answer)
    with pytest.raises(live_items.ItemInputError):
        live_items.apply_write("numeric", {"min": "muito"}, payload=payload, answer=answer)
    issues = {i.code for i in live_items.publish_issues(
        "numeric", prompt="P", payload={"min": 10.0, "max": 1.0}, answer={"value": 5.0}, time_limit_s=20)}
    assert "invalid_range" in issues
    issues = {i.code for i in live_items.publish_issues(
        "numeric", prompt="P", payload={"min": 0.0, "max": 10.0, "step": 0.00001}, answer={"value": 50.0}, time_limit_s=20)}
    assert {"out_of_range", "too_fine"} <= issues

    payload, answer = live_items.default_payload("ordering")
    values = live_items.apply_write("ordering", {"options": [{"text": "a"}, {"text": "a"}], "order_method": "exact"}, payload=payload, answer=answer)
    assert values["answer_json"]["method"] == "exact"
    issues = {i.code for i in live_items.publish_issues("ordering", prompt="P", payload=values["payload_json"], answer=values["answer_json"], time_limit_s=20)}
    assert {"too_few", "duplicate_option"} <= issues
    with pytest.raises(live_items.ItemInputError):
        live_items.apply_write("ordering", {"order_method": "bubble"}, payload=payload, answer=answer)
    with pytest.raises(live_items.ItemInputError):
        live_items.apply_write("word_cloud", {"max_words": 4}, payload={}, answer={})


def test_authoring_api_round_trips_ga_fields(live_on, login_client):
    host, _ = login_client()
    quiz = create_quiz(host)
    quiz = add_item(host, quiz, **NUMERIC)
    quiz = add_item(host, quiz, **{**ORDERING, "order_method": "exact"})
    quiz = add_item(host, quiz, **WORDS)
    numeric, ordering, words = quiz["items"]
    assert numeric["numeric"] == {"min": 0.0, "max": 1000.0, "step": 1.0, "unit": "bits", "value": 256.0, "tolerance": 10.0, "partial": True}
    assert numeric["points_multiplier"] == 1 and numeric["time_limit_s"] == 30
    assert ordering["order_method"] == "exact" and [o["text"] for o in ordering["options"]][0] == "Preparação"
    assert words["max_words"] == 2 and words["points_multiplier"] == 0
    bad = host.post(f"/api/live/quizzes/{quiz['id']}/items", json={"expected_version": quiz["version"], "item_type": "word_cloud", "max_words": 5})
    assert bad.status_code == 422
    # Type change keeps the list between ordering and poll; a word cloud never scores.
    changed = host.patch(
        f"/api/live/quizzes/{quiz['id']}/items/{ordering['id']}",
        json={"expected_version": quiz["version"], "item_type": "poll"},
    )
    assert changed.status_code == 200, changed.text
    poll = next(i for i in changed.json()["items"] if i["id"] == ordering["id"])
    assert [o["text"] for o in poll["options"]] == [o["text"] for o in ordering["options"]] and poll["points_multiplier"] == 0


# ----------------------------------------------------------------------------- runtime

def test_ordering_and_numeric_rooms_score_reveal_and_report(live_on, login_client, make_client, db):
    host, _ = login_client()
    session = _session(host, [ORDERING, NUMERIC])
    sid = session["id"]
    guest = make_client()
    ana, bia, caio = (_join(guest, session["join_code"], n) for n in ("Ana", "Bia", "Caio"))
    t0 = utcnow()
    runtime.start(db, sid, now=t0)

    public = _public(db, sid, 0)
    by_text = {o["text"]: o["id"] for o in public["options"]}
    right = [by_text[t] for t in ("Preparação", "Detecção", "Contenção", "Lições aprendidas")]
    swapped = [right[1], right[0], right[2], right[3]]
    assert _submit(db, sid, ana, 0, t0 + timedelta(seconds=1), choice=right).status == "accepted"
    assert _submit(db, sid, bia, 0, t0 + timedelta(seconds=2), choice=swapped).status == "accepted"
    assert _submit(db, sid, caio, 0, t0 + timedelta(seconds=2), choice=right[:3]).status == "invalid"
    tick = {b.audience: b.data for b in runtime.results_tick(db, sid) if b.type == "results.tick"}
    assert "ordering" not in tick[runtime.HOST]  # the slot accuracy is the answer: nothing live
    snap = runtime.snapshot(db, runtime.load_room(db, sid), role="participant", participant_id=bia["participant_id"])
    assert snap["my"]["last_answer"] == {"order": swapped}
    assert _submit(db, sid, caio, 0, t0 + timedelta(seconds=3), choice=list(reversed(right))).status == "accepted"

    runtime.reveal(db, sid, expected_qi=0, now=t0 + timedelta(seconds=4))
    reveal = runtime.reveal_payload(db, runtime.load_room(db, sid), 0)
    assert reveal["ordering"]["correct_order_ids"] == right
    assert reveal["ordering"]["slot_pct_correct"] == [33.3, 33.3, 66.7, 66.7] and reveal["ordering"]["exact"] == 1
    assert reveal["pct_correct"] == 33.3
    hidden = runtime.without_correct(reveal)
    assert hidden["ordering"]["correct_order_ids"] == [] and hidden["ordering"]["slot_pct_correct"] == []
    board = {s.participant_id: s for s in runtime.standings(db, runtime.load_room(db, sid), up_to=0)}
    assert board[ana["participant_id"]].score > board[bia["participant_id"]].score > board[caio["participant_id"]].score == 0

    runtime.next_step(db, sid, expected_qi=0, now=t0 + timedelta(seconds=5))
    t1 = t0 + timedelta(seconds=6)
    public = _public(db, sid, 1)
    assert public["numeric"]["unit"] == "bits" and "value" not in json.dumps(public["numeric"])
    assert _submit(db, sid, ana, 1, t1, number=256.0).status == "accepted"
    assert _submit(db, sid, bia, 1, t1, text="275").status == "accepted"
    assert _submit(db, sid, caio, 1, t1, text="1001").status == "invalid"
    tick = {b.audience: b.data for b in runtime.results_tick(db, sid) if b.type == "results.tick"}
    assert tick[runtime.HOST]["numeric"]["n"] == 2 and "value" not in tick[runtime.HOST]["numeric"]
    assert "numeric" not in tick[runtime.DISPLAY]  # show_live_distribution is off
    assert _submit(db, sid, caio, 1, t1, text="900").status == "accepted"
    runtime.reveal(db, sid, expected_qi=1, now=t1 + timedelta(seconds=1))
    reveal = runtime.reveal_payload(db, runtime.load_room(db, sid), 1)
    numeric = reveal["numeric"]
    assert numeric["value"] == 256.0 and numeric["tolerance"] == 10.0 and numeric["unit"] == "bits"
    assert numeric["n"] == 3 and sum(numeric["bins"]) == 3 and numeric["bins"][5] == 2 and numeric["bins"][18] == 1
    assert numeric["median"] == 275.0 and numeric["mean"] == pytest.approx(477.0)
    assert reveal["pct_correct"] == 33.3

    report = live_results.build_report(db, runtime.load_room(db, sid).session)
    ordering_report, numeric_report = report["items"]
    assert ordering_report["ordering"]["correct_order"][0] == "Preparação" and ordering_report["options"] == []
    assert ordering_report["ordering"]["slot_pct_correct"] == [33.3, 33.3, 66.7, 66.7]
    assert numeric_report["numeric"]["value"] == 256.0 and numeric_report["p"] == pytest.approx(0.333, abs=1e-3)
    mine = live_results.my_results(db, _participant(db, bia))
    views = {i["item_type"]: i for i in mine["items"]}
    assert views["ordering"]["your_answer"] == ["Detecção", "Preparação", "Contenção", "Lições aprendidas"]
    assert views["ordering"]["correct_answer"] == ["Preparação", "Detecção", "Contenção", "Lições aprendidas"]
    assert views["numeric"]["your_answer"] == "275 bits" and views["numeric"]["correct_answer"] == ["256 bits (± 10)"]
    assert 0 < views["numeric"]["fraction"] < 1


def _participant(db, joined):
    from app.models import LiveParticipant

    return db.get(LiveParticipant, joined["participant_id"])


def test_word_cloud_live_results_moderation_and_host_hide(live_on, login_client, make_client, db):
    host, _ = login_client()
    session = _session(host, [WORDS])
    sid = session["id"]
    guest = make_client()
    people = [_join(guest, session["join_code"], n) for n in ("Ana", "Bia", "Caio", "Duda")]
    t0 = utcnow()
    runtime.start(db, sid, now=t0)
    answers = [["Senha", "MFA"], ["senha"], ["MFA", "porra"], ["Backup"]]
    for person, words in zip(people[:3], answers):
        assert _submit(db, sid, person, 0, t0 + timedelta(seconds=1), words=words).status == "accepted"
    assert _submit(db, sid, people[3], 0, t0, words=["a", "b", "c"]).status == "invalid"

    tick = {b.audience: b.data for b in runtime.results_tick(db, sid) if b.type == "results.tick"}
    cloud = tick[runtime.DISPLAY]["word_cloud"]  # the projector sees the cloud grow
    assert [(w["text"], w["n"]) for w in cloud["words"]] == [("Senha", 2), ("MFA", 2)]
    assert cloud["filtered"] == 1  # the offensive word never reaches a screen
    snap = runtime.snapshot(db, runtime.load_room(db, sid), role="display")
    assert [w["key"] for w in snap["word_cloud"]["words"]] == ["senha", "mfa"]

    hide = runtime.hide_word(db, sid, qi=0, word="MFA")
    assert hide.error is None and hide.broadcasts[0].type == "word_cloud.update"
    assert [w["key"] for w in hide.broadcasts[0].data["word_cloud"]["words"]] == ["senha"]
    assert runtime.hide_word(db, sid, qi=1, word="MFA").error == "stale"
    assert runtime.hide_word(db, sid, qi=0, word="  ").error == "invalid"

    assert _submit(db, sid, people[3], 0, t0 + timedelta(seconds=2), words=["Backup"]).status == "accepted"
    runtime.reveal(db, sid, expected_qi=0, now=t0 + timedelta(seconds=3))
    reveal = runtime.reveal_payload(db, runtime.load_room(db, sid), 0)
    assert [w["key"] for w in reveal["word_cloud"]["words"]] == ["senha", "backup"]
    assert reveal["pct_correct"] is None and reveal["correct_option_ids"] == []
    shown = runtime.hide_word(db, sid, qi=0, word="mfa", hidden=False)
    assert [w["key"] for w in shown.broadcasts[0].data["word_cloud"]["words"]] == ["senha", "mfa", "backup"]
    runtime.hide_word(db, sid, qi=0, word="backup")

    report = live_results.build_report(db, runtime.load_room(db, sid).session)
    words = {w["key"]: w for w in report["items"][0]["word_cloud"]["words"]}
    assert words["backup"]["hidden"] is True and words["senha"]["n"] == 2 and report["items"][0]["p"] is None
    mine = live_results.my_results(db, _participant(db, people[0]))
    assert mine["items"][0]["your_answer"] == ["Senha", "MFA"] and mine["items"][0]["correct_answer"] is None
    snap = runtime.snapshot(db, runtime.load_room(db, sid), role="participant", participant_id=people[0]["participant_id"])
    assert snap["my"]["last_answer"] == {"words": ["Senha", "MFA"]}


def test_rehearsal_bots_answer_ga_types(live_on, login_client, db):
    host, _ = login_client()
    quiz = _publish(host, [ORDERING, NUMERIC, WORDS])
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], "rehearsal": True, "bots": 10}).json()
    sid = session["id"]
    t0 = utcnow()
    runtime.start(db, sid, now=t0)
    for qi in range(3):
        plan = runtime.bot_plan(db, sid, qi, now=t0, rng=random.Random(qi))
        assert len(plan) == 10
        results = runtime.submit_answers(db, [b.answer for b in plan], now=t0 + timedelta(seconds=1))
        assert {r.status for r in results} == {"accepted"}, [r.status for r in results]
        runtime.reveal(db, sid, expected_qi=qi, now=t0 + timedelta(seconds=2))
        reveal = runtime.reveal_payload(db, runtime.load_room(db, sid), qi)
        assert reveal["answered"] == 10
        if qi < 2:
            assert 0 < reveal["pct_correct"] < 100
        runtime.next_step(db, sid, expected_qi=qi, now=t0 + timedelta(seconds=3))
        t0 = t0 + timedelta(seconds=4)


# ----------------------------------------------------------------------------- websocket

def test_ga_types_over_websocket(live_on, login_client, make_client):
    from tests.test_live_ws import SUBPROTOCOLS, answer, expect, send

    host, _ = login_client()
    session = _session(host, [WORDS, ORDERING])
    guest = make_client()
    ana = _join(guest, session["join_code"], "Ana")
    display_token = host.post(f"/api/live/sessions/{session['id']}/display-token").json()["token"]
    with ExitStack() as stack:
        hs = stack.enter_context(host.websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS, headers={"origin": ORIGIN}))
        send(hs, "hello", {"session_id": session["id"], "role": "host"})
        expect(hs, "room.snapshot")
        ds = stack.enter_context(host.websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS))
        send(ds, "hello", {"token": display_token})
        expect(ds, "room.snapshot")
        ps = stack.enter_context(host.websocket_connect("/api/live/ws", subprotocols=SUBPROTOCOLS))
        send(ps, "hello", {"token": ana["token"]})
        expect(ps, "room.snapshot")

        send(hs, "host.start")
        intro = expect(ps, "question.intro")["data"]
        assert intro["question"]["max_words"] == 2
        answer(ps, 0, words=["a", "b", "c"])  # the frame allows 3, this item 2
        assert expect(ps, "answer.ack", qi=0)["data"]["status"] == "invalid"
        answer(ps, 0, words=["Zero Trust", "MFA"])
        assert expect(ps, "answer.ack", qi=0)["data"]["status"] == "accepted"
        send(hs, "host.hide_word", {"qi": 0, "word": "mfa"})
        update = expect(ds, "word_cloud.update")["data"]
        assert [w["text"] for w in update["word_cloud"]["words"]] == ["Zero Trust"]
        send(ps, "host.hide_word", {"qi": 0, "word": "x"}, mid="p1")
        assert expect(ps, "error")["data"]["code"] == "forbidden"

        send(hs, "host.reveal", {"expected_qi": 0})
        assert [w["key"] for w in expect(ds, "question.reveal", qi=0)["data"]["word_cloud"]["words"]] == ["zero trust"]
        send(hs, "host.next", {"expected_qi": 0})
        intro = expect(ps, "question.intro", qi=1)["data"]
        ids = {o["text"]: o["id"] for o in intro["question"]["options"]}
        order = [ids[t] for t in ("Preparação", "Detecção", "Contenção", "Lições aprendidas")]
        answer(ps, 1, choice=order)
        assert expect(ps, "answer.ack", qi=1)["data"]["status"] == "accepted"
        send(hs, "host.reveal", {"expected_qi": 1})
        reveal = expect(ps, "question.reveal", qi=1)["data"]
        assert reveal["ordering"]["correct_order_ids"] == order and reveal["my"]["correct"] is True


def test_answer_frame_limits_words():
    from app.live import protocol

    with pytest.raises(protocol.FrameError):
        protocol.parse_frame(json.dumps({"v": 1, "type": "answer.submit", "data": {
            "answer_id": str(uuid.uuid4()), "qi": 0, "words": ["a", "b", "c", "d"]}}))
    with pytest.raises(protocol.FrameError):
        protocol.parse_frame(json.dumps({"v": 1, "type": "answer.submit", "data": {
            "answer_id": str(uuid.uuid4()), "qi": 0, "words": ["x" * 26]}}))


# ----------------------------------------------------------------------------- bank

def _seed_pbq(db, qid, tasks, answers, *, license_scope="own"):
    from app.models import Exam, Question

    if not db.get(Exam, "secplus"):
        db.add(Exam(id="secplus", title="Security+", question_count=1))
        db.flush()
    db.add(Question(
        id=qid, exam_id="secplus", prompt="PBQ", multi_select=False, domain="Security Operations", certification="Security+",
        question_format="pbq", license_scope=license_scope,
        pbq_payload_json=json.dumps({"title": "Resposta a incidentes", "scenario": "...", "exhibits": [], "tasks": tasks}),
        pbq_answer_json=json.dumps({"points": 1, "explanation": "Geral", "tasks": answers}),
    ))
    db.commit()


def test_bank_imports_pbq_ordering_tasks(live_on, login_client, db):
    items = [{"id": f"i{n}", "text": f"Etapa {n}"} for n in range(5)]
    _seed_pbq(db, "pbq-order", [
        {"id": "t1", "type": "categorization", "prompt": "Classifique", "items": [], "buckets": []},
        {"id": "t2", "type": "ordering", "prompt": "Ordene as etapas", "items": items},
    ], {
        "t1": {"type": "categorization", "solution": {}, "scoring": {"method": "exact"}},
        "t2": {"type": "ordering", "solution": {"order": ["i3", "i1", "i0", "i4", "i2"]}, "scoring": {"method": "exact"},
               "explanation": {"summary": "Porque sim.", "per_item": {}}},
    })
    too_long = [{"id": f"j{n}", "text": f"Etapa {n}"} for n in range(7)]
    _seed_pbq(db, "pbq-seven", [{"id": "t1", "type": "ordering", "prompt": "Ordene", "items": too_long}],
              {"t1": {"type": "ordering", "solution": {"order": [i["id"] for i in too_long]}, "scoring": {}}})
    host, _ = login_client()
    found = {i["question_id"]: i for i in host.get("/api/live/bank/search").json()["items"]}
    assert found["pbq-order"]["convertible_to"] == "ordering" and found["pbq-order"]["question_format"] == "pbq"
    assert [o["text"] for o in found["pbq-order"]["options"]] == ["Etapa 3", "Etapa 1", "Etapa 0", "Etapa 4", "Etapa 2"]
    assert found["pbq-seven"]["convertible_to"] is None and found["pbq-seven"]["reject_reason"] == "unsupported_format"

    quiz = create_quiz(host)
    result = host.post(
        f"/api/live/quizzes/{quiz['id']}/items/from-bank",
        json={"expected_version": quiz["version"], "question_ids": ["pbq-order", "pbq-seven"]},
    ).json()
    assert result["rejected"] == [{"question_id": "pbq-seven", "reason": "unsupported_format"}]
    item = result["quiz"]["items"][0]
    assert item["item_type"] == "ordering" and item["order_method"] == "exact" and item["source_kind"] == "bank"
    assert item["prompt"] == "Resposta a incidentes: Ordene as etapas" and item["explanation"] == "Porque sim."
    assert [o["text"] for o in item["options"]] == ["Etapa 3", "Etapa 1", "Etapa 0", "Etapa 4", "Etapa 2"]
    published = host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": result["quiz"]["version"]})
    assert published.status_code == 200, published.text


def test_real_pbq_file_has_one_live_ordering_task():
    """The shipped Security+ PBQ set: the 6-item volatility task fits; the 7-item one does not."""
    from pathlib import Path
    from types import SimpleNamespace

    from app.services.live_quiz import pbq_ordering_task
    from app.services.pbq_grading import split_authoring_item

    raw = json.loads((Path(__file__).resolve().parents[2] / "questions" / "pbq_securityplus.json").read_text("utf-8"))
    tasks = []
    for question in raw["questions"]:
        public, answer = split_authoring_item(question)
        row = SimpleNamespace(question_format="pbq", pbq_payload_json=json.dumps(public), pbq_answer_json=json.dumps(answer))
        task = pbq_ordering_task(row)
        if task:
            tasks.append((question["id"], task))
    assert len(tasks) == 1 and len(tasks[0][1]["items"]) == 6 and tasks[0][1]["method"] == "kendall"
