"""Standalone AI job worker (AI_JOB_RUNNER=worker).

    python -m app.services.ai_authoring.worker

Claims queued jobs with ``SELECT ... FOR UPDATE SKIP LOCKED`` (PostgreSQL), so any
number of workers can run side by side. SIGTERM/SIGINT finish the current job first.
"""
from __future__ import annotations

import logging
import signal
import time

from app.core.config import settings
from app.core.logging import configure_logging
from app.live.db import live_db
from app.services.ai_authoring.jobs import run_job, sweep

logger = logging.getLogger("app.ai_authoring.worker")
_running = True


def _stop(*_args) -> None:
    global _running
    _running = False


def main(idle_sleep: float = 1.0) -> None:
    configure_logging(settings)
    settings.validate_runtime()
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    logger.info("AI worker started", extra={"event": "ai_worker_start"})
    last_sweep = 0.0
    while _running:
        if time.monotonic() - last_sweep > 60:
            with live_db() as db:
                sweep(db)
            last_sweep = time.monotonic()
        if run_job() is None:
            time.sleep(idle_sleep)
    logger.info("AI worker stopped", extra={"event": "ai_worker_stop"})


if __name__ == "__main__":
    main()
