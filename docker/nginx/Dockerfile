FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY 40-generate-self-signed-cert.sh /docker-entrypoint.d/40-generate-self-signed-cert.sh

RUN chmod 755 /docker-entrypoint.d/40-generate-self-signed-cert.sh \
    && mkdir -p /etc/nginx/certs

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --no-check-certificate -O /dev/null https://127.0.0.1/api/health || exit 1
