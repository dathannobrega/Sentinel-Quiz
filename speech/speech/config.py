"""Runtime settings for the speech service (contract §5.3).

Every knob is an ``SPEECH_*`` environment variable so the same image runs under
compose, natively on a Mac, and inside tests (which point ``SPEECH_CACHE_DIR`` at a
temporary directory and both engines at ``fake``).
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Kokoro voice catalogue exposed to the API (id -> label, lang, gender). Only the
# voices listed in SPEECH_TTS_VOICES are offered; unknown ids are rejected upstream.
KNOWN_VOICES: dict[str, dict[str, str]] = {
    "af_heart": {"label": "Heart", "lang": "en-US", "gender": "female"},
    "af_bella": {"label": "Bella", "lang": "en-US", "gender": "female"},
    "af_nicole": {"label": "Nicole", "lang": "en-US", "gender": "female"},
    "af_sarah": {"label": "Sarah", "lang": "en-US", "gender": "female"},
    "am_michael": {"label": "Michael", "lang": "en-US", "gender": "male"},
    "am_adam": {"label": "Adam", "lang": "en-US", "gender": "male"},
    "bf_emma": {"label": "Emma", "lang": "en-GB", "gender": "female"},
    "bm_george": {"label": "George", "lang": "en-GB", "gender": "male"},
}

DEFAULT_VOICES = "af_heart,af_bella,af_nicole,am_michael,am_adam,bf_emma,bm_george"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    host: str = Field(default="0.0.0.0", alias="SPEECH_HOST")
    port: int = Field(default=8100, alias="SPEECH_PORT")

    tts_engine: str = Field(default="kokoro", alias="SPEECH_TTS_ENGINE")  # kokoro|fake|none
    tts_model: str = Field(default="hexgrad/Kokoro-82M", alias="SPEECH_TTS_MODEL")
    tts_default_voice: str = Field(default="af_heart", alias="SPEECH_TTS_DEFAULT_VOICE")
    tts_voices: str = Field(default=DEFAULT_VOICES, alias="SPEECH_TTS_VOICES")

    asr_engine: str = Field(default="faster-whisper", alias="SPEECH_ASR_ENGINE")  # faster-whisper|mlx-whisper|fake|none
    asr_model: str = Field(default="small.en", alias="SPEECH_ASR_MODEL")
    asr_compute_type: str = Field(default="int8", alias="SPEECH_ASR_COMPUTE_TYPE")
    asr_threads: int = Field(default=4, alias="SPEECH_ASR_THREADS")
    # Intra-op threads for torch (Kokoro TTS). 0 = leave torch's default (all cores).
    torch_threads: int = Field(default=4, alias="SPEECH_TORCH_THREADS")

    audio_format: str = Field(default="mp3", alias="SPEECH_AUDIO_FORMAT")  # mp3|wav

    cache_dir: str = Field(default="/var/cache/speech", alias="SPEECH_CACHE_DIR")
    cache_max_mb: int = Field(default=2048, alias="SPEECH_CACHE_MAX_MB")

    max_audio_bytes: int = Field(default=8_000_000, alias="SPEECH_MAX_AUDIO_BYTES")
    max_text_chars: int = Field(default=2000, alias="SPEECH_MAX_TEXT_CHARS")
    max_concurrency: int = Field(default=2, alias="SPEECH_MAX_CONCURRENCY")
    # How long a request waits for an inference slot before 503 busy.
    busy_wait_seconds: float = Field(default=60.0, alias="SPEECH_BUSY_WAIT_SECONDS")

    preload: bool = Field(default=True, alias="SPEECH_PRELOAD")
    api_token: str = Field(default="", alias="SPEECH_API_TOKEN")

    hf_home: str = Field(default="", alias="HF_HOME")
    log_level: str = Field(default="INFO", alias="SPEECH_LOG_LEVEL")

    @property
    def voices(self) -> list[str]:
        return [v.strip() for v in self.tts_voices.split(",") if v.strip()]

    @property
    def voice_catalog(self) -> list[dict[str, str]]:
        """Voices as the API expects them in ``/healthz`` (unknown ids get a generic label)."""
        out = []
        for voice_id in self.voices:
            meta = KNOWN_VOICES.get(voice_id, {"label": voice_id, "lang": "en-US", "gender": "unknown"})
            out.append({"id": voice_id, **meta})
        return out

    @property
    def cache_path(self) -> Path:
        return Path(self.cache_dir)

    def apply_hf_home(self) -> None:
        """Make the Hugging Face cache live next to the audio cache unless HF_HOME is set.

        The compose volume mounts ``/var/cache/speech``; keeping model weights under it
        means a single volume survives image upgrades. Must run before importing
        huggingface_hub (which reads HF_HOME at import time).
        """
        if os.environ.get("HF_HOME"):
            return
        target = self.hf_home or str(self.cache_path / "hf")
        os.environ["HF_HOME"] = target


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.apply_hf_home()
    return settings
