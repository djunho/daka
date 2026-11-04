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
 * Incoming event: sent by the server to report a recoverable error or rejection.
 */
export interface WebSocketErrorEvent {
  type: 'error'
  code: string
  message: string
}

/**
 * Union of all possible incoming WebSocket event envelopes.
 */
export type IncomingWebSocketEvent = MessageCreatedEvent | WebSocketErrorEvent
