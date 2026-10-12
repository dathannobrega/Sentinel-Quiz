"""Prometheus metrics (contract 2 §2.6), one registry per service instance.

``speech_requests_total{route,status}``, ``speech_inference_seconds{engine}``,
``speech_tts_cache_hits_total``, ``speech_tts_cache_misses_total``,
``speech_tts_cache_bytes`` and ``speech_model_ready{engine}``. Gauges are refreshed at
scrape time.
"""
from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest

INFERENCE_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0)


class Metrics:
    content_type = CONTENT_TYPE_LATEST

    def __init__(self) -> None:
        self.registry = CollectorRegistry(auto_describe=True)
        self.requests = Counter(
            "speech_requests", "HTTP requests by route template and status code", ["route", "status"], registry=self.registry
        )
        self.inference = Histogram(
            "speech_inference_seconds", "Model inference time", ["engine"], buckets=INFERENCE_BUCKETS, registry=self.registry
        )
        self.cache_hits = Counter("speech_tts_cache_hits", "TTS requests served from the audio cache", registry=self.registry)
        self.cache_misses = Counter("speech_tts_cache_misses", "TTS requests that needed synthesis", registry=self.registry)
        self.cache_bytes = Gauge("speech_tts_cache_bytes", "Bytes in the TTS audio cache", registry=self.registry)
        self.model_ready = Gauge("speech_model_ready", "1 when the engine's model is loaded", ["engine"], registry=self.registry)

    @contextmanager
    def time_inference(self, engine: str) -> Iterator[None]:
        start = time.perf_counter()
        try:
            yield
        finally:
            self.inference.labels(engine=engine).observe(time.perf_counter() - start)

    def render(self, engines: list[Any], cache_bytes: int) -> bytes:
        self.cache_bytes.set(cache_bytes)
        for engine in engines:
            if engine.name != "none":
                self.model_ready.labels(engine=engine.name).set(1.0 if engine.ready else 0.0)
        return generate_latest(self.registry)
