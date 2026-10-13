from __future__ import annotations

from pathlib import Path

import pytest

from speech.config import Settings
from speech.runtime import effective_cpus, parse_parallel_mode, resolve_runtime
from speech.service import resolve_runtime_from


def _v2(tmp_path: Path, content: str) -> Path:
    (tmp_path / "cpu.max").write_text(content)
    return tmp_path


def _v1(tmp_path: Path, quota: str, period: str = "100000") -> Path:
    (tmp_path / "cpu").mkdir()
    (tmp_path / "cpu" / "cpu.cfs_quota_us").write_text(quota)
    (tmp_path / "cpu" / "cpu.cfs_period_us").write_text(period)
    return tmp_path


def test_effective_cpus_cgroup_v2(tmp_path: Path) -> None:
    assert effective_cpus(_v2(tmp_path, "300000 100000\n"), affinity=lambda: 16, cpu_count=lambda: 16) == 3
    assert effective_cpus(_v2(tmp_path, "150000 100000"), affinity=lambda: 16, cpu_count=lambda: 16) == 2  # rounded up
    assert effective_cpus(_v2(tmp_path, "max 100000"), affinity=lambda: 8, cpu_count=lambda: 16) == 8  # unlimited -> affinity
    assert effective_cpus(_v2(tmp_path, "3200000 100000"), affinity=lambda: 16, cpu_count=lambda: 16) == 16  # never above the host
    assert effective_cpus(_v2(tmp_path, "garbage"), affinity=lambda: 4, cpu_count=lambda: 16) == 4


def test_effective_cpus_cgroup_v1(tmp_path: Path) -> None:
    assert effective_cpus(_v1(tmp_path, "400000"), affinity=lambda: 16, cpu_count=lambda: 16) == 4
    (tmp_path / "cpu" / "cpu.cfs_quota_us").write_text("-1")
    assert effective_cpus(tmp_path, affinity=lambda: 12, cpu_count=lambda: 16) == 12


def test_effective_cpus_fallbacks(tmp_path: Path) -> None:
    assert effective_cpus(tmp_path / "missing", affinity=lambda: None, cpu_count=lambda: 10) == 10
    assert effective_cpus(tmp_path / "missing", affinity=lambda: None, cpu_count=lambda: None) == 1
    assert effective_cpus() >= 1  # the real machine


def test_auto_defaults_small_machine() -> None:
    rt = resolve_runtime(cpus=3)
    assert rt.as_health() == {
        "effective_cpus": 3,
        "threads": {"asr": 3, "torch": 3, "phoneme": 3},
        "max_concurrency": 1,
        "parallel_phonemes": False,
    }


def test_auto_defaults_eight_cpus_enable_parallel() -> None:
    rt = resolve_runtime(cpus=8)
    assert rt.max_concurrency == 2 and rt.parallel_phonemes is True
    assert rt.torch_threads == 8
    # The thread budget is split between the two engines that run at the same time.
    assert rt.asr_threads == 4 and rt.phoneme_threads == 4


def test_forced_parallel_on_small_cpu_halves_phoneme_threads() -> None:
    rt = resolve_runtime(cpus=3, parallel_phonemes="on")
    assert rt.parallel_phonemes is True and rt.phoneme_threads == 1 and rt.asr_threads == 2 and rt.torch_threads == 3
    off = resolve_runtime(cpus=4, parallel_phonemes="off")
    assert off.parallel_phonemes is False and (off.asr_threads, off.torch_threads, off.phoneme_threads) == (4, 4, 4)


def test_auto_threads_are_capped_on_big_hosts() -> None:
    rt = resolve_runtime(cpus=16, parallel_phonemes="off")
    assert (rt.asr_threads, rt.torch_threads, rt.phoneme_threads) == (8, 8, 8) and rt.max_concurrency == 2
    rt = resolve_runtime(cpus=16)
    assert rt.parallel_phonemes is True and (rt.asr_threads, rt.torch_threads, rt.phoneme_threads) == (4, 8, 4)
    rt = resolve_runtime(cpus=10)  # M1 Pro: 8 + 2 logical CPUs
    assert (rt.asr_threads, rt.torch_threads, rt.phoneme_threads) == (4, 8, 4)


def test_explicit_values_win() -> None:
    rt = resolve_runtime(cpus=2, asr_threads=6, torch_threads=5, phoneme_threads=4, max_concurrency=3)
    assert (rt.asr_threads, rt.torch_threads, rt.phoneme_threads, rt.max_concurrency) == (6, 5, 4, 3)


def test_parse_parallel_mode() -> None:
    assert parse_parallel_mode(None) == "auto"
    assert parse_parallel_mode(" ON ") == "on" and parse_parallel_mode("true") == "on"
    assert parse_parallel_mode("off") == "off" and parse_parallel_mode("0") == "off"
    assert parse_parallel_mode("sometimes") == "auto"


def test_settings_defaults_are_automatic(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("SPEECH_ASR_THREADS", "SPEECH_TORCH_THREADS", "SPEECH_PHONEME_THREADS", "SPEECH_MAX_CONCURRENCY"):
        monkeypatch.delenv(key, raising=False)
    settings = Settings()
    assert (settings.asr_threads, settings.torch_threads, settings.phoneme_threads, settings.max_concurrency) == (0, 0, 0, 0)
    assert settings.parallel_phonemes == "auto" and settings.cache_max_mb == 8192
    assert settings.low_priority_wait_seconds == 20.0
    rt = resolve_runtime_from(settings, cpus=3)
    assert rt.max_concurrency == 1 and rt.asr_threads == 3
