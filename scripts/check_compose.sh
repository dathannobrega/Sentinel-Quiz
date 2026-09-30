#!/bin/sh
# Validates the compose stacks and keeps the single-file Portainer stack in sync.
#
#   docker-compose.yml + docker-compose.dev.yml    development (must resolve)
#   docker-compose.yml + docker-compose.prod.yml   production  (must resolve)
#   docker-compose.portainer.yml                   must resolve to exactly the same
#                                                  config as base + prod
#
# Usage: scripts/check_compose.sh   (needs docker compose v2; run by CI)
set -eu

cd "$(dirname "$0")/.."

# Placeholder values for the variables production requires; the project .env and
# COMPOSE_FILE are ignored so a local setup cannot mask a difference.
export APP_IMAGE_TAG=sha-0000000 APP_POSTGRES_PASSWORD=check APP_NGINX_HOST=check.invalid
unset COMPOSE_FILE

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

resolve() {
    docker compose --env-file /dev/null "$@" config --format json
}

resolve -f docker-compose.yml -f docker-compose.dev.yml > /dev/null
resolve -f docker-compose.yml -f docker-compose.prod.yml > "${tmp_dir}/prod.json"
resolve -f docker-compose.portainer.yml > "${tmp_dir}/portainer.json"

if ! diff -u "${tmp_dir}/prod.json" "${tmp_dir}/portainer.json"; then
    echo "docker-compose.portainer.yml differs from docker-compose.yml + docker-compose.prod.yml (diff above: - base+prod, + portainer)." >&2
    exit 1
fi
echo "compose OK: dev and prod resolve; portainer matches base + prod."
