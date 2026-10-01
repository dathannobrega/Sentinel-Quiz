"""Sentinel Arena REST API: authoring, bank, publishing, sessions and guest join."""
from __future__ import annotations

import pytest

from app.core.config import settings
from tests.conftest import seed_question
from tests.live_helpers import add_item, create_quiz, live_on, published_quiz  # noqa: F401


def test_capabilities_reflect_flag_and_policy(client, login_client, monkeypatch):
    assert client.get("/api/live/capabilities").json()["reason"] == "live_disabled"
    monkeypatch.setattr(settings, "live_enabled", True)
    assert client.get("/api/live/capabilities").json()["reason"] == "auth_required"
    host, user = login_client()
    body = host.get("/api/live/capabilities").json()
    assert body["can_host"] is False and body["reason"] == "not_allowlisted"
    monkeypatch.setattr(settings, "live_host_allowlist", user.email.upper())
    assert host.get("/api/live/capabilities").json()["can_host"] is True
    assert "single_choice" in body["item_types"] and body["limits"]["options_max"] == 6


def test_authoring_requires_host(client, login_client, monkeypatch):
    monkeypatch.setattr(settings, "live_enabled", True)
    assert client.get("/api/live/quizzes").status_code == 401
    host, _ = login_client()
    assert host.get("/api/live/quizzes").status_code == 403


def test_quiz_crud_versioning_and_isolation(live_on, login_client):
    host, _ = login_client()
    quiz = create_quiz(host)
    assert quiz["version"] == 1 and quiz["items"] == [] and quiz["has_unpublished_changes"] is True
    quiz = add_item(host, quiz, item_type="single_choice", prompt="P1", options=[{"text": "a", "correct": True}, {"text": "b"}])
    quiz = add_item(host, quiz, item_type="content", body="Intervalo", position=0)
    assert [i["item_type"] for i in quiz["items"]] == ["content", "single_choice"]
    assert quiz["items"][1]["options"][0] == {"key": "A", "text": "a", "correct": True}

    stale = host.patch(f"/api/live/quizzes/{quiz['id']}", json={"expected_version": 1, "title": "x"})
    assert stale.status_code == 409 and stale.json()["code"] == "version_conflict"

    item_id = quiz["items"][1]["id"]
    quiz = host.patch(
        f"/api/live/quizzes/{quiz['id']}/items/{item_id}",
        json={"expected_version": quiz["version"], "item_type": "multi_choice"},
    ).json()
    assert quiz["items"][1]["item_type"] == "multi_choice" and quiz["items"][1]["options"][0]["correct"] is True

    ids = [i["id"] for i in quiz["items"]][::-1]
    quiz = host.post(f"/api/live/quizzes/{quiz['id']}/items/reorder", json={"expected_version": quiz["version"], "item_ids": ids}).json()
    assert [i["id"] for i in quiz["items"]] == ids
    bad = host.post(f"/api/live/quizzes/{quiz['id']}/items/reorder", json={"expected_version": quiz["version"], "item_ids": ids[:1]})
    assert bad.status_code == 422

    too_long = host.patch(
        f"/api/live/quizzes/{quiz['id']}/items/{item_id}", json={"expected_version": quiz["version"], "prompt": "x" * 401}
    )
    assert too_long.status_code == 422

    quiz = host.delete(f"/api/live/quizzes/{quiz['id']}/items/{ids[0]}?expected_version={quiz['version']}").json()
    assert len(quiz["items"]) == 1 and quiz["items"][0]["position"] == 0

    other, _ = login_client()
    assert other.get(f"/api/live/quizzes/{quiz['id']}").status_code == 404
    dup = host.post(f"/api/live/quizzes/{quiz['id']}/duplicate")
    assert dup.status_code == 201 and dup.json()["title"].endswith("(cópia)") and len(dup.json()["items"]) == 1
    assert host.delete(f"/api/live/quizzes/{quiz['id']}").status_code == 204
    assert [q["id"] for q in host.get("/api/live/quizzes").json()["items"]] == [dup.json()["id"]]


