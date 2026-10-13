"""Empty SPEECH_* values (what compose sends for unset APP_SPEECH_* variables) fall back to the
defaults instead of becoming empty model names (regression: phoneme engine never loaded on 1.1.0)."""
from __future__ import annotations

from speech.config import Settings


def test_empty_env_values_fall_back_to_defaults(monkeypatch):
    for name in ("SPEECH_PHONEME_MODEL", "SPEECH_TTS_MODEL", "SPEECH_ASR_MODEL", "SPEECH_TTS_DEFAULT_VOICE", "SPEECH_AUDIO_FORMAT", "SPEECH_PARALLEL_PHONEMES"):
        monkeypatch.setenv(name, "")
    settings = Settings(_env_file=None)
    assert settings.phoneme_model == "facebook/wav2vec2-lv-60-espeak-cv-ft"
    assert settings.tts_model == "hexgrad/Kokoro-82M"
    assert settings.asr_model == "small.en"
    assert settings.tts_default_voice == "af_heart"
    assert settings.audio_format == "mp3"
    assert settings.parallel_phonemes == "auto"


def test_explicit_values_are_kept(monkeypatch):
    monkeypatch.setenv("SPEECH_ASR_MODEL", "base.en")
    assert Settings(_env_file=None).asr_model == "base.en"
