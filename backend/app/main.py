from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.core.logging import configure_logging
from app.db.session import engine, SessionLocal
from app.db.base import Base
from app.middleware.observability import ObservabilityMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.api.routes import router as api_router
from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.study import router as study_router
from app.services.ingest import ingest_questions_from_dir
from app.services.materials import resolve_material_dir

configure_logging(settings)
settings.validate_runtime()

logger = logging.getLogger("app.bootstrap")

app = FastAPI(title="Sentinel Quiz API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RateLimitMiddleware, settings=settings)
app.add_middleware(ObservabilityMiddleware, settings=settings)

if settings.bootstrap_schema:
    Base.metadata.create_all(bind=engine)

if settings.is_production() and settings.bootstrap_schema:
    logger.warning(
        "BOOTSTRAP_SCHEMA is enabled in production; prefer running Alembic migrations before startup.",
        extra={
            "event": "bootstrap_schema_enabled_in_production",
            "environment": settings.environment,
        },
    )

@app.on_event("startup")
def on_startup():
    logger.info(
        "Application startup initiated",
        extra={
            "event": "startup_begin",
            "environment": settings.environment,
            "database_backend": "sqlite" if settings.database_url.startswith("sqlite") else "sql",
            "question_json_dir": settings.question_json_dir,
            "material_dir": settings.material_dir,
        },
    )

    db = SessionLocal()
    try:
        ingest_result = ingest_questions_from_dir(db, settings.question_json_dir)
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

app.include_router(api_router)
app.include_router(admin_router)
app.include_router(auth_router)
app.include_router(study_router)

material_path = resolve_material_dir()
if material_path and material_path.is_dir():
    app.mount("/materials", StaticFiles(directory=str(material_path), html=False), name="materials")
