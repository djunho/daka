#!/bin/bash
set -euo pipefail

[[ -n "${MYSQL_BACKUP_PASSWORD:-}" ]] || exit 0
: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"

# Pass the password as hex so SQL metacharacters never enter the statement.
password_hex=$(printf '%s' "$MYSQL_BACKUP_PASSWORD" | od -An -v -tx1 | tr -d ' \n')
database_identifier=${MYSQL_DATABASE//\`/\`\`}
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mariadb --protocol=socket --user=root <<SQL
SET @backup_hash = QUOTE(PASSWORD(UNHEX('$password_hex')));
SET @backup_auth = CONCAT('CREATE USER IF NOT EXISTS ''daka_backup''@''%'' IDENTIFIED BY PASSWORD ', @backup_hash);
PREPARE backup_auth FROM @backup_auth;
EXECUTE backup_auth;
DEALLOCATE PREPARE backup_auth;
SET @backup_auth = CONCAT('ALTER USER ''daka_backup''@''%'' IDENTIFIED BY PASSWORD ', @backup_hash);
PREPARE backup_auth FROM @backup_auth;
EXECUTE backup_auth;
DEALLOCATE PREPARE backup_auth;
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON \`$database_identifier\`.* TO 'daka_backup'@'%';
GRANT SELECT ON mysql.proc TO 'daka_backup'@'%';
SQL
