"""Deterministic time suggestion (PLANO §12.6)."""
from __future__ import annotations

import math


def suggest_time_limit(item_type: str, prompt: str, options: list[str] | None = None) -> tuple[int, str]:
    words = len((prompt or "").split()) + sum(len((o or "").split()) for o in options or [])
    seconds = 5 + words / 3 + (5 if item_type == "multi_choice" else 0) + (10 if item_type == "type_answer" else 0)
    if len(prompt or "") > 200:
        seconds += 10
    value = max(10, min(120, int(math.ceil(seconds / 5.0) * 5)))
    reason = f"{words} palavras para ler" + (" + escolha múltipla" if item_type == "multi_choice" else "") + (
        " + digitação" if item_type == "type_answer" else ""
    )
    return value, reason
