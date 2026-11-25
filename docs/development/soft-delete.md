# User Account Soft Delete

This document describes the voluntary user account soft delete implementation in the Daka backend.

## Objective

When a user requests account deletion, the data is not physically removed from the database. The account is marked as deactivated, personal fields are anonymized, and the account stops participating in the application's active features.

This approach preserves important information for:

- moderation;
- reports;
- negotiation and proposal history;
- messages;
- auditing;
- listing history.

## Endpoint

```http
DELETE /api/auth/me
```

The route requires a valid session. A user can only deactivate the account associated with their own `daka_session` cookie.

On success:

```http
204 No Content
```

Without valid authentication:

```http
401 Unauthorized
```

## How it works

The route performs the following actions:

1. Locks the user row during the transaction.
2. Locks the user's listings.
3. Sets `deleted_at` on the account.
4. Anonymizes the personal fields.
5. Changes the listings to the `Removed` state.
6. Closes active negotiations and proposals related to the user or their listings.
7. Removes favorites related to the account or listings.
8. Removes friendships where the account appears on either side.
9. Clears `last_seen`.
10. Removes the user's active sessions.
11. Commits all changes in a single transaction.
12. Removes the physical avatar file after the `commit`.
13. Clears the `daka_session` cookie.

## Anonymized fields

After voluntary deletion, the account keeps its ID but personal fields are replaced:

```text
user_name     = Deleted user
email         = deleted-{user_id}@deleted.daka
pass_hash     = NULL
google_sub    = NULL
avatar        = NULL
user_location = NULL
last_seen     = NULL
deleted_at    = current timestamp
```

The `.daka` domain passes the API's `EmailStr` validation. Including the user ID keeps the anonymized email unique, and the original email becomes available for a new registration.

## Preserved data

Soft delete does not physically remove:

- the user record;
- listings;
- listing images;
- reports;
- negotiations and proposals;
- messages.

Reports are preserved to maintain the moderation history. Listings remain in the database with the `Removed` state.

## `deleted_at` field

The following field was added to the `users` table:

```sql
deleted_at DATETIME NULL
```

The values represent:

```text
deleted_at = NULL       active account
deleted_at = timestamp  deactivated account
```

The corresponding SQLAlchemy model field is:

```python
deleted_at: Mapped[datetime | None] = mapped_column(DateTime)
```

The `last_seen` field is also cleared during deactivation:

```python
last_seen: Mapped[datetime | None] = mapped_column(DateTime)
```

## Authentication after deactivation

The `get_current_user` dependency only accepts users where `deleted_at IS NULL`.

Therefore, an old session cannot be used after the account is deactivated.

Email/password login ignores deactivated accounts. Google login does not automatically reactivate a deactivated account.

## Transactions and concurrency

The changes are executed inside a transaction:

```python
try:
    # changes
    db.commit()
except IntegrityError:
    db.rollback()
```

If an integrity error occurs, all changes are rolled back and the API returns `409 Conflict`.

The user and listing queries use `with_for_update()` to reduce race conditions with updates, negotiations, proposals, or other simultaneous operations.

## Migration for existing databases

New databases receive `deleted_at` automatically through `schema.sql`.

Existing MariaDB volumes must apply:

```sql
ALTER TABLE users
ADD COLUMN deleted_at DATETIME NULL
AFTER updated_at;
```

A backup is recommended before applying the migration:

```bash
mkdir -p backups

root_password=$(awk -F= '$1 == "MYSQL_ROOT_PASSWORD" {
  print substr($0, index($0, "=") + 1)
}' srcs/.env)

docker exec daka_db mariadb-dump \
  -u root \
  -p"$root_password" \
  --single-transaction \
  daka > backups/daka-before-soft-delete.sql
```

Apply the column idempotently:

```bash
docker exec daka_db mariadb \
  -u root \
  -p"$root_password" \
  daka \
  -e "ALTER TABLE users
      ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL
      AFTER updated_at;"
```

Verify the migration:

```bash
docker exec daka_db mariadb \
  -u root \
  -p"$root_password" \
  daka \
  -e "SHOW COLUMNS FROM users LIKE 'deleted_at';"
```

## Complete test

### 1. Start the services

```bash
docker compose -f srcs/docker-compose.yml up -d --build
```

Check the status:

```bash
docker compose -f srcs/docker-compose.yml ps
```

The backend and database should appear as `healthy`.

### 2. Test the API

```bash
curl -k https://localhost:8443/api/health
```

Expected result:

```json
{
  "status": "ok",
  "service": "daka-api"
}
```

### 3. Create a temporary user

```bash
curl -k -i \
  -X POST https://localhost:8443/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "user_name": "Soft Delete Test",
    "email": "soft-delete-test@example.com",
    "password": "SoftDelete-Test-123"
  }'
```

Expected result:

```http
201 Created
```

### 4. Log in and save the session

```bash
curl -k -i \
  -c /tmp/daka-cookies.txt \
  -X POST https://localhost:8443/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "soft-delete-test@example.com",
    "password": "SoftDelete-Test-123"
  }'
```

Expected result:

```http
200 OK
```

The `daka_session` cookie is saved in `/tmp/daka-cookies.txt`.

### 5. Create a test listing

```bash
curl -k -i \
  -b /tmp/daka-cookies.txt \
  -X POST https://localhost:8443/api/listings \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Temporary listing",
    "category_id": 1,
    "condition_id": 1,
    "listing_dsc": "Created for soft delete testing",
    "listing_location": "Test",
    "wish": "Nothing"
  }'
```

Expected result:

```http
201 Created
```

### 6. Execute the soft delete

```bash
curl -k -i \
  -b /tmp/daka-cookies.txt \
  -X DELETE \
  https://localhost:8443/api/auth/me
```

Expected result:

```http
204 No Content
```

### 7. Verify the anonymized user

```sql
SELECT
    id,
    user_name,
    email,
    deleted_at,
    pass_hash,
    google_sub,
    avatar,
    user_location
FROM users
WHERE email LIKE 'deleted-%@deleted.daka'
ORDER BY id DESC;
```

The user should remain with anonymized personal fields and a populated `deleted_at`.

### 8. Verify the listing

```sql
SELECT
    l.id,
    l.user_id,
    ls.state_name
FROM listings l
JOIN listings_states ls
    ON ls.id = l.state_id
WHERE l.user_id = (
    SELECT id
    FROM users
    WHERE email LIKE 'deleted-%@deleted.daka'
    ORDER BY id DESC
    LIMIT 1
);
```

The listing should remain with:

```text
state_name = Removed
```

### 9. Verify the sessions

```sql
SELECT *
FROM sessions
WHERE user_id = (
    SELECT id
    FROM users
    WHERE email LIKE 'deleted-%@deleted.daka'
    ORDER BY id DESC
    LIMIT 1
);
```

The result should be empty.

### 10. Confirm that the original email can be reused

Register a new account using the same original email. The expected result is:

```http
201 Created
```

## Validation performed

The implementation was validated with:

- Python compilation;
- `git diff --check`;
- MariaDB migration;
- healthy backend startup;
- healthy MariaDB startup;
- `200` response from `/api/health`;
- voluntary account deletion;
- personal data anonymization;
- reuse of the original email after deletion;
- listing preservation with the `Removed` state;
- session revocation.
