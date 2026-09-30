"""Input guardrails (PLANO §12.5): PII scrub, delimiter neutralization, injection signals."""
from __future__ import annotations

import re
import unicodedata

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
_PHONE = re.compile(r"(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b")
_ZERO_WIDTH = re.compile("[​-‏⁠-⁤﻿]")
_TAGS = re.compile(r"</?\s*(documento_do_usuario|tema_do_usuario|system|instructions?)\b[^>]*>", re.I)
_INJECTION_SIGNALS = re.compile(
    r"(ignore (all |the )?(previous|above|prior) (instructions|prompts?)"
    r"|disregard (the )?(previous|above)|system prompt|you are now|act as|jailbreak"
    r"|ignore as instru[cç][oõ]es|esque[cç]a (as |todas as )?instru[cç][oõ]es|voc[eê] agora [eé]"
    r"|prompt do sistema|finja (ser|que))",
    re.I,
)


def scrub_pii(text: str) -> str:
    text = _EMAIL.sub("[email]", text)
    text = _CPF.sub("[cpf]", text)
    return _PHONE.sub("[telefone]", text)


def clean_user_text(text: str, *, limit: int) -> str:
    """Plain, bounded text safe to embed between delimiters."""
    text = unicodedata.normalize("NFC", str(text or ""))
    text = _ZERO_WIDTH.sub("", text)
    text = "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    text = _TAGS.sub(" ", text)
    return scrub_pii(text)[:limit].strip()


def injection_suspected(text: str) -> bool:
    return bool(_INJECTION_SIGNALS.search(str(text or "")))
