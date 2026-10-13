"""Sentinel Reader Increment 3 (docs/reading/CONTRATO-INCREMENTO-3.md §3): sentence stream proxy,
server-side warm-up, book language, speeds and capabilities, on the synthetic book of
``test_reading_api`` with the fake speech client."""
from __future__ import annotations

import asyncio
import json
import logging

import httpx
import pytest

from app.core.config import settings
from app.services import material_corpus, reading, reading_warm, speech_client
from app.services.material_corpus import detect_language
from app.services.speech_client import FakeSpeechClient, SpeechClient, SpeechError

from test_material_corpus import _section, _write_book
from test_reading_api import BOOK, PARA_1, PARA_2, SECTION, reading_env  # noqa: F401 - fixture

CHILD = f"{BOOK}:c01:head-2-1"
NEXT = f"{BOOK}:c02:c02_1"
STREAM = f"/api/reading/sections/{SECTION}/tts/stream"
WARM = f"/api/reading/sections/{SECTION}/warm"

PT_1 = (
    "O treinamento de conscientização em segurança ensina cada funcionário a reconhecer phishing, pretexto e "
    "outros ataques de engenharia social antes que eles causem danos à organização e aos seus clientes."
)
PT_2 = (
    "A autenticação multifator adiciona uma segunda camada de defesa, de modo que uma senha roubada não é "
    "suficiente para que um atacante entre na conta e se mova lateralmente dentro da rede."
)
PT_BOOK = "guia_seguranca_pt"
PT_SECTION = f"{PT_BOOK}:c01:c01_1"


@pytest.fixture(autouse=True)
def _fresh_warm_scheduler():
    reading_warm.scheduler.shutdown()
    yield
    reading_warm.scheduler.shutdown()


@pytest.fixture()
def pt_env(reading_env, tmp_path):  # noqa: F811 - pytest fixture injection
    """A second book, in Portuguese, with no ``language`` in its manifest (detected from the text)."""
    _write_book(
        tmp_path / "json", slug=PT_BOOK, title="Guia de Segurança", language=None,
        chapters={"c01.xhtml": ("Capítulo 1: Engenharia Social", [_section("c01_1", 1, "Capítulo 1 Engenharia Social", PT_1 + " " + PT_2)])},
    )
    material_corpus.clear_corpus_cache()
    yield
    material_corpus.clear_corpus_cache()


def _stream_lines(http, url=STREAM, **params) -> tuple[int, list[dict], dict[str, str]]:
    with http.stream("GET", url, params={"part_id": SECTION, "block_index": 0, **params}) as response:
        raw = [line for line in response.iter_lines() if line.strip()]
        return response.status_code, [json.loads(line) for line in raw], dict(response.headers)


# ---------------------------------------------------------------------------- stream
def test_stream_forwards_ndjson_with_audio_urls_and_text(login_client, reading_env):
    http, _user = login_client()
    status, events, headers = _stream_lines(http, speed=1.1)
    assert status == 200
    assert headers["content-type"].startswith("application/x-ndjson") and headers["cache-control"] == "no-store"
    assert headers["x-accel-buffering"] == "no"
    assert [e["type"] for e in events] == ["meta", "segment", "segment", "done"]
    meta, *segments, done = events
    text = PARA_1 + " " + PARA_2
    assert meta["text"] == text and meta["sentences"] == 2 and meta["speed"] == 1.1 and meta["lang"] == "en-us"
    assert [s["index"] for s in segments] == [0, 1]
    assert [text[s["char_start"]:s["char_end"]] for s in segments] == [PARA_1, PARA_2]
    for segment in segments:
        assert segment["audio_url"] == f"/api/reading/audio/{segment['audio_id']}" and segment["cached"] is False
        for word in segment["words"]:
            assert text[word["char_start"]:word["char_end"]] == word["text"]
        assert segment["words"][0]["start"] == 0.0  # timings are relative to the sentence audio
        audio = http.get(segment["audio_url"])
        assert audio.status_code == 200 and audio.content[:4] == b"RIFF"
    assert done["duration_seconds"] == pytest.approx(sum(s["duration_seconds"] for s in segments))
    assert len({s["audio_id"] for s in segments}) == 2 and meta["block_audio_id"] not in {s["audio_id"] for s in segments}

    # Second time: every sentence comes from the cache.
    _status, again, _headers = _stream_lines(http, speed=1.1)
    assert all(e["cached"] is True for e in again if e["type"] == "segment")
    # A child part of the same section streams too.
    with http.stream("GET", STREAM, params={"part_id": CHILD, "block_index": 0}) as response:
        assert response.status_code == 200


