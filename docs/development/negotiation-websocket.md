# Negotiation WebSocket: authentication, persistence and local broadcast

The backend endpoint is `/ws/negotiations/{negotiation_id}`. Its expected
public path through the infrastructure proxy is
`/api/ws/negotiations/{negotiation_id}`.

The handshake uses the existing `daka_session` cookie. It never accepts an
authentication token or sender identity from a WebSocket payload. Before
allowing access to the negotiation, the backend verifies the exact `Origin`, resolves an
active unexpired session, loads the requested negotiation and listing, and checks
that the user is either the listing owner or the interested user.

## Origin configuration

Set `WEBSOCKET_ALLOWED_ORIGINS` to a comma-separated list of exact origins
(scheme, host, and port when applicable). Do not use wildcards.

- Local development: `https://localhost:8443`
- Production: the deployed frontend origin, for example
  `https://daka.example`

`WEBSOCKET_ALLOWED_ORIGINS` defaults to empty: `FRONTEND_URL` is always included,
so configuring only the production frontend does not implicitly allow localhost.
Localhost is allowed in production only if explicitly configured. Scheme and
host comparisons are case-insensitive; configured values and headers are
normalised to lowercase. Examples are documented in `.env.example`.
Connections without an
`Origin` header are rejected because browser authentication is cookie-based.

## Close codes

- `4401`: session cookie is missing or empty, token/session is invalid or
  expired, or the associated account is soft-deleted.
- `4403`: the origin is missing/not allowed, or the authenticated user is not
  a participant in the negotiation.
- `4404`: the negotiation identifier is malformed or no negotiation exists.
  These cases share a code to avoid revealing additional private information.

No private negotiation data is sent before all checks succeed.

On rejection, the backend completes the WebSocket upgrade and immediately
closes with the corresponding code. This lets browser `onclose` handlers receive
`4401`, `4403`, or `4404`. Closing before the upgrade would reject the HTTP
handshake, so the browser would not receive those WebSocket close codes.
The rejected connection is never registered in a room and receives no private data.

Database authentication and authorization run in `_authorize_negotiation` via
Starlette's `run_in_threadpool`, so synchronous SQLAlchemy queries do not block
the event loop. The worker creates, uses and closes its own `SessionLocal`;
only the detached authenticated user or a refusal code returns to the endpoint.
The session context closes and detaches objects without explicit `expunge`
calls. Session and user are loaded in one SELECT using the existing user join;
authorisation loads the negotiation and listing in a second SELECT without
loading the owner's account. The socket keeps `current_user` and the validated
`negotiation_id`, not a negotiation ORM object. Message processing uses the numeric
ids and a fresh worker session, rechecking current membership and state.

The transport-independent `is_participant` rule in `app/negotiation_access.py`
is shared by REST participant checks, WebSocket handshake and message persistence.
It checks membership only. Negotiation state and account/session validity remain
separate policies, so terminal negotiations can retain readable history.

## Connection lifecycle

`app/connection_manager.py` owns the shared process-local `manager`. Its private
dictionary maps each negotiation id to a set of WebSocket connections. Multiple
tabs or devices, including those belonging to the same participant, are separate
connections. Registering an already registered connection does not accept it again.
Concurrent registrations of the same socket share one in-flight accept task;
other sockets do not wait on that task. Failure or cancellation removes the
pending registration, and cancellation aborts the shared attempt rather than
allowing a background task to register an orphan connection later.

The endpoint finishes authentication and authorisation before calling
`manager.connect(validated_id, websocket)`. The manager checks that the room matches
the authorised context in `websocket.state`; it does not query the database or
decide participant permissions. It accepts the connection before creating or
populating its room. Failed acceptance therefore leaves no empty room behind.
Rejected handshakes continue through `_reject` and never enter the manager.

The endpoint receives raw transport events and validates message payloads separately.
Both disconnect events and `WebSocketDisconnect` end the loop. A `finally` block
calls `disconnect` even after unexpected errors or task cancellation. Removal is
idempotent, affects only the supplied connection, and deletes the room after its
last connection leaves. Other unexpected exceptions propagate after cleanup.
Removal uses `set.discard` and also drops the socket's private send lock and
captured identity/session context. Repeated cleanup does not remove other sockets.

