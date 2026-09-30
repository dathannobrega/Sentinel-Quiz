#!/bin/sh
# Sentinel Quiz API container entrypoint.
#
# Commands:
#   api        (default) alembic upgrade head (RUN_DB_MIGRATIONS, default true)
#              -> one-shot question ingestion (INGEST_ON_STARTUP, default false)
#              -> uvicorn with proxy headers and UVICORN_WORKERS workers.
#   migrate    only run `alembic upgrade head` and exit (one-shot job).
#   ingest     only run the question ingestion once and exit.
#   ai-worker  Sentinel Arena AI job worker (AI_JOB_RUNNER=worker).
#   uvicorn …  legacy form: migrations (if enabled) then exec the given command.
#   anything else is exec'd as-is (e.g. `sh`, `alembic current`).
#
# Configuration: every APP_<NAME> variable is exported as <NAME> when <NAME>
# is not already set, so the same APP_* names work in docker compose,
# Portainer and `docker run --env-file .env.docker.example`. Empty values are
# ignored, which means "use the application default".
set -eu

log() {
  printf '%s entrypoint: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

is_true() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on) return 0 ;;
  esac
  return 1
}

if [ -n "${APP_ENV_FILE:-}" ]; then
  if [ -f "${APP_ENV_FILE}" ]; then
    set -a
    # shellcheck disable=SC1090
    . "${APP_ENV_FILE}"
    set +a
  else
    log "WARNING: APP_ENV_FILE=${APP_ENV_FILE} not found; ignoring."
  fi
fi

map_prefixed_env() {
  prefixed_name="$1"
  target_name="$2"
  eval "prefixed_value=\${${prefixed_name}:-}"
  eval "target_value=\${${target_name}:-}"
  if [ -n "${prefixed_value}" ] && [ -z "${target_value}" ]; then
    export "${target_name}=${prefixed_value}"
  fi
}

# APP_* variables that only configure the stack (compose/proxy/images) or are
# already the real setting name; they are not mapped to application settings.
is_stack_only_var() {
  case "$1" in
    ENV | ENV_FILE | POSTGRES_* | NGINX_* | TLS_* | HTTP_PORT | HTTPS_PORT) return 0 ;;
    IMAGE_* | *_IMAGE_NAME | CONTAINER_NAME | *_CONTAINER_NAME) return 0 ;;
    MATERIAL_HOST_DIR | PUBLIC_API_ORIGIN | *_CPUS | *_MEMORY) return 0 ;;
  esac
  return 1
}

# Names are restricted to [A-Z0-9_] by the regex, so the eval above is safe.
for suffix in $(env | sed -n 's/^APP_\([A-Z0-9_][A-Z0-9_]*\)=.*/\1/p' | sort -u); do
  if is_stack_only_var "${suffix}"; then
    continue
  fi
  map_prefixed_env "APP_${suffix}" "${suffix}"
done

# --- Database URL ----------------------------------------------------------
# Precedence: DATABASE_URL > APP_DATABASE_URL (mapped above) > URL built from
# APP_POSTGRES_{USER,PASSWORD,DB,HOST,PORT}. An empty APP_DATABASE_URL falls
# through to the constructed URL, so the API and the postgres service always
# share the same credentials.
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -z "${APP_POSTGRES_PASSWORD:-}" ]; then
    log "ERROR: no database configured. Set APP_DATABASE_URL (or DATABASE_URL) or APP_POSTGRES_PASSWORD."
    exit 64
  fi
  DATABASE_URL="$(python -c '
import os
from urllib.parse import quote

env = os.environ.get
print(
    "postgresql+psycopg://{user}:{password}@{host}:{port}/{db}".format(
        user=quote(env("APP_POSTGRES_USER") or "sentinel", safe=""),
        password=quote(env("APP_POSTGRES_PASSWORD") or "", safe=""),
        host=env("APP_POSTGRES_HOST") or "postgres",
        port=env("APP_POSTGRES_PORT") or "5432",
        db=quote(env("APP_POSTGRES_DB") or "sentinel_quiz", safe=""),
    )
)
')"
fi
export DATABASE_URL

