"""Sentinel Reader API (docs/reading/CONTRATO-INCREMENTO-1.md §4) on a synthetic book with the fake
speech client (SPEECH_PROVIDER=fake): library, reading order, blocks, TTS, assessment, progress."""
from __future__ import annotations

import pytest

from app.core.config import settings
from app.services import material_corpus, speech_client

from test_material_corpus import _section, _write_book

PARA_1 = (
    "Security awareness training teaches every employee to recognize phishing, pretexting and other "
    "social engineering attacks before they cause damage to the organization and its customers."
)
PARA_2 = (
    "Multifactor authentication adds a second layer of defense, so a stolen password alone is not "
    "enough for an attacker to sign in to the account and move laterally inside the network."
)
SHORT = "Too short to read."
REVIEW = "1. Which attack targets executives? A. Whaling B. Vishing C. Smishing D. Tailgating. Answers follow."


@pytest.fixture()
def reading_env(tmp_path, monkeypatch):
    json_root = tmp_path / "json"
    _write_book(
        json_root,
        chapters={
            "c01.xhtml": (
                "Chapter 1: Social Engineering",
                [
                    _section(
                        "c01_1", 1, "Chapter 1 Social Engineering", PARA_1 + "\n\n" + PARA_2,
                        children=[
                            _section("head-2-1", 2, "Phishing", PARA_2 + " " + PARA_1),
                            _section("head-2-9", 2, "Tiny", SHORT),
                            _section("head-2-2", 2, "Review Questions", REVIEW + " " + REVIEW),
                        ],
                    ),
                ],
            ),
            "c02.xhtml": (
                "Chapter 2: Identity and Access",
                [_section("c02_1", 1, "Chapter 2 Identity and Access", PARA_2 + " " + PARA_1 + " " + PARA_2)],
            ),
        },
    )
    monkeypatch.setattr(settings, "material_dir", str(tmp_path))
    monkeypatch.setattr(settings, "speech_provider", "fake")
    monkeypatch.setattr(settings, "speech_service_url", "")
    monkeypatch.setattr(settings, "reading_enabled", True)
    monkeypatch.setattr(settings, "reading_daily_assess_quota", 400)
    material_corpus.clear_corpus_cache()
    speech_client.reset_speech_client()
    yield
    material_corpus.clear_corpus_cache()
    speech_client.reset_speech_client()


BOOK = "fake_security_guide"
SECTION = f"{BOOK}:c01:c01_1"


def test_requires_login(client, reading_env):
    assert client.get("/api/reading/library").status_code == 401
    assert client.get("/api/reading/capabilities").status_code == 401


def test_capabilities_with_fake_speech(login_client, reading_env):
    http, _user = login_client()
    body = http.get("/api/reading/capabilities").json()
    assert body["enabled"] is True and body["books_available"] is True
    assert body["tts"]["available"] is True and body["tts"]["engine"] == "fake"
    assert any(voice["id"] == "af_heart" for voice in body["tts"]["voices"])
    assert body["assess"]["available"] is True
    assert body["quota"] == {"daily_limit": 400, "used_today": 0, "remaining": 400}


def test_capabilities_without_speech_service(login_client, reading_env, monkeypatch):
    monkeypatch.setattr(settings, "speech_provider", "http")
    speech_client.reset_speech_client()
    http, _user = login_client()
    body = http.get("/api/reading/capabilities").json()
    assert body["tts"] == {**body["tts"], "available": False, "reason": "speech_unavailable"}
    assert body["assess"]["available"] is False
    # The reader still works (browser fallback); only speech features are off.
    assert http.get("/api/reading/library").status_code == 200
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": SECTION, "block_index": 0}).json()["code"] == "speech_unavailable"


def test_reading_disabled(login_client, reading_env, monkeypatch):
    monkeypatch.setattr(settings, "reading_enabled", False)
    http, _user = login_client()
    assert http.get("/api/reading/capabilities").json() == {"enabled": False}
    response = http.get("/api/reading/library")
    assert response.status_code == 404 and response.json()["code"] == "reading_disabled"


