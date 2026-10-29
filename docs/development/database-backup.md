# MariaDB Backup and Restore

The database is stored in the Docker volume `db_data`. Rebuilding or replacing
the database container does not remove that volume, but a backup is still
required before schema changes, destructive maintenance, or moving the project
to another machine.

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
docker compose -f srcs/docker-compose.yml stop backend
docker compose -f srcs/docker-compose.yml exec -T db sh -c \
  'mariadb --user=root --password="$MYSQL_ROOT_PASSWORD"' \
  < ../daka-backups/daka-YYYYMMDD-HHMMSS.sql
docker compose -f srcs/docker-compose.yml start backend
```

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