def test_stream_errors_before_the_first_byte_are_json(login_client, reading_env, monkeypatch):
    http, _user = login_client()
    assert http.get(STREAM).status_code == 422  # part_id / block_index required
    missing = http.get(STREAM, params={"part_id": SECTION, "block_index": 99})
    assert missing.status_code == 404 and missing.json()["code"] == "block_not_found"
    outside = http.get(STREAM, params={"part_id": NEXT, "block_index": 0})
    assert outside.status_code == 404 and outside.json()["code"] == "block_not_found"
    voice = http.get(STREAM, params={"part_id": SECTION, "block_index": 0, "voice": "zz_nobody"})
    assert voice.status_code == 400 and voice.json()["code"] == "voice_invalid"
    assert http.get(STREAM, params={"part_id": SECTION, "block_index": 0, "speed": 3}).status_code == 422
    assert http.get(f"/api/reading/sections/{BOOK}:c09:nope/tts/stream", params={"part_id": SECTION, "block_index": 0}).json()["code"] == "block_not_found"

    monkeypatch.setattr(settings, "speech_provider", "http")
    speech_client.reset_speech_client()
    down = http.get(STREAM, params={"part_id": SECTION, "block_index": 0})
    assert down.status_code == 503 and down.json()["code"] == "speech_unavailable"


def test_stream_requires_login(client, reading_env):
    assert client.get(STREAM, params={"part_id": SECTION, "block_index": 0}).status_code == 401


def test_stream_failure_after_the_first_line_becomes_an_error_line(login_client, reading_env, monkeypatch):
    async def broken(self, text, *, voice, speed, priority="normal"):
        yield json.dumps({"type": "meta", "block_audio_id": "0" * 64, "sentences": 2})
        raise SpeechError(502, "tts_failed", "engine crashed")

    monkeypatch.setattr(FakeSpeechClient, "tts_stream", broken)
    http, _user = login_client()
    status, events, _headers = _stream_lines(http)
    assert status == 200
    assert [e["type"] for e in events] == ["meta", "error"]
    assert events[0]["text"] == PARA_1 + " " + PARA_2
    assert events[1] == {"type": "error", "code": "tts_failed", "message": "engine crashed"}


def test_stream_upstream_503_before_first_line(login_client, reading_env, monkeypatch):
    async def warming(self, text, *, voice, speed, priority="normal"):
        raise SpeechError(503, "speech_warming", "loading")
        yield  # noqa: unreachable - makes this an async generator

    monkeypatch.setattr(FakeSpeechClient, "tts_stream", warming)
    http, _user = login_client()
    response = http.get(STREAM, params={"part_id": SECTION, "block_index": 0})
    assert response.status_code == 503 and response.json()["code"] == "speech_warming"


def test_stream_counts_in_the_reading_rate_limit_bucket():
    from app.middleware.rate_limit import RateLimitMiddleware

    middleware = RateLimitMiddleware(lambda scope, receive, send: None, settings=settings)
    assert middleware._resolve_policy("/api/reading/sections/x:c01:a/tts/stream", "GET")[0] == "reading"
    assert middleware._resolve_policy("/api/reading/sections/x:c01:a/warm", "POST")[0] == "reading"
    assert middleware._resolve_policy("/api/reading/sections/x:c01:a", "GET")[0] == "public"
    assert middleware._resolve_policy("/api/reading/library", "GET")[0] == "public"