def test_library_and_chapter_list_only_readable_sections(login_client, reading_env):
    http, _user = login_client()
    library = http.get("/api/reading/library").json()
    assert [book["slug"] for book in library["books"]] == [BOOK]
    book = library["books"][0]
    # Chapter 1 opener + Phishing; "Tiny" (< 20 words) and the review questions are not readable.
    assert book["sections"] == 3 and book["progress"] is None
    assert [(c["file"], c["sections"]) for c in book["chapters"]] == [("c01", 2), ("c02", 1)]
    assert book["minutes"] >= 1 and book["chapters"][0]["minutes"] >= 1

    chapter = http.get(f"/api/reading/books/{BOOK}/chapters/c01").json()
    assert chapter["chapter"]["file"] == "c01" and chapter["chapter"]["index"] == 1
    assert [s["id"] for s in chapter["sections"]] == [SECTION, f"{BOOK}:c01:head-2-1"]
    assert chapter["sections"][1]["level"] == 2 and chapter["sections"][1]["completed"] is False
    # The file name with extension is accepted too.
    assert http.get(f"/api/reading/books/{BOOK}/chapters/c01.xhtml").status_code == 200
    assert http.get(f"/api/reading/books/{BOOK}/chapters/c09").json()["code"] == "chapter_not_found"
    assert http.get("/api/reading/books/nope/chapters/c01").json()["code"] == "book_not_found"


