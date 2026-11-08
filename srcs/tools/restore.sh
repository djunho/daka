#!/usr/bin/env bash
set -euo pipefail

die() {
    printf 'restore: %s\n' "$*" >&2
    exit 1
}

[[ $# -eq 1 && -n "$1" ]] || die "usage: $0 BACKUP_DIRECTORY"
# The Docker daemon can mount paths the invoking user cannot traverse.
case "$1" in
    /*) export DAKA_RESTORE_SOURCE="$1" ;;
    *) export DAKA_RESTORE_SOURCE="$PWD/$1" ;;
esac
tools_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
export COMPOSE_FILE="${COMPOSE_FILE:-$tools_dir/../docker-compose.yml}"

override=$(mktemp)
trap 'rm -f -- "$override"' EXIT
cat > "$override" <<'YAML'
services:
  backend:
    volumes:
      - type: bind
        source: ${DAKA_RESTORE_SOURCE}
        target: /restore
        read_only: true
        bind:
          create_host_path: false
YAML
export COMPOSE_FILE="$COMPOSE_FILE${COMPOSE_PATH_SEPARATOR:-:}$override"

restore_files() {
    docker compose run --rm --no-deps -T --entrypoint python backend \
        - "$1" < "$tools_dir/restore-files.py"
}

database() {
    docker compose exec -T db sh -ec '
        export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
        exec mariadb --protocol=socket --user=root --database="$MYSQL_DATABASE" "$@"
    ' restore "$@"
}

printf 'Checking backup and target volumes...\n'
[[ -z "$(docker compose ps --status running -q db)" ]] ||
    die "database service must be stopped and its volume empty"
docker compose build db backend
restore_files check
docker compose run --rm --no-deps -T --entrypoint sh db -ec '
    test -z "$(ls -A /var/lib/mysql)" || { echo "Database volume must be empty" >&2; exit 1; }
'

printf 'Starting MariaDB and importing the dump...\n'
docker compose up -d --wait --wait-timeout 120 db
# Mount only the backup in the reader. The running db owns the database volume.
backend_image=$(docker compose config --images | awk '/^daka_backend$/ {print; exit}')
[[ -n "$backend_image" ]] || die "cannot find the backend image for streaming the backup"
mount_source=${DAKA_RESTORE_SOURCE//\"/\"\"}
docker run --rm --network none --entrypoint cat \
    --mount "type=bind,\"source=$mount_source\",target=/restore,readonly" \
    "$backend_image" /restore/database.sql | database

document_count=$(database --batch --skip-column-names --execute='SELECT COUNT(*) FROM documents;')
printf 'Restoring uploaded photos and documents...\n'
restore_files "$document_count"
database --execute='SELECT COUNT(*) AS users FROM users; SELECT COUNT(*) AS listings FROM listings;'
printf 'Database and uploads restored. Start the Daka stack to verify the application.\n'