## Concurrency and limitations

The manager must be used only from the application's event loop, not from worker
threads. Dictionary/set mutations contain no awaits; registration takes place
after the awaited acceptance using the current room collection. No mutable room
collection is exposed. Broadcast takes a snapshot of the requested room before
iterating over connections across awaits. Network sends never hold a global
manager/room lock. A private lock per connection serialises its message and error
writes, and is removed with that connection.

State is held only in memory, independently in each backend process. Restarts and
development reloads discard it. Multiple workers or replicas do not share rooms or
counts; cross-process delivery requires a separate future design. There is no
connection table, Redis, broker or frontend reconnection. Message persistence
remains separate from delivery and connection management.

A broken network connection is removed when the server detects the disconnect or
a transport error. The manager itself does not detect silent network failures or
implement a receive heartbeat. Delivery has bounded send/close timeouts as
described below.

## Diagnostics

Connection registration and removal log the negotiation id and remaining room
connection count. Normal disconnect codes `1000` and `1001` use INFO; other close
codes use WARNING. Unexpected loop errors use ERROR and are propagated. Logs do
not include cookies, session tokens, message contents, client close reasons, or
exception text.

`manager.connection_count(negotiation_id)` returns the room count;
`manager.connection_count()` returns the process total; `manager.room_count`
returns the number of nonempty rooms. These diagnostic values expose no socket
collections and are not a public API endpoint or a count across backend replicas.

## Message input contract

The only supported client event is a text frame containing a JSON object:

```json
{"type": "message.send", "content": "O comando é o original?"}
```

`MessageSendEvent` in `app/schemas.py` requires both fields, enforces string
content and forbids all extra fields, including `sender_id`, `negotiation_id`,
`id` and `created_at`. Surrounding Unicode whitespace is stripped. Empty text
and content longer than 250 Unicode code points after trimming are rejected.
This is a code-point limit, not a byte or visual/grapheme count. Internal line
breaks and HTML-like text are stored literally; no HTML is interpreted. Escaped
unpaired surrogates and non-JSON constants such as NaN are rejected.

The application rejects payloads above 4096 UTF-8 bytes before parsing JSON.
Binary frames are unsupported. The backend Docker command additionally pins
Uvicorn's `websockets` transport with `--ws-max-size 4096`, limiting incoming
messages (including fragmented messages) before application processing. Rebuild
and recreate the backend after changing this Docker command. Other launch
commands must use the same transport limit. An oversized message rejected by
the transport closes with code `1009`; one reaching the application produces
`payload_too_large`. Ordinary invalid events do not close the connection.

## Processing and transactions

`app/message_processing.py` separates parsing, per-connection throttling and
database persistence. The endpoint takes the sender id only from the handshake's
authenticated user, and the negotiation id only from the validated route.

Every valid send runs `persist_message` through `run_in_threadpool`. The project
uses synchronous SQLAlchemy/PyMySQL, not an async database session: each worker
creates, uses and closes its own session. No database session is retained across
WebSocket receives.

The transaction locks and rechecks the current sender, their original session,
the negotiation and its requested listing. The shared lock order remains user
before negotiation before listing. The session must still exist, belong to that
sender and be unexpired; the sender must not be soft-deleted and must still be
a participant. Expiration is checked again after waiting for room/listing locks.
Session locking serialises sends with revocation. Negotiation locking serialises
the state check and insert with concurrent negotiation transitions.

| Current negotiation state | New messages |
| --- | --- |
| Open | Allowed |
| Agreed | Allowed |
| Completed | Read only |
| Cancelled | Read only |
| Unavailable | Read only |

Rejected sends never create a message. For accepted sends, the worker adds and
flushes one `Message`, refreshes backend-generated fields, captures an immutable
`PersistedMessage` and commits. That result is returned only after successful
commit, with `id`, `negotiation_id`, `msg_sender`, `msg` and `created_at`.
Capturing fields before commit avoids a separate post-commit query that could
fail after a successful write. Database failures roll back and return a controlled
error; logs contain ids and the exception class, not SQL, parameters or exception
text. There is no automatic retry of the insert.

