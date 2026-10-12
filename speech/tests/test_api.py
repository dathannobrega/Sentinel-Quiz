from __future__ import annotations

import io
import shutil
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from speech.config import Settings
from speech.main import create_app

TEXT = "Security awareness training teaches employees to recognize phishing. Multifactor authentication adds a second layer of defense."


def make_client(tmp_path, monkeypatch, **env: str) -> Iterator[TestClient]:
    base = {
        "SPEECH_TTS_ENGINE": "fake",
        "SPEECH_ASR_ENGINE": "fake",
        "SPEECH_PHONEME_ENGINE": "none",
        "SPEECH_CACHE_DIR": str(tmp_path / "cache"),
        "SPEECH_PRELOAD": "false",
        "SPEECH_API_TOKEN": "",
        "SPEECH_MAX_AUDIO_BYTES": "8000000",
    }
    base.update(env)
    for key, value in base.items():
        monkeypatch.setenv(key, value)
    settings = Settings()
    app = create_app(settings)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def client(tmp_path, monkeypatch) -> Iterator[TestClient]:
    yield from make_client(tmp_path, monkeypatch)


def test_healthz_shape(client: TestClient) -> None:
    res = client.get("/healthz")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] in {"ok", "warming", "degraded"}
    assert body["tts"]["engine"] == "fake" and body["asr"]["engine"] == "fake"
    assert body["tts"]["default_voice"] == "af_heart"
    assert {"id", "label", "lang", "gender"} <= set(body["tts"]["voices"][0])
    assert "ready" in body["tts"] and "ready" in body["asr"]
    assert body["phoneme"] == {"engine": "none", "model": body["phoneme"]["model"], "ready": False, "error": None}