def test_publish_validation_and_snapshot(live_on, login_client):
    host, _ = login_client()
    quiz = create_quiz(host)
    empty = host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
    assert empty.status_code == 422 and empty.json()["details"]["issues"][0]["code"] == "empty"
    quiz = add_item(host, quiz, item_type="single_choice", prompt="P", options=[{"text": "a"}, {"text": "b"}])
    invalid = host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
    codes = {issue["code"] for issue in invalid.json()["details"]["issues"]}
    assert invalid.status_code == 422 and "no_correct" in codes
    item_id = quiz["items"][0]["id"]
    quiz = host.patch(
        f"/api/live/quizzes/{quiz['id']}/items/{item_id}",
        json={"expected_version": quiz["version"], "options": [{"text": "a", "correct": True}, {"text": "b"}], "time_limit_s": None},
    ).json()
    ok = host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
    assert ok.status_code == 200
    body = ok.json()
    assert body["version_no"] == 1 and body["quiz"]["has_unpublished_changes"] is False
    assert any(w["code"] == "no_timer" for w in body["warnings"])


def test_bank_search_and_import_respect_licence(live_on, login_client, db):
    own = seed_question(db, question_id="q-own")
    pending = seed_question(db, question_id="q-pending")
    private = seed_question(db, question_id="q-private")
    from app.models import Question

    db.get(Question, own).license_scope = "own"
    db.get(Question, private).license_scope = "personal_use"
    db.commit()
    host, _ = login_client()
    found = host.get("/api/live/bank/search").json()
    ids = {item["question_id"]: item for item in found["items"]}
    assert set(ids) == {own, pending} and found["total"] == 2
    assert ids[own]["guest_eligible"] is True and ids[pending]["guest_eligible"] is False
    assert "correct" not in str(ids[own]["options"])
    assert host.get("/api/live/bank/search?only_guest_eligible=true").json()["total"] == 1
    facets = host.get("/api/live/bank/facets").json()
    assert facets["certifications"][0]["count"] == 2

    quiz = create_quiz(host)
    result = host.post(
        f"/api/live/quizzes/{quiz['id']}/items/from-bank",
        json={"expected_version": quiz["version"], "question_ids": [own, pending, private, "nope"]},
    ).json()
    reasons = {r["question_id"]: r["reason"] for r in result["rejected"]}
    assert reasons == {private: "license_personal_use", "nope": "not_found"}
    items = result["quiz"]["items"]
    assert [i["source_kind"] for i in items] == ["bank", "bank"]
    assert items[0]["options"][0]["correct"] is True and items[0]["explanation"]
    assert {i["license_scope"] for i in items} == {"own", "pending_audit"}
    quiz = result["quiz"]
    published = host.post(f"/api/live/quizzes/{quiz['id']}/publish", json={"expected_version": quiz["version"]})
    assert published.status_code == 200

    gated = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], "allow_guests": True})
    assert gated.status_code == 422 and gated.json()["code"] == "license_requires_login"
    assert gated.json()["details"]["items"][0]["license_scope"] == "pending_audit"
    login_only = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], "allow_guests": False})
    assert login_only.status_code == 201 and login_only.json()["allow_guests"] is False