After the worker returns, the endpoint passes the committed result to
`manager.broadcast`. Terminal states reject writes without deleting past messages;
participants can read those messages through the REST history endpoint.
There is no deduplication across separate client sends/retries: at most one
insert occurs per processing attempt.

## Message output and delivery

All connections in the message's negotiation, including the submitting connection
and the sender's other tabs/devices, receive the same event:

```json
{
  "type": "message.created",
  "message": {
    "id": 123,
    "negotiation_id": 20,
    "sender_id": 7,
    "content": "O comando é o original?",
    "created_at": "2026-10-28T14:30:00Z"
  }
}
```

`MessageCreatedData` is the public message representation available for reuse by
REST consumers. It maps persisted `msg_sender`/`msg` to `sender_id`/`content`
and serialises datetimes as ISO 8601 UTC with a `Z` suffix. Naive database
datetimes follow the project's UTC convention. No sender profile, session or
cookie data is included. `message.created` is the sender's confirmation; the
frontend must use its persisted id/timestamp rather than treat an optimistic
placeholder as a confirmed message. There is no separate acknowledgement event.

`messages.created_at` is a MariaDB `TIMESTAMP`, which the server converts using
the connection's session timezone. `app/database.py` therefore executes
`SET SESSION time_zone = '+00:00'` on every pool checkout, both for new and reused
physical connections. This makes naive timestamps returned by PyMySQL represent
UTC before the serializer labels them with `Z`. The policy does not depend on
the server/OS timezone or on named timezone tables. Failure to set the timezone
fails the checkout rather than silently using another zone.

No column migration or global database timezone change is required. Deploy the
updated backend code and restart workers if they do not reload automatically.
Other database clients must also use UTC when reading/writing timestamps under
this convention. This does not retroactively repair incorrectly supplied dates.

`broadcast` accepts a `PersistedMessage` returned by the commit-confirmed worker,
not a raw input event or a separate room argument. Public schema validation
requires positive ids and a timestamp. This typed boundary trusts the persistence
worker's commit guarantee; delivery does not query the database or commit again.
The event is serialised once, then sent to a stable snapshot of only that room.
An absent room is harmless. Connections added after the snapshot do not receive
that event; a connection removed before its send begins is skipped. An already
in-flight send may finish while that connection is being removed.

Recipients are sent to concurrently so a slow connection does not delay healthy
recipients' writes. Each network send has a five-second timeout, after acquiring
its connection lock. Send failure or timeout unregisters only that socket and
attempts to close it with `1011`, with a separate one-second close timeout.
Repeated removal and already-closed transports are harmless. If the originating
socket is removed, its endpoint stops processing additional payloads.

Before each `message.created` write, the manager revalidates the recipient's
original session, active account and current participation using a fresh database
session in a worker thread. The handshake and recipient checker share
`app/websocket_authorization.py`. No transaction remains open during a network
send. The recipient's user id and session token are captured at registration,
kept only in private memory and removed on disconnect; neither is logged as a
credential or included in outgoing events.

The recipient authorisation await has its own five-second deadline while holding
that socket's send lock, separate from the network send's five-second deadline.
A timeout follows the same removal/1011-close path as other delivery failures;
healthy recipients are independent, and waiting sends skip the removed socket.
The close attempt remains bounded to one second.

Cancelling an async wait cannot terminate an already-running synchronous DB
thread. Recipient checks therefore use a dedicated bounded database pool (five
connections plus at most five overflow connections, two-second checkout wait),
with two-second PyMySQL connect/read/write timeouts and MariaDB
`max_statement_time = 1` per session. This pool keeps the UTC checkout policy.
These short limits do not change the pool or transaction budgets used by REST,
handshakes or message persistence. The server query limit and driver I/O limits
bound worker operations after an async deadline; worker cleanup closes its own
session when those operations finish. No broker or database migration is needed.

This check protects idle recipients as well as senders. A revoked/expired session
or soft-deleted account closes with 4401, lost membership with 4403, and a missing
negotiation with 4404, before sending that message. Database failure fails closed
with 1011 and does not prevent delivery to other valid recipients. Checking one
device's session does not invalidate another valid session for the same user.

