"""NVIDIA Parakeet TDT (NeMo transducer) on CPU through sherpa-onnx (optional extra ``parakeet``).

Why a second ASR: Whisper is a sequence-to-sequence decoder with a strong language
model, so it tends to "autocorrect" a learner's mispronunciation into the expected
word (``docs/reading/CALIBRACAO.md``: the right word was accepted in 35 of 65 audible
respellings). A transducer with greedy search has a much weaker implicit LM and should
write what it hears. ``docs/reading/BAKEOFF-ASR.md`` has the measurements.

Model: ``SPEECH_ASR_MODEL`` is either a directory with the sherpa-onnx export
(``encoder*.onnx``, ``decoder*.onnx``, ``joiner*.onnx``, ``tokens.txt``) or the name of a
release archive of ``k2-fsa/sherpa-onnx`` (default
``sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8``), downloaded once into
``$HF_HOME/sherpa-onnx/<name>/``. A Whisper size name left over from the default
configuration (``small.en``) falls back to the default Parakeet model.

Words: sherpa-onnx returns sentencepiece *pieces* (a leading ``▁`` or space marks a word
start) with one timestamp per piece, a TDT duration per piece and, for greedy search,
one log-probability per piece (``ys_log_probs``). :func:`words_from_pieces` joins the
pieces into words; the word probability is the mean piece probability (the same
convention Whisper uses for its word ``probability``), so ``SPEECH_WEAK_CONFIDENCE``
keeps its meaning. When the build exposes no log-probabilities every word gets 1.0.
"""
from __future__ import annotations

import logging
import math
import os
import re
import tarfile
import tempfile
import urllib.request
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from .base import EngineError, HeardWord, LazyLoader

logger = logging.getLogger("speech.asr.parakeet")

DEFAULT_MODEL = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
RELEASE_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{name}.tar.bz2"
SAMPLE_RATE = 16_000
# End of the last word (and of a word whose TDT duration is 0): last piece + this many seconds.
WORD_TAIL = 0.15
_WHISPER_SIZE_RE = re.compile(r"^(tiny|base|small|medium|large|turbo|distil)[\w.-]*$", re.IGNORECASE)
_ALNUM_RE = re.compile(r"[^\W_]")
_WORD_MARKS = ("▁", " ")
_HYPHENS = set("-\u2010\u2011\u2012\u2013\u2014")


def resolve_model_name(model: str) -> str:
    """``SPEECH_ASR_MODEL`` as the Parakeet engine understands it.

    Empty or a Whisper size (``small.en`` is the service default) -> default Parakeet
    model; anything else (a directory or an archive name) is kept.
    """
    name = (model or "").strip()
    if not name or (_WHISPER_SIZE_RE.match(name) and not os.path.isdir(name)):
        return DEFAULT_MODEL
    return name


def model_files(directory: Path, prefer_int8: bool = True) -> dict[str, Path]:
    """Pick encoder/decoder/joiner/tokens inside a sherpa-onnx transducer export.

    Exports ship ``encoder.int8.onnx`` and/or ``encoder.onnx``; ``prefer_int8`` chooses
    when both exist.
    """
    out: dict[str, Path] = {}
    for part in ("encoder", "decoder", "joiner"):
        candidates = sorted(directory.glob(f"{part}*.onnx"))
        if not candidates:
            raise FileNotFoundError(f"no {part}*.onnx in {directory}")
        int8 = [c for c in candidates if "int8" in c.name]
        other = [c for c in candidates if "int8" not in c.name]
        ordered = (int8 + other) if prefer_int8 else (other + int8)
        out[part] = ordered[0]
    tokens = directory / "tokens.txt"
    if not tokens.exists():
        raise FileNotFoundError(f"no tokens.txt in {directory}")
    out["tokens"] = tokens
    return out


def models_root() -> Path:
    base = os.environ.get("HF_HOME") or os.path.join(Path.home(), ".cache", "huggingface")
    return Path(base) / "sherpa-onnx"


