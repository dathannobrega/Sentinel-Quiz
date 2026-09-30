"""Sentinel Arena Incremento 4: moderation, admin, participant rights, retention, preflight."""
from __future__ import annotations

import uuid
from datetime import timedelta

from app.core.clock import utcnow
from app.live import runtime
from app.models import LiveAnswerEvent, LiveAuditEvent, LiveParticipant, LiveSession
from app.services import live_items
from tests.conftest import seed_question
from tests.live_helpers import add_item, create_quiz, live_on, published_quiz  # noqa: F401

SINGLE = {"item_type": "single_choice", "prompt": "Qual controle mitiga phishing?", "time_limit_s": 20,
          "options": [{"text": "Treinamento", "correct": True}, {"text": "Relay aberto"}]}


def _publish(host, *items, settings=None):
    quiz = create_quiz(host, settings=settings or {"reading_phase_s": 0, "leaderboard_every": 0})
    for fields in items:
        quiz = add_item(host, quiz, **fields)
    response = host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
    assert response.status_code == 200, response.text
    return response.json()


def _join(client, code, name="Ana"):
    response = client.post(f"/api/live/rooms/{code}/join", json={"display_name": name, "consent": True})
    assert response.status_code == 201, response.text
    return response.json()


def _answer(db, sid, participant_id, qi, text):
    room = runtime.load_room(db, sid)
    ids = {o["text"]: o["id"] for o in live_items.public_question(sid, qi, room.items[qi])["options"]}
    return runtime.submit_answer(
        db, sid, participant_id=participant_id, answer_id=str(uuid.uuid4()), qi=qi, choice=[ids[text]], text=None,
        client_elapsed_ms=None, rtt_min_ms=None,
    )


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ----------------------------------------------------------------------------- terms and names

def test_admin_terms_extend_and_relax_the_name_filter(live_on, login_client, make_client):
    admin, _ = login_client(role="admin")
    student, _ = login_client()
    assert student.post("/api/admin/live/terms", json={"term": "xablau"}).status_code == 403
    added = admin.post("/api/admin/live/terms", json={"term": "Xablau", "kind": "block", "scope": "names"})
    assert added.status_code == 201 and added.json()["term"] == "xablau"
    assert admin.post("/api/admin/live/terms", json={"term": "xablau", "kind": "block", "scope": "names"}).status_code == 409
    # "Pinto" is a surname that the built-in token list blocks: an allow term fixes it.
    assert admin.post("/api/admin/live/terms", json={"term": "pinto", "kind": "allow", "scope": "names"}).status_code == 201

    host, _ = login_client()
    session = host.post("/api/live/sessions", json={"quiz_id": published_quiz(host)["id"]}).json()
    guest = make_client()
    rejected = guest.post(f"/api/live/rooms/{session['join_code']}/join", json={"display_name": "X4blau", "consent": True})
    assert rejected.status_code == 422 and rejected.json()["details"]["reason"] == "offensive"
    assert _join(guest, session["join_code"], "Carlos Pinto")["display_name"] == "Carlos Pinto"

    terms = admin.get("/api/admin/live/terms").json()["items"]
    removed = admin.delete(f"/api/admin/live/terms/{next(t['id'] for t in terms if t['term'] == 'xablau')}")
    assert removed.status_code == 204
    audit = [e["action"] for e in admin.get("/api/admin/live/audit").json()["items"]]
    assert audit.count("term_added") == 2 and "term_removed" in audit


# ----------------------------------------------------------------------------- content moderation

