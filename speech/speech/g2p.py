"""IPA for single words via misaki (already a dependency of Kokoro).

Only used to show "expected vs heard" for weak/mispronounced words, so any failure
(missing espeak-ng fallback, odd token) degrades to ``None`` instead of failing the
assessment.
"""
from __future__ import annotations

import logging
import threading
from typing import Any

logger = logging.getLogger("speech.g2p")

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
