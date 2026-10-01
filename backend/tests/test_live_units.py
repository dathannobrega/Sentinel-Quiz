"""Sentinel Arena unit tests: licensing, names, tokens, item grading and scoring."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services import licensing, live_items, live_names, live_scoring, live_tokens


# ----------------------------------------------------------------------------- licensing

@pytest.mark.parametrize(
    ("question", "exam", "path", "expected"),
    [
        ({}, {}, "securityplus.json", "pending_audit"),
        ({"usage_restriction": "personal_use"}, {}, "x.json", "personal_use"),
        ({}, {}, "local/ceh.json", "personal_use"),
        ({"license_scope": "own"}, {}, "local/ceh.json", "personal_use"),  # local always wins
        ({"source_repo": "https://github.com/a/b", "source_license": "NOASSERTION"}, {}, "imports/a.json", "platform"),
        ({"license_scope": "own"}, {}, "cissp.json", "own"),
        ({}, {"license_scope": "own"}, "cissp.json", "own"),
        ({"license_scope": "bogus"}, {}, "cissp.json", "pending_audit"),
    ],
)
def test_classify_license_scope(question, exam, path, expected):
    scope, _license = licensing.classify_license_scope(question, exam=exam, source_path=path)
    assert scope == expected


def test_allowed_scopes_fail_closed_for_guests():
    assert licensing.allowed_scopes(allow_guests=True, platform_guest_ok=False) == {"own"}
    assert licensing.allowed_scopes(allow_guests=True, platform_guest_ok=True) == {"own", "platform"}
    assert "personal_use" not in licensing.allowed_scopes(allow_guests=False, platform_guest_ok=True)
    assert "pending_audit" in licensing.allowed_scopes(allow_guests=False, platform_guest_ok=False)


# ----------------------------------------------------------------------------- names

@pytest.mark.parametrize("name", ["Ana", "Firewall Veloz", "Scunthorpe", "Classe A", "Assis", "José 2"])
def test_names_accepted(name):
    display, key = live_names.validate_display_name(name)
    assert display == name and key


@pytest.mark.parametrize(
    ("name", "reason"),
    [("x", "too_short"), ("a" * 25, "too_long"), ("Puta", "offensive"), ("p0rr4", "offensive"), ("F.u.c.k", "offensive"), ("!!", "too_short")],
)
def test_names_rejected(name, reason):
    with pytest.raises(live_names.NameRejected) as info:
        live_names.validate_display_name(name)
    assert info.value.code in {reason, "invalid"}


def test_nickname_key_folds_case_accents_and_leet():
    assert live_names.nickname_key("Ána") == live_names.nickname_key("4NA ") == "ana"


def test_suggested_names_are_valid():
    for lang in ("pt-BR", "en"):
        for _ in range(30):
            live_names.validate_display_name(live_names.suggest_name(lang))


# ----------------------------------------------------------------------------- tokens

def test_token_roundtrip_and_tamper(monkeypatch):
    monkeypatch.setattr(live_tokens.settings, "live_token_keys", "k1:" + "s" * 40)
    token, claims = live_tokens.issue_token(session_id="sess", role="participant", ttl_seconds=60, participant_id="p1")
    parsed = live_tokens.verify_token(token)
    assert parsed == claims
    head, kid, body, sig = token.split(".")
    with pytest.raises(live_tokens.LiveTokenError):
        live_tokens.verify_token(".".join([head, kid, body, sig[:-2] + ("AA" if sig[-2:] != "AA" else "BB")]))
    with pytest.raises(live_tokens.LiveTokenError) as info:
        live_tokens.verify_token(token, now=claims.exp + 1)
    assert info.value.code == "expired"


def test_token_key_rotation(monkeypatch):
    monkeypatch.setattr(live_tokens.settings, "live_token_keys", "old:" + "o" * 40)
    token, _ = live_tokens.issue_token(session_id="s", role="display", ttl_seconds=60)
    monkeypatch.setattr(live_tokens.settings, "live_token_keys", "new:" + "n" * 40 + ",old:" + "o" * 40)
    assert live_tokens.verify_token(token).role == "display"
    monkeypatch.setattr(live_tokens.settings, "live_token_keys", "new:" + "n" * 40)
    with pytest.raises(live_tokens.LiveTokenError):
        live_tokens.verify_token(token)


def test_parse_token_keys_rejects_weak_secret():
    with pytest.raises(ValueError):
        live_tokens.parse_token_keys("k1:short")


# ----------------------------------------------------------------------------- items

def _snapshot(item_type, options=None, correct=None, **extra):
    payload = {"options": [{"key": k, "text": t} for k, t in (options or [])]}
    payload.update(extra.pop("payload", {}))
    return {"item_type": item_type, "prompt": "Q", "payload": payload, "answer": {"correct_keys": correct or [], **extra.pop("answer", {})}, "points_multiplier": 1, "time_limit_s": 20}


def test_public_question_never_leaks_answer_key():
    snap = _snapshot("single_choice", [("A", "x"), ("B", "y")], ["B"], payload={}, answer={})
    public = live_items.public_question("s1", 0, snap)
    assert "answer" not in public and "correct" not in str(public)
    assert [o["index"] for o in public["options"]] == [0, 1]
    assert all(o["id"].startswith("o_") and o["id"] not in {"A", "B"} for o in public["options"])
    # ids are per session
    assert live_items.public_question("s2", 0, snap)["options"][0]["id"] != public["options"][0]["id"]


def test_grade_single_and_multi():
    single = _snapshot("single_choice", [("A", "x"), ("B", "y")], ["B"])
    ids = {v: k for k, v in live_items.option_id_map("s", 0, single).items()}
    assert live_items.grade("s", 0, single, choice=[ids["B"]], text=None).fraction == 1.0
    assert live_items.grade("s", 0, single, choice=[ids["A"]], text=None).fraction == 0.0
    with pytest.raises(live_items.InvalidAnswer):
        live_items.grade("s", 0, single, choice=[ids["A"], ids["B"]], text=None)
    with pytest.raises(live_items.InvalidAnswer):
        live_items.grade("s", 0, single, choice=["o_forged"], text=None)

    multi = _snapshot("multi_choice", [("A", "a"), ("B", "b"), ("C", "c"), ("D", "d")], ["A", "B"])
    mids = {v: k for k, v in live_items.option_id_map("s", 1, multi).items()}
    assert live_items.grade("s", 1, multi, choice=[mids["A"], mids["B"]], text=None).fraction == 1.0
    assert live_items.grade("s", 1, multi, choice=[mids["A"]], text=None).fraction == 0.5
    assert live_items.grade("s", 1, multi, choice=[mids["A"], mids["C"]], text=None).fraction == 0.0
    strict = _snapshot("multi_choice", [("A", "a"), ("B", "b"), ("C", "c")], ["A", "B"], payload={"all_or_nothing": True})
    sids = {v: k for k, v in live_items.option_id_map("s", 2, strict).items()}
    assert live_items.grade("s", 2, strict, choice=[sids["A"]], text=None).fraction == 0.0


def test_grade_type_answer_normalizes():
    snap = _snapshot("type_answer", answer={"accepted_answers": ["Phishing", "spear phishing"]})
    assert live_items.grade("s", 0, snap, choice=None, text="  PHÍSHING! ").fraction == 1.0
    assert live_items.grade("s", 0, snap, choice=None, text="vishing").fraction == 0.0
    with pytest.raises(live_items.InvalidAnswer):
        live_items.grade("s", 0, snap, choice=None, text="")


def test_grade_poll_has_no_fraction():
    snap = _snapshot("poll", [("A", "x"), ("B", "y")], payload={"allow_multiple": True})
    ids = list(live_items.option_id_map("s", 0, snap))
    graded = live_items.grade("s", 0, snap, choice=ids, text=None)
    assert graded.fraction is None and graded.response == {"keys": ["A", "B"]}


def test_apply_write_limits_and_publish_issues():
    payload, answer = live_items.default_payload("single_choice")
    with pytest.raises(live_items.ItemInputError):
        live_items.apply_write("single_choice", {"prompt": "x" * 401}, payload=payload, answer=answer)
    with pytest.raises(live_items.ItemInputError):
        live_items.apply_write("single_choice", {"time_limit_s": 3}, payload=payload, answer=answer)
    values = live_items.apply_write(
        "single_choice", {"prompt": "P", "options": [{"text": "a"}, {"text": "a", "correct": True}]}, payload=payload, answer=answer
    )
    issues = {i.code for i in live_items.publish_issues("single_choice", prompt="P", payload=values["payload_json"], answer=values["answer_json"], time_limit_s=20)}
    assert "duplicate_option" in issues
    tf = live_items.apply_write("true_false", {"options": [{"key": "F", "correct": True}]}, payload={}, answer={})
    assert [o["key"] for o in tf["payload_json"]["options"]] == ["T", "F"] and tf["answer_json"]["correct_keys"] == ["F"]


def test_bank_conversion():
    assert live_items.bank_conversion([{"text": "a"}] * 7, False) == (None, "too_many_options")
    assert live_items.bank_conversion([{"text": "Verdadeiro"}, {"text": "Falso"}], False)[0] == "true_false"
    assert live_items.bank_conversion([{"text": "a"}, {"text": "b"}, {"text": "c"}], True)[0] == "multi_choice"


# ----------------------------------------------------------------------------- scoring

def test_points_formula():
    assert live_scoring.points_for(fraction=1.0, scoring="speed", multiplier=1, elapsed_ms=200, time_limit_s=20) == 1000
    assert live_scoring.points_for(fraction=1.0, scoring="speed", multiplier=1, elapsed_ms=20000, time_limit_s=20) == 500
    assert live_scoring.points_for(fraction=1.0, scoring="speed", multiplier=2, elapsed_ms=10000, time_limit_s=20) == 1500
    assert live_scoring.points_for(fraction=0.5, scoring="fixed", multiplier=1, elapsed_ms=19000, time_limit_s=20) == 500
    assert live_scoring.points_for(fraction=1.0, scoring="none", multiplier=1, elapsed_ms=0, time_limit_s=20) == 0
    assert live_scoring.points_for(fraction=0.0, scoring="speed", multiplier=1, elapsed_ms=0, time_limit_s=20) == 0
    assert live_scoring.credited_elapsed_ms(1000, 900) == 700  # credit capped at 300 ms


class _Ev:
    def __init__(self, position, pid, points, fraction, ms, event_type="submitted"):
        self.position, self.participant_id, self.points = position, pid, points
        self.score_fraction, self.server_ms, self.event_type = fraction, ms, event_type
        self.is_correct = fraction == 1
        self.response_json = {}


def test_standings_tiebreak_streak_and_host_accept():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    people = [
        live_scoring.ParticipantRow("a", "Ana", "x", t0),
        live_scoring.ParticipantRow("b", "Bia", "y", t0 + timedelta(seconds=1)),
        live_scoring.ParticipantRow("c", "Caio", "z", t0 + timedelta(seconds=2)),
    ]
    events = [
        _Ev(0, "a", 900, 1.0, 1000), _Ev(0, "b", 900, 1.0, 900), _Ev(0, "c", 0, 0.0, 500),
        _Ev(1, "a", 800, 1.0, 1000), _Ev(1, "b", 800, 1.0, 1000),
        _Ev(1, "c", 0, 0.0, 300), _Ev(1, "c", 700, 1.0, 300, "host_accepted"),
    ]
    answers = live_scoring.effective_answers(events)
    board = live_scoring.compute_standings(people, answers, scored_positions=[0, 1], streak_bonus=False)
    assert [s.participant_id for s in board] == ["b", "a", "c"]  # tie on points: faster corrects win
    assert board[2].score == 700
    bonus = live_scoring.compute_standings(people, answers, scored_positions=[0, 1], streak_bonus=True)
    assert bonus[0].score == 1800 and bonus[0].best_streak == 2


def test_dev_key_is_shared_by_every_worker(monkeypatch):
    # Without LIVE_TOKEN_KEYS (dev), all uvicorn workers must derive the same key.
    monkeypatch.setattr(live_tokens.settings, "live_token_keys", "")
    assert live_tokens._keys() == live_tokens._keys()
    token, _ = live_tokens.issue_token(session_id="s", role="display", ttl_seconds=60)
    assert live_tokens.verify_token(token).session_id == "s"
    monkeypatch.setattr(live_tokens.settings, "database_url", "sqlite:///other.db")
    with pytest.raises(live_tokens.LiveTokenError):
        live_tokens.verify_token(token)


def test_redis_bus_retries_publish_and_recovers(monkeypatch):
    """RNF-305: a publish survives a short Redis blip; the reader rebuilds the pub/sub,
    re-subscribes every room and runs the recovery hooks (local sockets get snapshots)."""
    import asyncio

    from app.live import bus as bus_module

    monkeypatch.setattr(bus_module, "PUBLISH_RETRY_DELAYS", (0.0, 0.0))

    class FakePubSub:
        def __init__(self) -> None:
            self.subscribed: list[str] = []

        async def subscribe(self, *channels: str) -> None:
            self.subscribed.extend(channels)

        async def aclose(self) -> None:
            return None

    class FakeRedis:
        def __init__(self) -> None:
            self.failures = 2
            self.published: list[str] = []

        async def publish(self, channel: str, data: str) -> None:
            if self.failures:
                self.failures -= 1
                raise ConnectionError("redis restarting")
            self.published.append(channel)

        def pubsub(self, **_: object) -> FakePubSub:
            return FakePubSub()

    async def scenario() -> None:
        live_bus = bus_module.RedisLiveBus.__new__(bus_module.RedisLiveBus)
        live_bus._redis = FakeRedis()
        live_bus._pubsub = FakePubSub()
        live_bus._handlers = {"s1": [lambda payload: None]}
        live_bus._reader = None
        live_bus._lock = asyncio.Lock()
        live_bus._recovered_hooks = []
        recovered: list[bool] = []

        async def hook() -> None:
            recovered.append(True)

        live_bus.on_recovered(hook)
        await live_bus.publish("s1", {"control": "dirty"})
        assert live_bus._redis.published == [bus_module.channel_name("s1")]

        live_bus._redis.failures = 5
        try:
            await live_bus.publish("s1", {"control": "dirty"})
        except ConnectionError:
            pass
        else:  # pragma: no cover
            raise AssertionError("a long outage must surface to the caller")

        assert await live_bus._reconnect(0.0) == 0.5
        assert live_bus._pubsub.subscribed == [bus_module.channel_name("s1")] and recovered == [True]

    asyncio.run(scenario())


def test_personal_frames_splice_matches_a_full_encode(monkeypatch):
    """The reveal/podium is serialized once and each person's block spliced in."""
    import json

    from app.live import gateway, protocol, runtime

    public = {"qi": 2, "counts": {"o_a": 3}, "explanation": 'aspas " e \\u0001 e ação'}
    blocks = {"p1": {"correct": True, "points": 900, "rank": 1}, "p2": {"correct": None, "rank": None}}

    class _Db:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(gateway, "live_db", lambda: _Db())
    monkeypatch.setattr(runtime, "load_room", lambda db, sid: None)
    monkeypatch.setattr(runtime, "personal_blocks", lambda db, room, kind, pids: blocks)
    frames = gateway._personal_frames("s", "reveal", ["p1", "p2"], "question.reveal", public, 7)  # noqa: SLF001
    for pid, text in frames.items():
        frame = json.loads(text)
        expected = json.loads(protocol.dumps(protocol.envelope("question.reveal", {**public, "my": blocks[pid]}, seq=7)))
        frame.pop("sts"), expected.pop("sts")
        assert frame == expected
