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
```

This route checks whether the Google credentials are configured and redirects the browser to Google's authorization screen.

If the credentials are not configured, it returns:

```http
503 Service Unavailable
```

```json
{
  "detail": "Google authentication is not configured."
}
```

### Callback

```http
GET /api/auth/google/callback
```

This is the URL Google calls after the user authorizes the application.

The callback exchanges the temporary code for tokens, validates the user data, and creates the local Daka session.

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

If Google does not verify the email, the login is rejected with `401 Unauthorized`.

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

If the account is already linked to another `google_sub`, the backend returns `409 Conflict` and does not replace the existing link.

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

## Common errors

### `503 Service Unavailable`

The Google credentials were not loaded by the backend. Check `srcs/.env` and rebuild the backend.

### `400 redirect_uri_mismatch`

The redirect URI in Google Cloud Console is not exactly the same as the backend configuration. Compare:

```text
https://localhost:8443/api/auth/google/callback
```

### `401 Google authentication was not completed`

The OAuth code expired, the state was lost, or authorization was not completed.

### `409 This email is linked to another Google account`

The email is already associated with another `google_sub`. The backend does not replace an existing association.

### Local HTTPS certificate

The project uses a local certificate generated by the `certgen` container. Browsers may require manual confirmation before accessing `https://localhost:8443`.

## Current status

Implemented in the backend:

- Google OAuth login;
- OAuth callback;
- Google email validation;
- automatic account creation;
- linking to an existing local account;
- Daka local session;
- transactional protection against duplicate associations;
- environment variable configuration.
