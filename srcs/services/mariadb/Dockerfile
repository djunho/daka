ARG MARIADB_IMAGE=mariadb:11
FROM ${MARIADB_IMAGE}

COPY tools/ /docker-entrypoint-initdb.d/
COPY schema.sql /docker-entrypoint-initdb.d/01_schema.sql
COPY seeds.sql  /docker-entrypoint-initdb.d/02_seeds.sql