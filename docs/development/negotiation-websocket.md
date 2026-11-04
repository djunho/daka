# Negotiation WebSocket authentication and connection lifecycle

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

The endpoint receives raw transport events without interpreting message content.
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

## Tests

From `srcs/services/backend`, with backend requirements installed:

```sh
python -m unittest discover -s tests -p 'test*websocket.py' -v
python -m unittest discover -s tests -p 'test_connection_manager.py' -v
```

The tests cover isolated rooms, multiple connections per participant, duplicate
registration, failed acceptance, repeated cleanup, rejected authorisation,
disconnects, unexpected loop errors, cancellation, and safe logging.
