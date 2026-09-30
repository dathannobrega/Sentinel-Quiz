# Sentinel Quiz reverse proxy (TLS termination + security headers).
# Base image pinned by digest; Dependabot (docker ecosystem) keeps it fresh.
FROM nginx:1.31-alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2

RUN apk add --no-cache openssl

# Defaults consumed by default.conf.template (envsubst) and the cert script.
ENV NGINX_SERVER_NAME=localhost \
    NGINX_SERVER_ALT_NAMES= \
    NGINX_TLS_MODE=self-signed \
    NGINX_SSL_CERTIFICATE=/etc/nginx/certs/server.crt \
    NGINX_SSL_CERTIFICATE_KEY=/etc/nginx/certs/server.key \
    NGINX_CERT_DAYS=825 \
    NGINX_CERT_RENEW_DAYS=30 \
    NGINX_CLIENT_MAX_BODY_SIZE=2m \
    NGINX_AUTH_RATE=10r/s \
    NGINX_AUTH_BURST=20 \
    NGINX_WEB_HOST=web \
    NGINX_WEB_PORT=3000 \
    NGINX_API_HOST=api \
    NGINX_API_PORT=8000

COPY nginx.conf /etc/nginx/nginx.conf
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY api-security-headers.conf /etc/nginx/snippets/api-security-headers.conf
COPY --chmod=755 40-generate-self-signed-cert.sh /docker-entrypoint.d/40-generate-self-signed-cert.sh

RUN mkdir -p /etc/nginx/certs

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --no-check-certificate -O /dev/null https://127.0.0.1/api/health || exit 1
