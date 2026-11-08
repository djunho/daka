# Recover Daka from a backup

Use this procedure after losing the database and upload volumes. It restores
the application database, photos, and private listing PDFs from the same backup directory.
Keep a copy of the deployment configuration and secrets separately. The backup
contains application data and uploads. You also need the repository and a
working `srcs/.env` with the same `MYSQL_DATABASE` as the dump.

## Restore

1. Identify a trusted backup directory with `database.sql`, `media.tar.gz`,
   and `documents.tar.gz`. Prefer the most recent copy that passed automatic
   verification. The backup can keep the restricted permissions set by the
   runner. Docker mounts it read-only for the restore. From the repository
   root, set its absolute path:

   ```bash
   backup_dir=/absolute/path/to/daka-backups/daka-YYYYMMDDTHHMMSSZ.suffix
   ```

2. With fresh Docker volumes, restore the database and the uploads, then start
   Daka:

   ```bash
   srcs/tools/restore.sh "$backup_dir"
   make up
   ```

   The script requires empty database, media, and documents volumes. A legacy
   backup without `documents.tar.gz` can be restored only if it contains no
   document records. If the script reports missing PDFs, select a complete copy.
   If a recovery attempt fails after it starts writing, keep the backup and
   diagnose the error. Reset only the failed recovery environment to fresh
   volumes before retrying.

3. Wait for Daka to become healthy and verify the database through the public
   API. Replace `8443` if `NGINX_PORT` differs:

   ```bash
   docker compose -f srcs/docker-compose.yml up -d --wait --wait-timeout 120
   curl --fail --insecure https://localhost:8443/api/health/db
   ```

   Open a listing known to be in the backup. Check that its data and photo are
   both served. Sign in and open or download a known listing PDF. The script also prints the restored user and listing counts
   so you can compare them with the source. The curl example accepts the
   local self-signed certificate.

4. If the status dashboard had an external link, open **Daka — Service Status**
   as a Grafana admin and recreate the share. The old URL is lost when
   `grafana_data` is removed. Test the new URL in a private browser window and
   distribute it to the people who used the old one. See the
   [status page instructions](development/observability.md#service-status-page).

5. Resume backups if this environment uses scheduled backups. See the
   [backup guide](development/database-backup.md) for activation and verification.

## Rehearse recovery

Use a disposable checkout on a separate Docker host, or give it a unique
`COMPOSE_PROJECT_NAME` and a free `NGINX_PORT` in `srcs/.env`. For the
same-host option, remove the fixed `container_name` entries from the disposable
copy of `srcs/docker-compose.yml` so its containers can coexist with the regular
stack. Give the rehearsal its own test data or use an authorized backup.

Once you have a backup outside the disposable project and have confirmed the
project name, start the clock, run `make clean` in that checkout and follow the
restore steps above. Stop the clock when the database check passes and the
known listing, photo, and PDF load. Record the elapsed time and any problems, update
this procedure, and repeat from fresh volumes.

On 2026-11-07, both completed rehearsals took 53 seconds each on a local
Docker host with cached images. Each restored 42 users and 313 listings.
The database health endpoint passed, and Nginx served listing 14 and its
restored photo. An earlier attempt exposed a permission issue when resolving
the backup directory on the host. The script now resolves the path without
entering that directory and reads the files through the Docker mount.

On 2026-11-08, a rehearsal with the new documents archive took 69 seconds.
After `make clean`, the API passed the database health check and served the
test listing and photo. The recovered PDF downloaded with an authenticated
session. The same request without a session returned HTTP 401.
