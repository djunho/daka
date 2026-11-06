/**
 * Chat and messaging types for negotiations.
 * Based on the backend specifications from Issues #120, #123, #124 and #125.
 */

// ============================================================================
// 1. REST API Types (Initial History & Pagination)
// ============================================================================

/**
 * Public sender information attached to messages in the REST history endpoint.
 * (GET /api/negotiations/{id}/messages)
 */
export interface ChatSender {
  id: number
  user_name: string
  avatar: string | null
}

/**
 * A message record returned by the database via the REST history endpoint.
 */
export interface ApiChatMessage {
  id: number
  negotiation_id: number
  sender: ChatSender
  content: string
  created_at: string // ISO-8601 UTC timestamp (e.g., "2026-11-03T21:30:00Z")
}

/**
 * Paginated response envelope for the message history endpoint.
 * Supports cursor-based pagination using `before_id`.
 */
export interface ApiChatMessagePage {
  items: ApiChatMessage[]
  limit: number
  next_before_id: number | null
  has_more: boolean
}

// ============================================================================
// 2. WebSocket Real-time Events (wss://<host>/api/ws/negotiations/{id})
// ============================================================================

/**
 * Maximum message length in Unicode code points after trimming, mirroring the
 * backend's MessageSendEvent (app/schemas.py). The hook, the widget's counter
 * and the error copy all read this one value.
 */
export const MESSAGE_MAX_LENGTH = 250

// Python's str.strip() (used by the backend) also removes U+001C-U+001F and
// U+0085, which String.prototype.trim() keeps. JS \s covers every other
// character Python strips (and also U+FEFF, which is harmless to drop first).
const SERVER_EDGE_SPACE = /^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/g

/**
 * Trims a message the way the backend will, so the length check matches the
 * server's and the content echoed in message.created equals what was sent.
 */
export function normaliseMessageContent(content: string): string {
  return content.replace(SERVER_EDGE_SPACE, '')
}

/**
 * Outgoing event: sent by the client to submit a new text message.
 * Note: sender_id and negotiation_id are inferred by the server from the
 * authenticated session and the URL route; the client must not send them.
 */
export interface MessageSendEvent {
  type: 'message.send'
  content: string
}

/**
 * The inner message payload broadcast by the server after persisting to database.
 * To save bandwidth on every message, it sends `sender_id` instead of the full
 * profile object, which the client already knows from the negotiation header.
 */
export interface MessageCreatedData {
  id: number
  negotiation_id: number
  sender_id: number
  content: string
  created_at: string
}

/**
 * Incoming event: broadcast by the server to all connected room participants
 * once a message has been successfully saved to the database.
 */
export interface MessageCreatedEvent {
  type: 'message.created'
  message: MessageCreatedData
}

/**
 * Optional safe validation metadata, never raw input or exception text.
 */
export interface WebSocketValidationDetail {
  field: string
  code: string
}

/**
 * Structured error details returned by the server on rejected events.
 */
export interface WebSocketErrorData {
  code: string
  message: string
  retry_after?: number
  details?: WebSocketValidationDetail[]
}

/**
 * Incoming event: sent by the server to report a recoverable error or rejection.
 */
export interface WebSocketErrorEvent {
  type: 'error'
  error: WebSocketErrorData
}

/**
 * Union of all possible incoming WebSocket event envelopes.
 */
export type IncomingWebSocketEvent = MessageCreatedEvent | WebSocketErrorEvent

// ============================================================================
// 3. WebSocket Close Codes (RFC 6455 & Application Contract)
// ============================================================================

/**
 * WebSocket Close Codes.
 * Standard code 1000 is defined by RFC 6455 Section 7.4.1 (Normal Closure).
 * Codes 4401, 4403, and 4404 are custom application-level terminal close codes
 * defined by the backend WebSocket endpoint (Issue #120 / ADR-0002).
 */
export const WS_CLOSE_CODES = {
  NORMAL_CLOSURE: 1000,
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
} as const
