#!/bin/sh
set -eu

if [ -n "${APP_ENV_FILE:-}" ] && [ -f "${APP_ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${APP_ENV_FILE}"
  set +a
fi

: "${QUESTION_JSON_DIR:=/questions}"
: "${DATABASE_URL:=sqlite:////data/securityplus.db}"
: "${FRONTEND_DIR:=/app/frontend}"
: "${CORS_ORIGINS:=http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:8000,http://localhost:8000}"
: "${GEMINI_ENABLE:=true}"
: "${GEMINI_MODEL:=gemini-1.5-flash}"
: "${GEMINI_TIMEOUT_SECONDS:=20}"
: "${GEMINI_TEMPERATURE:=0.2}"
: "${GEMINI_MAX_OUTPUT_TOKENS:=400}"
: "${GEMINI_MIN_RESPONSE_CHARS:=220}"
: "${GEMINI_RETRY_ON_SHORT:=true}"
: "${GEMINI_CANDIDATE_COUNT:=1}"

export QUESTION_JSON_DIR
export DATABASE_URL
export FRONTEND_DIR
export CORS_ORIGINS
export GEMINI_ENABLE
export GEMINI_MODEL
export GEMINI_TIMEOUT_SECONDS
export GEMINI_TEMPERATURE
export GEMINI_MAX_OUTPUT_TOKENS
export GEMINI_MIN_RESPONSE_CHARS
export GEMINI_RETRY_ON_SHORT
export GEMINI_CANDIDATE_COUNT

exec "$@"
