# Negotiation WebSocket: authentication, connections and message persistence

The backend endpoint is `/ws/negotiations/{negotiation_id}`. Its expected
public path through the infrastructure proxy is
`/api/ws/negotiations/{negotiation_id}`.

The handshake uses the existing `daka_session` cookie. It never accepts an
authentication token or sender identity from a WebSocket payload. Before
allowing access to the negotiation, the backend verifies the exact `Origin`, resolves an
active unexpired session, loads the requested negotiation and its listing
owner, and checks that the user is either that owner or the interested user.

## Origin configuration

Set `WEBSOCKET_ALLOWED_ORIGINS` to a comma-separated list of exact origins
(scheme, host, and port when applicable). Do not use wildcards.

- Local development: `https://localhost:8443`
- Production: the deployed frontend origin, for example
  `https://daka.example`

`FRONTEND_URL` is always included in the allowed set. Connections without an
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
only detached, preloaded objects or a refusal code return to the endpoint.

## Connection lifecycle

`app/connection_manager.py` owns the shared process-local `manager`. Its private
dictionary maps each negotiation id to a set of WebSocket connections. Multiple
tabs or devices, including those belonging to the same participant, are separate
connections. Registering an already registered connection does not accept it again.

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

## Concurrency and limitations

The manager must be used only from the application's event loop, not from worker
threads. Dictionary/set mutations contain no awaits; registration takes place
after the awaited acceptance using the current room collection. No mutable room
collection is exposed. Future broadcast work must take a snapshot before iterating
over connections across awaits.

State is held only in memory, independently in each backend process. Restarts and
development reloads discard it. Multiple workers or replicas do not share rooms or
counts; cross-process delivery requires a separate future design. There is no
connection table, Redis, broker, message persistence, broadcast, or frontend
reconnection in this component.

A broken network connection is removed when the server detects the disconnect or
a transport error. The manager itself does not detect silent network failures or
implement heartbeat/timeouts.

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

The next broadcast ticket will consume the committed result. This ticket sends
no success acknowledgement and defines no `message.created` event. It adds no
history endpoint; terminal states reject writes without deleting past messages.
There is no deduplication across separate client sends/retries: at most one
insert occurs per processing attempt.

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
{"type": "error", "code": "empty_content", "message": "Content must not be empty."}
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

Frontend logic should use stable codes, not compare human-readable messages.
Authentication changes are detected on the next valid send, not via background
polling. Terminal errors are sent before closing and normal manager cleanup runs.

## Tests

From `srcs/services/backend`, with backend requirements installed:

```sh
python -m unittest discover -s tests -p 'test*websocket.py' -v
python -m unittest discover -s tests -p 'test_connection_manager.py' -v
python -m unittest discover -s tests -p 'test_message_processing.py' -v
```

The tests cover isolated rooms, multiple connections per participant, duplicate
registration, failed acceptance, repeated cleanup, rejected authorisation,
disconnects, unexpected loop errors, cancellation, and safe logging.
Message tests cover validation, Unicode boundaries, identity injection, current
session/membership/state checks, rate limiting, rollback and commit-before-return.
The opt-in MariaDB suite additionally checks that a message waits for a concurrent
state transition and is rejected after the terminal state commits:

```sh
RUN_MARIADB_INTEGRATION=1 python -m unittest tests.test_mariadb_concurrency -v
```
