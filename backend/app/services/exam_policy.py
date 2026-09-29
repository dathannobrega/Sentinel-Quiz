"""Certification-level exam rules (M-C3): passing thresholds.

Single source of truth for the passing score of every certification, expressed as a
percentage of correct answers:

* CISSP: 700/1000 scaled score -> 70.0 %
* CompTIA Security+ (SY0-701): 750 on a 100-900 scale -> 750/900 = 83.0 %
* EC-Council CEH v13 (312-50): 70.0 %. There is no fixed official passing score: each
  exam form has its own cut score set by psychometricians, between 60 % and 85 %
  according to the v13 brochure (the eccouncil.org FAQ says 65 %-85 %). 70 % is a
  practice target inside that range.
* anything else: 70.0 %

Scaled scores are not linear in the number of correct answers; these percentages are a
practice-oriented approximation, documented here so there is one place to tune them.
"""
from __future__ import annotations

from typing import Iterable, Optional

DEFAULT_PASS_THRESHOLD = 70.0
PASS_THRESHOLDS: dict[str, float] = {
    "cissp": 70.0,
    "security+": 83.0,
    # Official cut score varies per exam form (60-85 %); see the module docstring.
    "ceh": 70.0,
}
_ALIASES = {
    "securityplus": "security+",
    "security plus": "security+",
    "comptia security+": "security+",
    "sec+": "security+",
    "secplus": "security+",
    "sy0-701": "security+",
    "ceh v13": "ceh",
    "cehv13": "ceh",
    "ceh ai": "ceh",
    "312-50": "ceh",
    "certified ethical hacker": "ceh",
}


def normalize_certification(value: Optional[str]) -> str:
    raw = " ".join(str(value or "").strip().lower().split())
    return _ALIASES.get(raw, raw)


def pass_threshold_for(certification: Optional[str]) -> float:
    return PASS_THRESHOLDS.get(normalize_certification(certification), DEFAULT_PASS_THRESHOLD)


def resolve_pass_threshold(certification_counts: dict[Optional[str], int] | Iterable[tuple[Optional[str], int]]) -> tuple[float, Optional[str]]:
    """Threshold for a session given ``{certification: question_count}``.

    Single-certification sessions use that certification's threshold. Mixed sessions use
    the question-weighted average of the thresholds involved (the returned certification
    is then ``None``).
    """
    items = list(certification_counts.items()) if isinstance(certification_counts, dict) else list(certification_counts)
    items = [(cert, int(count or 0)) for cert, count in items if int(count or 0) > 0]
    if not items:
        return DEFAULT_PASS_THRESHOLD, None
    labels = {normalize_certification(cert) for cert, _count in items}
    if len(labels) == 1:
        cert = items[0][0]
        return pass_threshold_for(cert), (str(cert).strip() or None) if cert else None
    total = sum(count for _cert, count in items)
    weighted = sum(pass_threshold_for(cert) * count for cert, count in items) / total
    return round(weighted, 2), None
