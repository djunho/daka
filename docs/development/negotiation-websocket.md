# Negotiation WebSocket authentication

The backend endpoint is `/ws/negotiations/{negotiation_id}`. Its expected
public path after the infrastructure proxy is configured is
`/api/ws/negotiations/{negotiation_id}`.

The handshake uses the existing `daka_session` cookie. It never accepts an
authentication token or sender identity from a WebSocket payload. Before
accepting the connection, the backend verifies the exact `Origin`, resolves an
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
