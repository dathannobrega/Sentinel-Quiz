from __future__ import annotations

import asyncio
import io
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from speech.api import Busy, EngineQueue, Limiter, stream_sentences
from speech.engines.base import EngineError, HeardWord
from speech.engines.fake import FakePhoneme
from tests.test_api import make_client

BLOCK = (
    "Security awareness training teaches employees to recognize phishing. "
    "Multifactor authentication adds a second layer of defense. "
    "Together they stop most credential theft."
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    yield from make_client(tmp_path, monkeypatch, SPEECH_AUDIO_FORMAT="wav")


def _lines(res: httpx.Response) -> list[dict]:
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("application/x-ndjson")
    assert res.headers["cache-control"] == "no-store" and res.headers["x-accel-buffering"] == "no"
    return [json.loads(line) for line in res.text.splitlines() if line.strip()]


# ------------------------------------------------------------------- stream
def test_stream_lines_in_order_then_cached(client: TestClient) -> None:
    lines = _lines(client.post("/v1/tts/stream", json={"text": BLOCK, "voice": "af_heart", "speed": 1.0, "lang": "en-us"}))
    assert [line["type"] for line in lines] == ["meta", "segment", "segment", "segment", "done"]
    meta = lines[0]
    service = client.app.state.service
    assert meta["block_audio_id"] == service.tts_audio_id(BLOCK, "af_heart", 1.0, "en-us")
    assert meta["sentences"] == 3 and meta["engine"] == "fake" and meta["voice"] == "af_heart"
    assert meta["speed"] == 1.0 and meta["lang"] == "en-us" and meta["content_type"] == "audio/wav"
    segments = lines[1:4]
    assert [s["index"] for s in segments] == [0, 1, 2]
    assert all(s["cached"] is False for s in segments)
    assert segments[0]["char_start"] == 0 and segments[-1]["char_end"] == len(BLOCK)
    for s in segments:
        assert len(s["audio_id"]) == 64 and s["duration_seconds"] > 0
        for w in s["words"]:
            assert BLOCK[w["char_start"]:w["char_end"]] == w["text"]
            assert 0 <= w["start"] < w["end"] <= s["duration_seconds"] + 1e-3
        assert client.get(f"/v1/audio/{s['audio_id']}").status_code == 200
    assert lines[-1]["duration_seconds"] == pytest.approx(sum(s["duration_seconds"] for s in segments), abs=1e-3)

    again = _lines(client.post("/v1/tts/stream", json={"text": BLOCK}))
    assert all(line["cached"] is True for line in again if line["type"] == "segment")
    assert [s["audio_id"] for s in again[1:4]] == [s["audio_id"] for s in segments]

    # The block is not produced by the stream; /v1/tts builds it from the cached sentences.
    assert service.cached_tts(meta["block_audio_id"]) is None
    block = client.post("/v1/tts", json={"text": BLOCK}).json()
    assert block["audio_id"] == meta["block_audio_id"] and block["cached"] is False
    assert block["duration_seconds"] == pytest.approx(lines[-1]["duration_seconds"], abs=1e-3)


def test_stream_validation_errors_are_plain_json(client: TestClient) -> None:
    res = client.post("/v1/tts/stream", json={"text": "  "})
    assert res.status_code == 400 and res.json()["code"] == "text_required"
    res = client.post("/v1/tts/stream", json={"text": "hi", "voice": "nope"})
    assert res.status_code == 400 and res.json()["code"] == "voice_invalid"
    res = client.post("/v1/tts/stream", json={"text": "hi", "lang": "fr"})
    assert res.status_code == 400 and res.json()["code"] == "lang_invalid"


def test_stream_disabled_engine_is_503_before_meta(tmp_path, monkeypatch) -> None:
    for client in make_client(tmp_path, monkeypatch, SPEECH_TTS_ENGINE="none"):
        res = client.post("/v1/tts/stream", json={"text": BLOCK})
        assert res.status_code == 503 and res.json()["code"] == "engine_disabled"


def test_stream_error_line_after_meta(client: TestClient) -> None:
    service = client.app.state.service
    original = service.tts.synthesize

    def flaky(text: str, voice: str, speed: float, lang: str):
        if "Multifactor" in text:
            raise EngineError("boom")
        return original(text, voice, speed, lang)

    service.tts.synthesize = flaky  # type: ignore[method-assign]
    lines = _lines(client.post("/v1/tts/stream", json={"text": BLOCK}))
    assert [line["type"] for line in lines] == ["meta", "segment", "error"]
    assert lines[-1] == {"type": "error", "code": "tts_failed", "message": "boom"}
    # The slot taken for the stream was released.
    assert client.app.state.limiter.tts.in_use == 0


def test_stream_stops_when_client_disconnects(client: TestClient) -> None:
    service = client.app.state.service
    calls: list[str] = []
    original = service.tts.synthesize

    def counting(text: str, voice: str, speed: float, lang: str):
        calls.append(text)
        return original(text, voice, speed, lang)

    service.tts.synthesize = counting  # type: ignore[method-assign]
    limiter = Limiter(client.app.state.settings, 1, service.metrics)
    seen = {"n": 0}

    async def gone_after_first() -> bool:
        seen["n"] += 1
        return seen["n"] > 1  # connected for the first sentence, gone afterwards

    async def run() -> list[dict]:
        out = []
        async for raw in stream_sentences(
            service, limiter, text=BLOCK, voice="af_heart", speed=1.0, lang="en-us", priority="normal",
            is_disconnected=gone_after_first,
        ):
            out.append(json.loads(raw))
        return out

    lines = asyncio.run(run())
    assert [line["type"] for line in lines] == ["meta", "segment"]
    assert len(calls) == 1, "synthesis must stop once the client is gone"
    assert limiter.tts.in_use == 0


def test_stream_priority_header_counts_in_metrics(client: TestClient) -> None:
    client.post("/v1/tts/stream", json={"text": BLOCK}, headers={"X-Speech-Priority": "low"})
    client.post("/v1/tts/stream", json={"text": BLOCK})
    text = client.get("/metrics").text
    assert 'speech_requests_total{priority="low",route="/v1/tts/stream",status="200"} 1.0' in text
    assert 'speech_requests_total{priority="normal",route="/v1/tts/stream",status="200"} 1.0' in text
    assert 'speech_queue_wait_seconds_count{engine="tts",priority="low"} 1.0' in text


# ------------------------------------------------------------------ limiter
def test_engine_queue_low_waits_while_normal_is_queued() -> None:
    async def scenario() -> None:
        q = EngineQueue(1)
        await q.acquire("normal", 1.0)  # A holds the only slot
        order: list[str] = []

        async def take(priority: str) -> None:
            await q.acquire(priority, 5.0)
            order.append(priority)

        low = asyncio.create_task(take("low"))
        await asyncio.sleep(0.01)
        normal = asyncio.create_task(take("normal"))
        await asyncio.sleep(0.01)
        assert order == [] and q.waiting("low") == 1 and q.waiting("normal") == 1
        q.release()  # A done -> the normal waiter wins even though low queued first
        await asyncio.sleep(0.01)
        assert order == ["normal"] and q.waiting("low") == 1
        q.release()  # normal done -> low finally runs
        await asyncio.sleep(0.01)
        assert order == ["normal", "low"]
        q.release()
        assert q.in_use == 0
        await asyncio.gather(low, normal)

    asyncio.run(scenario())


def test_engine_queue_low_times_out_and_normal_fast_path() -> None:
    async def scenario() -> None:
        q = EngineQueue(1)
        await q.acquire("normal", 1.0)
        started = time.perf_counter()
        with pytest.raises(Busy):
            await q.acquire("low", 0.05)
        assert time.perf_counter() - started < 1.0
        assert q.waiting("low") == 0  # the timed-out waiter is gone
        q.release()
        assert q.in_use == 0
        # A low request with a free slot and nobody waiting proceeds immediately.
        assert await q.acquire("low", 0.05) == 0.0
        # With a low waiter queued and a free slot, a normal request still never waits.
        q2 = EngineQueue(1)
        await q2.acquire("normal", 1.0)
        pending = asyncio.create_task(q2.acquire("low", 5.0))
        await asyncio.sleep(0.01)
        q2.release()  # goes to the low waiter (nobody normal is waiting)
        await pending
        assert q2.in_use == 1
        q2.release()

    asyncio.run(scenario())


def test_low_priority_request_gets_503_busy(tmp_path, monkeypatch) -> None:
    for client in make_client(
        tmp_path, monkeypatch, SPEECH_MAX_CONCURRENCY="1", SPEECH_LOW_PRIORITY_WAIT_SECONDS="0.1", SPEECH_AUDIO_FORMAT="wav"
    ):
        app = client.app
        service = app.state.service
        original = service.tts.synthesize

        def slow(text: str, voice: str, speed: float, lang: str):
            time.sleep(0.6)
            return original(text, voice, speed, lang)

        service.tts.synthesize = slow  # type: ignore[method-assign]

        async def scenario() -> tuple[httpx.Response, httpx.Response]:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://speech") as ac:
                normal = asyncio.create_task(ac.post("/v1/tts", json={"text": "Readers come first, always."}))
                await asyncio.sleep(0.1)  # let the normal request take the slot
                low = asyncio.create_task(
                    ac.post("/v1/tts", json={"text": "Warm up later, please."}, headers={"X-Speech-Priority": "low"})
                )
                return await normal, await low

        normal, low = asyncio.run(scenario())
        assert normal.status_code == 200
        assert low.status_code == 503 and low.json()["code"] == "busy" and low.headers["retry-after"] == "5"
        text = client.get("/metrics").text
        assert 'speech_requests_total{priority="low",route="/v1/tts",status="503"} 1.0' in text
        assert 'speech_queue_wait_seconds_count{engine="tts",priority="low"} 1.0' in text


def test_assess_accepts_priority_header(client: TestClient) -> None:
    files = {"audio": ("clip.webm", io.BytesIO(b"\x00\x01binary"), "audio/webm")}
    res = client.post("/v1/assess", files=files, data={"reference_text": BLOCK}, headers={"X-Speech-Priority": "low"})
    assert res.status_code == 200
    assert 'speech_queue_wait_seconds_count{engine="asr",priority="low"} 1.0' in client.get("/metrics").text


# ---------------------------------------------------------- parallel phonemes
class ScriptedPhoneme(FakePhoneme):
    """Fake recognizer that does not need the ASR words (like wav2vec2), so it can run in parallel."""

    needs_heard_words = False

    def __init__(self, script: list[HeardWord]) -> None:
        super().__init__("scripted")
        self.script = script
        self.calls: list[int] = []

    def posteriors(self, audio_f32_16k, heard):  # type: ignore[override]
        self.calls.append(len(heard))
        return super().posteriors(audio_f32_16k, self.script)


REFERENCE = "Security teams monitor every threat. Then they respond quickly."
TRANSCRIPT = "security teams monitor every threat#zzzzzz ... then they respond quickly"


def _assess(client: TestClient):
    files = {"audio": ("clip.webm", io.BytesIO(f"FAKE:{TRANSCRIPT}".encode()), "audio/webm")}
    res = client.post("/v1/assess", files=files, data={"reference_text": REFERENCE, "lang": "en"})
    assert res.status_code == 200, res.text
    return res.json()


def _script(client: TestClient) -> list[HeardWord]:
    return client.app.state.service.asr.transcribe(None, reference_text=REFERENCE, raw_bytes=f"FAKE:{TRANSCRIPT}".encode())


def test_parallel_phoneme_path_matches_sequential(tmp_path, monkeypatch) -> None:
    results = {}
    for mode in ("off", "on"):
        for client in make_client(tmp_path, monkeypatch, SPEECH_PHONEME_ENGINE="fake", SPEECH_PARALLEL_PHONEMES=mode):
            service = client.app.state.service
            service.phoneme = ScriptedPhoneme(_script(client))
            service.phoneme.load()
            assert client.get("/healthz").json()["runtime"]["parallel_phonemes"] is (mode == "on")
            results[mode] = _assess(client)
            assert service.last_assess_parallel is (mode == "on")
            # In parallel the forward runs before the ASR words exist (heard=[]).
            assert service.phoneme.calls == [0] if mode == "on" else service.phoneme.calls[0] > 0
    assert results["on"] == results["off"]
    body = results["on"]
    assert body["engines"] == {"asr": "fake", "phoneme": "fake"}  # engine name, not model
    words = {w["text"]: w for w in body["words"]}
    assert words["threat"]["status"] == "mispronounced" and words["threat"]["reason"] == "phoneme"
    assert words["Security"]["phoneme_score"] == pytest.approx(1.0, abs=1e-3)


def test_fake_phoneme_engine_falls_back_to_sequential(tmp_path, monkeypatch) -> None:
    for client in make_client(tmp_path, monkeypatch, SPEECH_PHONEME_ENGINE="fake", SPEECH_PARALLEL_PHONEMES="on"):
        body = _assess(client)
        assert body["engines"]["phoneme"] == "fake"
        assert client.app.state.service.last_assess_parallel is False


def test_healthz_runtime_block_from_effective_cpus(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("speech.runtime.effective_cpus", lambda *a, **k: 3)
    for client in make_client(tmp_path, monkeypatch):
        assert client.get("/healthz").json()["runtime"] == {
            "effective_cpus": 3,
            "threads": {"asr": 3, "torch": 3, "phoneme": 3},
            "max_concurrency": 1,
            "parallel_phonemes": False,
        }
    monkeypatch.setattr("speech.runtime.effective_cpus", lambda *a, **k: 8)
    for client in make_client(tmp_path, monkeypatch):
        rt = client.get("/healthz").json()["runtime"]
        assert rt["max_concurrency"] == 2 and rt["parallel_phonemes"] is True and rt["threads"]["phoneme"] == 4
