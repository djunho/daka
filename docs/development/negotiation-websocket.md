# Negotiation WebSocket authentication

The backend endpoint is `/ws/negotiations/{negotiation_id}`. Its expected
public path after the infrastructure proxy is configured is
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