# --- Derived / infrastructure defaults ---------------------------------------
# Application defaults (APP_ENV, BOOTSTRAP_SCHEMA, rate limits, ...) live in the
# backend code; only container-specific values are defaulted here.
: "${QUESTION_JSON_DIR:=/questions}"
: "${MATERIAL_DIR:=/app/material}"
: "${RUN_DB_MIGRATIONS:=true}"
: "${INGEST_ON_STARTUP:=false}"
: "${UVICORN_WORKERS:=2}"
# Only trust X-Forwarded-* from localhost unless told otherwise. The compose
# files set "*" because the API is reachable only on the internal network
# (the proxy is its sole client); never use "*" if port 8000 is published.
: "${FORWARDED_ALLOW_IPS:=127.0.0.1}"

if [ -z "${PUBLIC_WEB_ORIGIN:-}" ] && [ -n "${APP_NGINX_HOST:-}" ]; then
  PUBLIC_WEB_ORIGIN="https://${APP_NGINX_HOST}"
  export PUBLIC_WEB_ORIGIN
fi

export QUESTION_JSON_DIR MATERIAL_DIR RUN_DB_MIGRATIONS INGEST_ON_STARTUP UVICORN_WORKERS FORWARDED_ALLOW_IPS

run_migrations() {
  # alembic/env.py takes a PostgreSQL advisory lock, so concurrent replicas
  # starting at the same time serialize instead of racing.
  log "running alembic upgrade head"
  alembic -c /app/alembic.ini upgrade head
}

run_ingest() {
  log "ingesting question bank from ${QUESTION_JSON_DIR}"
  python - <<'PY'
import json

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.ingest import ingest_questions_from_dir

db = SessionLocal()
try:
    result = ingest_questions_from_dir(db, settings.question_json_dir) or {}
finally:
    db.close()

errors = result.get("errors") or []
print(
    json.dumps(
        {
            "event": "entrypoint_ingest_complete",
            "imported": int(result.get("imported", 0) or 0),
            "skipped": int(result.get("skipped", 0) or 0),
            "errors": len(errors),
        }
    ),
    flush=True,
)
PY
}

command="${1:-api}"

case "${command}" in
  api)
    if [ "$#" -gt 0 ]; then
      shift
    fi
    if is_true "${RUN_DB_MIGRATIONS}"; then
      run_migrations
    fi
    if is_true "${BOOTSTRAP_SCHEMA:-false}"; then
      # Legacy create_all path: schema is created on app import, so ingestion
      # must stay inside the app and a single worker avoids create_all races.
      log "WARNING: BOOTSTRAP_SCHEMA=true (dev only); forcing UVICORN_WORKERS=1."
      UVICORN_WORKERS=1
    elif is_true "${INGEST_ON_STARTUP}"; then
      # Ingest once here instead of once per uvicorn worker.
      run_ingest
      INGEST_ON_STARTUP=false
      export INGEST_ON_STARTUP
    fi
    exec uvicorn app.main:app \
      --host 0.0.0.0 \
      --port 8000 \
      --proxy-headers \
      --forwarded-allow-ips "${FORWARDED_ALLOW_IPS}" \
      --workers "${UVICORN_WORKERS}" \
      --no-server-header \
      --timeout-graceful-shutdown 20 \
      --ws websockets \
      --ws-per-message-deflate false \
      --ws-max-size 65536 \
      "$@"
    ;;
  migrate)
    run_migrations
    ;;
  ingest)
    run_ingest
    ;;
  ai-worker)
    # Sentinel Arena AI jobs (AI_JOB_RUNNER=worker): claims queued jobs with SKIP LOCKED.
    exec python -m app.services.ai_authoring.worker
    ;;
  uvicorn)
    if is_true "${RUN_DB_MIGRATIONS}"; then
      run_migrations
    fi
    exec "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