def ensure_model_dir(model: str) -> Path:
    """Directory with the model files, downloading the release archive when needed."""
    name = resolve_model_name(model)
    if os.path.isdir(name):
        return Path(name)
    target = models_root() / name
    if target.is_dir() and any(target.glob("encoder*.onnx")):
        return target
    url = RELEASE_URL.format(name=name)
    target.parent.mkdir(parents=True, exist_ok=True)
    logger.info("downloading %s to %s", url, target.parent)
    fd, tmp = tempfile.mkstemp(prefix="sherpa-onnx-", suffix=".tar.bz2", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as fh, urllib.request.urlopen(url, timeout=120) as res:  # noqa: S310 - fixed https host
            while chunk := res.read(1 << 20):
                fh.write(chunk)
        with tarfile.open(tmp, "r:bz2") as tar:
            tar.extractall(target.parent, filter="data")
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    if not target.is_dir():
        raise FileNotFoundError(f"archive {url} did not contain a {name}/ directory")
    return target


def words_from_pieces(
    pieces: Sequence[str],
    timestamps: Sequence[float],
    durations: Sequence[float] | None = None,
    log_probs: Sequence[float] | None = None,
    tail: float = WORD_TAIL,
) -> list[HeardWord]:
    """Join sentencepiece pieces into timed words.

    * a piece starting with ``▁`` or a space starts a new word; a piece without any
      letter or digit (punctuation) never does, it is glued to the current word, except a
      hyphen between two pieces, which splits the compound into two words ("fixed-length"
      -> "fixed", "length": the aligner compares without hyphens);
    * ``start`` = timestamp of the first piece; ``end`` = last piece + its TDT duration
      (or ``tail`` when the duration is missing/zero), never past the next word's start;
    * ``probability`` = mean of ``exp(log_prob)`` over the word's pieces, 1.0 without them;
    * words left without any letter or digit are dropped.
    """
    n = len(pieces)
    if len(timestamps) < n:
        raise ValueError(f"{n} pieces but {len(timestamps)} timestamps")
    groups: list[list[int]] = []
    split_next = False
    for i, piece in enumerate(pieces):
        has_alnum = bool(_ALNUM_RE.search(piece))
        if not has_alnum and piece.strip("".join(_WORD_MARKS)) and set(piece.strip("".join(_WORD_MARKS))) <= _HYPHENS:
            # A hyphen between pieces ("fixed", "-", "length"): the compound becomes two words,
            # like Whisper does, so the aligner can match "fixed length" in the reference
            # (hyphens are inaudible: ``compare_key`` drops them for "multi-factor" too).
            split_next = groups != []
            continue
        starts_word = (piece.startswith(_WORD_MARKS) and has_alnum) or (split_next and has_alnum)
        split_next = False
        if starts_word or not groups:
            groups.append([i])
        else:
            groups[-1].append(i)

    raw: list[tuple[str, float, float, float]] = []  # text, start, end_candidate, probability
    for idx in groups:
        text = "".join(pieces[i].lstrip("".join(_WORD_MARKS)) if k == 0 else pieces[i] for k, i in enumerate(idx))
        text = text.replace("▁", " ").strip()
        if not _ALNUM_RE.search(text):
            continue
        first, last = idx[0], idx[-1]
        start = float(timestamps[first])
        duration = float(durations[last]) if durations is not None and last < len(durations) else 0.0
        end = float(timestamps[last]) + (duration if duration > 0 else tail)
        if log_probs is not None and len(log_probs) >= last + 1:
            probability = float(np.mean([math.exp(min(0.0, float(log_probs[i]))) for i in idx]))
        else:
            probability = 1.0
        raw.append((text, start, end, probability))

    words: list[HeardWord] = []
    for k, (text, start, end, probability) in enumerate(raw):
        if k + 1 < len(raw):
            next_start = raw[k + 1][1]
            if next_start > start:
                end = min(end, next_start)
        if end <= start:
            end = start + 0.05
        words.append(HeardWord(text=text, start=round(start, 3), end=round(end, 3), probability=round(probability, 4)))
    return words


class ParakeetASR(LazyLoader):
    name = "parakeet"
    needs_decoded_audio = True

    def __init__(self, model: str, compute_type: str = "int8", cpu_threads: int = 4, decoding_method: str = "greedy_search") -> None:
        self.model = resolve_model_name(model)
        self.compute_type = compute_type
        self.cpu_threads = cpu_threads
        self.decoding_method = decoding_method
        self._recognizer: Any = None
        self.has_log_probs: bool | None = None  # learnt from the first result
        self._init_loader()

    def _do_load(self) -> None:
        import sherpa_onnx  # optional dependency, imported lazily

        directory = ensure_model_dir(self.model)
        files = model_files(directory, prefer_int8=self.compute_type.lower().startswith("int8"))
        logger.info("parakeet: %s (%s threads=%d)", directory, files["encoder"].name, self.cpu_threads)
        self._recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(files["encoder"]),
            decoder=str(files["decoder"]),
            joiner=str(files["joiner"]),
            tokens=str(files["tokens"]),
            num_threads=max(1, int(self.cpu_threads)),
            sample_rate=SAMPLE_RATE,
            feature_dim=80,
            decoding_method=self.decoding_method,
            model_type="nemo_transducer",
        )

    def transcribe(
        self, audio_f32_16k: np.ndarray, *, reference_text: str | None = None, raw_bytes: bytes | None = None
    ) -> list[HeardWord]:
        if self._recognizer is None:
            self.load()
        try:
            samples = np.ascontiguousarray(np.asarray(audio_f32_16k, dtype=np.float32))
            stream = self._recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, samples)
            self._recognizer.decode_stream(stream)
            result = stream.result
        except Exception as exc:  # noqa: BLE001
            raise EngineError(f"parakeet transcription failed: {exc}") from exc
        pieces = list(getattr(result, "tokens", []) or [])
        timestamps = list(getattr(result, "timestamps", []) or [])
        durations = list(getattr(result, "durations", []) or []) or None
        log_probs = list(getattr(result, "ys_log_probs", []) or []) or None
        if self.has_log_probs is None:
            self.has_log_probs = log_probs is not None and len(log_probs) == len(pieces)
            if not self.has_log_probs:
                logger.warning("parakeet: sherpa-onnx exposed no per-token log-probabilities; word probability fixed at 1.0")
        if log_probs is not None and len(log_probs) != len(pieces):
            log_probs = None
        return words_from_pieces(pieces, timestamps, durations, log_probs)


__all__ = ["DEFAULT_MODEL", "ParakeetASR", "ensure_model_dir", "model_files", "resolve_model_name", "words_from_pieces"]
