"""CPU budget detection and automatic threads/concurrency (contract 3 §2.4).

``effective_cpus()`` answers "how many cores does this *container* really have":
the cgroup v2 quota (``cpu.max``), the cgroup v1 quota (``cpu.cfs_quota_us`` /
``cpu.cfs_period_us``), the scheduler affinity mask and finally ``os.cpu_count()``.
A quota is rounded up (1.5 CPUs -> 2) and never exceeds the cores the host exposes.

``resolve_runtime()`` turns the ``SPEECH_*`` settings (``0`` = automatic) into the
values the engines actually use. The rules are deliberately simple so an operator can
predict them from ``/healthz``:

* threads (ASR, torch/Kokoro, wav2vec2) = ``max(1, cpus)``, capped at
  ``AUTO_THREADS_CAP`` (8): measured on an M1 Pro, faster-whisper ``small.en`` int8 is
  3.4x *slower* with 10 threads than with 4 and wav2vec2 gains nothing past 4, so
  handing every logical CPU of a big host to one small model only burns it;
* ``max_concurrency`` = 1 below 6 CPUs, otherwise 2 (one heavy inference at a time on
  small machines);
* parallel phonemes: ``auto`` = only with 6+ CPUs; ``on``/``off`` force it. Whenever
  the wav2vec2 forward runs alongside Whisper the thread budget is *split* between
  them (wav2vec2 ``max(1, auto // 2)``, Whisper the rest) instead of giving each the
  full count: two oversubscribed OpenMP pools on the same cores were the slowest
  configuration measured (README, "Incremento 3").

Explicit (> 0) values always win over these rules.
"""
from __future__ import annotations

import logging
import math
import os
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger("speech.runtime")

CGROUP_ROOT = Path("/sys/fs/cgroup")
PARALLEL_MODES = ("auto", "on", "off")
PARALLEL_MIN_CPUS = 6
CONCURRENCY_MIN_CPUS = 6
AUTO_THREADS_CAP = 8


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, ValueError):
        return None


def _quota_v2(root: Path) -> int | None:
    """``cpu.max`` is ``"<quota> <period>"`` or ``"max <period>"`` (unlimited)."""
    raw = _read(root / "cpu.max")
    if not raw:
        return None
    parts = raw.split()
    if len(parts) != 2 or parts[0] == "max":
        return None
    try:
        quota, period = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if quota <= 0 or period <= 0:
        return None
    return max(1, math.ceil(quota / period))


def _quota_v1(root: Path) -> int | None:
    for sub in ("cpu", "cpu,cpuacct"):
        quota_raw = _read(root / sub / "cpu.cfs_quota_us")
        period_raw = _read(root / sub / "cpu.cfs_period_us")
        if quota_raw is None or period_raw is None:
            continue
        try:
            quota, period = int(quota_raw), int(period_raw)
        except ValueError:
            continue
        if quota <= 0 or period <= 0:  # -1 = unlimited
            return None
        return max(1, math.ceil(quota / period))
    return None


def host_cpus(affinity: Callable[[], int | None] | None = None, cpu_count: Callable[[], int | None] | None = None) -> int:
    """Cores visible to this process: affinity mask when the platform has one, else ``os.cpu_count()``."""
    if affinity is None:
        def affinity() -> int | None:  # type: ignore[misc]
            getter = getattr(os, "sched_getaffinity", None)
            if getter is None:
                return None
            try:
                return len(getter(0))
            except (OSError, ValueError):
                return None
    if cpu_count is None:
        cpu_count = os.cpu_count
    for getter in (affinity, cpu_count):
        try:
            value = getter()
        except Exception:  # noqa: BLE001
            value = None
        if value and value > 0:
            return int(value)
    return 1


def effective_cpus(
    cgroup_root: Path | str = CGROUP_ROOT,
    affinity: Callable[[], int | None] | None = None,
    cpu_count: Callable[[], int | None] | None = None,
) -> int:
    """CPUs this container may use (>= 1). See the module docstring for the order."""
    root = Path(cgroup_root)
    host = host_cpus(affinity, cpu_count)
    quota = _quota_v2(root)
    if quota is None:
        quota = _quota_v1(root)
    if quota is not None:
        return max(1, min(quota, host))
    return max(1, host)


def parse_parallel_mode(raw: str | None) -> str:
    value = (raw or "auto").strip().lower()
    if value in {"1", "true", "yes"}:
        return "on"
    if value in {"0", "false", "no"}:
        return "off"
    if value not in PARALLEL_MODES:
        logger.warning("SPEECH_PARALLEL_PHONEMES=%r is not auto|on|off; using auto", raw)
        return "auto"
    return value


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    effective_cpus: int
    asr_threads: int
    torch_threads: int
    phoneme_threads: int
    max_concurrency: int
    parallel_phonemes: bool
    parallel_mode: str  # auto|on|off as configured

    def as_health(self) -> dict[str, Any]:
        return {
            "effective_cpus": self.effective_cpus,
            "threads": {"asr": self.asr_threads, "torch": self.torch_threads, "phoneme": self.phoneme_threads},
            "max_concurrency": self.max_concurrency,
            "parallel_phonemes": self.parallel_phonemes,
        }

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def resolve_runtime(
    *,
    cpus: int | None = None,
    asr_threads: int = 0,
    torch_threads: int = 0,
    phoneme_threads: int = 0,
    max_concurrency: int = 0,
    parallel_phonemes: str = "auto",
) -> RuntimeConfig:
    """Apply the automatic rules; explicit (> 0) values always win over the automatic ones."""
    n = max(1, int(cpus if cpus is not None else effective_cpus()))
    mode = parse_parallel_mode(parallel_phonemes)
    parallel = mode == "on" or (mode == "auto" and n >= PARALLEL_MIN_CPUS)
    auto_threads = min(n, AUTO_THREADS_CAP)
    if parallel:
        phoneme_auto = max(1, auto_threads // 2)
        asr_auto = max(1, auto_threads - phoneme_auto)
    else:
        phoneme_auto = asr_auto = auto_threads
    return RuntimeConfig(
        effective_cpus=n,
        asr_threads=asr_threads if asr_threads > 0 else asr_auto,
        torch_threads=torch_threads if torch_threads > 0 else auto_threads,
        phoneme_threads=phoneme_threads if phoneme_threads > 0 else phoneme_auto,
        max_concurrency=max_concurrency if max_concurrency > 0 else (1 if n < CONCURRENCY_MIN_CPUS else 2),
        parallel_phonemes=parallel,
        parallel_mode=mode,
    )


__all__ = ["RuntimeConfig", "effective_cpus", "host_cpus", "parse_parallel_mode", "resolve_runtime"]
