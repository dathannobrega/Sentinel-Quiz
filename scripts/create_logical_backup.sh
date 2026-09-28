#!/bin/sh
# Logical PostgreSQL backup (pg_dump custom format) with verification and
# retention. No password ever appears on a command line.
#
# Modes (BACKUP_MODE):
#   compose   (default) run pg_dump INSIDE the postgres service of a compose
#             project: `docker compose [BACKUP_COMPOSE_ARGS] exec -T postgres`.
#             Uses the container's own POSTGRES_USER/POSTGRES_DB and the local
#             socket, so no credentials are needed on the host.
#   container same, via `docker exec` on BACKUP_PG_CONTAINER (Portainer stacks).
#   url       run the host's pg_dump against DATABASE_URL. The password is moved
#             into a temporary PGPASSFILE (mode 600), never passed as argument.
#
# Environment:
#   BACKUP_DIR            output directory (default: ./backups)
#   BACKUP_RETENTION      number of most recent dumps to keep (default: 14; 0 = keep all)
#   BACKUP_COMPOSE_ARGS   extra args for docker compose, e.g. "-f docker-compose.portainer.yml -p sentinel"
#   BACKUP_PG_SERVICE     compose service name (default: postgres)
#   BACKUP_PG_CONTAINER   container name for BACKUP_MODE=container
#   DATABASE_URL          for BACKUP_MODE=url (postgresql[+psycopg]://user:pass@host:port/db)
#
# Examples:
#   ./scripts/create_logical_backup.sh
#   BACKUP_MODE=container BACKUP_PG_CONTAINER=sentinel-postgres-1 ./scripts/create_logical_backup.sh
#   BACKUP_MODE=url DATABASE_URL=postgresql://sentinel:***@db.internal:5432/sentinel_quiz ./scripts/create_logical_backup.sh
#
# Restore: see README.md, section "Backup e restore".
set -eu
umask 077

mode="${BACKUP_MODE:-compose}"
backup_dir="${BACKUP_DIR:-./backups}"
retention="${BACKUP_RETENTION:-14}"
pg_service="${BACKUP_PG_SERVICE:-postgres}"
compose_args="${BACKUP_COMPOSE_ARGS:-}"

log() {
  printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

case "${retention}" in
  '' | *[!0-9]*) fail "BACKUP_RETENTION must be a non-negative integer" ;;
esac

mkdir -p "${backup_dir}"
chmod 700 "${backup_dir}"

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
target_path="${backup_dir}/sentinel-quiz-${timestamp}.dump"
partial_path="${target_path}.partial"
pgpass_file=""

cleanup() {
  rm -f "${partial_path}"
  if [ -n "${pgpass_file}" ]; then
    rm -f "${pgpass_file}"
  fi
}
trap cleanup EXIT INT TERM

# Commands executed inside the postgres container; single quotes keep the
# variables unexpanded on the host (they are the container's own env).
# shellcheck disable=SC2016
in_container_dump='exec pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
in_container_verify='exec pg_restore --list'

url_decode() {
  # Portable percent-decoding (POSIX sh, no \x escapes) for URL credentials.
  remaining="$1"
  decoded=""
  while :; do
    case "${remaining}" in
      *%[0-9A-Fa-f][0-9A-Fa-f]*)
        prefix="${remaining%%%[0-9A-Fa-f][0-9A-Fa-f]*}"
        remaining="${remaining#"${prefix}"%}"
        hex="${remaining%"${remaining#??}"}"
        remaining="${remaining#??}"
        decoded="${decoded}${prefix}$(printf '%b' "\\0$(printf '%o' "0x${hex}")")"
        ;;
      *)
        decoded="${decoded}${remaining}"
        break
        ;;
    esac
  done
  printf '%s' "${decoded}"
}

