"""wav2vec2 CTC phoneme recognizer (espeak IPA vocabulary) for GOP scoring.

Default checkpoint ``facebook/wav2vec2-lv-60-espeak-cv-ft`` (Apache-2.0 per its model
card): wav2vec2-large-lv60 fine-tuned on multilingual Common Voice to emit the
phonemes espeak-ng produces, so the expected phonemes of a word can be obtained from
the ``espeak-ng`` binary and matched token by token.

The tokenizer class of the checkpoint needs ``phonemizer``; it is not used. The CTC
vocabulary is read straight from ``vocab.json`` and the audio normalization of the
feature extractor (zero mean, unit variance) is applied in numpy.
"""
from __future__ import annotations

import json
import logging
import threading
from typing import Any

import numpy as np

from ..phonemes import espeak_path, expected_variants, log_softmax
from .base import EngineError, ExpectedPhonemes, HeardWord, LazyLoader, Posteriors

logger = logging.getLogger("speech.phoneme.wav2vec2")

SAMPLE_RATE = 16_000
FRAME_RATE = 50.0  # conv feature encoder stride 320 samples at 16 kHz
SAMPLES_PER_FRAME = 320
# Self-attention is quadratic in frames: long recordings are processed in chunks with
# context on both sides, keeping only the centre frames of each chunk.
CHUNK_SECONDS = 30.0
CONTEXT_SECONDS = 1.0
SPECIAL_TOKENS = ("<s>", "</s>", "<unk>")

_torch_threads_lock = threading.Lock()


class Wav2Vec2Phoneme(LazyLoader):
    name = "wav2vec2"
    needs_heard_words = False  # the forward only needs PCM: may run in parallel with the ASR

    def __init__(self, model: str, threads: int = 4, lang: str = "en-us") -> None:
        self.model = model
        self.threads = threads
        self.lang = lang
        self._model: Any = None
        self._vocab: list[str] = []
        self._vocab_set: frozenset[str] = frozenset()
        self._max_token_len = 1
        self._blank_id = 0
        self._special_ids: frozenset[int] = frozenset()
        self._init_loader()

    def _do_load(self) -> None:
        if espeak_path() is None:
            raise RuntimeError("espeak-ng binary not found (needed for the expected phonemes)")
        import torch  # heavy import, keep lazy
        from huggingface_hub import hf_hub_download
        from transformers import Wav2Vec2ForCTC

        vocab_path = hf_hub_download(self.model, "vocab.json")
        with open(vocab_path, encoding="utf-8") as fh:
            mapping: dict[str, int] = json.load(fh)
        size = max(mapping.values()) + 1
        vocab = [""] * size
        for tok, idx in mapping.items():
            vocab[idx] = tok
        model = Wav2Vec2ForCTC.from_pretrained(self.model)
        model.eval()
        if model.config.vocab_size != size:
            raise RuntimeError(f"vocab.json has {size} tokens but the model emits {model.config.vocab_size}")
        pad_id = model.config.pad_token_id
        self._blank_id = int(pad_id if pad_id is not None else mapping.get("<pad>", 0))
        self._special_ids = frozenset(mapping[t] for t in SPECIAL_TOKENS if t in mapping)
        self._vocab = vocab
        phonemes = {t for i, t in enumerate(vocab) if t and i != self._blank_id and i not in self._special_ids}
        self._vocab_set = frozenset(phonemes)
        self._max_token_len = max(len(t) for t in phonemes)
        self._torch = torch
        self._model = model
        # Warm the graph so the first assessment does not pay for it.
        self._forward(np.zeros(SAMPLE_RATE, dtype=np.float32))

    # ------------------------------------------------------------------ inference
    def _forward(self, audio: np.ndarray) -> np.ndarray:
        torch = self._torch
        x = np.asarray(audio, dtype=np.float32)
        x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)
        with _torch_threads_lock:
            previous = torch.get_num_threads()
            if self.threads > 0 and previous != self.threads:
                torch.set_num_threads(self.threads)
            try:
                with torch.inference_mode():
                    logits = self._model(torch.from_numpy(x).unsqueeze(0)).logits[0]
            finally:
                if self.threads > 0 and previous != self.threads:
                    torch.set_num_threads(previous)
        return logits.float().cpu().numpy()

    def posteriors(self, audio_f32_16k: np.ndarray, heard: list[HeardWord]) -> Posteriors:
        if self._model is None:
            self.load()
        audio = np.asarray(audio_f32_16k, dtype=np.float32)
        if audio.size < SAMPLES_PER_FRAME * 2:
            raise EngineError("recording too short for phoneme scoring")
        try:
            logits = self._chunked(audio)
        except Exception as exc:  # noqa: BLE001
            raise EngineError(f"wav2vec2 inference failed: {exc}") from exc
        return Posteriors(
            logp=log_softmax(logits), frame_rate=FRAME_RATE, vocab=self._vocab,
            blank_id=self._blank_id, special_ids=self._special_ids,
        )

    def _chunked(self, audio: np.ndarray) -> np.ndarray:
        chunk = int(CHUNK_SECONDS * SAMPLE_RATE)
        if audio.size <= chunk + int(CONTEXT_SECONDS * SAMPLE_RATE):
            return self._forward(audio)
        ctx = int(CONTEXT_SECONDS * SAMPLE_RATE)
        total_frames = audio.size // SAMPLES_PER_FRAME
        parts: list[np.ndarray] = []
        start = 0
        while start < audio.size:
            stop = min(audio.size, start + chunk)
            lo, hi = max(0, start - ctx), min(audio.size, stop + ctx)
            logits = self._forward(audio[lo:hi])
            skip = (start - lo) // SAMPLES_PER_FRAME
            keep = (stop - start) // SAMPLES_PER_FRAME if stop < audio.size else logits.shape[0] - skip
            parts.append(logits[skip : skip + keep])
            start = stop
        out = np.concatenate(parts, axis=0)
        return out[: max(total_frames, 1)] if out.shape[0] > total_frames else out

    def expected(self, words: list[str]) -> list[list[ExpectedPhonemes]]:
        if not self._vocab_set:
            self.load()
        return expected_variants(words, self._vocab_set, self.lang, self._max_token_len)