def test_session_lifecycle_and_guest_join(live_on, login_client, make_client):
    host, _ = login_client()
    quiz = create_quiz(host)
    not_published = host.post("/api/live/sessions", json={"quiz_id": quiz["id"]})
    assert not_published.status_code == 409
    quiz = published_quiz(host)
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], "max_participants": 2}).json()
    code = session["join_code"]
    assert len(code) == 6 and code[0] != "0" and session["join_url"].endswith(f"/j/{code}")
    assert host.get(f"/api/live/sessions/{session['id']}/qr.svg").headers["content-type"].startswith("image/svg")

    guest = make_client()
    info = guest.get(f"/api/live/rooms/{code}").json()
    assert info["requires_login"] is False and info["accepting_joins"] is True and info["title"]
    assert guest.get("/api/live/rooms/000000").status_code == 404

    assert guest.post(f"/api/live/rooms/{code}/join", json={"display_name": "Ana", "consent": False}).status_code == 422
    rejected = guest.post(f"/api/live/rooms/{code}/join", json={"display_name": "Puta", "consent": True})
    assert rejected.status_code == 422 and rejected.json()["details"]["reason"] == "offensive"
    joined = guest.post(f"/api/live/rooms/{code}/join", json={"display_name": "Ana", "consent": True})
    assert joined.status_code == 201
    ana = joined.json()
    assert ana["token"].startswith("v1.") and len(ana["return_code"]) == 6
    taken = guest.post(f"/api/live/rooms/{code}/join", json={"display_name": "ANA ", "consent": True})
    assert taken.status_code == 409 and taken.json()["details"]["suggestion"]

    # A logged-in participant is linked to the account and re-joining reuses the seat.
    member, _ = login_client()
    first = member.post(f"/api/live/rooms/{code}/join", json={"display_name": "Bia", "consent": True}).json()
    again = member.post(f"/api/live/rooms/{code}/join", json={"display_name": "Bia", "consent": True}).json()
    assert first["participant_id"] == again["participant_id"] and first["return_code"] is None

    # Full room (GA): the next person waits for a seat instead of being turned away.
    full = guest.post(f"/api/live/rooms/{code}/join", json={"display_name": "Caio", "consent": True})
    assert full.status_code == 202 and full.json()["status"] == "waiting" and full.json()["reason"] == "capacity"

    wrong = guest.post(f"/api/live/rooms/{code}/rejoin", json={"display_name": "Ana", "return_code": "ZZZZZZ"})
    assert wrong.status_code == 403
    back = guest.post(f"/api/live/rooms/{code}/rejoin", json={"display_name": "ana", "return_code": ana["return_code"].lower()})
    assert back.status_code == 200 and back.json()["participant_id"] == ana["participant_id"]
    # The previous token was superseded.
    stale = guest.get("/api/live/me/results", headers={"Authorization": f"Bearer {ana['token']}"})
    assert stale.status_code == 401
    mine = guest.get("/api/live/me/results", headers={"Authorization": f"Bearer {back.json()['token']}"})
    assert mine.status_code == 200 and mine.json()["display_name"] == "Ana"

    display = host.post(f"/api/live/sessions/{session['id']}/display-token").json()
    assert display["token"].startswith("v1.")
    ended = host.post(f"/api/live/sessions/{session['id']}/end").json()
    assert ended["status"] == "finished"
    assert guest.get(f"/api/live/rooms/{code}").status_code == 404  # PIN released
    report = host.get(f"/api/live/sessions/{session['id']}/report").json()
    assert report["kpis"]["participants"] == 2
    assert host.get(f"/api/live/sessions?quiz_id={quiz['id']}").json()["items"][0]["id"] == session["id"]


def test_room_requiring_login(live_on, login_client, make_client):
    host, _ = login_client()
    quiz = published_quiz(host)
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], "allow_guests": False}).json()
    anon = make_client()
    denied = anon.post(f"/api/live/rooms/{session['join_code']}/join", json={"display_name": "Ana", "consent": True})
    assert denied.status_code == 401 and denied.json()["code"] == "login_required"


def test_minor_audience_uses_generated_names(live_on, login_client, make_client):
    host, _ = login_client()
    quiz = published_quiz(host)
    session = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], "audience": "infantojuvenil"}).json()
    joined = make_client().post(
        f"/api/live/rooms/{session['join_code']}/join", json={"display_name": "Maria Silva", "consent": True}
    ).json()
    assert joined["display_name"] != "Maria Silva"


def test_public_routes_hidden_when_disabled(client):
    assert client.get("/api/live/rooms/123456").status_code == 404
    assert client.get("/api/live/rooms/123456").json()["code"] == "live_disabled"


@pytest.mark.parametrize("path", ["/api/live/names/suggest", "/api/live/names/suggest?lang=en"])
def test_name_suggestion(live_on, client, path):
    assert len(client.get(path).json()["name"]) >= 3