Logout and account deletion do not synchronously close every local socket. Idle
connections are removed on their next send or next attempted broadcast delivery;
there is no background polling or cross-process socket registry. This approach
also detects session changes made by other workers or database operations. An
authorisation check and a network write are not an atomic operation: a write
already authorised/in flight when revocation commits cannot be recalled.
The current implementation adds up to two SELECTs per recipient per delivery;
any future optimisation must retain the recipient-revocation checks.

Serialization/preparation failures produce a controlled `delivery_failed` error
to the origin when that connection is still usable. Individual failed recipients
are removed without failing delivery to healthy recipients. Neither case rolls
back, deletes or retries the committed message. Broadcast logs include negotiation
and message ids, delivered counts and removed counts, never the payload or raw
exception text. Expected closed-transport failures use INFO, timeouts WARNING,
and unexpected failures ERROR.

## Ordering and recovery limitations

Within one submitting connection, its receive loop processes one message and
awaits delivery before processing the next. Concurrent broadcasts and errors
share each recipient's send lock, so writes on that connection never overlap.
There is no room-wide ordering queue: delivery order across concurrent senders
need not match message-id/commit order or be identical across recipients. No
ordering or delivery guarantee is made across backend processes or replicas.

This is best-effort, process-local live delivery, not durable delivery or an
exactly-once protocol. A successful send means the transport accepted the write,
not that a user read it. Clients should identify messages by persisted id and
must not blindly resend after a delivery failure, which can create another row.

Undelivered messages remain in the database and can be fetched through REST
history. Frontend reconnection/automatic recovery remains separate work. Multiple
backend processes will require a shared broker or equivalent design; none is
introduced here.

## REST message history

`GET /api/negotiations/{negotiation_id}/messages` requires the existing session
cookie and permits only the interested user and requested listing owner. Missing
authentication returns 401, a missing negotiation 404 and a nonparticipant 403.
Access does not depend on negotiation state: Open, Agreed, Completed, Cancelled
and Unavailable all retain readable history for authenticated participants.

Query parameters:

| Parameter | Default | Valid values |
| --- | --- | --- |
| limit | 50 | Integer from 1 to 100 |
| before_id | omitted | Positive integer up to 2147483647 (message INT range) |

Invalid parameters return 422. A cursor is an exclusive numeric boundary; it
need not identify an existing message or a message in the same negotiation.
Every query still filters by the authorised negotiation. No OFFSET is used.

The query fetches `limit + 1` messages in descending id order, checks for an
extra row, trims the result and reverses it. Thus the first page contains the
most recent messages in ascending id order, with stable ordering even when
timestamps are identical. New messages do not shift the boundary of older pages.

```json
{
  "items": [{
    "id": 251,
    "negotiation_id": 20,
    "sender": {"id": 7, "user_name": "Alex", "avatar": null},
    "content": "O comando é o original?",
    "created_at": "2026-10-28T14:30:00Z"
  }],
  "limit": 50,
  "next_before_id": 251,
  "has_more": true
}
```

When `has_more` is true, `next_before_id` is the oldest id in the returned page.
Pass it as `before_id` to request the preceding page. When there are no older
messages, including empty pages, `has_more` is false and `next_before_id` is null.
Prepend earlier pages when assembling a chronological conversation.

REST adds only the sender's public id, user_name and avatar; email, location,
session and credentials are not returned. Historical messages remain visible if
their sender was soft-deleted, while the requesting account must still be active.
Like WebSocket messages, timestamps use ISO 8601 UTC with a Z suffix and content
is returned literally. REST includes a `sender` object instead of WebSocket's
`sender_id`; both identify the same persisted sender.

The cursor query uses `idx_messages_negotiation_id (negotiation_id, id)`. Existing
database volumes must apply the additive migration documented in
`srcs/services/mariadb/README.md`; image rebuilds alone do not migrate them.
This endpoint retrieves committed history but does not implement automatic
frontend reconnect, merge/deduplication or resend logic.

## Frequency limit

Each connection permits 10 attempts in a rolling 10-second window, using a
monotonic clock. Invalid events count as attempts too. Rejected attempts do not
extend the window or increase memory usage. A `rate_limited` error contains
`retry_after` in seconds. Each connection keeps at most 10 timestamps and clears
them in the endpoint's `finally` block.

