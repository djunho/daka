# MariaDB (daka)

This folder contains the MariaDB image, database schema and seed data used by the `daka` application.

Contents
- `Dockerfile` — base image (mariadb:11).
- `schema.sql` — creates the `daka` database and all tables.
- `seeds.sql` — initial lookup/seed data (categories, conditions, states).
- `dakaERD.md` — Entity-Relationship Diagram (Mermaid).

For procedures to back up and restore the database volume, see
[`docs/development/database-backup.md`](../../../docs/development/database-backup.md).

Environment
Use the repo's `.env` (see `srcs/.env` or `.env.example`) to provide the database credentials and connection settings. Important variables:

- `MYSQL_DATABASE` — database name (default: `daka`).
- `MYSQL_USER` — app DB user.
- `MYSQL_PASSWORD` — app DB password.
- `MYSQL_ROOT_PASSWORD` — root password for MariaDB.
- `DB_HOST` / `DB_PORT` — used by the backend to connect (in Compose, `DB_HOST=db`).

Quickstart (Docker Compose)
From the repository root you can start the whole stack (recommended):

```bash
docker compose -f srcs/docker-compose.yml up --build
```

To start only the DB service (in detached mode):

```bash
docker compose -f srcs/docker-compose.yml up -d --build db
```

Build image manually

```bash
cd srcs/services/mariadb
docker build -t daka_db .
```

Loading schema & seed data
Option A — copy files into the running container and run them there:

```bash
docker cp srcs/services/mariadb/schema.sql daka_db:/schema.sql
docker cp srcs/services/mariadb/seeds.sql daka_db:/seeds.sql
docker exec -it daka_db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" < /schema.sql'
docker exec -it daka_db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" daka < /seeds.sql'
```

Option B — feed SQL from the host shell (substitute the password or export it):

```bash
export MYSQL_ROOT_PASSWORD=$(grep MYSQL_ROOT_PASSWORD srcs/.env | cut -d'=' -f2)
docker exec -i daka_db mysql -u root -p"${MYSQL_ROOT_PASSWORD}" < srcs/services/mariadb/schema.sql
docker exec -i daka_db mysql -u root -p"${MYSQL_ROOT_PASSWORD}" daka < srcs/services/mariadb/seeds.sql
```

Notes
- The Compose file (`srcs/docker-compose.yml`) sets the DB `container_name` to `daka_db`, so the commands above target that name.
- The Compose file also configures a healthcheck for the DB service. If you change the service name or container name, update the commands accordingly.
- If you prefer applying schema/seeds during container startup, you can extend the `Dockerfile` or add an entrypoint script that runs the SQL files (copy `schema.sql`/`seeds.sql` into the image and run them on first boot).

Viewing the data model
- See `dakaERD.md` for a Mermaid ER diagram of the core and support models.

Troubleshooting
- "Access denied" when running `mysql` — ensure the password you use matches `MYSQL_ROOT_PASSWORD` in `srcs/.env` or your `.env` file used by Compose.
- Foreign key errors when importing schema/seeds — import `schema.sql` first, then `seeds.sql`.
- If the DB service doesn't become healthy, check container logs:

```bash
docker logs daka_db
```

Contributing
- If you change the schema, update `dakaERD.md` and `schema.sql` together and provide migration notes in this README.

Migration notes
- Ticket #120 adds `idx_messages_negotiation_id` on `messages (negotiation_id, id)`
  for cursor pagination. New databases receive it from `schema.sql`. Existing
  volumes must apply `tools/120-message-history-index.sql`; rebuilding the image
  does not rerun initialisation on an existing volume. The migration adds only
  an index and is safe to run again. Do not reload `schema.sql` or delete the
  volume to apply this change.

  From the repository root, using the existing app credentials inside the backend:

  ```sh
  docker compose -f srcs/docker-compose.yml exec -T backend python -c '
  from app.database import engine
  with engine.begin() as connection:
      connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS idx_messages_negotiation_id ON messages (negotiation_id, id)")
  '
  ```

  Alternatively, execute this statement in the application database using your
  normal database client:

  ```sql
  CREATE INDEX IF NOT EXISTS idx_messages_negotiation_id
      ON messages (negotiation_id, id);
  ```

- Soft delete adds `users.deleted_at DATETIME NULL`.
- New databases receive this column from `schema.sql`.
- Existing MariaDB volumes must apply:

```sql
ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL AFTER updated_at;
```

- Friend presence and symmetric contacts add `users.last_seen` and the
  `friendships` table. Before deploying a branch that uses these models to an
  existing MariaDB volume, apply:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen DATETIME NULL DEFAULT NULL AFTER updated_at;

CREATE TABLE IF NOT EXISTS friendships (
	user_id INT NOT NULL,
	friend_id INT NOT NULL,
	status ENUM('accepted', 'removed') NOT NULL DEFAULT 'accepted',
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id, friend_id),
	CONSTRAINT chk_friendship_order CHECK (user_id < friend_id),
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);
```

If `friendships` already exists, add the lifecycle timestamp separately:

```sql
ALTER TABLE friendships ADD COLUMN IF NOT EXISTS updated_at
    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
```

The pair must always be normalized before insert or lookup (`user_id <
friend_id`). Adding a friendship creates or reactivates the row with
`status = 'accepted'`; removing it sets `status = 'removed'` without deleting
the row. Friend lists include only rows with `status = 'accepted'`. Account
deactivation permanently removes that user's friendship rows.

- Listing documents (#178) add the `documents` table (PDFs attached to a
  listing). New databases receive it from `schema.sql`. Existing volumes must
  apply `tools/130-listing-documents.sql` **before** running a backend that
  uses this model: without the table, the listing detail and the negotiation
  detail answer 500. The migration only creates a table and is safe to run
  again. Do not reload `schema.sql` or delete the volume to apply it.

  From the repository root, with the database credentials of the `db` container:

  ```sh
  docker compose -f srcs/docker-compose.yml exec -T db sh -c \
    'mariadb -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
    < srcs/services/mariadb/tools/130-listing-documents.sql
  ```

  Alternatively, execute the `CREATE TABLE IF NOT EXISTS documents (...)`
  statement from that file in the application database using your normal
  database client.

License
- Follow the repository LICENSE in the project root.
