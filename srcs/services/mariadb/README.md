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

License
- Follow the repository LICENSE in the project root.
