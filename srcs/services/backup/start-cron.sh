#!/bin/bash
set -euo pipefail

: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
: "${MYSQL_BACKUP_PASSWORD:?MYSQL_BACKUP_PASSWORD is required}"

umask 077
declare -px MYSQL_DATABASE MYSQL_BACKUP_PASSWORD > /run/daka-backup.env

# The expectation outlives the scheduler so a stopped runner can still alert.
marker=/backup-metrics/backup-enabled.prom
if [[ ! -f "$marker" ]]; then
    pending=$(mktemp /backup-metrics/.backup-enabled.XXXXXX)
    trap 'rm -f -- "$pending"' EXIT
    printf '# TYPE backup_monitoring_enabled_timestamp gauge\nbackup_monitoring_enabled_timestamp %s\n' "$(date +%s)" > "$pending"
    chmod 644 "$pending"
    mv -f -- "$pending" "$marker"
    trap - EXIT
fi

exec cron -f
