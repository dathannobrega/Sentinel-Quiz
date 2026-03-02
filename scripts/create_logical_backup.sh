#!/bin/sh
set -eu

DATABASE_URL_INPUT="${1:-${DATABASE_URL:-}}"
OUTPUT_DIR="${2:-./backups}"

if [ -z "${DATABASE_URL_INPUT}" ]; then
  echo "Uso: scripts/create_logical_backup.sh <DATABASE_URL opcional> [output_dir]" >&2
  echo "Ou defina DATABASE_URL no ambiente." >&2
  exit 1
fi

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
mkdir -p "${OUTPUT_DIR}"

case "${DATABASE_URL_INPUT}" in
  sqlite:///*)
    db_path="${DATABASE_URL_INPUT#sqlite:///}"
    if [ ! -f "${db_path}" ]; then
      echo "Arquivo SQLite nao encontrado: ${db_path}" >&2
      exit 1
    fi
    target_path="${OUTPUT_DIR}/sentinel-quiz-${timestamp}.sqlite3"
    cp "${db_path}" "${target_path}"
    ;;
  postgresql://*|postgresql+psycopg://*)
    if ! command -v pg_dump >/dev/null 2>&1; then
      echo "pg_dump nao encontrado no PATH." >&2
      exit 1
    fi
    pg_url="${DATABASE_URL_INPUT#postgresql+psycopg://}"
    pg_url="postgresql://${pg_url#postgresql://}"
    target_path="${OUTPUT_DIR}/sentinel-quiz-${timestamp}.dump"
    pg_dump \
      --format=custom \
      --no-owner \
      --no-privileges \
      --file="${target_path}" \
      "${pg_url}"
    ;;
  *)
    echo "DATABASE_URL nao suportada para backup: ${DATABASE_URL_INPUT}" >&2
    exit 1
    ;;
esac

echo "Backup criado em ${target_path}"
