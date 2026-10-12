"""Phoneme-level pronunciation scoring (GOP) on top of a CTC phoneme recognizer.

Pipeline for one recording (contract 2 §2.2):

1. Expected phonemes per reference word come from the ``espeak-ng`` binary
   (``-q --ipa=3 -v en-us``), which ties multi-letter phonemes with U+200D. The tied
   units are mapped onto the recognizer's vocabulary by longest match.
2. The recognizer produces frame log-posteriors for the whole recording once
   (:class:`~speech.engines.base.Posteriors`).
3. For each word with ASR timings, the frames of ``[start - 0.08 s, end + 0.08 s]``
   are force-aligned (CTC Viterbi with blanks, numpy) to the expected phonemes.
4. Per phoneme ``gop = mean(log P(expected) - max_q log P(q))`` over its aligned
   frames, ``score = exp(gop)``; ``heard`` is the most probable non-blank token over
   those frames.

Everything here is pure numpy so it is unit-testable with hand-built posteriors.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import threading
import unicodedata
from collections import OrderedDict
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from .engines.base import ExpectedPhonemes, Posteriors

logger = logging.getLogger("speech.phonemes")

WINDOW_PAD_SECONDS = 0.08  # contract window for a word scored on its own
VARIANT_PAD_SECONDS = 0.25  # window used to pick the best pronunciation variant
ALIGN_SLACK_SECONDS = 0.5  # joint alignment: how far a phoneme may sit outside its ASR word
REFINE_MARGIN_FRAMES = 2  # frames around a jointly aligned word when re-trying variants
GOOD_SCORE = 0.75
FAIR_SCORE = 0.5

STRESS_MARKS = "ˈˌ"
TIE_CHARS = "‍͜͡^"  # ZWJ (espeak --ipa=3), combining ties, phonemizer '^'
# Spacing modifier letters that belong to the preceding phoneme (length, palatalized...).
MODIFIER_LETTERS = set("ːˑʲʰʷˠˤ˞")
IGNORED_CHARS = set(" \t\n-.'‿|_,;:!?\"()")
ESPEAK_TIMEOUT = 15
_NEG_INF = -np.inf


# --------------------------------------------------------------------- espeak-ng
def espeak_path() -> str | None:
    return shutil.which("espeak-ng")


def _espeak_voice(lang: str) -> str:
    return "en-gb" if lang.lower().endswith("gb") else "en-us"


def _run_espeak(lines: Sequence[str], voice: str) -> list[str]:
    """One espeak-ng process for many lines; returns one IPA line per input line.

    espeak-ng costs ~150 ms per process (it loads its dictionaries), so callers batch.
    Each input line ends with a period, which makes espeak emit exactly one output
    line per input line.
    """
    exe = espeak_path()
    if exe is None:
        raise RuntimeError("espeak-ng not found")
    payload = "".join(f"{line.strip()}.\n" for line in lines)
    proc = subprocess.run(
        [exe, "-q", "--ipa=3", "-v", voice], input=payload.encode("utf-8"),
        capture_output=True, timeout=ESPEAK_TIMEOUT, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"espeak-ng failed: {proc.stderr.decode('utf-8', 'replace')[:200]}")
    out = [line.strip() for line in proc.stdout.decode("utf-8", "replace").splitlines() if line.strip()]
    if len(out) != len(lines):
        raise RuntimeError(f"espeak-ng returned {len(out)} lines for {len(lines)} inputs")
    return out


class _BoundedCache:
    def __init__(self, size: int) -> None:
        self.size = size
        self._data: OrderedDict[tuple[str, str], str | None] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple[str, str]) -> tuple[bool, str | None]:
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
                return True, self._data[key]
            return False, None

    def put(self, key: tuple[str, str], value: str | None) -> None:
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.size:
                self._data.popitem(last=False)


_word_cache = _BoundedCache(16_384)


def espeak_words(words: Sequence[str], lang: str = "en-us") -> list[str | None]:
    """Isolated (citation) IPA of each word, raw espeak output (ties kept). Cached."""
    voice = _espeak_voice(lang)
    result: list[str | None] = [None] * len(words)
    missing: dict[str, list[int]] = {}
    for i, word in enumerate(words):
        word = (word or "").strip()
        if not word:
            continue
        found, value = _word_cache.get((voice, word))
        if found:
            result[i] = value
        else:
            missing.setdefault(word, []).append(i)
    if missing:
        todo = list(missing)
        try:
            ipas: list[str | None] = list(_run_espeak(todo, voice))
        except Exception as exc:  # noqa: BLE001
            logger.warning("espeak-ng batch failed (%s); falling back to one call per word", exc)
            ipas = []
            for word in todo:
                try:
                    ipas.append(_run_espeak([word], voice)[0])
                except Exception:  # noqa: BLE001
                    ipas.append(None)
        for word, ipa in zip(todo, ipas):
            _word_cache.put((voice, word), ipa or None)
            for i in missing[word]:
                result[i] = ipa or None
    return result


@lru_cache(maxsize=256)
def _espeak_sentence(text: str, voice: str) -> tuple[str, ...]:
    return tuple(_run_espeak([text], voice)[0].split())


def espeak_in_context(words: Sequence[str], lang: str = "en-us") -> list[str | None]:
    """IPA of each word as espeak reads it inside the sentence (weak forms: "a" -> ɐ).

    Returns all ``None`` when espeak's word split does not line up with ``words``
    (each entry may contain spaces, e.g. "fifty percent", and counts as that many).
    """
    spans = [len(w.split()) for w in words]
    flat = " ".join(w for w in words if w.strip())
    if not flat:
        return [None] * len(words)
    try:
        out = _espeak_sentence(flat, _espeak_voice(lang))
    except Exception as exc:  # noqa: BLE001
        logger.debug("espeak sentence failed: %s", exc)
        return [None] * len(words)
    if len(out) != sum(spans):
        return [None] * len(words)
    result: list[str | None] = []
    cursor = 0
    for span in spans:
        result.append(" ".join(out[cursor : cursor + span]) if span else None)
        cursor += span
    return result


def display_ipa(raw: str) -> str:
    """espeak IPA for humans: tie characters removed, stress marks kept."""
    return "".join(ch for ch in raw if ch not in TIE_CHARS).strip()


# ------------------------------------------------------------------ tokenization
def split_units(ipa: str) -> list[str]:
    """Split espeak IPA into phoneme units, honouring tie characters.

    Stress marks and separators are dropped; combining diacritics and modifier letters
    (``ː``, ``ʲ``...) stay attached to the preceding phoneme; a tie joins the next
    character to the current unit (``a‍ɪ`` -> ``aɪ``).
    """
    if "_" in ipa:  # older espeak-ng builds separate phonemes with "_" in --ipa=3 mode
        chunks = ipa.replace(" ", "_").split("_")
        return [u for u in ("".join(ch for ch in c if ch not in STRESS_MARKS and ch not in TIE_CHARS) for c in chunks) if u]
    units: list[str] = []
    join_next = False
    for ch in ipa:
        if ch in STRESS_MARKS:
            continue
        if ch in TIE_CHARS:
            join_next = bool(units)
            continue
        if ch in IGNORED_CHARS or ch.isspace():
            join_next = False
            continue
        if units and (join_next or unicodedata.combining(ch) or ch in MODIFIER_LETTERS):
            units[-1] += ch
        else:
            units.append(ch)
        join_next = False
    return units


def tokenize_ipa(ipa: str, vocab: Collection[str], max_token_len: int = 5, merge_linking_r: bool = False) -> list[str]:
    """Map espeak IPA onto a CTC vocabulary by longest match inside each tied unit.

    A unit that is itself a vocabulary token is kept whole (``ɔːɹ``, ``eɪ``); otherwise it
    is split greedily into the longest known pieces; unknown characters are dropped.
    With ``merge_linking_r`` a plain ``ɹ`` right after an r-coloured token (espeak's
    ``ʊ‍ɹɹ`` in "security") is dropped; callers offer both forms as variants because
    the recognizer emits either ``ʊɹ ɹ`` or a single ``ʊɹ`` depending on the speaker.
    """
    tokens: list[str] = []
    for unit in split_units(ipa):
        if unit in vocab:
            pieces = [unit]
        else:
            pieces = []
            i = 0
            while i < len(unit):
                for length in range(min(max_token_len, len(unit) - i), 0, -1):
                    piece = unit[i : i + length]
                    if piece in vocab:
                        pieces.append(piece)
                        i += length
                        break
                else:
                    i += 1
        for piece in pieces:
            if merge_linking_r and piece == "ɹ" and tokens and len(tokens[-1]) > 1 and tokens[-1].endswith("ɹ"):
                continue
            tokens.append(piece)
    return tokens


# Weak (unstressed) forms of function words, as space-separated vocabulary tokens.
# espeak gives the citation form of an isolated word ("a" -> eɪ, "to" -> tuː) and its
# in-sentence output glues clitics to neighbours ("in the" -> ɪnðə), so connected
# speech needs these explicitly; the best-scoring variant wins.
WEAK_FORMS: dict[str, tuple[str, ...]] = {
    "a": ("ɐ", "ə"), "an": ("ɐ n", "ə n"), "the": ("ð ə", "ð i", "ð ɪ"), "to": ("t ə", "t ʊ", "ɾ ə"),
    "of": ("ə v", "ə"), "and": ("ə n", "ə n d", "æ n"), "for": ("f ɚ", "f ə"), "from": ("f ɹ ə m",),
    "at": ("ɐ t", "ə t"), "as": ("ə z",), "or": ("ɚ",), "can": ("k ə n",), "that": ("ð ə t",),
    "are": ("ɚ",), "was": ("w ə z",), "has": ("h ə z", "ə z"), "have": ("h ə v", "ə v"),
    "does": ("d ə z",), "but": ("b ə t",), "than": ("ð ə n",), "them": ("ð ə m",), "some": ("s ə m",),
    "your": ("j ɚ",), "you": ("j ə",), "will": ("w ə l",), "would": ("w ə d",), "could": ("k ə d",),
    "should": ("ʃ ə d",), "were": ("w ɚ",), "be": ("b i",), "by": ("b ə",), "is": ("ə z",),
}


def expected_variants(
    words: Sequence[str], vocab: Collection[str], lang: str = "en-us", max_token_len: int = 5
) -> list[list[ExpectedPhonemes]]:
    """Pronunciation variants per normalized word.

    Citation form from espeak first (it is what ``expected_ipa`` shows unless another
    variant fits the audio better), then the in-sentence form when espeak's word split
    lines up, then the weak forms of function words.
    """
    isolated = espeak_words(words, lang)
    context = espeak_in_context(words, lang)
    out: list[list[ExpectedPhonemes]] = []
    for word, iso, ctx in zip(words, isolated, context):
        variants: list[ExpectedPhonemes] = []
        seen: set[tuple[str, ...]] = set()

        def add(ipa: str, tokens: list[str]) -> None:
            if tokens and tuple(tokens) not in seen:
                seen.add(tuple(tokens))
                variants.append(ExpectedPhonemes(ipa=ipa, tokens=tokens))

        for raw in (iso, ctx):
            if raw:
                add(display_ipa(raw), tokenize_ipa(raw, vocab, max_token_len))
                add(display_ipa(raw), tokenize_ipa(raw, vocab, max_token_len, merge_linking_r=True))
        for weak in WEAK_FORMS.get(word.strip().lower(), ()):
            tokens = [t for t in weak.split() if t in vocab]
            add("".join(tokens), tokens)
        out.append(variants)
    return out


# ------------------------------------------------------- CTC forced alignment
def _viterbi(
    blank_lp: np.ndarray, tok_lp: np.ndarray, tokens: Sequence[int], allowed: np.ndarray | None
) -> list[tuple[int, int]] | None:
    T, N = tok_lp.shape
    if N == 0:
        return []
    repeats = sum(1 for a, b in zip(tokens, tokens[1:]) if a == b)
    if T < N + repeats:
        return None
    S = 2 * N + 1
    emit = np.empty((T, S), dtype=np.float64)
    emit[:, 0::2] = blank_lp[:, None]
    emit[:, 1::2] = tok_lp if allowed is None else np.where(allowed, tok_lp, _NEG_INF)
    # A token state may be entered from two states back (skipping the blank) unless it
    # repeats the previous token, which CTC must separate with a blank.
    can_skip = np.zeros(S, dtype=bool)
    for k in range(1, N):
        can_skip[2 * k + 1] = tokens[k] != tokens[k - 1]
    alpha = np.full(S, _NEG_INF)
    alpha[0] = emit[0, 0]
    alpha[1] = emit[0, 1]
    back = np.zeros((T, S), dtype=np.int8)
    neg1 = np.array([_NEG_INF])
    neg2 = np.array([_NEG_INF, _NEG_INF])
    cols = np.arange(S)
    for t in range(1, T):
        step = np.concatenate((neg1, alpha[:-1]))
        skip = np.where(can_skip, np.concatenate((neg2, alpha[:-2])), _NEG_INF)
        stacked = np.vstack((alpha, step, skip))
        choice = np.argmax(stacked, axis=0)
        alpha = stacked[choice, cols] + emit[t]
        back[t] = choice
    s = S - 1 if alpha[S - 1] >= alpha[S - 2] else S - 2
    if not np.isfinite(alpha[s]):
        return None
    spans: list[tuple[int, int] | None] = [None] * N
    for t in range(T - 1, -1, -1):
        if s % 2 == 1:
            k = (s - 1) // 2
            last = spans[k]
            spans[k] = (t, t) if last is None else (t, last[1])
        s -= int(back[t, s])
    if any(span is None for span in spans):  # pragma: no cover - impossible for a finite path
        return None
    return spans  # type: ignore[return-value]


def ctc_forced_align(
    logp: np.ndarray, tokens: Sequence[int], blank: int, allowed: np.ndarray | None = None
) -> list[tuple[int, int]] | None:
    """Viterbi alignment of ``tokens`` to ``logp`` [T, V] under CTC topology.

    ``allowed`` (optional, bool [T, N]) restricts the frames each token may occupy;
    blanks are allowed everywhere. Returns, per token, the inclusive
    ``(first_frame, last_frame)`` of the frames assigned to it, or ``None`` when the
    sequence does not fit (CTC needs one frame per token plus a blank between
    repeated tokens).
    """
    logp = np.asarray(logp)
    tok_lp = logp[:, list(tokens)] if len(tokens) else np.zeros((logp.shape[0], 0))
    return _viterbi(logp[:, blank], tok_lp, list(tokens), allowed)


# Accent-neutral tolerance: realizations that are not pronunciation errors for a
# learner aiming at intelligible English (reduced vowels, cot/caught, flaps, rhotic vs
# non-rhotic). The classic learner confusions (θ/t, ð/d, v/w, ɪ/iː, æ/ɛ...) stay strict.
EQUIVALENTS: dict[str, tuple[str, ...]] = {
    "ᵻ": ("ɪ", "ə", "ɨ", "i"),
    "ə": ("ɐ", "ᵻ", "ʌ"),
    "ɐ": ("ə", "ʌ"),
    "ʌ": ("ə", "ɐ"),
    "ɚ": ("ɜː", "ɜ", "ə"),
    "ɜː": ("ɚ", "ɜ"),
    "ɔː": ("ɑː", "ɔ", "ɑ", "ɒ"),
    "ɑː": ("ɑ", "ɔː", "ɒ"),
    "ɔɪ": ("oɪ",),
    "oʊ": ("əʊ", "o", "oː"),
    "əʊ": ("oʊ", "o"),
    "iː": ("i",),
    "i": ("iː", "ɪ"),
    "uː": ("u",),
    "u": ("uː",),
    "eɪ": ("e", "eː"),
    "ɾ": ("t", "d"),
    "t": ("ɾ",),
    "d": ("ɾ",),
    "ʊɹ": ("ʊ", "ʊə", "ɔːɹ", "ɔː"),
    "ɛɹ": ("ɛ", "eə"),
    "ɪɹ": ("ɪ", "iə"),
    "iə": ("ɪɹ", "ɪ"),
    "ɑːɹ": ("ɑː", "ɑ"),
    "ɔːɹ": ("ɔː", "oːɹ", "oː"),
    "oːɹ": ("ɔːɹ", "oː", "ɔː"),
    "əl": ("l", "ɫ", "ə"),
    "l": ("ɫ",),
    "ɹ": ("r",),
    "aɪɚ": ("aɪ", "aɪə"),
    "aɪə": ("aɪɚ", "aɪ"),
}


def _class_ids(post: Posteriors, token: str) -> list[int]:
    ids = [post.token_id(token)]
    ids += [post.token_id(t) for t in EQUIVALENTS.get(token, ())]
    return [i for i in ids if i is not None]


def class_logp(post: Posteriors, logp: np.ndarray, tokens: Sequence[str]) -> np.ndarray:
    """[T, N] log-probability of each expected token or an accepted equivalent."""
    cols = []
    for token in tokens:
        ids = _class_ids(post, token)
        sub = logp[:, ids]
        top = sub.max(axis=1, keepdims=True)
        cols.append((top + np.log(np.exp(sub - top).sum(axis=1, keepdims=True)))[:, 0])
    return np.stack(cols, axis=1) if cols else np.zeros((logp.shape[0], 0))


@dataclass(slots=True)
class PhonemeScore:
    ipa: str
    score: float
    heard: str | None
    quality: str

    def as_dict(self) -> dict:
        return {"ipa": self.ipa, "score": round(self.score, 3), "heard": self.heard, "quality": self.quality}


@dataclass(slots=True)
class WordPhonemes:
    expected_ipa: str
    heard_ipa: str
    phonemes: list[PhonemeScore]
    score: float


def quality_for(score: float) -> str:
    if score >= GOOD_SCORE:
        return "good"
    if score >= FAIR_SCORE:
        return "fair"
    return "bad"


def _heard_mask(post: Posteriors, size: int) -> np.ndarray:
    mask = np.ones(size, dtype=bool)
    mask[post.blank_id] = False
    for sid in post.special_ids:
        mask[sid] = False
    return mask


def gop(
    logp: np.ndarray, tok_lp: np.ndarray, spans: Sequence[tuple[int, int]], post: Posteriors
) -> list[tuple[float, int]]:
    """(score, heard_id) per aligned token.

    ``gop = mean over its frames of (log P(expected) - max_q log P(q))`` with ``q`` over
    the whole vocabulary (blank included) and ``P(expected)`` the probability mass of
    the expected token and its accepted equivalents; ``score = exp(gop)``. ``heard`` is
    the non-blank token with the most probability mass over the same frames.
    """
    mask = _heard_mask(post, logp.shape[1])
    frame_max = logp.max(axis=1)
    out: list[tuple[float, int]] = []
    for k, (a, b) in enumerate(spans):
        value = float(np.mean(tok_lp[a : b + 1, k] - frame_max[a : b + 1]))
        mass = np.exp(logp[a : b + 1]).sum(axis=0)
        mass[~mask] = -1.0
        out.append((float(np.exp(min(value, 0.0))), int(np.argmax(mass))))
    return out


def _word_result(
    post: Posteriors, logp: np.ndarray, tok_lp: np.ndarray, tokens: Sequence[str], spans: Sequence[tuple[int, int]], ipa: str
) -> WordPhonemes:
    scored = gop(logp, tok_lp, spans, post)
    phonemes = [
        PhonemeScore(ipa=t, score=score, heard=post.vocab[heard], quality=quality_for(score))
        for t, (score, heard) in zip(tokens, scored)
    ]
    return WordPhonemes(
        expected_ipa=ipa,
        heard_ipa="".join(p.heard or "" for p in phonemes),
        phonemes=phonemes,
        score=float(np.mean([p.score for p in phonemes])),
    )


def _known(post: Posteriors, variant: ExpectedPhonemes) -> list[str]:
    return [t for t in variant.tokens if post.token_id(t) is not None]


def score_word(
    post: Posteriors, start: float, end: float, variants: Sequence[ExpectedPhonemes], pad: float = WINDOW_PAD_SECONDS
) -> WordPhonemes | None:
    """GOP of one word aligned inside its padded ASR window; the best variant wins."""
    total = post.logp.shape[0]
    a = max(0, int(np.floor((start - pad) * post.frame_rate)))
    b = min(total, int(np.ceil((end + pad) * post.frame_rate)))
    if b <= a:
        return None
    window = post.logp[a:b]
    best: WordPhonemes | None = None
    for variant in variants:
        tokens = _known(post, variant)
        if not tokens:
            continue
        tok_lp = class_logp(post, window, tokens)
        ids = [post.token_id(t) for t in tokens]
        spans = _viterbi(window[:, post.blank_id], tok_lp, ids, None)  # type: ignore[arg-type]
        if spans is None:
            continue
        result = _word_result(post, window, tok_lp, tokens, spans, variant.ipa)
        if best is None or result.score > best.score:
            best = result
    return best


def score_words(
    post: Posteriors,
    items: Sequence[tuple[float, float, Sequence[ExpectedPhonemes]]],
    slack: float = ALIGN_SLACK_SECONDS,
    choose_pad: float = VARIANT_PAD_SECONDS,
) -> list[WordPhonemes | None]:
    """GOP for every ``(start, end, variants)`` word of one recording.

    1. Each word picks its best pronunciation variant on its own padded window.
    2. All chosen phonemes are force-aligned in ONE pass over the recording, each word's
       phonemes restricted to ``[start - slack, end + slack]``. ASR word boundaries are
       often 0.1-0.3 s early or late; a joint alignment lets the neighbours pin each
       phoneme instead of cutting word-final phonemes at a tight window.

    Falls back to independent windows when the joint alignment is infeasible.
    """
    chosen: list[tuple[ExpectedPhonemes, list[str]] | None] = []
    for start, end, variants in items:
        usable = [v for v in variants if _known(post, v)]
        if not usable:
            chosen.append(None)
            continue
        variant = usable[0]
        if len(usable) > 1:
            best = score_word(post, start, end, usable, pad=choose_pad)
            if best is not None:
                variant = next((v for v in usable if v.ipa == best.expected_ipa), variant)
        chosen.append((variant, _known(post, variant)))
    out: list[WordPhonemes | None] = [None] * len(items)
    flat: list[str] = []
    owner: list[int] = []
    for k, item in enumerate(chosen):
        if item is not None:
            flat.extend(item[1])
            owner.extend([k] * len(item[1]))
    if not flat:
        return out
    logp = post.logp
    T = logp.shape[0]
    allowed = np.zeros((T, len(flat)), dtype=bool)
    for col, k in enumerate(owner):
        start, end, _variants = items[k]
        a = max(0, int(np.floor((start - slack) * post.frame_rate)))
        b = min(T, int(np.ceil((end + slack) * post.frame_rate)))
        allowed[a:b, col] = True
    tok_lp = class_logp(post, logp, flat)
    ids = [post.token_id(t) for t in flat]
    spans = _viterbi(logp[:, post.blank_id], tok_lp, ids, allowed)  # type: ignore[arg-type]
    if spans is None:
        logger.debug("joint phoneme alignment infeasible; scoring words independently")
        for k, (start, end, variants) in enumerate(items):
            if chosen[k] is not None:
                out[k] = score_word(post, start, end, [chosen[k][0]], pad=choose_pad)  # type: ignore[index]
        return out
    cursor = 0
    margin = REFINE_MARGIN_FRAMES
    for k, item in enumerate(chosen):
        if item is None:
            continue
        variant, tokens = item
        n = len(tokens)
        word_spans = spans[cursor : cursor + n]
        result = _word_result(post, logp, tok_lp[:, cursor : cursor + n], tokens, word_spans, variant.ipa)
        # 3. Where the joint alignment placed the word, give the other variants a second
        #    chance ("the" chosen as ði on a loose window but read as ðə).
        others = [v for v in items[k][2] if v is not variant and _known(post, v)]
        if others and result.score < 1.0:
            first, last = word_spans[0][0], word_spans[-1][1]
            t0 = max(0.0, (first - margin) / post.frame_rate)
            t1 = (last + 1 + margin) / post.frame_rate
            alt = score_word(post, t0, t1, others, pad=0.0)
            if alt is not None and alt.score > result.score:
                result = alt
        out[k] = result
        cursor += n
    return out


def log_softmax(logits: np.ndarray) -> np.ndarray:
    logits = np.asarray(logits, dtype=np.float32)
    shifted = logits - logits.max(axis=-1, keepdims=True)
    return shifted - np.log(np.exp(shifted).sum(axis=-1, keepdims=True))


__all__ = [
    "EQUIVALENTS", "PhonemeScore", "WordPhonemes", "class_logp", "ctc_forced_align", "display_ipa",
    "espeak_in_context", "espeak_path", "espeak_words", "expected_variants", "gop", "log_softmax",
    "quality_for", "score_word", "score_words", "split_units", "tokenize_ipa",
]
