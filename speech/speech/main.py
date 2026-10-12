"""FastAPI application factory and the ``speech-server`` console entry point."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from .api import Limiter, register_routes
from .config import Settings, get_settings
from .errors import register_exception_handlers
from .service import SpeechService

logger = logging.getLogger("speech")


def create_app(settings: Settings | None = None, service: SpeechService | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.apply_hf_home()
    svc = service or SpeechService(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # The limiter owns asyncio primitives, so it is created inside the running loop.
        app.state.limiter = Limiter(settings)
        if settings.preload:
            svc.preload()
        yield

    app = FastAPI(title="Sentinel Speech", version="0.1.0", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.settings = settings
    app.state.service = svc
    register_exception_handlers(app)
    register_routes(app)
    return app


def run() -> None:
    import uvicorn

    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logger.info(
        "starting speech service tts=%s/%s asr=%s/%s cache=%s hf_home=%s",
        settings.tts_engine, settings.tts_model, settings.asr_engine, settings.asr_model, settings.cache_dir,
        os.environ.get("HF_HOME"),
    )
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level=settings.log_level.lower())
