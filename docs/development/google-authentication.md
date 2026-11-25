# Google Authentication

This document describes the Google OAuth 2.0 authentication implementation in the Daka backend.

## Overview

The flow uses OAuth 2.0 with OpenID Connect:

```text
User visits /api/auth/google/login
        |
        v
Backend redirects to Google
        |
        v
User authorizes Daka
        |
        v
Google calls /api/auth/google/callback
        |
        v
Backend validates the identity
        |
        v
Backend creates or reuses the local account
        |
        v
Backend creates the Daka session
        |
        v
Backend redirects to the frontend
```

Google authentication happens only during login. After that, requests use Daka's local session.

## Endpoints

### Start login

```http
GET /api/auth/google/login
GET /api/auth/google/login?dest=/intended-path
```

This route checks whether the Google credentials are configured, safely stores an optional destination path in the temporary OAuth session, and redirects the browser to Google's authorization screen.

If the credentials are not configured, it redirects the browser to:

```http
302 Found
Location: https://localhost:8443/login?error=google_unconfigured
```

#### Destination parameter (`dest`)

To preserve the user's intended destination across the full OAuth redirect flow (e.g., when redirected to `/login` from a protected route like `/profile`), the frontend appends `?dest=<path>`.

The backend validates `dest` against open redirects:
- Only relative paths starting with a single `/` and containing no `//` or `\` are accepted.
- Invalid or external destinations safely fall back to `/`.

The validated destination is stored in the signed `daka_oauth_state` session cookie and restored upon callback.

### Callback

```http
GET /api/auth/google/callback
```

This is the URL Google calls after the user authorizes or denies the application.

The callback exchanges the temporary code for tokens, validates the user data, creates the local Daka session, and redirects the browser to the destination path (or `/login?error=<code>` on failure).

## Configuration

Configuration is stored in `srcs/.env` and loaded by Docker Compose.

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=https://localhost:8443/api/auth/google/callback
OAUTH_STATE_SECRET=a_long_random_secret
FRONTEND_URL=https://localhost:8443
```

The `.env.example` file contains placeholders and serves as a template. Real values must be stored in `srcs/.env`, which must not be committed.

### Generate `OAUTH_STATE_SECRET`

```bash
openssl rand -hex 32
```

The value must remain private and stable. It must not be replaced with an email, password, Client ID, or Client Secret.

## Google Cloud Console configuration

1. Create or select a project in Google Cloud Console.
2. Configure the OAuth consent screen.
3. Choose `External` for a typical development project.
4. Keep the application in `Testing` mode.
5. Add the test email under `Test users`.
6. Create an OAuth client of type `Web application`.
7. Register this redirect URI exactly:

```text
https://localhost:8443/api/auth/google/callback
```

The URL must contain exactly the same protocol, domain, port, and path configured in the backend.

The requested scopes are:

```text
openid
email
profile
```

They allow the backend to receive the Google identifier, email, name, and profile picture.

## Temporary OAuth cookie

The backend uses `SessionMiddleware` to temporarily store the OAuth flow state.

The cookie is called:

```text
daka_oauth_state
```

It is different from the normal authentication cookie:

```text
daka_session
```

The `daka_oauth_state` cookie is used to validate the `state` parameter. This parameter ensures that the callback corresponds to a flow initiated by the same browser.

Applied settings:

- signed cookie;
- `HttpOnly`;
- `Secure`;
- `SameSite=Lax`.

The `daka_session` cookie is created only after the Google login succeeds.

## Google data validation

The backend requires:

```text
sub
email
email_verified = true
```

The `sub` field is the stable identifier of the Google account. The email is normalized by trimming whitespace and converting it to lowercase.

If Google does not verify the email, or user information cannot be obtained, the login fails and the callback redirects the browser to `/login?error=auth_failed`.

## Account creation and linking

### Existing Google user

The backend first searches by `google_sub`:

```python
user = db.query(User).filter(User.google_sub == google_sub).first()
```

If it finds a user, it reuses the same account and creates a new local session.

### Local account with the same email

If the `google_sub` does not exist yet, the backend searches by email.

If it finds a local account without a `google_sub`, it links the Google identifier to that account:

```python
existing_email.google_sub = google_sub
```

The existing data is preserved, including the name, avatar, location, password, and other related data.

If the account is already linked to another `google_sub`, the backend redirects the browser to `/login?error=google_conflict` and does not replace the existing link.

### Concurrent account-linking protection

The email lookup uses a row lock with SQLAlchemy's `with_for_update()`:

```python
existing_email = (
        db.query(User)
        .filter(User.email == email)
        .with_for_update()
        .first()
)
```

This translates to a database row lock similar to `SELECT ... FOR UPDATE`. It prevents two concurrent Google callbacks from both observing an empty `google_sub` and assigning different Google subjects to the same local account.

The first transaction links the account and commits. A concurrent transaction waits for that lock, then reads the updated `google_sub` and returns `409 Conflict` instead of replacing the existing association.

