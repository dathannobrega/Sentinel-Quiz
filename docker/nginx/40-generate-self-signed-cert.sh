#!/bin/sh
# Prepares the TLS certificate used by nginx.
#
# NGINX_TLS_MODE=self-signed (default)
#   Generates a self-signed certificate ONLY when none exists, when it expires
#   within NGINX_CERT_RENEW_DAYS, or when the host names (CN/SAN) changed.
#   Otherwise the persisted certificate is reused, so browsers that trusted it
#   keep trusting it across restarts.
# NGINX_TLS_MODE=custom
#   Never generates anything. NGINX_SSL_CERTIFICATE / NGINX_SSL_CERTIFICATE_KEY
#   must point to readable files (e.g. a Let's Encrypt fullchain/privkey pair
#   or a corporate certificate mounted read-only). Startup fails otherwise.
set -eu

log() {
  printf '%s\n' "40-generate-self-signed-cert: $*"
}

tls_mode="${NGINX_TLS_MODE:-self-signed}"
cert_path="${NGINX_SSL_CERTIFICATE:-/etc/nginx/certs/server.crt}"
key_path="${NGINX_SSL_CERTIFICATE_KEY:-/etc/nginx/certs/server.key}"

case "${tls_mode}" in
  custom)
    for file in "${cert_path}" "${key_path}"; do
      if [ ! -r "${file}" ]; then
        log "ERROR: NGINX_TLS_MODE=custom but ${file} is missing or unreadable."
        exit 1
      fi
    done
    if ! openssl x509 -in "${cert_path}" -noout >/dev/null 2>&1; then
      log "ERROR: ${cert_path} is not a valid PEM certificate."
      exit 1
    fi
    if ! openssl x509 -in "${cert_path}" -noout -checkend 0 >/dev/null 2>&1; then
      log "WARNING: custom certificate ${cert_path} is expired."
    fi
    log "using custom certificate ${cert_path}"
    exit 0
    ;;
  self-signed) ;;
  *)
    log "ERROR: unsupported NGINX_TLS_MODE=${tls_mode} (use self-signed or custom)."
    exit 1
    ;;
esac

server_name="${NGINX_SERVER_NAME:-localhost}"
alt_names_raw="${NGINX_SERVER_ALT_NAMES:-}"
cert_days="${NGINX_CERT_DAYS:-825}"
renew_days="${NGINX_CERT_RENEW_DAYS:-30}"
cert_dir="$(dirname "${cert_path}")"
marker_path="${cert_dir}/.self-signed-san"
subject_alt_names="DNS:${server_name}"

append_alt_name() {
  name="$1"
  if [ -z "${name}" ]; then
    return
  fi

  case "${name}" in
    *[!0-9.]*)
      subject_alt_names="${subject_alt_names},DNS:${name}"
      ;;
    *)
      subject_alt_names="${subject_alt_names},IP:${name}"
      ;;
  esac
}

if [ "${server_name}" = "localhost" ]; then
  subject_alt_names="${subject_alt_names},IP:127.0.0.1"
fi

if [ -n "${alt_names_raw}" ]; then
  old_ifs="$IFS"
  IFS=","
  for alt_name in ${alt_names_raw}; do
    trimmed_name=$(printf "%s" "${alt_name}" | tr -d "[:space:]")
    append_alt_name "${trimmed_name}"
  done
  IFS="$old_ifs"
fi

mkdir -p "${cert_dir}"

if [ -s "${cert_path}" ] && [ -s "${key_path}" ] && [ -f "${marker_path}" ] \
  && [ "$(cat "${marker_path}")" = "${subject_alt_names}" ] \
  && openssl x509 -in "${cert_path}" -noout -checkend "$((renew_days * 86400))" >/dev/null 2>&1; then
  log "reusing existing self-signed certificate for ${subject_alt_names}"
  exit 0
fi

log "generating self-signed certificate for ${subject_alt_names} (${cert_days} days)"

openssl_config="$(mktemp)"
cleanup() {
  rm -f "${openssl_config}"
}
trap cleanup EXIT INT TERM

cat > "${openssl_config}" <<EOF
[req]
prompt = no
distinguished_name = dn
x509_extensions = ext

[dn]
CN = ${server_name}

[ext]
subjectAltName = ${subject_alt_names}
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

umask 077
openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -days "${cert_days}" \
  -keyout "${key_path}.tmp" \
  -out "${cert_path}.tmp" \
  -config "${openssl_config}" \
  >/dev/null 2>&1

mv "${key_path}.tmp" "${key_path}"
mv "${cert_path}.tmp" "${cert_path}"
printf '%s' "${subject_alt_names}" > "${marker_path}"
chmod 600 "${key_path}"
chmod 644 "${cert_path}"