def test_flagged_content_waits_for_an_admin_before_guests(live_on, login_client):
    host, _ = login_client()
    flagged = _publish(host, {**SINGLE, "prompt": "Quem é o maior filho da puta do SOC?"})
    assert flagged["moderation"]["state"] == "flagged"
    assert flagged["moderation"]["findings"][0]["field"] == "prompt"
    quiz_id = flagged["quiz"]["id"]
    pending = host.post("/api/live/sessions", json={"quiz_id": quiz_id})
    assert pending.status_code == 422 and pending.json()["code"] == "moderation_pending"
    assert host.post("/api/live/sessions", json={"quiz_id": quiz_id, "allow_guests": False}).status_code == 201

    reviewer, _ = login_client(role="reviewer")
    cases = reviewer.get("/api/admin/live/cases").json()
    case = next(c for c in cases["items"] if c["quiz_id"] == quiz_id)
    assert case["source"] == "filter" and case["reason"] == "filter_match" and "puta" in case["excerpt"]
    approved = reviewer.post(f"/api/admin/live/cases/{case['id']}/resolve", json={"action": "approve"})
    assert approved.status_code == 200
    assert host.post("/api/live/sessions", json={"quiz_id": quiz_id}).status_code == 201
    assert reviewer.post(f"/api/admin/live/cases/{case['id']}/resolve", json={"action": "dismiss"}).status_code == 409

    clean = _publish(host, SINGLE)
    assert clean["moderation"] == {"state": "clear", "findings": []}