# ---------------------------------------------------------------------------- HTTP client stream
def _collect(client: SpeechClient, **kwargs) -> list[str]:
    async def run():
        return [line async for line in client.tts_stream("Hello there. Second one.", voice="af_heart", speed=1.0, **kwargs)]

    return asyncio.run(run())


def _mock(client: SpeechClient, handler, monkeypatch) -> None:
    monkeypatch.setattr(
        client, "_async_client",
        lambda: httpx.AsyncClient(base_url=client.base_url, transport=httpx.MockTransport(handler), headers=client._headers()),
    )


def test_speech_http_client_streams_lines_and_sends_priority(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["priority"] = request.headers.get("x-speech-priority")
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        lines = [{"type": "meta", "sentences": 1}, {"type": "segment", "index": 0}, {"type": "done"}]
        return httpx.Response(200, content="\n".join(json.dumps(line) for line in lines).encode() + b"\n\n")

    client = SpeechClient("http://speech.invalid:8100", token="secret")
    _mock(client, handler, monkeypatch)
    lines = _collect(client, priority="low")
    assert [json.loads(line)["type"] for line in lines] == ["meta", "segment", "done"]
    assert captured["path"] == "/v1/tts/stream" and captured["priority"] == "low" and captured["auth"] == "Bearer secret"
    assert captured["body"] == {"text": "Hello there. Second one.", "voice": "af_heart", "speed": 1.0, "lang": "en-us"}


def test_speech_http_client_stream_maps_failures(monkeypatch):
    client = SpeechClient("http://speech.invalid:8100")

    def refused(request):
        raise httpx.ConnectError("refused")

    _mock(client, refused, monkeypatch)
    with pytest.raises(SpeechError) as exc:
        _collect(client)
    assert (exc.value.status_code, exc.value.code) == (503, "speech_unavailable")

    def timeout(request):
        raise httpx.ReadTimeout("slow")

    _mock(client, timeout, monkeypatch)
    with pytest.raises(SpeechError) as exc:
        _collect(client)
    assert (exc.value.status_code, exc.value.code) == (504, "speech_timeout")

    def not_ready(request):
        return httpx.Response(503, json={"code": "model_not_ready", "message": "loading"})

    _mock(client, not_ready, monkeypatch)
    with pytest.raises(SpeechError) as exc:
        _collect(client)
    assert (exc.value.status_code, exc.value.code) == (503, "speech_warming")


def test_speech_http_client_tts_sends_priority_header(monkeypatch):
    captured: dict = {}

    def fake_request(self, method, url, **kwargs):
        captured.update(kwargs)
        return httpx.Response(200, json={"audio_id": "0" * 64}, request=httpx.Request(method, "http://speech/v1/tts"))

    monkeypatch.setattr(httpx.Client, "request", fake_request)
    client = SpeechClient("http://speech.invalid:8100")
    client.tts("hello", voice="af_heart", speed=1.0, priority="low")
    assert captured["headers"] == {"X-Speech-Priority": "low"}
    client.tts("hello", voice="af_heart", speed=1.0)
    assert captured["headers"] == {"X-Speech-Priority": "normal"}
    client.tts("hello", voice="af_heart", speed=1.0, priority="urgent")  # unknown values never reach the service
    assert captured["headers"] == {"X-Speech-Priority": "normal"}


# ---------------------------------------------------------------------------- warm-up
def test_blocks_ahead_follows_the_rendered_order_and_the_next_section(reading_env):
    ahead = reading.blocks_ahead(SECTION, SECTION, 0, 2)
    assert [(s, p, i) for s, p, i, _t in ahead] == [(SECTION, SECTION, 0), (SECTION, CHILD, 0), (NEXT, NEXT, 0)]
    assert ahead[0][3] == PARA_1 + " " + PARA_2 and ahead[1][3] == PARA_2 + " " + PARA_1
    # From the child's block: the children after it, then the next section.
    from_child = reading.blocks_ahead(SECTION, CHILD, 0, 10)
    assert from_child[0][:3] == (SECTION, CHILD, 0) and from_child[-1][:3] == (NEXT, NEXT, 0)
    assert all(text.strip() for *_rest, text in from_child)
    # Unknown position, foreign part or zero count: nothing (never text a client invented).
    assert reading.blocks_ahead(SECTION, SECTION, 99, 6) == []
    assert reading.blocks_ahead(SECTION, NEXT, 0, 6) == []
    assert reading.blocks_ahead(SECTION, SECTION, 0, 0) == []
    # The last section has no successor.
    assert [s for s, *_rest in reading.blocks_ahead(NEXT, NEXT, 0, 6)] == [NEXT]


def test_warm_queues_dedupes_and_calls_tts_with_low_priority(login_client, reading_env, monkeypatch, caplog):
    calls: list[dict] = []
    original = FakeSpeechClient.tts

    def recording(self, text, *, voice, speed, priority="normal"):
        calls.append({"text": text, "voice": voice, "speed": speed, "priority": priority})
        return original(self, text, voice=voice, speed=speed, priority=priority)

    monkeypatch.setattr(FakeSpeechClient, "tts", recording)
    monkeypatch.setattr(reading_warm.scheduler, "_dispatch", lambda job: job())  # run the job inline
    monkeypatch.setattr(settings, "reading_warm_blocks_ahead", 2)
    http, _user = login_client()

    with caplog.at_level(logging.INFO, logger="app.reading.warm"):
        first = http.post(WARM, json={"part_id": SECTION, "block_index": 0, "speed": 0.9})
    assert first.status_code == 202, first.text
    assert first.json() == {"queued": 3, "skipped": 0}  # 2 blocks ahead + first block of the next section
    assert [c["priority"] for c in calls] == ["low"] * 3 and {c["speed"] for c in calls} == {0.9}
    assert calls[0]["text"] == PARA_1 + " " + PARA_2 and calls[-1]["text"].startswith(PARA_2)
    event = next(r for r in caplog.records if getattr(r, "event", None) == "reading_warm")
    assert (event.blocks, event.synthesized, event.cached, event.failed) == (3, 3, 0, 0) and event.duration_ms >= 0
    assert reading_warm.scheduler.pending_count() == 0

    # Same position within 60 s: everything is skipped, nothing synthesized again.
    again = http.post(WARM, json={"part_id": SECTION, "block_index": 0, "speed": 0.9})
    assert again.json() == {"queued": 0, "skipped": 3} and len(calls) == 3
    # Another voice is other audio; the next position overlaps on two blocks.
    assert http.post(WARM, json={"part_id": SECTION, "block_index": 0, "speed": 0.9, "voice": "am_adam"}).json() == {"queued": 3, "skipped": 0}
    assert http.post(WARM, json={"part_id": CHILD, "block_index": 0, "speed": 0.9}).json()["skipped"] >= 1
    # The warmed sentences are what the stream serves: the block is now cached for the fake client.
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": SECTION, "block_index": 0, "speed": 0.9}).json()["cached"] is True

    missing = http.post(WARM, json={"part_id": SECTION, "block_index": 42})
    assert missing.status_code == 404 and missing.json()["code"] == "block_not_found"
    assert http.post(WARM, json={"part_id": SECTION, "block_index": 0, "voice": "zz_nobody"}).json()["code"] == "voice_invalid"
    assert http.post(WARM, json={"part_id": SECTION, "block_index": 0, "text": "evil"}).status_code == 422


def test_warm_queue_limit_and_failures_never_propagate(login_client, reading_env, monkeypatch, caplog):
    monkeypatch.setattr(reading_warm.scheduler, "_dispatch", lambda job: job())
    monkeypatch.setattr(settings, "reading_warm_blocks_ahead", 6)
    monkeypatch.setattr(settings, "reading_warm_queue_max", 2)
    http, _user = login_client()
    body = http.post(WARM, json={"part_id": SECTION, "block_index": 0}).json()
    assert body["queued"] == 2 and body["skipped"] >= 1

    def broken(self, text, *, voice, speed, priority="normal"):
        raise SpeechError(503, "speech_warming", "loading")

    monkeypatch.setattr(FakeSpeechClient, "tts", broken)
    monkeypatch.setattr(settings, "reading_warm_queue_max", 200)
    with caplog.at_level(logging.INFO, logger="app.reading.warm"):
        response = http.post(WARM, json={"part_id": CHILD, "block_index": 0, "voice": "am_adam"})
    assert response.status_code == 202 and response.json()["queued"] >= 1
    event = [r for r in caplog.records if getattr(r, "event", None) == "reading_warm"][-1]
    assert event.failed == 1 and event.code == "speech_warming"  # stops at the first 503: the rest would fail too
    assert reading_warm.scheduler.pending_count() == 0


def test_warm_disabled_and_without_speech(login_client, reading_env, monkeypatch):
    http, _user = login_client()
    monkeypatch.setattr(settings, "reading_warm_enabled", False)
    response = http.post(WARM, json={"part_id": SECTION, "block_index": 0})
    assert response.status_code == 202 and response.json() == {"queued": 0, "skipped": 0, "enabled": False}
    assert http.get("/api/reading/capabilities").json()["warm"] == {"enabled": False, "blocks_ahead": 6}

    monkeypatch.setattr(settings, "reading_warm_enabled", True)
    monkeypatch.setattr(settings, "speech_provider", "http")
    speech_client.reset_speech_client()
    down = http.post(WARM, json={"part_id": SECTION, "block_index": 0})
    assert down.status_code == 503 and down.json()["code"] == "speech_unavailable"


def test_warm_scheduler_runs_on_its_own_thread_and_shuts_down(reading_env, monkeypatch):
    monkeypatch.setattr(settings, "speech_provider", "fake")
    speech_client.reset_speech_client()
    scheduler = reading_warm.WarmScheduler()
    assert scheduler._executor is None  # lazy: nothing started at import or construction
    result = scheduler.schedule(SECTION, SECTION, 0, voice="af_heart", speed=1.0)
    assert result["queued"] >= 1 and scheduler._executor is not None
    scheduler._executor.shutdown(wait=True)
    assert scheduler.pending_count() == 0
    client = speech_client.get_speech_client()
    assert client.tts(PARA_1 + " " + PARA_2, voice="af_heart", speed=1.0)["cached"] is True
    scheduler.shutdown()
    assert scheduler._executor is None


# ---------------------------------------------------------------------------- language
def test_detect_language():
    assert detect_language(PARA_1 + " " + PARA_2) == "en"
    assert detect_language(PT_1 + " " + PT_2) == "pt"
    assert detect_language(
        "La autenticación multifactor añade una segunda capa de defensa, de modo que una contraseña robada no es "
        "suficiente para que el atacante inicie sesión en la cuenta y se mueva por la red de la empresa."
    ) == "es"
    assert detect_language("xq zzv plork vrm qqt blarg snorf 1234 ...") == "unknown"
    assert detect_language("") == "unknown"
    assert detect_language("0x41 0x42 0x43 ; ; ; <<< >>>") == "unknown"


def test_book_language_is_exposed_and_detected(login_client, pt_env):
    http, _user = login_client()
    books = {b["slug"]: b for b in http.get("/api/reading/library").json()["books"]}
    assert books[BOOK]["language"] == "en" and books[PT_BOOK]["language"] == "pt"
    assert http.get(f"/api/reading/sections/{SECTION}").json()["language"] == "en"
    assert http.get(f"/api/reading/sections/{PT_SECTION}").json()["language"] == "pt"
    assert http.get(f"/api/reading/books/{PT_BOOK}/chapters/c01/offline-manifest").json()["book"]["language"] == "pt"
    assert http.get(f"/api/reading/books/{BOOK}/chapters/c01/offline-manifest").json()["book"]["language"] == "en"


def test_manifest_language_wins_over_detection(tmp_path):
    root = tmp_path / "json"
    _write_book(root, slug="declared", language="es", chapters={"c01.xhtml": ("Chapter 1", [_section("c01_1", 1, "Chapter 1", PARA_1 + " " + PARA_2)])})
    _write_book(root, slug="detected", language=None, chapters={"c01.xhtml": ("Chapter 1", [_section("c01_1", 1, "Chapter 1", PARA_1 + " " + PARA_2)])})
    _write_book(root, slug="junk", language="xx", chapters={"c01.xhtml": ("Chapter 1", [_section("c01_1", 1, "Chapter 1", "zzz qqq vvv")])})
    corpus = material_corpus.build_corpus(root)
    assert corpus.books["declared"].language == "es"
    assert corpus.books["detected"].language == "en"
    assert corpus.books["junk"].language == "unknown"


def test_non_english_books_get_409_on_speech_endpoints(login_client, pt_env, monkeypatch):
    monkeypatch.setattr(reading_warm.scheduler, "_dispatch", lambda job: job())
    http, _user = login_client()
    base = f"/api/reading/sections/{PT_SECTION}"
    tts = http.post(f"{base}/tts", json={"part_id": PT_SECTION, "block_index": 0})
    assert tts.status_code == 409 and tts.json()["code"] == "language_unsupported" and tts.json()["language"] == "pt"
    stream = http.get(f"{base}/tts/stream", params={"part_id": PT_SECTION, "block_index": 0})
    assert stream.status_code == 409 and stream.json()["code"] == "language_unsupported"
    warm = http.post(f"{base}/warm", json={"part_id": PT_SECTION, "block_index": 0})
    assert warm.status_code == 409 and warm.json()["language"] == "pt"
    assess = http.post(
        f"{base}/assess", files={"audio": ("r.webm", b"FAKE:" + PT_1.encode(), "audio/webm")},
        data={"part_id": PT_SECTION, "block_index": "0"},
    )
    assert assess.status_code == 409 and assess.json()["code"] == "language_unsupported"
    # Reading itself, progress and the English book are untouched.
    assert http.get(base).status_code == 200
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": SECTION, "block_index": 0}).status_code == 200


# ---------------------------------------------------------------------------- capabilities
def test_capabilities_increment_3(login_client, reading_env, monkeypatch):
    http, _user = login_client()
    caps = http.get("/api/reading/capabilities").json()
    assert caps["tts"]["speeds"] == [0.5, 0.6, 0.75, 0.9, 1.0, 1.1, 1.25]
    assert caps["tts"]["streaming"] is True
    assert caps["warm"] == {"enabled": True, "blocks_ahead": 6}
    assert http.post(f"/api/reading/sections/{SECTION}/tts", json={"part_id": SECTION, "block_index": 0, "speed": 0.5}).status_code == 200
    health = speech_client.get_speech_client().health()
    assert health.runtime["max_concurrency"] == 1 and set(health.runtime["threads"]) == {"asr", "torch", "phoneme"}

    original = FakeSpeechClient.health

    def warming(self, *, force=False):
        health = original(self)
        return speech_client.SpeechHealth(status="warming", tts={**health.tts, "ready": False}, asr=health.asr, phoneme=health.phoneme)

    monkeypatch.setattr(FakeSpeechClient, "health", warming)
    tts = http.get("/api/reading/capabilities").json()["tts"]
    assert tts["available"] is False and tts["streaming"] is False and tts["reason"] == "speech_warming"

    monkeypatch.setattr(settings, "speech_provider", "http")
    speech_client.reset_speech_client()
    assert http.get("/api/reading/capabilities").json()["tts"]["streaming"] is False
