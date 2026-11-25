# ADR-0002 - Adopt a Chat-Centric Negotiation Model

**Status:** Accepted

**Date:** 28-10-2026

**Last updated:** 05-11-2026

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
- A proposal may omit the offered listing when the interested user has no item
  to offer in return.
- Within one negotiation, the same offered listing may appear in at most one
  proposal, and at most one proposal may omit the offered listing.
- The interested user may withdraw an individual pending proposal, and may
  reopen it while the negotiation is open (see ADR-0003).
- When one proposal is accepted, the accepted proposal moves to `Accepted` and
  the negotiation moves to `Agreed`.
- The requested listing and, when present, the offered listing move atomically
  from `Available` to `Reserved`.
- Other pending proposals and negotiations involving the reserved listings
  remain unchanged until the agreed negotiation is completed or cancelled.
- After the negotiation reaches `Agreed`, no new proposals may be created or
  accepted.
- When the negotiation is completed, the reserved listings move to `Traded`.
  Other pending proposals in that negotiation move to `NotSelected`, while
  competing negotiations and proposals affected by a now-traded listing move
  to `Unavailable` and `ItemUnavailable`, respectively.
- When an agreed negotiation is cancelled, its reserved listings return to
  `Available`. The accepted proposal remains `Accepted` as history.
- When an open or agreed negotiation is cancelled, its pending proposals move
  to `Withdrawn` if the interested user cancelled it or to `Rejected` if the
  listing owner cancelled it.
- A cancelled negotiation is terminal and cannot be reopened. Because one
  negotiation is retained per requested listing and interested user, that user
  cannot start another negotiation for the same listing after cancellation.
- A pending proposal moves to `ItemUnavailable` when a required listing becomes
  `Removed`, `Expired`, or `Traded`; reservation alone does not close competing
  proposals.
- Each proposal references zero or one listing offered by the interested user.
- Multi-item proposals and item combinations are outside the current scope.
- Chat history contains text messages only.
- Text messages are exchanged through WebSocket and persisted in the database.
- Negotiation and proposal actions are performed through REST endpoints.
- Proposals are displayed in a fixed banner area above the chat instead of
  being inserted into the message history.
- Previous proposals remain stored as negotiation history even though they are
  not rendered as chat messages.
- Listing states are `Available`, `Reserved`, `Traded`, `Expired`, and
  `Removed`.
- Negotiation states are `Open`, `Agreed`, `Completed`, `Cancelled`, and
  `Unavailable`.
- Proposal states are `Pending`, `Accepted`, `Rejected`, `Withdrawn`,
  `NotSelected`, and `ItemUnavailable`.

The current `Trade` domain will therefore be separated into `Negotiation` and
`Proposal`. Messages will belong to a negotiation, and each proposal may
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
- Users without a listing to offer can still make a proposal that may progress
  through agreement and completion.
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
- Completing an agreed negotiation requires closing its remaining pending
  proposals and the competing negotiations and proposals made impossible by
  the traded listings.

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
  state changes, and listing reservations are not atomic.
- Completion may leave competing negotiations or proposals active unless all
  records affected by the traded listings are updated atomically.

---

## Implementation Notes

- Add `negotiations`, `negotiation_states`, `proposals`, and `proposal_states`.
- Change messages to reference `negotiation_id` instead of `trade_id`.
- Do not add `proposal_items`, because a proposal references at most one offered
  listing directly.
- Allow `proposals.offered_listing_id` to be null.
- Enforce at most one proposal for the same offered listing within a
  negotiation and at most one proposal without an offered listing within a
  negotiation. Because SQL unique constraints treat null values as distinct,
  normalize the nullable listing reference through a generated key before
  applying the composite unique constraint.
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
  negotiation to `Agreed`, and reserve the requested listing and the optional
  offered listing in the same transaction. Leave other pending proposals
  unchanged until completion or cancellation.
- On completion, move the reserved listings to `Traded`, move the other pending
  proposals in the completed negotiation to `NotSelected`, and close competing
  negotiations and proposals made impossible by the traded listings.
- On cancellation, preserve an accepted proposal as history and move pending
  proposals to `Withdrawn` or `Rejected` according to which participant
  cancelled the negotiation.
- Do not enforce a database constraint limiting a negotiation to one pending
  proposal.
- Present pending proposals in the fixed banner area without inserting them
  into the text-message history.

---

## References

- RFC: *Evolution of the Negotiation and Trade Model*, 22-10-2026.
- GitHub Issue #62: Negotiations and Proposals epic.
- GitHub Issue #95: Negotiation and proposal REST API.
- GitHub Issue #119: Negotiation, proposal, and message database model.
- GitHub Issue #65: Chat implementation.

---

## Related ADRs

- [ADR-0003](0003-allow-reopening-withdrawn-proposals.md): lets the
  interested user reopen a withdrawn proposal. It complements the rules above
  on withdrawing and preserving proposals.