def test_live_rate_limits_are_per_room_and_token_not_per_ip(live_on, login_client):
    """RNF-205 / DC-22: a whole room behind one IP joins; code guessing is limited per IP."""
    from fastapi.testclient import TestClient

    from app.core.config import Settings
    from app.main import create_app

    host, _ = login_client()
    quiz = published_quiz(host)
    code = host.post("/api/live/sessions", json={"quiz_id": quiz["id"], "max_participants": 50}).json()["join_code"]
    limited = create_app(Settings(
        _env_file=None, RATE_LIMIT_PUBLIC_REQUESTS=2, ABUSE_SIGNAL_ENABLED=False, CORS_ORIGINS="http://localhost:3000",
        RATE_LIMIT_LIVE_TOKEN_REQUESTS=2, LIVE_INVALID_CODE_LIMIT=3,
    ))
    with TestClient(limited) as guests:  # every request comes from the same address
        assert guests.get(f"/api/live/rooms/{code}").status_code == 200
        tokens = []
        for i in range(12):
            joined = guests.post(f"/api/live/rooms/{code}/join", json={"display_name": f"Aluno {i}", "consent": True})
            assert joined.status_code == 201, joined.text
            tokens.append(joined.json()["token"])

        # /me/* is limited per participant token.
        me = [guests.get("/api/live/me/results", headers={"Authorization": f"Bearer {tokens[0]}"}).status_code for _ in range(3)]
        assert me[2] == 429
        assert guests.get("/api/live/me/results", headers={"Authorization": f"Bearer {tokens[1]}"}).status_code != 429

        # Guessing codes: after 3 unknown codes this IP is blocked from new codes...
        wrong = "999999" if code != "999999" else "888888"
        assert [guests.get(f"/api/live/rooms/{wrong}").status_code for _ in range(3)] == [404, 404, 404]
        blocked = guests.get("/api/live/rooms/123123")
        assert blocked.status_code == 429 and blocked.json()["code"] == "too_many_invalid_codes"
        assert blocked.headers["Retry-After"]
        # ...but the room it already reached keeps working (a typo in class does not lock everyone out).
        assert guests.get(f"/api/live/rooms/{code}").status_code == 200
        assert guests.post(f"/api/live/rooms/{code}/join", json={"display_name": "Atrasado", "consent": True}).status_code == 201


def test_finished_known_room_is_not_a_guess(live_on, login_client):
    """After a session ends, everyone reloading its code gets 404 - that is not code guessing."""
    from fastapi.testclient import TestClient

    from app.core.config import Settings
    from app.main import create_app

    host, _ = login_client()
    session = host.post("/api/live/sessions", json={"quiz_id": published_quiz(host)["id"]}).json()
    limited = create_app(Settings(_env_file=None, ABUSE_SIGNAL_ENABLED=False, LIVE_INVALID_CODE_LIMIT=3))
    with TestClient(limited) as guests:
        assert guests.get(f"/api/live/rooms/{session['join_code']}").status_code == 200
        host.post(f"/api/live/sessions/{session['id']}/end")
        assert [guests.get(f"/api/live/rooms/{session['join_code']}").status_code for _ in range(5)] == [404] * 5
        fresh = host.post("/api/live/sessions", json={"quiz_id": published_quiz(host)["id"]}).json()
        assert guests.get(f"/api/live/rooms/{fresh['join_code']}").status_code == 200  # the NAT is not locked out


def test_live_rate_limit_buckets():
    from app.core.config import Settings
    from app.middleware.rate_limit import RateLimitMiddleware

    mw = RateLimitMiddleware(lambda *a: None, Settings(_env_file=None))
    assert mw._resolve_policy("/api/live/rooms/123 456")[0::2] == ("live_room", "123456")
    assert mw._resolve_policy("/api/live/rooms/123456/join", "POST")[0::2] == ("live_room", "123456")
    assert mw._resolve_policy("/api/live/rooms/123456/rejoin", "POST")[0] == "live_room"
    bucket, _, scope = mw._resolve_policy("/api/live/me/results", "GET", "Bearer v1.abc")
    assert bucket == "live_token" and scope and "abc" not in scope
    assert mw._resolve_policy("/api/live/me/results")[0] == "live_ip"
    assert mw._resolve_policy("/api/live/names/suggest")[0] == "live_ip"
    assert mw._resolve_policy("/api/live/sessions")[0] == "public"
    assert mw._resolve_policy("/api/live/quizzes/x/items", "POST")[0] == "public"
