"""Live metrics (RNF-1001) without extra dependencies.

Process-local counters, gauges and fixed-bucket histograms rendered in the Prometheus
text format (``GET /api/live/metrics``) or as a JSON summary with approximate
percentiles (``?format=json``, used by ``scripts/live/loadtest.py``). Each ``live``
replica exposes its own numbers; Prometheus aggregates across replicas.

Everything here runs on the event loop or in worker threads, so updates take a lock.
The cost is a dict lookup and an addition per event.
"""
from __future__ import annotations

import asyncio
import bisect
import threading
import time
from typing import Any, Callable, Iterable

# Seconds. Tuned for the live SLOs: 50 ms .. 1 s is where RNF-101/103/106 live.
LATENCY_BUCKETS = (0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.3, 0.5, 0.75, 1.0, 2.5, 5.0, 10.0)
BATCH_BUCKETS = (1, 2, 5, 10, 25, 50, 100, 250, 500)


class Histogram:
    def __init__(self, buckets: Iterable[float] = LATENCY_BUCKETS) -> None:
        self.buckets = tuple(buckets)
        self.counts = [0] * (len(self.buckets) + 1)
        self.total = 0.0
        self.n = 0

    def observe(self, value: float) -> None:
        self.counts[bisect.bisect_left(self.buckets, value)] += 1
        self.total += value
        self.n += 1

    def quantile(self, q: float) -> float | None:
        """Upper bound of the bucket holding the q-quantile (conservative)."""
        if not self.n:
            return None
        rank = q * self.n
        seen = 0
        for index, count in enumerate(self.counts):
            seen += count
            if seen >= rank:
                return self.buckets[index] if index < len(self.buckets) else float("inf")
        return float("inf")


class LiveMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self.histograms: dict[tuple[str, tuple[tuple[str, str], ...]], Histogram] = {}
        self.gauges: dict[str, Callable[[], dict[tuple[tuple[str, str], ...], float]]] = {}

    @staticmethod
    def _key(name: str, labels: dict[str, Any] | None) -> tuple[str, tuple[tuple[str, str], ...]]:
        return name, tuple(sorted((k, str(v)) for k, v in (labels or {}).items()))

    def inc(self, name: str, labels: dict[str, Any] | None = None, value: float = 1.0) -> None:
        key = self._key(name, labels)
        with self._lock:
            self.counters[key] = self.counters.get(key, 0.0) + value

    def observe(
        self, name: str, seconds: float, labels: dict[str, Any] | None = None, *, buckets: Iterable[float] = LATENCY_BUCKETS
    ) -> None:
        key = self._key(name, labels)
        with self._lock:
            histogram = self.histograms.get(key)
            if histogram is None:
                histogram = self.histograms[key] = Histogram(buckets)
            histogram.observe(max(0.0, seconds))

    def gauge(self, name: str, read: Callable[[], dict[tuple[tuple[str, str], ...], float]]) -> None:
        self.gauges[name] = read

    def reset(self) -> None:
        with self._lock:
            self.counters.clear()
            self.histograms.clear()

    # -------------------------------------------------------------- exposition
    def prometheus(self) -> str:
        lines: list[str] = []
        with self._lock:
            counters = dict(self.counters)
            histograms = {k: (h.buckets, list(h.counts), h.total, h.n) for k, h in self.histograms.items()}
        for name in sorted({k[0] for k in counters}):
            lines.append(f"# TYPE {name} counter")
            for (metric, labels), value in sorted(counters.items()):
                if metric == name:
                    lines.append(f"{name}{_labels(labels)} {value:g}")
        for name, read in sorted(self.gauges.items()):
            lines.append(f"# TYPE {name} gauge")
            for labels, value in sorted(_safe(read).items()):
                lines.append(f"{name}{_labels(labels)} {value:g}")
        for name in sorted({k[0] for k in histograms}):
            lines.append(f"# TYPE {name} histogram")
            for (metric, labels), (buckets, counts, total, n) in sorted(histograms.items()):
                if metric != name:
                    continue
                cumulative = 0
                for bound, count in zip(buckets, counts):
                    cumulative += count
                    lines.append(f"{name}_bucket{_labels(labels + (('le', f'{bound:g}'),))} {cumulative}")
                lines.append(f"{name}_bucket{_labels(labels + (('le', '+Inf'),))} {n}")
                lines.append(f"{name}_sum{_labels(labels)} {total:.6f}")
                lines.append(f"{name}_count{_labels(labels)} {n}")
        return "\n".join(lines) + "\n"

    def summary(self) -> dict[str, Any]:
        with self._lock:
            counters = {_flat(k): v for k, v in self.counters.items()}
            histograms = {_flat(k): _describe(k[0], h) for k, h in self.histograms.items()}
        gauges = {f"{name}{_labels(labels)}": value for name, read in self.gauges.items() for labels, value in _safe(read).items()}
        return {"counters": counters, "gauges": gauges, "histograms": histograms}


def _describe(name: str, h: Histogram) -> dict[str, Any]:
    if not name.endswith("_seconds"):  # sizes/counts: raw values
        return {"n": h.n, "mean": round(h.total / h.n, 2) if h.n else None,
                "p50": h.quantile(0.5), "p95": h.quantile(0.95), "p99": h.quantile(0.99)}
    return {
        "n": h.n,
        "mean_ms": round(h.total / h.n * 1000, 2) if h.n else None,
        "p50_ms": _ms(h.quantile(0.5)),
        "p95_ms": _ms(h.quantile(0.95)),
        "p99_ms": _ms(h.quantile(0.99)),
    }


def _safe(read: Callable[[], dict]) -> dict:
    try:
        return read()
    except Exception:  # pragma: no cover - a gauge must never break the scrape
        return {}


def _labels(labels: tuple[tuple[str, str], ...]) -> str:
    if not labels:
        return ""
    body = ",".join(f'{k}="{v.replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))}"' for k, v in labels)
    return "{" + body + "}"


def _flat(key: tuple[str, tuple[tuple[str, str], ...]]) -> str:
    return key[0] + _labels(key[1])


def _ms(value: float | None) -> float | None:
    if value is None:
        return None
    return None if value == float("inf") else round(value * 1000, 1)


metrics = LiveMetrics()


async def loop_lag_sampler(interval: float = 0.5) -> None:
    """``live_event_loop_lag_seconds`` (RNF-108): how late a sleep wakes up."""
    while True:
        started = time.perf_counter()
        await asyncio.sleep(interval)
        metrics.observe("live_event_loop_lag_seconds", time.perf_counter() - started - interval)