For accounts that do not exist yet, the `UNIQUE` constraints on `email` and `google_sub`, together with `IntegrityError` handling, protect against duplicate account creation.

### New account

If there is no user with the `google_sub` and no account with the email, a new account is created:

```python
user = User(
    user_name=user_name,
    email=email,
    google_sub=google_sub,
    avatar=google_user.get("picture"),
)
```

The Google-only account has:

```text
pass_hash = NULL
google_sub = Google identifier
email = verified email
user_name = name returned by Google
avatar = picture returned by Google
```

There is no need to manually register the user in the `users` table.

## Daka session

After finding or creating the user, the backend uses `_open_session`, the same function used by the traditional login.

The process is:

1. generate a random token;
2. calculate the token hash;
3. store only the hash in the `sessions` table;
4. create the `daka_session` cookie;
5. redirect to the frontend.

The original token is never stored in MariaDB.

After Google login, requests normally use:

```http
GET /api/auth/me
PATCH /api/auth/me
POST /api/auth/logout
```

## Dependencies

The following dependencies were added to `srcs/services/backend/requirements.txt`:

```text
Authlib==1.4.1
itsdangerous==2.2.0
httpx==0.28.1
```

- `Authlib` implements the OAuth client.
- `itsdangerous` signs the temporary session used by OAuth.
- `httpx` allows Authlib to make HTTP requests to Google.

## Starting the environment

After filling in `srcs/.env`:

```bash
docker compose -f srcs/docker-compose.yml up -d --build
```

Check the containers:

```bash
docker compose -f srcs/docker-compose.yml ps
```

The backend should appear as `healthy`.

## Testing

### Test the API

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

### Test the Google redirect

```bash
curl -k -I https://localhost:8443/api/auth/google/login
```

Expected result:

```text
HTTP/1.1 302 Found
Location: https://accounts.google.com/...
```

### Log in through the browser

Open:

```text
https://localhost:8443/api/auth/google/login
```

If the browser shows a warning about the local HTTPS certificate, accept the certificate for development.

Then:

1. select the Google account registered as a `Test user`;
2. authorize the application;
3. wait for the redirect to the frontend.

### Check Google users in the database

Enter MariaDB:

```bash
docker exec -it daka_db mariadb -u root -p daka
```

Run:

```sql
SELECT
    id,
    user_name,
    email,
    google_sub,
    avatar
FROM users
WHERE google_sub IS NOT NULL
ORDER BY id;
```

To check sessions:

```sql
SELECT
    id,
    user_id,
    expires_at
FROM sessions
ORDER BY id DESC;
```

Avoid using `SELECT * FROM users`, because it also displays `pass_hash`.

## Common errors and error handling

OAuth errors during browser navigation redirect back to the frontend login page (`/login?error=<code>`) via `302 Found`, allowing the SPA to present localized user feedback in European Portuguese.

### Query error codes (`/login?error=<code>`)

| Error code | Meaning | User message (pt-PT) | Typical cause |
| :--- | :--- | :--- | :--- |
| `access_denied` | Authorization denied | *A autenticação com a Google foi cancelada.* | User clicked "Cancel" on Google's consent screen. |
| `google_unconfigured` | OAuth disabled | *A autenticação com a Google não se encontra configurada.* | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` missing in `srcs/.env`. |
| `google_conflict` | Account linking conflict | *Este email já está associado a outra conta Google.* | Local account email is already linked to a different `google_sub`. |
| `auth_failed` | Token or claim failure | *Não foi possível concluir a autenticação com a Google.* | Authorization code expired, state invalid, unverified email, or unrecognized external input. |
| `server_error` | Server error | *Ocorreu um erro no servidor durante a autenticação. Por favor, tenta novamente.* | Database transaction failure when creating local session or user. |

All incoming OAuth error strings from external parameters are sanitized and verified against an allow-list (`ALLOWED_OAUTH_ERRORS`) before constructing redirect URLs, preventing query parameter injection and open redirects.

### Google Cloud Console errors

#### `400 redirect_uri_mismatch`

The redirect URI in Google Cloud Console is not exactly the same as the backend configuration. Compare:

```text
https://localhost:8443/api/auth/google/callback
```

#### Local HTTPS certificate

The project uses a local certificate generated by the `certgen` container. Browsers may require manual confirmation before accessing `https://localhost:8443`.

## Current status

Implemented:

- Google OAuth login (`/api/auth/google/login`);
- Destination preservation across OAuth cycle via `dest` parameter and signed session;
- OAuth callback (`/api/auth/google/callback`);
- Browser redirect error handling via HTTP 302 to `/login?error=<code>`;
- Security sanitization and allow-list against parameter injection;
- Open redirect validation on destination paths;
- Google email validation;
- automatic account creation;
- linking to an existing local account;
- Daka local session;
- transactional protection against duplicate associations;
- environment variable configuration.
