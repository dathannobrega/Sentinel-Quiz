"""ASGI app of the dedicated ``live`` service (PLANO §10.1, DC-02).

Same image and code as the API; serves only the realtime surface (WebSocket, room
lookup/join, health) so long-lived connections are isolated from the REST API
(bulkhead). Requires LIVE_BUS_BACKEND=redis when it runs next to the ``api`` service
or with more than one replica, so every process sees every room event.

    uvicorn app.live.main:app --workers 1 --ws websockets --ws-max-size 16384
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.live import router as live_rest_router
from app.core.config import Settings, settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.live.bus import build_live_bus
from app.live.gateway import LiveHub, router as live_ws_router
from app.middleware.observability import ObservabilityMiddleware
from app.middleware.rate_limit import RateLimitMiddleware, build_rate_limit_store


def create_live_app(app_settings: Settings | None = None) -> FastAPI:
    app_settings = app_settings or settings
    configure_logging(app_settings)
    app_settings.validate_runtime()
    hub = LiveHub(build_live_bus(app_settings))
    rate_limit_store = build_rate_limit_store(app_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await hub.start()
        try:
            yield
        finally:
            await rate_limit_store.close()
            await hub.close()

    app = FastAPI(title="Sentinel Arena Live", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings = app_settings
    app.state.live_hub = hub
    app.state.rate_limit_store = rate_limit_store
    register_exception_handlers(app)
    # Same buckets as the API (per room code / participant token, DC-22).
    app.add_middleware(RateLimitMiddleware, settings=app_settings, store=rate_limit_store)
    app.add_middleware(ObservabilityMiddleware, settings=app_settings)
    app.include_router(live_ws_router)
    # Room lookup/join are the hot path when a QR code is shown to a big audience.
    app.include_router(live_rest_router)
    return app


app = create_live_app()
