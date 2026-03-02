from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.db.session import engine, SessionLocal
from app.db.base import Base
from app.db.migrations import ensure_compat_schema
from app.middleware.rate_limit import RateLimitMiddleware
from app.api.routes import router as api_router
from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.study import router as study_router
from app.services.ingest import ingest_questions_from_dir
from app.services.materials import resolve_material_dir

app = FastAPI(title="Sentinel Quiz API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RateLimitMiddleware, settings=settings)

if settings.bootstrap_schema:
    Base.metadata.create_all(bind=engine)
    ensure_compat_schema(engine)

@app.on_event("startup")
def on_startup():
    # Ingest JSON files -> DB
    db = SessionLocal()
    try:
        ingest_questions_from_dir(db, settings.question_json_dir)
    finally:
        db.close()

app.include_router(api_router)
app.include_router(admin_router)
app.include_router(auth_router)
app.include_router(study_router)

material_path = resolve_material_dir()
if material_path and material_path.is_dir():
    app.mount("/materials", StaticFiles(directory=str(material_path), html=False), name="materials")
