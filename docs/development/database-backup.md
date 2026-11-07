# MariaDB Backup and Restore

The database is stored in the Docker volume `db_data`. Rebuilding or replacing
the database container does not remove that volume, but a backup is still
required before schema changes, destructive maintenance, or moving the project
to another machine.

## Scheduled application backups

Set `MYSQL_BACKUP_PASSWORD` in `srcs/.env` to a separate secret. Generate
one with `openssl rand -hex 32`. From the repository root, run:

```bash
make backup-up
```

This creates or updates the dedicated database account, including on an
existing database volume, and starts the backup profile at 03:00 UTC daily.
Run the same target after changing the backup password. The runner uses the
same MariaDB base image as the database service.

To create the first verified backup immediately, or run one on demand:

```bash
docker compose -f srcs/docker-compose.yml exec -T backup /usr/local/bin/backup.sh
```

Each backup directory contains `database.sql` and `media.tar.gz`. The runner
checks that the archive can be read and imports the dump into a temporary
MariaDB instance before publishing the backup. Rotation keeps the latest
verified copy from each of the seven most recent dates and four most recent
ISO weeks that have a backup, in UTC. The same copy can count toward both.
Copies created before automatic verification and manual SQL files are outside
this rotation.

The **Daka — Backups** Grafana dashboard shows the last verified backup, its
age and its duration. The first scheduler start records that backups are
expected. Prometheus fires `BackupOverdue` after 26 hours without a verified
backup. A stopped runner still alerts because the expectation persists in
the metrics volume. A development stack that has never enabled scheduled
backups has no expectation and does not raise this alert.

To intentionally disable scheduled backups and their alert, stop the runner
and remove its expectation marker:

```bash
docker compose -f srcs/docker-compose.yml stop backup
docker compose -f srcs/docker-compose.yml run --rm --no-deps backup \
  rm -f /backup-metrics/backup-enabled.prom
```

The rest of this guide covers manual database-only maintenance.

The commands below must be run from the repository root while the `db` service
is running. They read the database name and credentials from `srcs/.env` inside
the container, so the password is not copied into the shell history or exposed
in the host process list.

## Create a logical backup

Create a private backup directory next to the repository. Keeping it outside
`daka/` prevents database dumps from appearing in the Git working tree:

```bash
mkdir -p ../daka-backups
chmod 700 ../daka-backups
```

Export all tables, triggers, routines, and events from the application
database:

```bash
docker compose -f srcs/docker-compose.yml exec -T db sh -c \
  'mariadb-dump --user=root --password="$MYSQL_ROOT_PASSWORD" \
  --single-transaction --routines --triggers --events \
  --databases "$MYSQL_DATABASE"' \
  > "../daka-backups/daka-$(date +%Y%m%d-%H%M%S).sql"
```

`--single-transaction` creates a consistent dump of the InnoDB tables without
locking them for the duration of the export. Check that the command succeeded
and that the file is not empty before relying on it:

```bash
test -s ../daka-backups/daka-YYYYMMDD-HHMMSS.sql
```

The `../daka-backups/` directory is outside the repository and does not depend
on a project `.gitignore` rule. Its SQL files may contain personal data,
password hashes, messages, and other sensitive content. Store copies encrypted
and restrict access to the people who operate the database.

Uploaded listing and avatar images are held in the separate Docker volume
`media`. A database dump does not include those files; back up that volume
separately if a complete application restore is required.

## Restore a backup

Restoring overwrites database objects and data represented by the dump. Take a
fresh backup first, stop the backend to prevent writes during the restore, and
select the exact dump file explicitly:

```bash
docker compose -f srcs/docker-compose.yml stop backend && \
docker compose -f srcs/docker-compose.yml exec -T db sh -c \
  'mariadb --user=root --password="$MYSQL_ROOT_PASSWORD"' \
  < ../daka-backups/daka-YYYYMMDD-HHMMSS.sql && \
docker compose -f srcs/docker-compose.yml start backend
```

The `&&` chain deliberately leaves the backend stopped if the import fails.
Inspect the database error, correct it, and rerun the restore before starting
the backend manually.

Verify the restored database before deleting any older backup:

```bash
docker compose -f srcs/docker-compose.yml exec db sh -c \
  'mariadb --user=root --password="$MYSQL_ROOT_PASSWORD" \
  --database="$MYSQL_DATABASE" --execute="SHOW TABLES;"'
```

## Existing volumes and schema changes

`schema.sql` and `seeds.sql` are initialization files. MariaDB runs them only
when it creates an empty data directory; rebuilding the image does not migrate
an existing `db_data` volume.

Before applying a schema change to an existing environment:

1. Create and verify a backup.
2. Stop services that write to the database.
3. Apply a reviewed migration to the existing database, or recreate the volume
   only when losing its data is intentional.
4. Start the services and verify both the schema and application behavior.

Never use a development volume recreation procedure on production data.
