"""Participant display names: normalization, moderation and suggestions (PLANO §13.8).

- ``clean_display_name`` keeps what the person typed (NFKC, no control/format chars,
  single spaces, 2–24 characters).
- ``nickname_key`` is the uniqueness key inside a room: case/accents/spacing and common
  leetspeak are folded, so "Ana", "ana " and "4NA" collide.
- ``is_offensive`` checks the folded form against a pt-BR/en blocklist (substring for
  long terms, whole token for short ones, to avoid the "Scunthorpe" problem).
"""
from __future__ import annotations

import random
import re
import unicodedata

MIN_LEN = 2
MAX_LEN = 24

_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "i"})

# Folded (lowercase, no accents, no leet) terms. Long terms match as substrings of the
# compact name; short terms only as whole tokens.
_BLOCK_SUBSTRINGS = (
    "caralho", "buceta", "porra", "cacete", "arrombad", "viadinh", "vagabund", "piranha", "punheta",
    "fuck", "bitch", "whore", "nigger", "nigga", "faggot", "retard", "hitler", "nazi",
    "estupr", "pedofil", "putinha", "filhodaputa",
)
_BLOCK_TOKENS = frozenset({
    "puta", "puto", "cu", "cuzao", "pau", "rola", "pinto", "merda", "bosta", "otario", "otaria", "idiota",
    "burro", "burra", "corno", "sex", "sexo", "porn", "dick", "cock", "ass", "fag", "slut", "kkk",
    "cunt", "shit", "fdp", "vsf", "tnc", "macaco",
    "admin", "host", "apresentador", "moderador", "sistema", "system",
})

_ADJECTIVES_PT = (
    "Veloz", "Astuto", "Sereno", "Brilhante", "Discreto", "Audaz", "Atento", "Ágil", "Curioso", "Firme",
    "Lendário", "Preciso", "Sagaz", "Tático", "Valente", "Zen",
)
_NOUNS_PT = (
    "Firewall", "Hash", "Token", "Proxy", "Kernel", "Cifra", "Sandbox", "Honeypot", "Bastion", "Nonce",
    "Checksum", "Payload", "Sentinela", "Vigia", "Radar", "Escudo",
)
_ADJECTIVES_EN = (
    "Swift", "Clever", "Calm", "Bright", "Stealthy", "Bold", "Keen", "Nimble", "Curious", "Steady",
    "Legendary", "Precise", "Sharp", "Tactical", "Brave", "Zen",
)
_NOUNS_EN = (
    "Firewall", "Hash", "Token", "Proxy", "Kernel", "Cipher", "Sandbox", "Honeypot", "Bastion", "Nonce",
    "Checksum", "Payload", "Sentinel", "Watcher", "Radar", "Shield",
)

_SPACES = re.compile(r"\s+")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def clean_display_name(raw: str | None) -> str:
    text = unicodedata.normalize("NFKC", str(raw or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C")
    return _SPACES.sub(" ", text).strip()


def _folded(value: str) -> str:
    return _strip_accents(value).lower().translate(_LEET)


def nickname_key(display_name: str) -> str:
    return _NON_ALNUM.sub("", _folded(display_name))[:48]


def is_offensive(display_name: str) -> bool:
    folded = _folded(display_name)
    compact = _NON_ALNUM.sub("", folded)
    # Collapse repeated letters ("puuuta") before matching.
    squeezed = re.sub(r"(.)\1+", r"\1", compact)
    for term in _BLOCK_SUBSTRINGS:
        if term in compact or term in squeezed:
            return True
    tokens = {tok for tok in _NON_ALNUM.split(folded) if tok}
    tokens |= {re.sub(r"(.)\1+", r"\1", tok) for tok in tokens}
    if compact in _BLOCK_TOKENS or squeezed in _BLOCK_TOKENS:
        return True
    return bool(tokens & _BLOCK_TOKENS)


class NameRejected(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code  # "too_short" | "too_long" | "offensive" | "invalid"


def validate_display_name(raw: str | None) -> tuple[str, str]:
    """Return ``(display_name, nickname_key)`` or raise :class:`NameRejected`."""
    name = clean_display_name(raw)
    if len(name) > MAX_LEN:
        raise NameRejected("too_long")
    key = nickname_key(name)
    letters = sum(1 for ch in name if ch.isalnum())
    if len(name) < MIN_LEN or len(key) < MIN_LEN or letters < MIN_LEN:
        raise NameRejected("too_short" if len(name) < MIN_LEN else "invalid")
    if is_offensive(name):
        raise NameRejected("offensive")
    return name, key


def suggest_name(lang: str | None = None, *, rng: random.Random | None = None) -> str:
    rng = rng or random.SystemRandom()
    if str(lang or "").lower().startswith("en"):
        return f"{rng.choice(_ADJECTIVES_EN)} {rng.choice(_NOUNS_EN)}"
    return f"{rng.choice(_NOUNS_PT)} {rng.choice(_ADJECTIVES_PT)}"


def avatar_seed(rng: random.Random | None = None) -> str:
    rng = rng or random.SystemRandom()
    return "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(10))
