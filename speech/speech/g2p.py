"""IPA for single words: espeak-ng when installed, misaki (Kokoro's G2P) otherwise.

misaki writes diphthongs and a few consonants with single capital letters (``A`` = eɪ,
``I`` = aɪ...); :func:`to_standard_ipa` turns them into standard IPA so the API never
leaks misaki's private alphabet. Any failure degrades to ``None`` instead of failing
the assessment.
"""
from __future__ import annotations

import logging
import threading
from typing import Any

logger = logging.getLogger("speech.g2p")

# misaki -> IPA (misaki EN_PHONES.md): diphthongs as capitals, affricates as ligatures,
# T = American flap, ᵊ = small schwa. Everything else is already IPA.
MISAKI_TO_IPA: dict[str, str] = {
    "A": "eɪ",
    "I": "aɪ",
    "W": "aʊ",
    "Y": "ɔɪ",
    "O": "oʊ",
    "Q": "əʊ",
    "T": "ɾ",
    "ʤ": "dʒ",
    "ʧ": "tʃ",
    "ᵊ": "ə",
}


def to_standard_ipa(misaki_ipa: str | None) -> str | None:
    if not misaki_ipa:
        return misaki_ipa
    return "".join(MISAKI_TO_IPA.get(ch, ch) for ch in misaki_ipa)

_lock = threading.Lock()
_instances: dict[bool, Any] = {}
_disabled = False


def _get(british: bool) -> Any | None:
    global _disabled
    if _disabled:
        return None
    with _lock:
        inst = _instances.get(british)
        if inst is None:
            try:
                from misaki import en  # heavy import, keep lazy

                inst = en.G2P(trf=False, british=british, fallback=_espeak_fallback(british))
            except Exception as exc:  # noqa: BLE001
                logger.warning("misaki G2P unavailable, IPA disabled: %s", exc)
                _disabled = True
                return None
            _instances[british] = inst
        return inst


def _espeak_fallback(british: bool) -> Any | None:
    """Out-of-dictionary words need espeak-ng; without it misaki just returns None."""
    try:
        from misaki import espeak

        return espeak.EspeakFallback(british=british)
    except Exception as exc:  # noqa: BLE001
        logger.info("espeak-ng fallback unavailable (%s); OOV words will have no IPA", exc)
        return None


def ipa(word: str, lang: str = "en-us") -> str | None:
    """IPA string for ``word`` or None when misaki cannot produce one."""
    if not word or not word.strip():
        return None
    g2p = _get(british=lang.lower().endswith("gb"))
    if g2p is None:
        return None
    try:
        phonemes, _tokens = g2p(word)
    except Exception as exc:  # noqa: BLE001
        logger.debug("G2P failed for %r: %s", word, exc)
        return None
    phonemes = (phonemes or "").strip()
    return phonemes or None


def warm(lang: str = "en-us") -> None:
    """Instantiate the G2P so the first assess request does not pay for it."""
    _get(british=lang.lower().endswith("gb"))


def standard_ipa(word: str, lang: str = "en-us") -> str | None:
    """Standard IPA of ``word``: espeak-ng (stress kept, ties removed), else misaki."""
    from .phonemes import display_ipa, espeak_path, espeak_words  # local: avoid import cycle

    if not word or not word.strip():
        return None
    if espeak_path() is not None:
        raw = espeak_words([word.strip()], lang)[0]
        if raw:
            return display_ipa(raw)
    return to_standard_ipa(ipa(word, lang))