def test_section_detail_progress_and_completion(login_client, reading_env):
    http, _user = login_client()
    detail = http.get(f"/api/reading/sections/{SECTION}").json()
    assert detail["book_slug"] == BOOK and detail["chapter_file"] == "c01" and detail["chapter_index"] == 1
    assert detail["position"] == {"index": 0, "total": 3} and detail["progress"] is None
    assert detail["parts"][0]["id"] == SECTION and len(detail["parts"][0]["blocks"]) >= 1
    assert detail["next"]["id"] == f"{BOOK}:c02:c02_1"  # children are inside `parts`, next skips them

    second = f"{BOOK}:c01:head-2-1"
    saved = http.put(
        "/api/reading/progress",
        json={"book_slug": BOOK, "section_id": second, "part_id": second, "block_index": 1, "mode": "shadow", "words_read": 40, "seconds_listened": 20},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["percent"] == pytest.approx(33.3) and saved.json()["words_read"] == 40
    again = http.put(
        "/api/reading/progress",
        json={"book_slug": BOOK, "section_id": second, "part_id": second, "block_index": 1, "mode": "listen", "words_read": 10, "seconds_listened": 5},
    ).json()
    assert again["words_read"] == 50 and again["seconds_listened"] == 25 and again["mode"] == "listen"

    library = http.get("/api/reading/library").json()["books"][0]
    assert library["progress"]["section_id"] == second and library["progress"]["section_title"] == "Phishing"
    chapter = http.get(f"/api/reading/books/{BOOK}/chapters/c01").json()
    assert [s["completed"] for s in chapter["sections"]] == [True, False]
    detail = http.get(f"/api/reading/sections/{second}").json()
    assert detail["progress"]["block_index"] == 1
    assert http.get("/api/reading/progress").json()["items"][0]["book_slug"] == BOOK

    # Progress must point at a section of that book.
    bad = http.put("/api/reading/progress", json={"book_slug": BOOK, "section_id": "other:c01:x", "part_id": "other:c01:x", "block_index": 0})
    assert bad.status_code == 404 and bad.json()["code"] == "section_not_found"


def test_tts_resolves_block_text_server_side(login_client, reading_env):
    http, _user = login_client()
    body = http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": SECTION, "block_index": 0, "speed": 1.1})
    assert body.status_code == 200, body.text
    data = body.json()
    assert data["text"].startswith("Security awareness training")
    assert data["audio_url"] == f"/api/reading/audio/{data['audio_id']}" and data["cached"] is False
    for word in data["words"]:
        assert data["text"][word["char_start"]:word["char_end"]] == word["text"]
        assert word["start"] < word["end"]
    # Second call: served from cache. Child part under the same section is allowed.
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": SECTION, "block_index": 0, "speed": 1.1}).json()["cached"] is True
    child = f"{BOOK}:c01:head-2-1"
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": child, "block_index": 0}).status_code == 200
    # A part outside the section, a missing block and an unknown voice are rejected.
    other = f"{BOOK}:c02:c02_1"
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": other, "block_index": 0}).json()["code"] == "block_not_found"
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": SECTION, "block_index": 99}).json()["code"] == "block_not_found"
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": SECTION, "block_index": 0, "voice": "zz_nobody"}).json()["code"] == "voice_invalid"

    audio = http.get(data["audio_url"])
    assert audio.status_code == 200 and audio.headers["content-type"].startswith("audio/wav")
    assert audio.content[:4] == b"RIFF" and audio.headers["cache-control"] == "private, max-age=86400"
    assert http.get("/api/reading/audio/" + "0" * 64).json()["code"] == "audio_not_found"
    assert http.get("/api/reading/audio/not-hex").status_code == 404


def test_assess_records_attempt_and_scores(login_client, reading_env, db):
    from app.models import ReadingAttempt

    http, user = login_client()
    text = http.get(f"/api/reading/sections/{SECTION}").json()["parts"][0]["blocks"][0]["text"]
    words = text.split()
    transcript = " ".join(words[:-2])  # the reader skipped the last two words
    response = http.post(
        f"/api/reading/sections/{SECTION}/assess",
        files={"audio": ("recording.webm", b"FAKE:" + transcript.encode(), "audio/webm;codecs=opus")},
        data={"part_id": SECTION, "block_index": "0"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    statuses = [w["status"] for w in body["words"]]
    assert statuses.count("missed") == 2 and statuses[0] == "ok"
    assert body["metrics"]["reference_words"] == len(body["words"])
    assert 0 < body["scores"]["overall"] < 1 and body["attempts_for_block"] == 1
    assert body["best_overall"] == body["scores"]["overall"] and body["text"] == text

    stored = db.query(ReadingAttempt).filter_by(user_id=user.id).one()
    assert stored.section_id == SECTION and stored.block_index == 0 and stored.overall == pytest.approx(body["scores"]["overall"])
    assert "words" in stored.result_json and b"FAKE" not in stored.result_json.encode()

    listing = http.get(f"/api/reading/sections/{SECTION}/attempts").json()["attempts"]
    assert len(listing) == 1 and listing[0]["id"] == body["attempt_id"]
    stats = http.get("/api/reading/stats").json()
    assert stats["attempts"] == 1 and stats["active_days_30"] == 1 and len(stats["recent"]) == 7
    assert stats["recent"][-1]["attempts"] == 1
    assert http.get("/api/reading/capabilities").json()["quota"]["used_today"] == 1


def test_assess_limits(login_client, reading_env, monkeypatch):
    http, _user = login_client()
    unsupported = http.post(
        f"/api/reading/sections/{SECTION}/assess",
        files={"audio": ("x.txt", b"hello", "text/plain")},
        data={"part_id": SECTION, "block_index": "0"},
    )
    assert unsupported.status_code == 415 and unsupported.json()["code"] == "audio_unsupported"

    monkeypatch.setattr(settings, "speech_max_audio_bytes", 16)
    too_large = http.post(
        f"/api/reading/sections/{SECTION}/assess",
        files={"audio": ("x.webm", b"0" * 64, "audio/webm")},
        data={"part_id": SECTION, "block_index": "0"},
    )
    assert too_large.status_code == 413 and too_large.json()["code"] == "audio_too_large"
    monkeypatch.setattr(settings, "speech_max_audio_bytes", 8_000_000)

    missing_block = http.post(
        f"/api/reading/sections/{SECTION}/assess",
        files={"audio": ("x.webm", b"0" * 64, "audio/webm")},
        data={"part_id": SECTION, "block_index": "42"},
    )
    assert missing_block.status_code == 404 and missing_block.json()["code"] == "block_not_found"

    monkeypatch.setattr(settings, "reading_daily_assess_quota", 1)
    first = http.post(
        f"/api/reading/sections/{SECTION}/assess",
        files={"audio": ("x.webm", b"0" * 64, "audio/webm")},
        data={"part_id": SECTION, "block_index": "0"},
    )
    assert first.status_code == 200
    second = http.post(
        f"/api/reading/sections/{SECTION}/assess",
        files={"audio": ("x.webm", b"0" * 64, "audio/webm")},
        data={"part_id": SECTION, "block_index": "0"},
    )
    assert second.status_code == 429 and second.json()["code"] == "reading_quota_exceeded"


def test_reading_rate_limit_bucket():
    from app.middleware.rate_limit import RateLimitMiddleware

    middleware = RateLimitMiddleware(lambda scope, receive, send: None, settings=settings)
    assert middleware._resolve_policy("/api/reading/sections/x/assess", "POST")[0] == "reading"
    assert middleware._resolve_policy("/api/reading/progress", "PUT")[0] == "reading"
    assert middleware._resolve_policy("/api/reading/library", "GET")[0] == "public"


def test_speech_http_client_maps_failures(monkeypatch):
    import httpx

    client = speech_client.SpeechClient("http://speech.invalid:8100", timeout_seconds=1.0)

    def boom(self, method, url, **kwargs):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(httpx.Client, "request", boom)
    with pytest.raises(speech_client.SpeechError) as exc:
        client.tts("hello", voice="af_heart", speed=1.0)
    assert exc.value.status_code == 503 and exc.value.code == "speech_unavailable"
    assert client.health().status == "unavailable"
