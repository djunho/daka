# MariaDB (daka)

This folder contains the MariaDB image, database schema and seed data used by the `daka` application.

Contents
- `Dockerfile` — base image (mariadb:11).
- `schema.sql` — creates the `daka` database and all tables.
- `seeds.sql` — initial lookup/seed data (categories, conditions, states).
- `dakaERD.md` — Entity-Relationship Diagram (Mermaid).

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

License
- Follow the repository LICENSE in the project root.