This in-memory limit is per connection, not per user or across processes. Other
tabs/devices have independent allowances; reconnecting or restarting resets the
allowance. It is not a distributed abuse-prevention mechanism.

## Error contract

Errors are sent only to the submitting connection, for example:

```json
{"type": "error", "error": {"code": "empty_content", "message": "Content must not be empty."}}
```

| Code | Meaning / connection behaviour |
| --- | --- |
| invalid_json | Malformed JSON; keep open |
| invalid_payload | Wrong structure, missing fields, non-string content, extra fields or binary frame; keep open |
| payload_too_large | Application payload above 4096 bytes; keep open |
| unsupported_event | Event other than message.send; keep open |
| empty_content | Empty after trimming; keep open |
| content_too_long | Above 250 Unicode code points after trimming; keep open |
| rate_limited | Window exhausted; keep open, includes retry_after |
| unauthenticated | Session revoked/expired/mismatched or sender inactive; close 4401 |
| negotiation_not_found | Negotiation no longer exists; close 4404 |
| forbidden | Sender no longer a participant; close 4403 |
| negotiation_read_only | State disallows new messages; keep open |
| persistence_failed | Database operation failed; keep open |
| delivery_failed | Commit succeeded but live delivery preparation failed; keep open if usable |

`WebSocketErrorEvent` provides the common envelope. The #125 contract nests
fields under `error`, replacing #124's top-level `code`/`message`/`retry_after`.
Clients must read `event.error.code`; rate-limit delay is
`event.error.retry_after`. Optional `error.details` is a list of safe
`{field, code}` validation metadata and is omitted when unused; raw input and
exception text must never be included.

Errors use the same per-connection send lock and timeout as broadcasts, but are
sent only to their origin. Failed error delivery unregisters and closes that
connection; it is not retried or broadcast. Fatal errors are sent before the
corresponding close, with cleanup even when closing fails.

Frontend logic should use stable codes, not compare human-readable messages.
Authentication changes are detected on the next valid send or next broadcast
delivery attempt, not via background polling. Send-side terminal errors are sent
before closing; revoked broadcast recipients are closed without receiving the
private message. Normal manager cleanup runs in both cases.

## Tests

From `srcs/services/backend`, with backend requirements installed:

```sh
python -m unittest discover -s tests -p 'test*websocket.py' -v
python -m unittest discover -s tests -p 'test_connection_manager.py' -v
python -m unittest discover -s tests -p 'test_message_processing.py' -v
python -m unittest discover -s tests -p 'test_websocket_broadcast.py' -v
python -m unittest discover -s tests -p 'test_message_history.py' -v
```

The tests cover isolated rooms, multiple connections per participant, duplicate
registration, failed acceptance, repeated cleanup, rejected authorisation,
disconnects, unexpected loop errors, cancellation, and safe logging.
Message tests cover validation, Unicode boundaries, identity injection, current
session/membership/state checks, rate limiting, rollback and commit-before-return.
Broadcast tests cover serialisation, room isolation, sender devices, slow/failed
recipients, concurrent connection changes, concurrent writes, private error
delivery and retention of committed messages after live delivery failures.
The opt-in MariaDB suite additionally checks that a message waits for a concurrent
state transition and is rejected after the terminal state commits:

```sh
RUN_MARIADB_INTEGRATION=1 python -m unittest tests.test_mariadb_concurrency -v
```

The timezone integration test starts a physical connection in `+05:30`, verifies
the production checkout hook resets it to UTC, deliberately changes the session
zone, then reuses the same connection and verifies UTC is restored. It compares a
real TIMESTAMP's serialized instant against `UNIX_TIMESTAMP` and uses only a
temporary table, without changing the server's global timezone:

```sh
RUN_MARIADB_INTEGRATION=1 python -m unittest tests.test_mariadb_timezone -v
```

Recipient deadline tests include a stalled async check, cancellation of a wait on
an already-running synchronous worker, a real MariaDB query deadline, and driver
read timeout with the server query limit disabled only in that test session.
The MariaDB tests use SELECT SLEEP, restore/discard the test connection, and do
not alter application data or global server settings:

```sh
RUN_MARIADB_INTEGRATION=1 python -m unittest tests.test_mariadb_authorization_timeout -v
```
