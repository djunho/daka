#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBS="${ROOT}/requirements/observability"
ENV_FILE="${1:-${ROOT}/.env}"

die() { echo "gen-secrets: $*" >&2; exit 1; }
[ -f "${ENV_FILE}" ] || die "env file not found: ${ENV_FILE} (copy .env.example to srcs/.env)"

getenv() {
  local key="$1" val
  val="$(grep -E "^${key}=" "${ENV_FILE}" | tail -1 | cut -d= -f2-)" || true
  [ -n "${val}" ] || die "missing ${key} in ${ENV_FILE}"
  printf '%s' "${val}"
}

PROM_USER="$(getenv PROM_USER)"
PROM_PASSWORD="$(getenv PROM_PASSWORD)"
EXP_USER="$(getenv MYSQL_EXPORTER_USER)"
EXP_PASSWORD="$(getenv MYSQL_EXPORTER_PASSWORD)"

bcrypt() {
  local user="$1" pass="$2"
  if command -v htpasswd >/dev/null 2>&1; then
    htpasswd -nbB "${user}" "${pass}" | cut -d: -f2
  else
    echo "gen-secrets: htpasswd not found, using ephemeral httpd container" >&2
    docker run --rm httpd:2.4-alpine htpasswd -nbB "${user}" "${pass}" | cut -d: -f2
  fi
}

HASH="$(bcrypt "${PROM_USER}" "${PROM_PASSWORD}")"
[ -n "${HASH}" ] || die "bcrypt hash generation failed"

mkdir -p "${OBS}/prometheus" "${OBS}/mysqld-exporter"

sed -e "s|__PROM_USER__|${PROM_USER}|" \
    -e "s|__PROM_BCRYPT__|${HASH}|" \
    "${OBS}/prometheus/web.yml.template" > "${OBS}/prometheus/web.yml"

printf '%s' "${PROM_PASSWORD}" > "${OBS}/prometheus/scrape_password"

cat > "${OBS}/mysqld-exporter/.my.cnf" <<CNF
[client]
user=${EXP_USER}
password=${EXP_PASSWORD}
CNF

chmod 600 "${OBS}/prometheus/web.yml" \
          "${OBS}/prometheus/scrape_password" \
          "${OBS}/mysqld-exporter/.my.cnf"

echo "gen-secrets: web.yml, scrape_password, .my.cnf generated from $(basename "${ENV_FILE}")"
