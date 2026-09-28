from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.routes import router as api_router
from app.api.study import router as study_router
from app.core.config import Settings, settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.middleware.observability import ObservabilityMiddleware
from app.middleware.rate_limit import RateLimitMiddleware, build_rate_limit_store
from app.services.ingest import ingest_questions_from_dir
from app.services.materials import resolve_material_dir


logger = logging.getLogger("app.bootstrap")

CORS_EXPOSE_HEADERS = ["Retry-After", "Content-Disposition", "X-Request-ID", "X-Total-Count"]


def _log_material_dir_state(app_settings: Settings) -> None:
    material_path = resolve_material_dir()
    if material_path and material_path.is_dir():
        if not any(path.is_file() for path in material_path.iterdir()):
            logger.warning(
                "Material directory is mounted but empty; excerpt preview will fail for referenced books.",
                extra={"event": "material_dir_empty", "material_dir": str(material_path)},
            )
        return
    logger.warning(
        "Material directory is unavailable; excerpt preview will be disabled.",
        extra={"event": "material_dir_missing", "material_dir": app_settings.material_dir},
    )


def _run_startup(app_settings: Settings) -> None:
    logger.info(
        "Application startup initiated",
        extra={
            "event": "startup_begin",
            "environment": app_settings.environment,
            "database_backend": "sqlite" if app_settings.database_url.startswith("sqlite") else "sql",
            "question_json_dir": app_settings.question_json_dir,
            "material_dir": app_settings.material_dir,
            "api_docs_enabled": app_settings.api_docs_enabled(),
            "rate_limit_backend": app_settings.normalized_rate_limit_backend(),
        },
    )

    if app_settings.bootstrap_schema:
        # Development convenience only (validate_runtime forbids it in production).
        Base.metadata.create_all(bind=engine)

    _log_material_dir_state(app_settings)

    if not app_settings.ingest_on_startup:
        logger.info(
            "Startup ingestion skipped by configuration",
            extra={"event": "startup_ingest_skipped", "ingest_on_startup": False},
        )
        return

    db = SessionLocal()
    try:
        ingest_result = ingest_questions_from_dir(db, app_settings.question_json_dir)
        logger.info(
            "Question ingestion completed",
            extra={
                "event": "startup_ingest_complete",
                "imported": int(ingest_result.get("imported", 0) or 0),
                "skipped": int(ingest_result.get("skipped", 0) or 0),
                "errors": ingest_result.get("errors", []),
            },
        )
    finally:
        db.close()


def create_app(app_settings: Settings | None = None) -> FastAPI:
    app_settings = app_settings or settings
    configure_logging(app_settings)
    app_settings.validate_runtime()

    rate_limit_store = build_rate_limit_store(app_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        _run_startup(app_settings)
        try:
            yield
        finally:
            await rate_limit_store.close()

    docs_enabled = app_settings.api_docs_enabled()
    app = FastAPI(
        title="Sentinel Quiz API",
        version="1.0.0",
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.rate_limit_store = rate_limit_store

    register_exception_handlers(app)

    # Middleware order: the LAST added is the OUTERMOST. CORS must be outermost so
    # every response (including 429 from the rate limiter and 5xx) carries CORS
    # headers and preflight requests never reach the rate limiter.
    app.add_middleware(RateLimitMiddleware, settings=app_settings, store=rate_limit_store)
    app.add_middleware(ObservabilityMiddleware, settings=app_settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origin_list(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=CORS_EXPOSE_HEADERS,
    )

    app.include_router(api_router)
    app.include_router(admin_router)
    app.include_router(auth_router)
    app.include_router(study_router)
    # NOTE: the original material files are intentionally NOT served (no StaticFiles
    # mount). Excerpts are only available through the authenticated
    # /api/materials/preview endpoint.
    return app


app = create_app()
