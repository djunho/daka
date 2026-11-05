# ADR-0003 - Allow Reopening Withdrawn Proposals

**Status:** Accepted

**Date:** 05-11-2026

**Author(s):** DAKA Team

---

## Context

ADR-0002 sets two rules that, together, leave the interested user stuck:

- "Within one negotiation, the same offered listing may appear in at most one
  proposal, and at most one proposal may omit the offered listing." The
  database enforces it with `uq_proposals_negotiation_offer`, a unique key on
  `(negotiation_id, COALESCE(offered_listing_id, 0))`.
- "Preserve proposal records after rejection, withdrawal, or acceptance."

A withdrawn proposal stays stored as `Withdrawn` and still holds its place in
the unique key. Once the interested user withdraws a proposal, they can never
offer that listing again in the negotiation, nor make another proposal without
a listing. Creating it again answers `409 An identical proposal already exists
in this negotiation.` (GitHub Issue #160).

Withdrawing is the interested user's own decision and is easy to do by
mistake, or to regret after talking in the chat. Being locked out of the same
offer for the rest of the negotiation is not the intended outcome.

---

## Decision

The interested user may reopen a proposal they withdrew.

- `PATCH /api/proposals/{proposal_id}/reopen` moves the **same row** from
  `Withdrawn` back to `Pending`, clears `responded_at` and updates the
  negotiation's `updated_at`.
- Only the interested user may reopen (`403` otherwise).
- Only a `Withdrawn` proposal in an `Open` negotiation may be reopened (`409`
  otherwise). Cancelling a negotiation also moves its pending proposals to
  `Withdrawn`, and this rule keeps those closed, because a cancelled
  negotiation is terminal.
- When the proposal offers a listing, that listing is locked and checked again
  with the same rules as creating a proposal: it still exists, still belongs
  to the interested user and is still `Available` (`404`, `403` or `409`).
- `Rejected`, `NotSelected`, `ItemUnavailable` and `Accepted` proposals cannot
  be reopened. A rejection is the listing owner's answer and stays final.
- The unique key does not change. There is still at most one proposal per
  offered listing, and one without a listing, in each negotiation.

The frontend offers a "Reabrir" action on withdrawn proposals in the
negotiation history, and the "Nova proposta" form no longer offers listings,
or the "no listing" option, that are already used by a proposal in the
negotiation.

---

## Alternatives Considered

### Alternative 1 - Apply the unique key only to pending proposals

Replace the generated key with one that is `NULL` when the proposal is not
`Pending`, so closed proposals no longer take part in the unique key (MariaDB
allows several `NULL` values), and let the user simply create the proposal
again.

Advantages:

- The history keeps every proposal, including the withdrawn one.
- The existing "Nova proposta" form works with no new action.

Disadvantages:

- Needs a schema migration on every existing volume.
- A rejected proposal could also be sent again, so the owner's "no" would not
  hold unless another rule is added.

---

## Consequences

### Positive Consequences

- A withdrawal can be undone while the negotiation is open.
- No schema change and no migration.
- Rejections stay final without any extra rule.
- The "Nova proposta" form stops offering choices that can only fail.

### Negative Consequences

- The history no longer shows that a reopened proposal was once withdrawn:
  there are no proposal events in the chat, and `created_at` keeps the date of
  the first time.
- The listing owner may see a proposal disappear from the pending ones and come
  back without an explanation.

### Risks

- Reopening races with accepting another proposal, cancelling or completing
  the negotiation, or a change to the offered listing. Mitigation: the route
  uses the same lock order as the other proposal changes (negotiation and
  proposal, then listings) and checks every rule after taking the locks.

---

## Implementation Notes

- The route reuses `_lock_proposal_and_negotiation`. The checks on the offered
  listing live in `_lock_offered_listing`, shared with `create_proposal`, so
  both apply the same rules.
- Creating a proposal identical to a withdrawn one still answers `409`; the
  frontend offers "Reabrir" instead.

---

## References

- GitHub Issue #160: Reopen a withdrawn proposal and stop offering repeated
  proposals.
- GitHub Issue #126: Negotiation and proposal model.

---

## Related ADRs

- [ADR-0002](0002-adopt-chat-centric-negotiations.md): complemented by this
  decision on the rules for withdrawing and preserving proposals.
