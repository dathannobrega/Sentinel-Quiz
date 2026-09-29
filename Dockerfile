# syntax=docker/dockerfile:1.7
#
# Sentinel Quiz API image (FastAPI + Alembic).
# Base image pinned by digest; Dependabot (docker ecosystem) keeps it fresh.
ARG PYTHON_IMAGE=python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

# ---------------------------------------------------------------------------
# builder: resolve and install Python dependencies into an isolated venv
# ---------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

# requirements.lock pins every transitive dependency with hashes (pip-compile of requirements.txt).
COPY backend/requirements.lock /tmp/requirements.lock

RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock

# ---------------------------------------------------------------------------
# runtime: slim image, non-root user, no build tooling, no licensed material
# ---------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    MATERIAL_DIR=/app/material \
    STUDY_TRACK_DIR=/app/study-tracks \
    QUESTION_JSON_DIR=/questions

WORKDIR /app

# Code is owned by root and read-only for the runtime user. /app/material is
# an empty mount point: EPUBs are provided at runtime via a read-only volume
# (./material:/app/material:ro) and are never baked into the image.
# /app/study-tracks holds only the three non-licensed study-track definitions
# (Modulos_sec+.md, cissp_domain.json) so the study track works without the
# material volume (e.g. Portainer).
RUN groupadd --system app \
    && useradd --system --gid app --home-dir /app --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/material /questions \
    && chown app:app /app/material

COPY --from=builder /opt/venv /opt/venv
COPY backend/app /app/app
COPY backend/alembic /app/alembic
COPY backend/alembic.ini /app/alembic.ini
COPY questions /questions
COPY material/Modulos_sec+.md material/cissp_domain.json material/ceh_modules.md /app/study-tracks/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh

USER app
EXPOSE 8000

# Generous start period: migrations + optional ingestion run before uvicorn.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --start-interval=5s --retries=3 \
  CMD python -c "import sys, urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3); sys.exit(0)"

ENTRYPOINT ["entrypoint.sh"]

# "api" = migrations (if enabled) + optional one-shot ingestion + uvicorn.
# Other commands: "migrate" (alembic upgrade head only), "ingest", or any
# arbitrary command (exec'd as-is).
CMD ["api"]
