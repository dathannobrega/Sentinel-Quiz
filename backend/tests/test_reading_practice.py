"""Sentinel Reader Increment 2 (docs/reading/CONTRATO-INCREMENTO-2.md §3-§4) on the synthetic book of
``test_reading_api`` with the fake speech client and the fake AI provider: sentences and drill,
the words deck (SM-2), glossary, comprehension quiz, "Seus dados", offline manifest, capabilities."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.services import reading_words
from app.services.ai_authoring import provider as ai_provider

from test_reading_api import BOOK, PARA_1, PARA_2, SECTION, reading_env  # noqa: F401 - fixture

CHILD = f"{BOOK}:c01:head-2-1"


@pytest.fixture()
def practice_env(reading_env, monkeypatch):  # noqa: F811 - pytest fixture injection
    monkeypatch.setattr(settings, "ai_provider", "fake")
    monkeypatch.setattr(settings, "reading_ai_daily_quota", 300)
    monkeypatch.setattr(settings, "reading_max_offline_chapters", 5)
    yield


def _block(http, section=SECTION, part=None, index=0) -> dict:
    detail = http.get(f"/api/reading/sections/{section}").json()
    part = part or section
    return next(p for p in detail["parts"] if p["id"] == part)["blocks"][index]


def _assess(http, transcript: str, *, section=SECTION, part=None, block=0, sentence=None):
    data = {"part_id": part or section, "block_index": str(block)}
    if sentence is not None:
        data["sentence_index"] = str(sentence)
    return http.post(
        f"/api/reading/sections/{section}/assess",
        files={"audio": ("r.webm", b"FAKE:" + transcript.encode(), "audio/webm")},
        data=data,
    )


def _range(text: str, word: str, inner: int = 2) -> tuple[int, int]:
    """A range INSIDE ``word`` (the server must expand it to the whole word)."""
    start = text.index(word)
    return start + inner, start + inner + 1


def _word_body(text: str, word: str, kind: str = "vocabulary", section=SECTION, part=None, block=0) -> dict:
    start, end = _range(text, word)
    return {"section_id": section, "part_id": part or section, "block_index": block, "char_start": start, "char_end": end, "kind": kind}


# ---------------------------------------------------------------------------- sentences + drill
def test_section_blocks_carry_sentence_offsets(login_client, practice_env):
    http, _user = login_client()
    block = _block(http)
    assert block["text"] == PARA_1 + " " + PARA_2
    sentences = block["sentences"]
    assert [s["index"] for s in sentences] == [0, 1]
    assert [block["text"][s["char_start"]:s["char_end"]] for s in sentences] == [PARA_1, PARA_2]


def test_drill_assess_scores_one_sentence(login_client, practice_env, db):
    from app.models import ReadingAttempt

    http, user = login_client()
    words = PARA_2.split()
    transcript = " ".join(["~" + words[0]] + words[1:])  # "Multifactor" badly pronounced
    response = _assess(http, transcript, sentence=1)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sentence_index"] == 1 and body["text"] == PARA_2
    assert body["char_offset"] == len(PARA_1) + 1
    for word in body["words"]:
        assert body["text"][word["char_start"]:word["char_end"]] == word["text"]
    first = body["words"][0]
    assert first["status"] == "mispronounced" and first["reason"] == "phoneme" and first["phoneme_score"] < 0.6
    assert first["phonemes"][0]["quality"] == "bad" and body["tips"][0]["code"] == "phoneme_confusion"
    assert body["engines"] == {"asr": "fake", "phoneme": "fake"} and body["prosody"]["score"] is not None
    assert body["scores"]["prosody"] is not None
    assert body["deck"] == {"added": 1, "reviewed": 0}
    assert body["attempts_for_block"] == 1

    stored = db.query(ReadingAttempt).filter_by(user_id=user.id).one()
    assert stored.sentence_index == 1
    listing = http.get(f"/api/reading/sections/{SECTION}/attempts").json()["attempts"]
    assert listing[0]["sentence_index"] == 1

    # A paragraph attempt is a separate unit for best/attempt counts.
    paragraph = _assess(http, PARA_1 + " " + PARA_2).json()
    assert paragraph["sentence_index"] is None and paragraph["char_offset"] == 0 and paragraph["attempts_for_block"] == 1

    missing = _assess(http, "x", sentence=7)
    assert missing.status_code == 404 and missing.json()["code"] == "sentence_not_found"


# ---------------------------------------------------------------------------- deck after assessments
def test_assessment_feeds_the_deck(login_client, practice_env, db):
    from app.models import ReadingWord

    http, user = login_client()
    words = PARA_1.split()
    marked = ["~" + w if w == "awareness" else "?" + w if w == "training" else w for w in words]
    first = _assess(http, " ".join(marked + PARA_2.split())).json()
    assert first["deck"] == {"added": 2, "reviewed": 0}
    cards = {c.word_norm: c for c in db.query(ReadingWord).filter_by(user_id=user.id)}
    assert set(cards) == {"awareness", "training"}
    card = cards["awareness"]
    assert card.kind == "pronunciation" and card.source == "assessment" and card.context == PARA_1
    assert card.ipa and card.section_id == SECTION and card.reps == 0

    # Same mistakes again: the new cards are due, so they lapse ("again", due in 10 minutes).
    second = _assess(http, " ".join(marked + PARA_2.split())).json()
    assert second["deck"] == {"added": 0, "reviewed": 2}
    db.expire_all()
    card = db.query(ReadingWord).filter_by(user_id=user.id, word_norm="awareness").one()
    assert card.lapses == 1 and card.reps == 0 and card.ease == pytest.approx(2.3)
    due_in = card.due_at - datetime.now(timezone.utc)
    assert timedelta(minutes=9) < due_in <= timedelta(minutes=10)

    # Not due: no change. Once due, a clean reading counts as "good".
    third = _assess(http, PARA_1 + " " + PARA_2).json()
    assert third["deck"] == {"added": 0, "reviewed": 0}
    db.query(ReadingWord).filter_by(user_id=user.id).update({"due_at": datetime.now(timezone.utc) - timedelta(minutes=1)})
    db.commit()
    fourth = _assess(http, PARA_1 + " " + PARA_2).json()
    assert fourth["deck"] == {"added": 0, "reviewed": 2}
    db.expire_all()
    card = db.query(ReadingWord).filter_by(user_id=user.id, word_norm="awareness").one()
    assert card.reps == 1 and card.interval_days == pytest.approx(1.0) and card.last_score == pytest.approx(0.92)


def test_deck_caps_new_cards_per_assessment(login_client, practice_env):
    http, _user = login_client()
    transcript = " ".join("~" + w for w in PARA_1.split())
    body = _assess(http, transcript + " " + PARA_2).json()
    assert body["deck"]["added"] == reading_words.MAX_AUTO_CARDS


def _card(**fields) -> object:
    from app.models import ReadingWord

    base = {"reps": 0, "lapses": 0, "ease": 2.5, "interval_days": 0.0}
    base.update(fields)
    return ReadingWord(**base)


def test_sm2_transitions():
    now = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)
    card = _card()
    reading_words.schedule(card, "good", now=now)
    assert (card.reps, card.interval_days, card.due_at) == (1, 1.0, now + timedelta(days=1))
    reading_words.schedule(card, "good", now=now)
    assert (card.reps, card.interval_days) == (2, 3.0)
    reading_words.schedule(card, "good", now=now)
    assert card.reps == 3 and card.interval_days == pytest.approx(7.5) and card.ease == pytest.approx(2.5)
    reading_words.schedule(card, "hard", now=now)
    assert card.interval_days == pytest.approx(9.0) and card.ease == pytest.approx(2.35) and card.reps == 3
    reading_words.schedule(card, "easy", now=now)
    assert card.interval_days == pytest.approx(9.0 * 2.35 * 1.3) and card.ease == pytest.approx(2.5)
    assert card.interval_days >= reading_words.LEARNED_DAYS
    reading_words.schedule(card, "again", now=now)
    assert (card.reps, card.lapses, card.interval_days) == (0, 1, 0.0)
    assert card.due_at == now + timedelta(minutes=10) and card.ease == pytest.approx(2.3)
    for _ in range(10):
        reading_words.schedule(card, "again", now=now)
    assert card.ease == pytest.approx(1.3)  # floor
    fresh = _card()
    reading_words.schedule(fresh, "hard", now=now)
    assert fresh.interval_days == 1.0 and fresh.ease == pytest.approx(2.35)
    easy = _card()
    reading_words.schedule(easy, "easy", now=now)
    assert easy.interval_days == pytest.approx(2.5 * 1.3) and easy.reps == 1
    assert reading_words.grade_for_overall(0.9) == "good"
    assert reading_words.grade_for_overall(0.75) == "hard"
    assert reading_words.grade_for_overall(0.5) == "again"


# ---------------------------------------------------------------------------- words endpoints
def test_words_crud_and_owner_checks(login_client, practice_env):
    http, _user = login_client()
    text = _block(http)["text"]
    created = http.post("/api/reading/words", json=_word_body(text, "awareness", kind="pronunciation"))
    assert created.status_code == 201, created.text
    card = created.json()
    assert card["word"] == "awareness" and card["kind"] == "pronunciation" and card["source"] == "manual"
    assert card["context"] == PARA_1 and card["ipa"] and card["section_id"] == SECTION
    assert set(card) == {"id", "word", "kind", "ipa", "meaning_pt", "context", "section_id", "source", "reps", "lapses",
                         "ease", "interval_days", "due_at", "last_score", "last_reviewed_at", "created_at"}
    again = http.post("/api/reading/words", json=_word_body(text, "awareness", kind="pronunciation"))
    assert again.status_code == 200 and again.json()["id"] == card["id"]
    vocab = http.post("/api/reading/words", json=_word_body(text, "pretexting")).json()
    assert vocab["kind"] == "vocabulary"

    listing = http.get("/api/reading/words").json()
    assert listing["total"] == 2 and listing["due"] == 2 and len(listing["items"]) == 2
    assert http.get("/api/reading/words?kind=vocabulary").json()["total"] == 1
    assert http.get("/api/reading/words?status=due&limit=1").json()["items"][0]["id"] in {card["id"], vocab["id"]}
    summary = http.get("/api/reading/words/summary").json()
    assert summary == {"total": 2, "due": 2, "learned": 0, "by_kind": {"pronunciation": 1, "vocabulary": 1}}

    # Ranges that do not hit a word, and blocks outside the section.
    space = text.index(" ")
    bad = http.post("/api/reading/words", json={**_word_body(text, "awareness"), "char_start": space, "char_end": space + 1})
    assert bad.status_code == 400 and bad.json()["code"] == "word_invalid"
    outside = http.post("/api/reading/words", json={**_word_body(text, "awareness"), "part_id": f"{BOOK}:c02:c02_1"})
    assert outside.status_code == 404 and outside.json()["code"] == "block_not_found"
    assert http.post("/api/reading/words", json={**_word_body(text, "awareness"), "text": "evil"}).status_code == 422

    tts = http.post(f"/api/reading/words/{card['id']}/tts", json={"speed": 0.9})
    assert tts.status_code == 200 and tts.json()["text"] == "awareness" and tts.json()["audio_url"].startswith("/api/reading/audio/")

    graded = http.post(f"/api/reading/words/{vocab['id']}/grade", json={"grade": "good"})
    assert graded.status_code == 200 and graded.json()["reps"] == 1 and graded.json()["interval_days"] == 1.0
    assert http.post(f"/api/reading/words/{vocab['id']}/grade", json={"grade": "meh"}).status_code == 422

    # Another user sees none of it.
    other, _ = login_client()
    assert other.get("/api/reading/words").json()["total"] == 0
    for method, path, kwargs in (
        ("delete", f"/api/reading/words/{card['id']}", {}),
        ("post", f"/api/reading/words/{card['id']}/tts", {"json": {}}),
        ("post", f"/api/reading/words/{card['id']}/grade", {"json": {"grade": "easy"}}),
        ("post", f"/api/reading/words/{card['id']}/review", {"files": {"audio": ("r.webm", b"FAKE:awareness", "audio/webm")}}),
    ):
        response = getattr(other, method)(path, **kwargs)
        assert response.status_code == 404 and response.json()["code"] == "word_not_found", (method, path)

    assert http.delete(f"/api/reading/words/{card['id']}").status_code == 204
    assert http.delete(f"/api/reading/words/{card['id']}").status_code == 404
    assert http.get("/api/reading/words").json()["total"] == 1


def test_word_review_grades_from_the_recording_and_uses_the_quota(login_client, practice_env, monkeypatch):
    http, _user = login_client()
    text = _block(http)["text"]
    card = http.post("/api/reading/words", json=_word_body(text, "awareness", kind="pronunciation")).json()

    good = http.post(f"/api/reading/words/{card['id']}/review", files={"audio": ("r.webm", b"FAKE:awareness", "audio/webm")})
    assert good.status_code == 200, good.text
    body = good.json()
    assert body["grade"] == "good" and body["card"]["reps"] == 1 and body["card"]["last_score"] >= 0.85
    assert body["assessment"]["text"] == "awareness" and len(body["assessment"]["words"]) == 1
    assert body["assessment"]["prosody"] is None  # fewer than 3 words

    bad = http.post(f"/api/reading/words/{card['id']}/review", files={"audio": ("r.webm", b"FAKE:~awareness", "audio/webm")}).json()
    assert bad["grade"] == "again" and bad["card"]["lapses"] == 1 and bad["card"]["reps"] == 0
    unsupported = http.post(f"/api/reading/words/{card['id']}/review", files={"audio": ("r.txt", b"x", "text/plain")})
    assert unsupported.status_code == 415

    # Word reviews share the daily assessment quota with paragraph/sentence attempts.
    assert http.get("/api/reading/capabilities").json()["quota"]["used_today"] == 2
    monkeypatch.setattr(settings, "reading_daily_assess_quota", 2)
    blocked = http.post(f"/api/reading/words/{card['id']}/review", files={"audio": ("r.webm", b"FAKE:awareness", "audio/webm")})
    assert blocked.status_code == 429 and blocked.json()["code"] == "reading_quota_exceeded"
    assert _assess(http, PARA_1).json()["code"] == "reading_quota_exceeded"


# ---------------------------------------------------------------------------- glossary
def test_glossary_with_fake_ai_cache_and_deck(login_client, practice_env, db):
    from app.models import ReadingAiCall

    http, user = login_client()
    text = _block(http)["text"]
    body = {k: v for k, v in _word_body(text, "pretexting").items() if k != "kind"}
    first = http.post("/api/reading/glossary", json=body)
    assert first.status_code == 200, first.text
    entry = first.json()
    assert entry["word"] == "pretexting" and entry["word_norm"] == "pretexting" and entry["source"] == "ai"
    assert entry["ipa"] and entry["translation_pt"] and entry["definition_en"] and entry["context_explanation_pt"]
    assert entry["examples"] and entry["in_deck"] is False and entry["card_id"] is None
    second = http.post("/api/reading/glossary", json=body).json()
    assert second["source"] == "cache" and second["translation_pt"] == entry["translation_pt"]
    assert db.query(ReadingAiCall).filter_by(user_id=user.id, kind="glossary").count() == 1  # cache is free

    # Adding the looked-up word keeps the translation and marks it as a glossary card.
    card = http.post("/api/reading/words", json=_word_body(text, "pretexting")).json()
    assert card["source"] == "glossary" and card["meaning_pt"] == entry["translation_pt"]
    third = http.post("/api/reading/glossary", json=body).json()
    assert third["in_deck"] is True and third["card_id"] == card["id"]

    assert http.post("/api/reading/glossary", json={**body, "text": "x"}).status_code == 422


def test_glossary_quota_failure_and_disabled(login_client, practice_env, monkeypatch):
    http, _user = login_client()
    text = _block(http)["text"]
    body = lambda word: {k: v for k, v in _word_body(text, word).items() if k != "kind"}  # noqa: E731

    monkeypatch.setattr(settings, "reading_ai_daily_quota", 1)
    assert http.post("/api/reading/glossary", json=body("phishing")).json()["source"] == "ai"
    assert http.post("/api/reading/glossary", json=body("phishing")).json()["source"] == "cache"  # cache still served
    blocked = http.post("/api/reading/glossary", json=body("employee"))
    assert blocked.status_code == 429 and blocked.json()["code"] == "reading_ai_quota_exceeded"
    assert http.get("/api/reading/capabilities").json()["quota"]["used_today"] == 0  # separate quotas

    monkeypatch.setattr(settings, "reading_ai_daily_quota", 300)

    def broken(self, task, system, user, *, model):
        raise ai_provider.ProviderError("unavailable", "down")

    monkeypatch.setattr(ai_provider.FakeProvider, "generate_json", broken)
    failed = http.post("/api/reading/glossary", json=body("employee"))
    assert failed.status_code == 502 and failed.json()["code"] == "reading_ai_failed"

    # Gemini without a key: no AI, but IPA (speech service) still answers.
    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", "")
    plain = http.post("/api/reading/glossary", json=body("customers"))
    assert plain.status_code == 200
    data = plain.json()
    assert data["source"] == "none" and data["ipa"] and data["translation_pt"] is None and data["examples"] == []
    caps = http.get("/api/reading/capabilities").json()["ai"]
    assert caps == {"available": False, "reason": "not_configured", "provider": "gemini"}
    monkeypatch.setattr(settings, "gemini_api_key", "k")
    monkeypatch.setattr(settings, "gemini_enable", False)
    assert http.get("/api/reading/capabilities").json()["ai"]["reason"] == "disabled"


def test_glossary_ipa_null_when_speech_fails(login_client, practice_env, monkeypatch):
    from app.services.speech_client import FakeSpeechClient, SpeechError

    def broken(self, words, *, lang="en-us"):
        raise SpeechError(503, "speech_unavailable", "down")

    monkeypatch.setattr(FakeSpeechClient, "g2p", broken)
    http, _user = login_client()
    text = _block(http)["text"]
    body = {k: v for k, v in _word_body(text, "phishing").items() if k != "kind"}
    data = http.post("/api/reading/glossary", json=body).json()
    assert data["ipa"] is None and data["source"] == "ai"


# ---------------------------------------------------------------------------- comprehension
def test_quiz_generate_cache_and_answer(login_client, practice_env, db):
    from app.models import ReadingSectionQuiz

    http, _user = login_client()
    created = http.post(f"/api/reading/sections/{SECTION}/quiz")
    assert created.status_code == 200, created.text
    quiz = created.json()
    assert quiz["source"] == "ai" and quiz["section_id"] == SECTION and quiz["answers"] == []
    assert 2 <= len(quiz["questions"]) <= 3
    assert "correct_key" not in json.dumps(quiz) and "evidence" not in json.dumps(quiz)
    assert [o["key"] for o in quiz["questions"][0]["options"]] == ["A", "B", "C", "D"]

    stored = json.loads(db.query(ReadingSectionQuiz).filter_by(section_id=SECTION).one().questions_json)
    key = stored[0]["correct_key"]
    wrong = next(k for k in "ABCD" if k != key)
    first = http.post(f"/api/reading/sections/{SECTION}/quiz/answer", json={"question_index": 0, "choice": wrong}).json()
    assert first["correct"] is False and first["correct_key"] == key and first["evidence"] and first["explanation"]
    assert (first["answered"], first["correct_count"]) == (1, 0)
    second = http.post(f"/api/reading/sections/{SECTION}/quiz/answer", json={"question_index": 0, "choice": key}).json()
    assert second["correct"] is True and (second["answered"], second["correct_count"]) == (1, 1)  # the latest counts

    cached = http.post(f"/api/reading/sections/{SECTION}/quiz").json()
    assert cached["source"] == "cache" and cached["quiz_id"] == quiz["quiz_id"]
    assert cached["answers"] == [{"question_index": 0, "choice": key, "correct": True}]

    assert http.post(f"/api/reading/sections/{SECTION}/quiz/answer", json={"question_index": 9, "choice": "A"}).json()["code"] == "question_not_found"
    assert http.post(f"/api/reading/sections/{SECTION}/quiz/answer", json={"question_index": 0, "choice": "E"}).status_code == 422
    assert http.post(f"/api/reading/sections/{CHILD}/quiz/answer", json={"question_index": 0, "choice": "A"}).json()["code"] == "quiz_not_found"
    assert http.post(f"/api/reading/sections/{BOOK}:c09:nope/quiz").json()["code"] == "section_not_found"

    stats = http.get("/api/reading/stats").json()
    assert stats["quiz"] == {"answered": 1, "correct": 1}


def test_quiz_rejects_invented_evidence(login_client, practice_env, monkeypatch):
    def invented(self, task, system, user, *, model):
        question = {
            "prompt": "What does the text say?", "correct_key": "A", "explanation": "Porque sim.",
            "options": [{"key": k, "text": f"Option {k}"} for k in "ABCD"],
            "evidence": "Firewalls are the only control an organization ever needs.",
        }
        return {"questions": [question, question, question]}, ai_provider.Usage()

    monkeypatch.setattr(ai_provider.FakeProvider, "generate_json", invented)
    http, _user = login_client()
    response = http.post(f"/api/reading/sections/{SECTION}/quiz")
    assert response.status_code == 502 and response.json()["code"] == "quiz_generation_failed"


def test_quiz_disabled_and_quota(login_client, practice_env, monkeypatch):
    http, _user = login_client()
    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", "")
    disabled = http.post(f"/api/reading/sections/{SECTION}/quiz")
    assert disabled.status_code == 404 and disabled.json()["code"] == "reading_ai_disabled"
    monkeypatch.setattr(settings, "ai_provider", "fake")
    monkeypatch.setattr(settings, "reading_ai_daily_quota", 1)
    assert http.post(f"/api/reading/sections/{SECTION}/quiz").status_code == 200
    blocked = http.post(f"/api/reading/sections/{CHILD}/quiz")
    assert blocked.status_code == 429 and blocked.json()["code"] == "reading_ai_quota_exceeded"


def test_quiz_validation_normalizes_evidence():
    from app.services import reading_ai

    base = "Security awareness training teaches every employee to recognize phishing — and “pretexting”."
    question = {
        "prompt": "Who is trained?", "correct_key": "b", "explanation": "Todos.",
        "options": [{"key": k, "text": f"Option {k}"} for k in "DCBA"],
        "evidence": 'every employee to recognize phishing - and "pretexting"',
    }
    valid = reading_ai.validate_quiz({"questions": [question, {**question, "options": question["options"][:3]}]}, base)
    assert len(valid) == 1 and valid[0]["correct_key"] == "B" and [o["key"] for o in valid[0]["options"]] == list("ABCD")
    assert reading_ai.validate_quiz({"questions": "nope"}, base) == []


# ---------------------------------------------------------------------------- your data
def test_export_and_delete_my_data(login_client, practice_env):
    http, _user = login_client()
    other, _ = login_client()
    text = _block(http)["text"]
    http.put("/api/reading/progress", json={"book_slug": BOOK, "section_id": SECTION, "part_id": SECTION, "block_index": 0, "words_read": 10})
    _assess(http, "~" + PARA_1)
    http.post("/api/reading/words", json=_word_body(text, "pretexting"))
    http.post(f"/api/reading/sections/{SECTION}/quiz")
    http.post(f"/api/reading/sections/{SECTION}/quiz/answer", json={"question_index": 0, "choice": "A"})
    _assess(other, PARA_1)

    export = http.get("/api/reading/me/export")
    assert export.status_code == 200 and "attachment" in export.headers["content-disposition"]
    data = export.json()
    assert set(data) == {"exported_at", "progress", "attempts", "words", "quiz_answers"}
    assert len(data["progress"]) == 1 and len(data["attempts"]) == 1 and "words" in data["attempts"][0]["result"]
    assert {w["word"] for w in data["words"]} == {"Security", "pretexting"}
    assert data["quiz_answers"][0]["section_id"] == SECTION

    deleted = http.delete("/api/reading/me")
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": {"progress": 1, "attempts": 1, "words": 2, "quiz_answers": 1}}
    empty = http.get("/api/reading/me/export").json()
    assert empty["progress"] == empty["attempts"] == empty["words"] == empty["quiz_answers"] == []
    # The other user's data and the shared quiz cache are untouched.
    assert other.get("/api/reading/stats").json()["attempts"] == 1
    assert http.post(f"/api/reading/sections/{SECTION}/quiz").json()["source"] == "cache"


# ---------------------------------------------------------------------------- offline, capabilities, stats
def test_offline_manifest(login_client, practice_env):
    http, _user = login_client()
    manifest = http.get(f"/api/reading/books/{BOOK}/chapters/c01/offline-manifest")
    assert manifest.status_code == 200, manifest.text
    body = manifest.json()
    assert body["book"]["slug"] == BOOK and body["chapter"]["file"] == "c01"
    assert [s["id"] for s in body["sections"]] == [SECTION, CHILD]
    block = body["sections"][0]["blocks"][0]
    assert block == {"part_id": SECTION, "block_index": 0, "words": len((PARA_1 + " " + PARA_2).split())}
    assert body["total_blocks"] == sum(len(s["blocks"]) for s in body["sections"])
    words = sum(b["words"] for s in body["sections"] for b in s["blocks"])
    assert body["estimated_audio_mb"] == round(words / 150 * 0.45, 1)
    # Every block of the manifest is synthesizable as listed.
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": block["part_id"], "block_index": 0}).status_code == 200
    assert http.get(f"/api/reading/books/{BOOK}/chapters/c09/offline-manifest").json()["code"] == "chapter_not_found"
    assert http.get("/api/reading/books/nope/chapters/c01/offline-manifest").json()["code"] == "book_not_found"


def test_capabilities_and_stats_increment_2(login_client, practice_env):
    http, _user = login_client()
    caps = http.get("/api/reading/capabilities").json()
    assert caps["ai"] == {"available": True, "reason": None, "provider": "fake"}
    assert caps["phonemes"] == {"available": True, "reason": None}
    assert caps["words"] == {"due": 0} and caps["offline"] == {"max_chapters": 5}
    _assess(http, "~" + PARA_1)
    assert http.get("/api/reading/capabilities").json()["words"]["due"] == 1
    stats = http.get("/api/reading/stats").json()
    assert stats["words"] == {"total": 1, "due": 1, "learned": 0} and stats["quiz"] == {"answered": 0, "correct": 0}


def test_capabilities_phonemes_follow_speech_health(login_client, practice_env, monkeypatch):
    from app.services.speech_client import FakeSpeechClient, SpeechHealth

    original = FakeSpeechClient.health

    def warming(self, *, force=False):
        health = original(self)
        return SpeechHealth(status=health.status, tts=health.tts, asr=health.asr, phoneme={"engine": "wav2vec2", "ready": False})

    monkeypatch.setattr(FakeSpeechClient, "health", warming)
    http, _user = login_client()
    assert http.get("/api/reading/capabilities").json()["phonemes"] == {"available": False, "reason": "warming"}


def test_reading_writes_share_the_rate_limit_bucket():
    from app.middleware.rate_limit import RateLimitMiddleware

    middleware = RateLimitMiddleware(lambda scope, receive, send: None, settings=settings)
    for method, path in (
        ("POST", "/api/reading/glossary"), ("POST", "/api/reading/words"), ("POST", "/api/reading/sections/x/quiz"),
        ("POST", "/api/reading/words/abc/review"), ("DELETE", "/api/reading/me"), ("DELETE", "/api/reading/words/abc"),
    ):
        assert middleware._resolve_policy(path, method)[0] == "reading", (method, path)
    assert middleware._resolve_policy("/api/reading/words", "GET")[0] == "public"


def test_speech_http_client_g2p(monkeypatch):
    import httpx

    from app.services import speech_client

    captured = {}

    def fake_request(self, method, url, **kwargs):
        captured.update({"method": method, "url": url, **kwargs})
        return httpx.Response(200, json={"items": [{"word": "threat", "ipa": "θɹˈɛt"}, {"word": "zzz", "ipa": None}]},
                              request=httpx.Request(method, "http://speech/v1/g2p"))

    monkeypatch.setattr(httpx.Client, "request", fake_request)
    client = speech_client.SpeechClient("http://speech.invalid:8100")
    assert client.g2p(["threat", "zzz", "threat", "x" * 65]) == {"threat": "θɹˈɛt", "zzz": None}
    assert captured["url"] == "/v1/g2p" and captured["json"] == {"words": ["threat", "zzz"], "lang": "en-us"}


def test_fake_tips_group_by_sound_pair():
    from app.services.speech_client import FakeSpeechClient

    result = FakeSpeechClient().assess(
        b"FAKE:~threat ~threat ~think", content_type="audio/webm", filename="r.webm", reference_text="threat threat think"
    )
    pairs = [(tip["expected"], tip["heard"]) for tip in result["tips"]]
    assert len(pairs) == len(set(pairs))
    assert sum(len(tip["examples"]) for tip in result["tips"]) <= 3