def test_reports_removal_and_block(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _publish(host, SINGLE, {**SINGLE, "prompt": "Segunda pergunta?"})["quiz"]
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"]}).json()
    guest = make_client()
    ana = _join(guest, session["join_code"])
    runtime.start(db, session["id"])

    # Participant report (RF-1104) with a copy of the item.
    bad = guest.post("/api/live/me/report", headers=_auth(ana["token"]), json={"target": "item", "reason": "offensive"})
    assert bad.status_code == 422
    sent = guest.post("/api/live/me/report", headers=_auth(ana["token"]), json={"target": "item", "qi": 0, "reason": "offensive", "note": "ofensivo"})
    assert sent.status_code == 202
    for _ in range(4):
        guest.post("/api/live/me/report", headers=_auth(ana["token"]), json={"target": "session", "reason": "spam"})
    too_many = guest.post("/api/live/me/report", headers=_auth(ana["token"]), json={"target": "session", "reason": "spam"})
    assert too_many.status_code == 429

    reviewer, _ = login_client(role="reviewer")
    cases = reviewer.get("/api/admin/live/cases").json()["items"]
    case = next(c for c in cases if c["position"] == 0)
    assert case["excerpt"].startswith("Qual controle mitiga phishing?") and case["join_code"] == session["join_code"]
    assert reviewer.post(f"/api/admin/live/cases/{case['id']}/resolve", json={"action": "remove_item"}).status_code == 422  # reason
    removed = reviewer.post(f"/api/admin/live/cases/{case['id']}/resolve", json={"action": "remove_item", "note": "conteúdo ofensivo"})
    assert removed.status_code == 200 and removed.json()["sessions_affected"] == [session["id"]]

    # The open question became a neutral placeholder: nothing to answer, nothing scored.
    room = runtime.load_room(db, session["id"])
    assert room.session.phase == "content" and room.items[0]["removed"] is True and room.items[0]["prompt"] == ""
    snapshot = runtime.snapshot(db, room, role="participant", participant_id=ana["participant_id"])
    assert "Qual controle" not in str(snapshot)
    # New sessions of the same version inherit the removal.
    fresh = host.post("/api/live/sessions", json={"quiz_id": quiz["id"]}).json()
    assert runtime.load_room(db, fresh["id"]).items[0]["removed"] is True

    # Blocking needs an admin; it ends the active rooms and stops new ones.
    other = next(c for c in reviewer.get("/api/admin/live/cases").json()["items"] if c["position"] is None)
    assert reviewer.post(f"/api/admin/live/cases/{other['id']}/resolve", json={"action": "block_quiz", "note": "abuso"}).status_code == 403
    admin, _ = login_client(role="admin")
    blocked = admin.post(f"/api/admin/live/cases/{other['id']}/resolve", json={"action": "block_quiz", "note": "abuso repetido"})
    assert set(blocked.json()["sessions_affected"]) == {session["id"], fresh["id"]}
    assert db.get(LiveSession, session["id"], populate_existing=True).status == "finished"
    assert host.post("/api/live/sessions", json={"quiz_id": quiz["id"]}).json()["code"] == "quiz_blocked"
    assert admin.post(f"/api/admin/live/quizzes/{quiz['id']}/unblock", json={"reason": "revisado com o autor"}).status_code == 200


def test_force_end_overview_and_audited_reports(live_on, login_client, make_client, db):
    host, _ = login_client()
    session = host.post("/api/live/sessions", json={"quiz_id": published_quiz(host)["id"]}).json()
    _join(make_client(), session["join_code"])
    reviewer, _ = login_client(role="reviewer")
    admin, _ = login_client(role="admin")
    overview = reviewer.get("/api/admin/live/overview").json()
    row = next(s for s in overview["active_sessions"] if s["id"] == session["id"])
    assert row["participants"] == 1 and row["owner_email"]
    assert reviewer.post(f"/api/admin/live/sessions/{session['id']}/end", json={"reason": "abuso na sala"}).status_code == 403
    assert admin.post(f"/api/admin/live/sessions/{session['id']}/end", json={"reason": "x"}).status_code == 422
    assert admin.post(f"/api/admin/live/sessions/{session['id']}/end", json={"reason": "abuso na sala"}).status_code == 200
    assert admin.post(f"/api/admin/live/sessions/{session['id']}/end", json={"reason": "abuso na sala"}).status_code == 409

    # RF-1110: owner views are audited (deduplicated); admins must state a reason.
    host.get(f"/api/live/sessions/{session['id']}/report")
    host.get(f"/api/live/sessions/{session['id']}/report")
    host.get(f"/api/live/sessions/{session['id']}/export.csv")
    assert admin.get(f"/api/admin/live/sessions/{session['id']}/report").status_code == 422
    assert admin.get(f"/api/admin/live/sessions/{session['id']}/report", params={"reason": "denúncia #12"}).status_code == 200
    actions = [e["action"] for e in admin.get("/api/admin/live/audit", params={"session_id": session["id"]}).json()["items"]]
    assert actions.count("report_view") == 1 and "export_csv" in actions and "admin_report_view" in actions
    assert "force_end" in actions


def test_offensive_typed_answers_are_masked_on_the_projector(live_on, login_client, make_client, db):
    host, _ = login_client()
    quiz = _publish(host, {"item_type": "type_answer", "prompt": "Ataque por SMS?", "accepted_answers": ["smishing"], "time_limit_s": 20})["quiz"]
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"]}).json()
    guest = make_client()
    people = [_join(guest, session["join_code"], name) for name in ("Ana", "Bia")]
    sid = session["id"]
    runtime.start(db, sid)
    for person, text in zip(people, ("smishing", "sua mae puta")):
        runtime.submit_answer(db, sid, participant_id=person["participant_id"], answer_id=str(uuid.uuid4()), qi=0,
                              choice=None, text=text, client_elapsed_ms=None, rtt_min_ms=None)
    top = runtime.reveal_payload(db, runtime.load_room(db, sid), 0)["top_answers"]
    assert {"text": "smishing", "n": 1, "accepted": True} in top
    assert {"text": "•••", "n": 1, "accepted": False, "masked": True} in top


# ----------------------------------------------------------------------------- participant rights

def test_my_data_erase_and_return_code_access(live_on, login_client, make_client, db):
    host, _ = login_client()
    session = host.post("/api/live/sessions", json={"quiz_id": _publish(host, SINGLE)["quiz"]["id"]}).json()
    guest = make_client()
    ana = _join(guest, session["join_code"])
    bia = _join(guest, session["join_code"], "Bia")
    sid = session["id"]
    runtime.start(db, sid)
    assert _answer(db, sid, ana["participant_id"], 0, "Treinamento").status == "accepted"

    mine = guest.get("/api/live/me", headers=_auth(ana["token"])).json()
    assert mine["participant"]["display_name"] == "Ana" and mine["answers"][0]["correct"] is True
    assert mine["claim"] == {"available": False, "reason": "session_active"}
    assert guest.get("/api/live/me").status_code == 401

    runtime.end_session(db, sid)
    # Expired token: name + return code give a fresh one (finished session, RF-613/650).
    bad = guest.post("/api/live/me/access", json={"session_id": sid, "display_name": "Bia", "return_code": "ZZZZZZ"})
    assert bad.status_code == 403
    fresh = guest.post("/api/live/me/access", json={"session_id": sid, "display_name": "bia ", "return_code": bia["return_code"]})
    assert fresh.status_code == 200 and fresh.json()["participant_id"] == bia["participant_id"]
    assert guest.get("/api/live/me", headers=_auth(bia["token"])).status_code == 401  # the old token is superseded

    erased = guest.delete("/api/live/me", headers=_auth(ana["token"]))
    assert erased.status_code == 200
    assert guest.get("/api/live/me", headers=_auth(ana["token"])).status_code == 401
    participant = db.get(LiveParticipant, ana["participant_id"], populate_existing=True)
    assert participant.erased_at is not None and participant.display_name != "Ana" and participant.token_hash is None
    report = host.get(f"/api/live/sessions/{sid}/report").json()
    assert [p["display_name"] for p in report["participants"]] == ["Bia"]
    denied = guest.post("/api/live/me/access", json={"session_id": sid, "display_name": "Ana", "return_code": ana["return_code"]})
    assert denied.status_code == 403
    assert db.query(LiveAuditEvent).filter(LiveAuditEvent.action == "participant_erased").count() == 1


def test_return_code_guessing_is_limited(live_on, login_client, make_client):
    host, _ = login_client()
    session = host.post("/api/live/sessions", json={"quiz_id": published_quiz(host)["id"]}).json()
    guest = make_client()
    _join(guest, session["join_code"])
    statuses = [
        guest.post("/api/live/me/access", json={"session_id": session["id"], "display_name": "Ana", "return_code": f"BAD{i:03d}"}).status_code
        for i in range(11)
    ]
    assert statuses[:10] == [403] * 10 and statuses[10] == 429


def test_claim_links_guest_answers_to_the_account(live_on, login_client, make_client, db):
    question_id = seed_question(db, question_id="q-claim")
    from app.models import Question, UserQuestionProgress

    db.get(Question, question_id).license_scope = "own"
    db.commit()
    host, _ = login_client()
    quiz = create_quiz(host, settings={"reading_phase_s": 0, "leaderboard_every": 0})
    quiz = host.post(f"/api/live/quizzes/{quiz['id']}/items/from-bank",
                     json={"expected_version": quiz["version"], "question_ids": [question_id]}).json()["quiz"]
    host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"]}).json()
    guest = make_client()
    ana = _join(guest, session["join_code"])
    sid = session["id"]
    runtime.start(db, sid)
    room = runtime.load_room(db, sid)
    correct = next(o["id"] for o in live_items.public_question(sid, 0, room.items[0])["options"] if o["index"] == 0)
    runtime.submit_answer(db, sid, participant_id=ana["participant_id"], answer_id=str(uuid.uuid4()), qi=0,
                          choice=[correct], text=None, client_elapsed_ms=None, rtt_min_ms=None)

    member, user = login_client()
    early = member.post("/api/live/me/claim", json={"token": ana["token"]})
    assert early.status_code == 409 and early.json()["code"] == "claim_session_active"
    runtime.end_session(db, sid)
    assert make_client().post("/api/live/me/claim", json={"token": ana["token"]}).status_code == 401  # needs an account
    claimed = member.post("/api/live/me/claim", json={"token": ana["token"]})
    assert claimed.status_code == 200 and claimed.json() == {"claimed": True, "bank_answers_recorded": 1}
    progress = db.query(UserQuestionProgress).filter_by(user_id=user.id, question_id=question_id).one()
    assert progress.total_attempts == 1
    assert member.post("/api/live/me/claim", json={"token": ana["token"]}).json()["code"] == "claim_already_linked"

    # After 7 days the offer expires.
    other = host.post("/api/live/sessions", json={"quiz_id": quiz["id"]}).json()
    bia = _join(guest, other["join_code"], "Bia")
    runtime.end_session(db, other["id"])
    db.get(LiveSession, other["id"]).ended_at = utcnow() - timedelta(days=8)
    db.commit()
    assert member.post("/api/live/me/claim", json={"token": bia["token"]}).json()["code"] == "claim_expired"


# ----------------------------------------------------------------------------- preview, preflight, retention

def test_participant_preview_in_rehearsal(live_on, login_client, db):
    host, _ = login_client()
    quiz_id = published_quiz(host)["id"]
    live = host.post("/api/live/sessions", json={"quiz_id": quiz_id}).json()
    assert host.post(f"/api/live/sessions/{live['id']}/preview").json()["code"] == "preview_requires_rehearsal"
    rehearsal = host.post("/api/live/sessions", json={"quiz_id": quiz_id, "rehearsal": True, "bots": 2}).json()
    first = host.post(f"/api/live/sessions/{rehearsal['id']}/preview")
    assert first.status_code == 201 and first.json()["display_name"] == "Prévia" and first.json()["token"]
    again = host.post(f"/api/live/sessions/{rehearsal['id']}/preview").json()
    assert again["participant_id"] == first.json()["participant_id"]  # reused
    from app.services import live_results

    report = live_results.build_report(db, db.get(LiveSession, rehearsal["id"]))
    assert report["kpis"]["participants"] == 0  # bots and the preview never reach reports


def test_preflight_reports_readiness(live_on, login_client, make_client):
    host, _ = login_client()
    session = host.post("/api/live/sessions", json={"quiz_id": published_quiz(host)["id"]}).json()
    result = host.get(f"/api/live/sessions/{session['id']}/preflight").json()
    checks = {c["key"]: c for c in result["checks"]}
    assert {"database", "capacity", "content", "realtime_bus", "rate_limit", "token_keys", "event_loop"} <= set(checks)
    assert checks["content"]["status"] == "ok" and checks["database"]["status"] in {"ok", "warn"}
    assert result["status"] in {"ready", "attention"} and result["large_room"] is True  # default cap is 1,000
    stranger, _ = login_client()
    assert stranger.get(f"/api/live/sessions/{session['id']}/preflight").status_code == 404

    flagged = _publish(host, {**SINGLE, "prompt": "Pergunta de merda?"})["quiz"]
    login_only = host.post("/api/live/sessions", json={"quiz_id": flagged["id"], "allow_guests": False}).json()
    content = {c["key"]: c for c in host.get(f"/api/live/sessions/{login_only['id']}/preflight").json()["checks"]}["content"]
    assert content == {"key": "content", "status": "warn", "detail": "moderation_pending"}


def test_retention_anonymizes_then_purges_with_a_report_snapshot(live_on, login_client, make_client, db):
    from app.services import live_retention

    host, _ = login_client()
    session = host.post("/api/live/sessions", json={"quiz_id": _publish(host, SINGLE)["quiz"]["id"]}).json()
    guest = make_client()
    ana = _join(guest, session["join_code"])
    sid = session["id"]
    runtime.start(db, sid)
    _answer(db, sid, ana["participant_id"], 0, "Treinamento")
    runtime.end_session(db, sid)
    before = host.get(f"/api/live/sessions/{sid}/report").json()
    assert before["retention"] == {"events_purged_at": None, "snapshot": False}

    now = utcnow()
    assert live_retention.run(db, now=now)["sessions_anonymized"] == 0  # too recent
    names = live_retention.run(db, now=now + timedelta(days=181))
    assert names["sessions_anonymized"] == 1 and names["sessions_purged"] == 0
    participant = db.get(LiveParticipant, ana["participant_id"], populate_existing=True)
    assert participant.display_name == "Participante 1" and participant.return_code_hash is None

    purge = live_retention.run(db, now=now + timedelta(days=366))
    assert purge["sessions_purged"] == 1 and purge["events_deleted"] == 1
    assert db.query(LiveAnswerEvent).filter_by(session_id=sid).count() == 0
    after = host.get(f"/api/live/sessions/{sid}/report").json()
    assert after["retention"]["snapshot"] is True
    assert after["kpis"]["participants"] == 1 and after["participants"][0]["display_name"] == "Participante 1"
    assert after["items"][0]["answered"] == before["items"][0]["answered"]
    assert live_retention.run(db, now=now + timedelta(days=400))["sessions_purged"] == 0  # idempotent
    assert db.query(LiveAuditEvent).filter(LiveAuditEvent.action.in_(["retention_anonymize", "retention_purge"])).count() == 2
