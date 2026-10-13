"""Server-side warm-up of the next paragraphs (docs/reading/CONTRATO-INCREMENTO-3.md §3.2).

On a small VM the first paragraph takes 15-25 s to start playing. When the reader opens a section,
the UI posts its position and this module synthesizes the next ``READING_WARM_BLOCKS_AHEAD`` blocks
in the background with ``X-Speech-Priority: low``, so the sentences are already cached when the
reader gets there and a warm-up never delays a paragraph someone is waiting for.

Design constraints, all deliberate:

* one small thread pool per API process (``READING_WARM_WORKERS``), created lazily: importing this
  module or running tests starts no thread;
* a bounded set of pending blocks (``READING_WARM_QUEUE_MAX``) deduplicated by
  ``(section, part, block, voice, speed)``, plus a 60 s memory of positions already requested, so
  a reader scrolling back and forth or two tabs do not multiply the work;
* the block text is resolved from the corpus *here*, never taken from the client;
* nothing raises to the caller: a failed warm-up is a log line (``event: reading_warm``).
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable

from app.core.config import settings
from app.services import reading
from app.services.speech_client import SpeechError, get_speech_client

logger = logging.getLogger("app.reading.warm")

RECENT_SECONDS = 60.0
WarmKey = tuple[str, str, int, str, float]


@dataclass(frozen=True)
class WarmTarget:
    key: WarmKey
    text: str


class WarmScheduler:
    """Per-process queue of low-priority TTS jobs (see the module docstring)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._executor: ThreadPoolExecutor | None = None
        self._pending: set[WarmKey] = set()
        self._recent: dict[WarmKey, float] = {}

    # ------------------------------------------------------------------ bookkeeping
    def _prune_recent(self, now: float) -> None:
        for key in [key for key, stamp in self._recent.items() if now - stamp >= RECENT_SECONDS]:
            self._recent.pop(key, None)

    def _dispatch(self, job: Callable[[], None]) -> None:
        """Run ``job`` on the pool (tests swap this for an inline call)."""
        with self._lock:
            if self._executor is None:
                workers = max(int(settings.reading_warm_workers or 1), 1)
                self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="reading-warm")
            executor = self._executor
        executor.submit(job)

    def shutdown(self) -> None:
        """Stop the pool without waiting for queued jobs (app lifespan / tests)."""
        with self._lock:
            executor, self._executor = self._executor, None
            self._pending.clear()
            self._recent.clear()
        if executor is not None:
            executor.shutdown(wait=False, cancel_futures=True)

    def pending_count(self) -> int:
        with self._lock:
            return len(self._pending)

    # ------------------------------------------------------------------ API
    def schedule(self, section_id: str, part_id: str, block_index: int, *, voice: str, speed: float) -> dict[str, Any]:
        """Queue the blocks ahead of a position; ``{"queued", "skipped"}`` (+ ``enabled: false``)."""
        if not settings.reading_warm_enabled:
            return {"queued": 0, "skipped": 0, "enabled": False}
        ahead = max(int(settings.reading_warm_blocks_ahead or 0), 0)
        queue_max = max(int(settings.reading_warm_queue_max or 0), 0)
        candidates = reading.blocks_ahead(section_id, part_id, block_index, ahead)
        now = time.monotonic()
        targets: list[WarmTarget] = []
        skipped = 0
        with self._lock:
            self._prune_recent(now)
            for sid, pid, index, text in candidates:
                key: WarmKey = (sid, pid, index, voice, float(speed))
                if key in self._pending or key in self._recent or len(self._pending) >= queue_max:
                    skipped += 1
                    continue
                self._pending.add(key)
                self._recent[key] = now
                targets.append(WarmTarget(key, text))
        if targets:
            try:
                self._dispatch(lambda: self._run(targets))
            except Exception:  # pragma: no cover - pool shut down mid-request
                with self._lock:
                    for target in targets:
                        self._pending.discard(target.key)
                logger.warning("Warm-up dispatch failed", extra={"event": "reading_warm", "queued": 0, "failed": len(targets)})
                return {"queued": 0, "skipped": skipped + len(targets)}
        return {"queued": len(targets), "skipped": skipped}

    def _run(self, targets: list[WarmTarget]) -> None:
        """The job: one low-priority ``POST /v1/tts`` per block. Never raises."""
        started = time.perf_counter()
        counts = {"synthesized": 0, "cached": 0, "failed": 0}
        code: str | None = None
        try:
            client = get_speech_client()
            for target in targets:
                if client is None:
                    counts["failed"] += 1
                    code = "speech_unavailable"
                    continue
                _section, _part, index, voice, speed = target.key
                try:
                    result = client.tts(target.text, voice=voice, speed=speed, priority="low")
                except SpeechError as exc:
                    counts["failed"] += 1
                    code = exc.code
                    if exc.status_code in (503, 504):
                        # The service is busy or warming: the rest would fail the same way.
                        break
                except Exception as exc:  # pragma: no cover - defensive
                    counts["failed"] += 1
                    code = type(exc).__name__
                else:
                    counts["cached" if result.get("cached") else "synthesized"] += 1
        finally:
            with self._lock:
                for target in targets:
                    self._pending.discard(target.key)
            logger.info(
                "Reading warm-up finished",
                extra={
                    "event": "reading_warm", "blocks": len(targets), **counts, "code": code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )


scheduler = WarmScheduler()


def shutdown() -> None:
    scheduler.shutdown()