def test_tts_words_offsets_and_cache(client: TestClient) -> None:
    res = client.post("/v1/tts", json={"text": TEXT, "voice": "af_heart", "speed": 1.0, "lang": "en-us"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["audio_id"]) == 64 and body["cached"] is False
    assert body["engine"] == "fake" and body["voice"] == "af_heart" and body["speed"] == 1.0
    assert body["duration_seconds"] > 0 and body["sample_rate"] == 24000
    assert body["content_type"] in {"audio/mpeg", "audio/wav"}
    words = body["words"]
    assert [w["text"] for w in words][:3] == ["Security", "awareness", "training"]
    for w in words:
        assert TEXT[w["char_start"]:w["char_end"]] == w["text"]
        assert w["start"] < w["end"]
    assert words[-1]["end"] == pytest.approx(body["duration_seconds"], abs=1e-3)

    again = client.post("/v1/tts", json={"text": TEXT, "voice": "af_heart", "speed": 1.0, "lang": "en-us"})
    assert again.status_code == 200
    assert again.json()["cached"] is True
    assert again.json()["audio_id"] == body["audio_id"]
    assert again.json()["words"] == words

    # A different speed is a different audio id.
    other = client.post("/v1/tts", json={"text": TEXT, "speed": 1.25})
    assert other.json()["audio_id"] != body["audio_id"]


def test_audio_endpoint_serves_bytes(client: TestClient) -> None:
    body = client.post("/v1/tts", json={"text": "Hello world."}).json()
    res = client.get(f"/v1/audio/{body['audio_id']}")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith(body["content_type"])
    assert res.headers["cache-control"] == "private, max-age=86400"
    assert len(res.content) > 100
    if body["content_type"] == "audio/wav":
        assert res.content[:4] == b"RIFF"

    missing = client.get("/v1/audio/" + "0" * 64)
    assert missing.status_code == 404 and missing.json()["code"] == "audio_not_found"
    bad = client.get("/v1/audio/not-an-id")
    assert bad.status_code == 404


def test_tts_validation_errors(client: TestClient) -> None:
    res = client.post("/v1/tts", json={"text": "   "})
    assert res.status_code == 400 and res.json() == {"code": "text_required", "message": res.json()["message"]}
    res = client.post("/v1/tts", json={})
    assert res.status_code == 400 and res.json()["code"] == "text_required"
    res = client.post("/v1/tts", json={"text": "x" * 2001})
    assert res.status_code == 400 and res.json()["code"] == "text_too_long"
    res = client.post("/v1/tts", json={"text": "hi", "voice": "nope"})
    assert res.status_code == 400 and res.json()["code"] == "voice_invalid"
    res = client.post("/v1/tts", json={"text": "hi", "speed": 3.0})
    assert res.status_code == 422 and res.json()["code"] == "validation_error"
    res = client.post("/v1/tts", json={"text": "hi", "lang": "fr"})
    assert res.status_code == 400 and res.json()["code"] == "lang_invalid"


def _assess(client: TestClient, transcript: str | None, reference: str = TEXT, **form):
    payload = f"FAKE:{transcript}".encode() if transcript is not None else b"\x00\x01binary"
    files = {"audio": ("clip.webm", io.BytesIO(payload), "audio/webm")}
    data = {"reference_text": reference, "lang": "en", **form}
    return client.post("/v1/assess", files=files, data=data)


def test_assess_perfect_with_binary_falls_back_to_reference(client: TestClient) -> None:
    res = _assess(client, None)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["engine"] == "fake" and body["text"] == TEXT
    assert all(w["status"] == "ok" for w in body["words"])
    assert body["extras"] == []
    assert body["scores"]["accuracy"] == 1.0 and body["scores"]["completeness"] == 1.0
    assert body["scores"]["overall"] >= 0.85
    assert body["metrics"]["reference_words"] == len(body["words"]) == 16
    assert body["speech_seconds"] > 0 and body["duration_seconds"] >= body["speech_seconds"]
    for w in body["words"]:
        assert TEXT[w["char_start"]:w["char_end"]] == w["text"]
        assert w["expected_ipa"] is None and w["heard_ipa"] is None


def test_assess_fake_transcript_statuses(client: TestClient) -> None:
    transcript = (
        "security awareness um training teaches employees to recognize fixing "
        "multifactor authentication adds second@0.3 layer of defense"
    )
    res = _assess(client, transcript)
    assert res.status_code == 200, res.text
    body = res.json()
    by_text = {w["text"]: w for w in body["words"]}
    assert by_text["Security"]["status"] == "ok" and by_text["Security"]["heard"] == "security"
    assert by_text["phishing"]["status"] == "mispronounced" and by_text["phishing"]["heard"] == "fixing"
    assert by_text["phishing"]["reason"] == "substitution"
    assert by_text["phishing"]["expected_ipa"] and by_text["phishing"]["heard_ipa"]
    # misaki's private capitals never leak: standard IPA only.
    assert not set("AIWYOQT") & set(by_text["phishing"]["expected_ipa"] + by_text["phishing"]["heard_ipa"])
    assert by_text["a"]["status"] == "missed" and by_text["a"]["heard"] is None
    assert by_text["second"]["status"] == "weak" and by_text["second"]["confidence"] == 0.3
    assert by_text["second"]["reason"] == "low_confidence"
    assert by_text["second"]["expected_ipa"]
    assert by_text["Security"]["phonemes"] is None and by_text["Security"]["phoneme_score"] is None
    assert body["extras"] == [{"text": "um", "after_index": 1, "start": 0.7, "end": 1.0}]
    m = body["metrics"]
    assert (m["ok"], m["weak"], m["mispronounced"], m["missed"], m["extra"]) == (13, 1, 1, 1, 1)
    s = body["scores"]
    # word_acc: 13 ok = 1, weak = 0.5, substitution = 0.25, missed = 0
    assert s["accuracy"] == pytest.approx((13 + 0.5 + 0.25) / 16, abs=1e-3)
    assert s["completeness"] == pytest.approx(15 / 16, abs=1e-3)
    assert body["prosody"] is not None and s["prosody"] == body["prosody"]["score"]
    expected = (0.5 * s["accuracy"] + 0.2 * s["completeness"] + 0.15 * s["fluency"] + 0.15 * s["prosody"]) / 1.0
    assert s["overall"] == pytest.approx(expected, abs=2e-3)
    assert body["engines"] == {"asr": "fake", "phoneme": None}
    assert body["transcript"].startswith("security awareness um")
    assert "attempt_id" not in body


def test_assess_validation(client: TestClient) -> None:
    res = _assess(client, "hello", reference="   ")
    assert res.status_code == 400 and res.json()["code"] == "text_required"
    res = _assess(client, "hello", reference="x" * 2001)
    assert res.status_code == 400 and res.json()["code"] == "text_too_long"
    res = _assess(client, "hello", lang="pt")
    assert res.status_code == 400 and res.json()["code"] == "lang_invalid"
    empty = client.post("/v1/assess", files={"audio": ("a.webm", io.BytesIO(b""), "audio/webm")}, data={"reference_text": TEXT})
    assert empty.status_code == 400 and empty.json()["code"] == "audio_invalid"


def test_assess_too_large(tmp_path, monkeypatch) -> None:
    for client in make_client(tmp_path, monkeypatch, SPEECH_MAX_AUDIO_BYTES="100"):
        files = {"audio": ("clip.webm", io.BytesIO(b"x" * 101), "audio/webm")}
        res = client.post("/v1/assess", files=files, data={"reference_text": TEXT})
        assert res.status_code == 413
        assert res.json()["code"] == "audio_too_large"


def test_bearer_token_required_when_configured(tmp_path, monkeypatch) -> None:
    for client in make_client(tmp_path, monkeypatch, SPEECH_API_TOKEN="s3cret"):
        res = client.post("/v1/tts", json={"text": "hi"})
        assert res.status_code == 401 and res.json()["code"] == "unauthorized"
        res = client.post("/v1/tts", json={"text": "hi"}, headers={"Authorization": "Bearer wrong"})
        assert res.status_code == 401
        res = client.post("/v1/tts", json={"text": "hi"}, headers={"Authorization": "Bearer s3cret"})
        assert res.status_code == 200
        # health stays open for the API's probe
        assert client.get("/healthz").status_code == 200


def test_disabled_engines(tmp_path, monkeypatch) -> None:
    for client in make_client(tmp_path, monkeypatch, SPEECH_TTS_ENGINE="none", SPEECH_ASR_ENGINE="none"):
        health = client.get("/healthz").json()
        assert health["tts"]["engine"] == "none" and health["tts"]["ready"] is False
        res = client.post("/v1/tts", json={"text": "hi"})
        assert res.status_code == 503 and res.json()["code"] == "engine_disabled"
        res = _assess(client, "hi", reference="hi")
        assert res.status_code == 503 and res.json()["code"] == "engine_disabled"


def test_cache_eviction_by_size(tmp_path, monkeypatch) -> None:
    for client in make_client(tmp_path, monkeypatch, SPEECH_CACHE_MAX_MB="0", SPEECH_AUDIO_FORMAT="wav"):
        # 0 MB budget means "unbounded" (eviction disabled); use the cache directly for a tiny budget.
        from speech.cache import AudioCache

        cache = AudioCache(tmp_path / "small", max_bytes=3000)
        for i in range(5):
            cache.put("a" * 63 + str(i), b"x" * 1000, "wav", {"i": i})
        remaining = sorted(p.stem for p in (tmp_path / "small" / "tts").iterdir())
        assert len(set(remaining)) <= 2
        assert cache.get("a" * 63 + "4") is not None
        assert cache.get("a" * 63 + "0") is None
        assert client.get("/healthz").status_code == 200


def test_homophone_substitution_is_not_a_mispronunciation(client: TestClient) -> None:
    res = _assess(client, "we recognize fishing emails", reference="We recognize phishing emails.")
    body = res.json()
    word = body["words"][2]
    assert word["text"] == "phishing" and word["heard"] == "fishing"
    assert word["status"] == "ok" and word["reason"] is None
    if shutil.which("espeak-ng"):  # RP homophone (non-rhotic): checked with the en-gb voice too
        body = _assess(client, "fix the critical floor", reference="Fix the critical flaw.").json()
        assert body["words"][3]["status"] == "ok"


def test_ending_difference_is_weak(client: TestClient) -> None:
    res = _assess(client, "the organization policy covers organization assets", reference="The organization's policy covers organizations assets.")
    words = res.json()["words"]
    assert words[1]["status"] == "weak" and words[1]["reason"] == "ending"
    assert words[4]["status"] == "weak" and words[4]["reason"] == "ending"


@pytest.fixture
def phoneme_client(tmp_path, monkeypatch) -> Iterator[TestClient]:
    yield from make_client(tmp_path, monkeypatch, SPEECH_PHONEME_ENGINE="fake")


def test_assess_with_fake_phoneme_engine(phoneme_client: TestClient) -> None:
    reference = "Security teams monitor every threat. Then they respond quickly."
    # "threat" is heard by the ASR as the right word but its sounds are wrong (#tret
    # spells what the phoneme engine hears); "..." is a 1.2 s pause after the period.
    res = _assess(phoneme_client, "security teams monitor every threat#zzzzzz ... then they respond quickly", reference=reference)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["engines"] == {"asr": "fake", "phoneme": "fake"}
    words = {w["text"]: w for w in body["words"]}
    good = words["Security"]
    assert good["status"] == "ok" and good["reason"] is None
    assert good["phoneme_score"] == pytest.approx(1.0, abs=1e-3)
    assert [p["ipa"] for p in good["phonemes"]] == list("security")
    assert all(p["quality"] == "good" and p["heard"] == p["ipa"] for p in good["phonemes"])
    assert good["expected_ipa"] == "security" and good["heard_ipa"] == "security"
    bad = words["threat"]
    assert bad["heard"] == "threat" and bad["status"] == "mispronounced" and bad["reason"] == "phoneme"
    assert bad["phoneme_score"] < 0.6
    assert all(p["quality"] == "bad" for p in bad["phonemes"])
    assert body["tips"] and body["tips"][0]["code"] == "phoneme_confusion"
    assert body["tips"][0]["examples"] == ["threat"]
    # The pause after the period is not a long pause and not an unexpected break.
    assert body["metrics"]["long_pauses"] == 0
    assert words["Then"]["break"] is None
    p = body["prosody"]
    assert set(p) == {"score", "pitch_range_semitones", "monotone", "unexpected_breaks", "missing_breaks"}
    assert p["unexpected_breaks"] == 0 and p["monotone"] is False and p["pitch_range_semitones"] is None
    s = body["scores"]
    assert s["prosody"] == p["score"]
    # accuracy = mean of phoneme scores (no substitution, no missed)
    assert s["accuracy"] == pytest.approx(sum(w["phoneme_score"] for w in body["words"]) / len(body["words"]), abs=2e-3)


def test_unexpected_break_and_long_pause_without_punctuation(phoneme_client: TestClient) -> None:
    res = _assess(phoneme_client, "security teams ... monitor every threat", reference="Security teams monitor every threat.")
    body = res.json()
    assert body["metrics"]["long_pauses"] == 1
    assert body["words"][2]["break"] == "unexpected"
    assert body["prosody"]["unexpected_breaks"] == 1
    assert body["prosody"]["score"] == pytest.approx(0.9)


def test_prosody_null_with_fewer_than_three_words(phoneme_client: TestClient) -> None:
    body = _assess(phoneme_client, "security teams", reference="Security teams.").json()
    assert body["prosody"] is None and body["scores"]["prosody"] is None
    s = body["scores"]
    expected = (0.5 * s["accuracy"] + 0.2 * s["completeness"] + 0.15 * s["fluency"]) / 0.85
    assert s["overall"] == pytest.approx(expected, abs=2e-3)


def test_health_reports_phoneme_engine(phoneme_client: TestClient) -> None:
    body = phoneme_client.get("/healthz").json()
    assert body["phoneme"]["engine"] == "fake"


def test_g2p_endpoint(client: TestClient) -> None:
    res = client.post("/v1/g2p", json={"words": ["threat", "security"], "lang": "en-us"})
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert [i["word"] for i in items] == ["threat", "security"]
    for item in items:
        assert item["ipa"] and not set("AIWYOQT") & set(item["ipa"])
    if shutil.which("espeak-ng"):
        assert items[0]["ipa"] == "θɹˈɛt"
    assert client.post("/v1/g2p", json={"words": []}).status_code == 422
    assert client.post("/v1/g2p", json={"words": ["x" * 65]}).status_code == 422
    assert client.post("/v1/g2p", json={"words": ["a"] * 51}).status_code == 422
    res = client.post("/v1/g2p", json={"words": ["a"], "lang": "pt-br"})
    assert res.status_code == 400 and res.json()["code"] == "lang_invalid"


def test_metrics_endpoint(client: TestClient) -> None:
    client.post("/v1/tts", json={"text": "Hello world."})
    client.post("/v1/tts", json={"text": "Hello world."})
    _assess(client, None)
    res = client.get("/metrics")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/plain")
    text = res.text
    assert 'speech_requests_total{route="/v1/tts",status="200"} 2.0' in text
    assert "speech_tts_cache_hits_total 1.0" in text
    assert "speech_tts_cache_misses_total 1.0" in text
    assert 'speech_inference_seconds_count{engine="fake"}' in text
    assert "speech_tts_cache_bytes " in text
    assert 'speech_model_ready{engine="fake"} 1.0' in text


def test_metrics_requires_token_when_configured(tmp_path, monkeypatch) -> None:
    for client in make_client(tmp_path, monkeypatch, SPEECH_API_TOKEN="s3cret"):
        assert client.get("/metrics").status_code == 401
        res = client.get("/metrics", headers={"Authorization": "Bearer s3cret"})
        assert res.status_code == 200 and "speech_requests_total" in res.text
        assert client.post("/v1/g2p", json={"words": ["a"]}).status_code == 401
