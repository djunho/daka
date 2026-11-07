#!/bin/sh
set -eu

: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
: "${MYSQL_BACKUP_PASSWORD:?MYSQL_BACKUP_PASSWORD is required}"

umask 077
exec 9>/backups/.backup.lock
# Bound the wait so scheduled runs do not pile up behind a stuck backup.
: "${BACKUP_FLOCK_WAIT_SECONDS:=300}"
if ! flock -w "$BACKUP_FLOCK_WAIT_SECONDS" -x 9; then
    echo "backup.sh: could not acquire lock within ${BACKUP_FLOCK_WAIT_SECONDS}s; another backup may be running or hung" >&2
    exit 1
fi

started_at=$(date +%s)
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
staging_dir=$(mktemp -d "/backups/.daka-${timestamp}.XXXXXX")
verify_dir=
verify_pid=
metrics_tmp=
cleanup() {
    if [ -n "$verify_pid" ]; then
        kill "$verify_pid" 2>/dev/null || true
        wait "$verify_pid" || true
    fi
    [ -z "$verify_dir" ] || rm -rf -- "$verify_dir"
    [ -z "$metrics_tmp" ] || rm -f -- "$metrics_tmp"
    rm -rf -- "$staging_dir"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

MYSQL_PWD="$MYSQL_BACKUP_PASSWORD" mariadb-dump \
    --host=db --user=daka_backup \
    --single-transaction --routines --triggers --events \
    --databases "$MYSQL_DATABASE" > "$staging_dir/database.sql"
test -s "$staging_dir/database.sql"

tar -czf "$staging_dir/media.tar.gz" -C /data/media .
tar -tzf "$staging_dir/media.tar.gz" >/dev/null
tar -czf "$staging_dir/documents.tar.gz" -C /data/documents .
tar -tzf "$staging_dir/documents.tar.gz" >/dev/null

# Import the dump into a private MariaDB instance with only a local socket.
verify_dir=$(mktemp -d)
socket="$verify_dir/mariadb.sock"
mariadb-install-db --no-defaults --user=root --datadir="$verify_dir/data" \
    --auth-root-authentication-method=normal --skip-test-db >/dev/null
mariadbd --no-defaults --user=root --datadir="$verify_dir/data" \
    --skip-networking --event-scheduler=OFF \
    --socket="$socket" --pid-file="$verify_dir/mariadb.pid" &
verify_pid=$!
attempts=0
until mariadb-admin --no-defaults --socket="$socket" --user=root ping --silent; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ] || ! kill -0 "$verify_pid" 2>/dev/null; then
        echo "Backup verification: temporary MariaDB did not start" >&2
        exit 1
    fi
    sleep 1
done
mariadb --no-defaults --socket="$socket" --user=root < "$staging_dir/database.sql"
mariadb --no-defaults --socket="$socket" --user=root --database="$MYSQL_DATABASE" \
    --execute='SELECT 1 FROM users LIMIT 1; SELECT 1 FROM listings LIMIT 1;' >/dev/null
touch "$staging_dir/.verified"

backup_dir="/backups/${staging_dir##*/.}"
mv -T -- "$staging_dir" "$backup_dir"

# Keep one backup per day for the latest seven days with backups, and one
# per ISO week for the latest four weeks with backups. A copy can serve both.
export LC_ALL=C
daily_dates=
weekly_dates=
daily_count=0
weekly_count=0
printf '%s\n' /backups/daka-* | sort -r | while IFS= read -r candidate; do
    [ -f "$candidate/.verified" ] || continue
    candidate_name=${candidate##*/}
    case "$candidate_name" in
        daka-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.??????) ;;
        *) continue ;;
    esac
    day=$(printf '%s' "$candidate_name" | cut -c 6-13)
    week=$(date -u -d "$(printf '%s' "$day" | sed 's/^\(....\)\(..\)/\1-\2-/')" +%G-W%V)
    keep=false
    if [ "$daily_count" -lt 7 ] && ! echo "$daily_dates" | grep -qw "$day"; then
        daily_dates="$daily_dates $day"
        daily_count=$((daily_count + 1))
        keep=true
    fi
    if [ "$weekly_count" -lt 4 ] && ! echo "$weekly_dates" | grep -qw "$week"; then
        weekly_dates="$weekly_dates $week"
        weekly_count=$((weekly_count + 1))
        keep=true
    fi
    if [ "$keep" = false ] && [ "$candidate" != "$backup_dir" ]; then
        rm -rf -- "$candidate"
    fi
done

finished_at=$(date +%s)
metrics_tmp=$(mktemp /backup-metrics/.backup.XXXXXX)
printf '# TYPE backup_last_success_timestamp gauge\nbackup_last_success_timestamp %s\n# TYPE backup_duration_seconds gauge\nbackup_duration_seconds %s\n' \
    "$finished_at" "$((finished_at - started_at))" > "$metrics_tmp"
chmod 644 "$metrics_tmp"
mv -f -- "$metrics_tmp" /backup-metrics/backup.prom
printf 'Backup created at %s\n' "$backup_dir"
