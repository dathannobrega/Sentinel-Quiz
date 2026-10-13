"""Piece -> word joining of the sherpa-onnx (Parakeet) engine, with a fake recognizer result."""
from __future__ import annotations

import math

import numpy as np
import pytest

from speech.alignment import align, reference_words
from speech.engines import parakeet_asr
from speech.engines.parakeet_asr import ParakeetASR, resolve_model_name, words_from_pieces

# What sherpa-onnx returned for "Well, I don't wish" (leading space = word start, TDT durations).
PIECES = [" Well", ",", " I", " don", "'", "t", " w", "ish"]
TIMES = [0.40, 0.64, 0.72, 0.80, 0.96, 1.04, 1.04, 1.12]
DURS = [0.24, 0.08, 0.08, 0.16, 0.08, 0.0, 0.08, 0.16]
LOGP = [-0.001, -0.143, 0.0, -0.001, 0.0, 0.0, -0.5, -0.1]


def test_pieces_join_into_words_with_times_and_probability() -> None:
    words = words_from_pieces(PIECES, TIMES, DURS, LOGP)
    assert [w.text for w in words] == ["Well,", "I", "don't", "wish"]
    assert [w.start for w in words] == [0.40, 0.72, 0.80, 1.04]
    # "Well," ends with its last piece + duration (0.64 + 0.08), capped by the next start.
    assert words[0].end == 0.72
    # "don't": last piece has duration 0 -> tail of 0.15 s, capped at the next word start.
    assert words[2].end == 1.04
    # last word: last piece + its duration, no cap.
    assert words[3].end == pytest.approx(1.28)
    # Probability = mean piece probability (Whisper's convention).
    assert words[0].probability == pytest.approx(np.mean([math.exp(-0.001), math.exp(-0.143)]), abs=1e-4)
    assert words[3].probability == pytest.approx(np.mean([math.exp(-0.5), math.exp(-0.1)]), abs=1e-4)
    assert all(w.end > w.start for w in words)


def test_sentencepiece_marker_and_missing_extras() -> None:
    words = words_from_pieces(["▁fire", "wall", "▁blocks", "."], [0.1, 0.3, 0.6, 0.9])
    assert [w.text for w in words] == ["firewall", "blocks."]
    assert [w.probability for w in words] == [1.0, 1.0]  # no log-probs exposed -> 1.0
    # No durations: last piece + 0.15 s tail (0.45), which is below the next start (0.6).
    assert words[0].end == pytest.approx(0.45)
    assert words[1].end == pytest.approx(1.05)


def test_hyphenated_compound_splits_into_two_words() -> None:
    # Bake-off finding: Parakeet wrote "fixed-length" for the reference "fixed length" and the
    # aligner marked "fixed" missed + "length" mispronounced; the split keeps the piece times.
    words = words_from_pieces([" a", " fixed", "-", "length", " digest", "."], [0.1, 0.3, 0.6, 0.65, 1.0, 1.4], None, [0.0] * 6)
    assert [w.text for w in words] == ["a", "fixed", "length", "digest."]
    assert words[1].start == 0.3 and words[1].end == 0.45 and words[2].start == 0.65
    refs = reference_words("a fixed length digest")
    aligned, extras = align(refs, words)
    assert [w.status for w in aligned] == ["ok"] * 4 and extras == []
    # The reverse case (reference "multi-factor", pieces "multi", "-", "factor") still aligns.
    multi = words_from_pieces([" multi", "-", "factor"], [0.0, 0.2, 0.25])
    assert [w.text for w in multi] == ["multi", "factor"]
    assert [w.status for w in align(reference_words("multi-factor"), multi)[0]] == ["ok"]


def test_punctuation_only_pieces_never_make_words() -> None:
    words = words_from_pieces([",", " ok", " .", "..."], [0.0, 0.2, 0.5, 0.6], None, None)
    assert len(words) == 1 and words[0].text == "ok ...." and words[0].start == 0.2


def test_words_align_like_whisper_output() -> None:
    refs = reference_words("Well, I don't wish.")
    words, extras = align(refs, words_from_pieces(PIECES, TIMES, DURS, LOGP))
    assert [w.status for w in words] == ["ok"] * 4 and extras == []


def test_resolve_model_name_defaults_from_whisper_sizes(tmp_path) -> None:
    assert resolve_model_name("small.en") == parakeet_asr.DEFAULT_MODEL
    assert resolve_model_name("") == parakeet_asr.DEFAULT_MODEL
    assert resolve_model_name("sherpa-onnx-nemo-parakeet-tdt-0.6b-v2") == "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2"
    assert resolve_model_name(str(tmp_path)) == str(tmp_path)


def test_engine_transcribe_uses_fake_recognizer(monkeypatch) -> None:
    class Result:
        tokens, timestamps, durations, ys_log_probs = PIECES, TIMES, DURS, LOGP

    class Stream:
        def accept_waveform(self, sr, samples) -> None:
            assert sr == 16_000 and samples.dtype == np.float32

        result = Result()

    class Recognizer:
        def create_stream(self) -> Stream:
            return Stream()

        def decode_stream(self, stream) -> None:
            return None

    engine = ParakeetASR("small.en", "int8", 2)
    engine._recognizer = Recognizer()
    engine._loaded = True
    heard = engine.transcribe(np.zeros(16_000, dtype=np.float32))
    assert [w.text for w in heard] == ["Well,", "I", "don't", "wish"]
    assert engine.has_log_probs is True and engine.name == "parakeet"
