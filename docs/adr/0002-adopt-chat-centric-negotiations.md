# ADR-0001 - Adopt a Chat-Centric Negotiation Model

**Status:** Accepted

**Date:** 28-10-2026

**Author(s):** DAKA Team

---

## Context

The original trade model required an interested user to select an offered
listing before starting a conversation with a listing owner. The chat was then
attached to that specific trade proposal.

This approach created two product problems:

- Users could not ask questions about a listing before making an offer.
- A rejected offer could fragment the conversation into multiple trades and
  separate chat histories for the same listing and interested user.

The team needed a model that preserves one conversation throughout the
negotiation while remaining small enough for the current project scope.

---

## Decision

DAKA will adopt a chat-centric negotiation model with the following rules:

- A negotiation represents the conversation between one listing owner and one
  interested user about one requested listing.
- A negotiation can be created without an offer.
- A negotiation can contain multiple proposals over time.
- A negotiation can contain multiple pending proposals simultaneously.
- Each pending proposal represents an alternative that the listing owner may
  accept or reject while the negotiation is open.
- The interested user may withdraw an individual pending proposal.
- When one proposal is accepted, the accepted proposal moves to `Accepted` and
  the negotiation moves to `Agreed`.
- All other pending proposals move atomically to `NotSelected`.
- After the negotiation reaches `Agreed`, no new proposals may be created or
  accepted.
- Each proposal references exactly one listing offered by the interested user.
- Multi-item proposals and item combinations are outside the current scope.
- Chat history contains text messages only.
- Text messages are exchanged through WebSocket and persisted in the database.
- Negotiation and proposal actions are performed through REST endpoints.
- Proposals are displayed in a fixed banner area above the chat instead of
  being inserted into the message history.
- Previous proposals remain stored as negotiation history even though they are
  not rendered as chat messages.

The current `Trade` domain will therefore be separated into `Negotiation` and
`Proposal`. Messages will belong to a negotiation, and each proposal will
reference one offered listing.

---

## Alternatives Considered

### Conversation Model: Keep the Trade-Centric Model

The team considered preserving the existing model in which a chat belongs
to a trade created with a preselected offered listing.

This option was rejected because it prevents users from starting a
conversation before making an offer and can fragment the conversation
across multiple trades.

### Proposal Composition: Allow Multi-Item Proposals

The team considered allowing each proposal to contain multiple offered
listings.

This option was not selected for the current scope because it requires
additional relationships, validation, locking, and user interface behavior.
The decision does not prevent this capability from being reconsidered later.

### Chat Presentation: Use a Mixed Message and Event Feed

The team considered displaying proposal creation, rejection, acceptance,
and completion as events mixed chronologically with text messages.

This option was rejected for the current scope in favor of a text-only chat
and a separate proposal banner.

## Consequences

### Positive Consequences

- Users can start a conversation without committing an item.
- Rejected or withdrawn proposals do not end the conversation.
- A single chat history is preserved for each requested listing and interested
  user.
- Proposal business rules remain separate from text-message transport.
- The banner keeps the chat interface simple and focused on text.
- The model can be extended with multi-item proposals later if product needs
  justify the additional complexity.
- Users can present multiple alternative proposals without fragmenting the
  negotiation or creating separate chat histories.
- The listing owner can compare available alternatives before choosing one.
- Proposal history remains explicit: accepted, rejected, withdrawn, and
  non-selected proposals can be distinguished.

### Negative Consequences

- The existing trade schema, ORM models, API schemas, routes, and lifecycle
  logic must be refactored.
- The frontend must keep the proposal banner area synchronized with changes made
  through REST.
- The banner does not show proposal changes in their exact conversational
  position.
- The proposal banner must support presenting and navigating multiple pending
  proposals.
- The frontend must synchronize the set of pending proposals after proposal
  actions performed through REST.
- The proposal lifecycle requires an additional `NotSelected` state.
- Accepting one proposal requires updating the other pending proposals in the
  same operation.

### Risks

- Concurrent acceptance attempts must be protected with database transactions
  and row-level locks.
- If WebSocket is limited to text messages, the other participant will need
  polling or another refresh mechanism to see proposal changes while the chat
  is open.
- The team must define consistent transitions for negotiation and proposal
  states to prevent contradictory records.
- Concurrent acceptance attempts could result in more than one accepted
  proposal unless the transition is protected by a database transaction and
  row-level locking.
- The banner may display stale proposal data if REST changes are not followed
  by refetching or polling.
- Proposal state transitions may become inconsistent if acceptance, negotiation
  state changes, and closure of the remaining pending proposals are not atomic.

---

## Implementation Notes

- Add `negotiations`, `negotiation_states`, `proposals`, and `proposal_states`.
- Change messages to reference `negotiation_id` instead of `trade_id`.
- Do not add `proposal_items`, because each proposal references one offered
  listing directly.
- Do not add message or event types; the chat stores text messages only.
- Use REST for creating, withdrawing, rejecting, and accepting proposals, and
  for cancelling or completing negotiations.
- Use a negotiation-scoped WebSocket endpoint for new text messages and
  presence if presence is included in the implementation scope.
- Preserve proposal records after rejection, withdrawal, or acceptance.
- Protect proposal state changes transactionally.
- Allow multiple `Pending` proposals per negotiation.
- Add `NotSelected` to the proposal states.
- When one proposal is accepted, update it to `Accepted`, update the
  negotiation to `Agreed`, and update all other pending proposals to
  `NotSelected` in the same transaction.
- Do not enforce a database constraint limiting a negotiation to one pending
  proposal.
- Present pending proposals in the fixed banner area without inserting them
  into the text-message history.

---

## References

- RFC: *Evolution of the Negotiation and Trade Model*, 22-10-2026.
- GitHub Issue #65: Chat implementation.

---

## Related ADRs

- None.
