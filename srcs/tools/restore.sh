#!/usr/bin/env bash
set -euo pipefail

die() {
    printf 'restore: %s\n' "$*" >&2
    exit 1
}

[[ $# -eq 1 ]] || die "usage: $0 BACKUP_DIRECTORY"
backup_dir=$(realpath -e -- "$1") || die "cannot find backup directory"
[[ -d "$backup_dir" ]] || die "backup path must be a directory"
srcs_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
export COMPOSE_FILE="${COMPOSE_FILE:-$srcs_dir/docker-compose.yml}"

db_helper() {
    docker compose run --rm --no-deps -T --entrypoint sh \
        --volume "$backup_dir:/restore:ro" db -ec "$1"
}

media_helper() {
    docker compose run --rm --no-deps -T --entrypoint sh \
        --volume "$backup_dir:/restore:ro" backend -ec "$1"
}

printf 'Checking backup and target volumes...\n'
docker compose build db backend
db_helper '
    test -s /restore/database.sql || { echo "Missing or empty database.sql" >&2; exit 1; }
    test -z "$(ls -A /var/lib/mysql)" || { echo "Database volume must be empty" >&2; exit 1; }
    backtick=$(printf "\140")
    escaped_db=$(printf "%s" "$MYSQL_DATABASE" | sed "s/$backtick/$backtick$backtick/g")
    grep -Fxq "USE $backtick$escaped_db$backtick;" /restore/database.sql ||
        { echo "Dump does not select MYSQL_DATABASE" >&2; exit 1; }
'
media_helper '
    test -z "$(ls -A /data/media)" || { echo "Media volume must be empty" >&2; exit 1; }
    tar -tzf /restore/media.tar.gz >/dev/null
'

printf 'Starting MariaDB and importing the dump...\n'
docker compose up -d --wait --wait-timeout 120 db
db_helper '
    export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
    mariadb --host=db --user=root < /restore/database.sql
    mariadb --host=db --user=root --database="$MYSQL_DATABASE" \
        --execute="SELECT COUNT(*) AS users FROM users; SELECT COUNT(*) AS listings FROM listings;"
'

printf 'Restoring uploaded files...\n'
media_helper 'tar --extract --gzip --file=/restore/media.tar.gz --directory=/data/media'
printf 'Database and uploads restored. Start the Daka stack to verify the application.\n'
