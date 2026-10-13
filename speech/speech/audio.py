"""ffmpeg helpers: encode synthesized audio, decode uploaded recordings.

Everything goes through ffmpeg subprocesses because browsers upload whatever
``MediaRecorder`` produces (webm/opus, ogg/opus, mp4/aac...) and no pure-Python
decoder covers all of them. Uploaded bytes are decoded through a temporary file that
is removed immediately: MP4 from Safari keeps its ``moov`` atom at the end, which
ffmpeg cannot read from a pipe.
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile

import numpy as np
import soundfile as sf

ASR_SAMPLE_RATE = 16_000
FFMPEG_TIMEOUT = 120


class AudioDecodeError(ValueError):
    """The upload is not decodable audio."""


def ffmpeg_path() -> str | None:
    return shutil.which("ffmpeg")


def ffmpeg_available() -> bool:
    return ffmpeg_path() is not None


def encode_wav(audio_f32: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.asarray(audio_f32, dtype=np.float32), sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def encode_mp3(audio_f32: np.ndarray, sample_rate: int, bitrate: str = "64k") -> bytes:
    """float32 mono PCM -> MP3 (libmp3lame, mono, constant bitrate)."""
    ffmpeg = ffmpeg_path()
    if ffmpeg is None:
        raise RuntimeError("ffmpeg not found")
    pcm = np.ascontiguousarray(np.asarray(audio_f32, dtype=np.float32)).tobytes()
    cmd = [
        ffmpeg, "-nostdin", "-v", "error",
        "-f", "f32le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
        "-codec:a", "libmp3lame", "-b:a", bitrate, "-ac", "1",
        "-f", "mp3", "pipe:1",
    ]
    proc = subprocess.run(cmd, input=pcm, capture_output=True, timeout=FFMPEG_TIMEOUT, check=False)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg mp3 encode failed: {proc.stderr.decode('utf-8', 'replace')[:400]}")
    return proc.stdout


def decode_to_f32(data: bytes, sample_rate: int = ASR_SAMPLE_RATE) -> np.ndarray:
    """Any container/codec ffmpeg knows -> mono float32 at ``sample_rate``."""
    ffmpeg = ffmpeg_path()
    if ffmpeg is None:
        raise RuntimeError("ffmpeg not found")
    if not data:
        raise AudioDecodeError("empty audio")
    fd, path = tempfile.mkstemp(prefix="speech-upload-", suffix=".bin")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        cmd = [
            ffmpeg, "-nostdin", "-v", "error", "-i", path,
            "-vn", "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(sample_rate), "pipe:1",
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT, check=False)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    if proc.returncode != 0 or len(proc.stdout) < 4:
        raise AudioDecodeError(proc.stderr.decode("utf-8", "replace").strip()[:400] or "undecodable audio")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def decode_file_to_f32(path: str | os.PathLike[str], sample_rate: int) -> np.ndarray:
    """A cached ``.wav``/``.mp3`` back to mono float32 at ``sample_rate`` (block concatenation).

    WAV goes through soundfile (no ffmpeg needed, bit exact); anything else through
    ffmpeg, which honours LAME's gapless header so the decoded MP3 keeps its length.
    """
    path = os.fspath(path)
    if path.lower().endswith(".wav"):
        data, sr = sf.read(path, dtype="float32", always_2d=True)
        mono = data.mean(axis=1).astype(np.float32) if data.shape[1] > 1 else data[:, 0].copy()
        if sr != sample_rate:
            raise AudioDecodeError(f"cached wav is {sr} Hz, expected {sample_rate}")
        return mono
    ffmpeg = ffmpeg_path()
    if ffmpeg is None:
        raise RuntimeError("ffmpeg not found")
    cmd = [
        ffmpeg, "-nostdin", "-v", "error", "-i", path,
        "-vn", "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(sample_rate), "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT, check=False)
    if proc.returncode != 0 or len(proc.stdout) < 4:
        raise AudioDecodeError(proc.stderr.decode("utf-8", "replace").strip()[:400] or "undecodable cached audio")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def fit_length(audio_f32: np.ndarray, samples: int) -> np.ndarray:
    """Trim or zero-pad to exactly ``samples`` (codec priming/padding never shifts a word)."""
    if samples <= 0:
        return np.zeros(0, dtype=np.float32)
    if len(audio_f32) >= samples:
        return np.asarray(audio_f32[:samples], dtype=np.float32)
    out = np.zeros(samples, dtype=np.float32)
    out[: len(audio_f32)] = audio_f32
    return out


def duration_seconds(audio_f32: np.ndarray, sample_rate: int) -> float:
    return round(float(len(audio_f32)) / float(sample_rate), 3) if sample_rate else 0.0
