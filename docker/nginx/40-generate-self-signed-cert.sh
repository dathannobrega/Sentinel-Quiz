#!/bin/sh
set -eu

server_name="${NGINX_SERVER_NAME:-localhost}"
alt_names_raw="${NGINX_SERVER_ALT_NAMES:-}"
cert_days="${NGINX_CERT_DAYS:-3650}"
cert_dir="/etc/nginx/certs"
cert_path="${cert_dir}/server.crt"
key_path="${cert_dir}/server.key"
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

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -days "${cert_days}" \
  -keyout "${key_path}" \
  -out "${cert_path}" \
  -config "${openssl_config}" \
  >/dev/null 2>&1

chmod 600 "${key_path}"
chmod 644 "${cert_path}"