case "${mode}" in
  compose)
    command -v docker >/dev/null 2>&1 || fail "docker not found in PATH"
    # shellcheck disable=SC2086
    docker compose ${compose_args} exec -T "${pg_service}" sh -c "${in_container_dump}" > "${partial_path}"
    # shellcheck disable=SC2086
    docker compose ${compose_args} exec -T "${pg_service}" sh -c "${in_container_verify}" < "${partial_path}" > /dev/null \
      || fail "pg_restore --list could not read the dump"
    ;;
  container)
    command -v docker >/dev/null 2>&1 || fail "docker not found in PATH"
    [ -n "${BACKUP_PG_CONTAINER:-}" ] || fail "set BACKUP_PG_CONTAINER for BACKUP_MODE=container"
    docker exec -i "${BACKUP_PG_CONTAINER}" sh -c "${in_container_dump}" > "${partial_path}"
    docker exec -i "${BACKUP_PG_CONTAINER}" sh -c "${in_container_verify}" < "${partial_path}" > /dev/null \
      || fail "pg_restore --list could not read the dump"
    ;;
  url)
    command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found in PATH"
    command -v pg_restore >/dev/null 2>&1 || fail "pg_restore not found in PATH"
    url="${DATABASE_URL:-}"
    [ -n "${url}" ] || fail "set DATABASE_URL for BACKUP_MODE=url"
    case "${url}" in
      postgresql://* | postgresql+psycopg://* | postgres://*) ;;
      *) fail "DATABASE_URL must be a PostgreSQL URL" ;;
    esac
    rest="${url#*://}"
    rest="${rest%%\?*}"
    userinfo=""
    case "${rest}" in
      *@*)
        userinfo="${rest%@*}"
        rest="${rest##*@}"
        ;;
    esac
    hostport="${rest%%/*}"
    dbname="${rest#*/}"
    [ "${dbname}" != "${rest}" ] && [ -n "${dbname}" ] || fail "DATABASE_URL has no database name"
    host="${hostport%%:*}"
    port="5432"
    case "${hostport}" in
      *:*) port="${hostport##*:}" ;;
    esac
    user="${userinfo%%:*}"
    password=""
    case "${userinfo}" in
      *:*) password="${userinfo#*:}" ;;
    esac
    user="$(url_decode "${user}")"
    dbname="$(url_decode "${dbname}")"
    pgpass_file="$(mktemp)"
    if [ -n "${password}" ]; then
      password="$(url_decode "${password}")"
      # pgpass format: escape backslashes and colons.
      escaped_password="$(printf '%s' "${password}" | sed 's/\\/\\\\/g; s/:/\\:/g')"
      printf '%s:%s:*:*:%s\n' "${host}" "${port}" "${escaped_password}" > "${pgpass_file}"
    fi
    chmod 600 "${pgpass_file}"
    PGPASSFILE="${pgpass_file}" pg_dump \
      --format=custom \
      --no-owner \
      --no-privileges \
      --host="${host}" \
      --port="${port}" \
      --username="${user}" \
      --dbname="${dbname}" \
      --file="${partial_path}"
    pg_restore --list "${partial_path}" > /dev/null || fail "pg_restore --list could not read the dump"
    ;;
  *)
    fail "unsupported BACKUP_MODE=${mode} (compose, container or url)"
    ;;
esac

[ -s "${partial_path}" ] || fail "empty dump"
mv "${partial_path}" "${target_path}"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${backup_dir}" && sha256sum "$(basename "${target_path}")" > "$(basename "${target_path}").sha256")
elif command -v shasum >/dev/null 2>&1; then
  (cd "${backup_dir}" && shasum -a 256 "$(basename "${target_path}")" > "$(basename "${target_path}").sha256")
fi

log "backup verified: ${target_path} ($(wc -c < "${target_path}" | tr -d ' ') bytes)"

if [ "${retention}" -gt 0 ]; then
  # File names are generated above (no spaces), so ls-based rotation is safe.
  # shellcheck disable=SC2012
  ls -1t "${backup_dir}"/sentinel-quiz-*.dump 2>/dev/null | tail -n +"$((retention + 1))" | while read -r old; do
    rm -f "${old}" "${old}.sha256"
    log "retention: removed ${old}"
  done
fi

printf '%s\n' "${target_path}"
