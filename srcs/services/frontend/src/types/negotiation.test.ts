import { describe, expect, it } from 'vitest'
import type { ApiProposal } from '../lib/api'
import { ACTIVE_NEGOTIATION_STATES, groupProposals, isNegotiationReadOnly } from './negotiation'

function proposal(id: number, created_at: string): ApiProposal {
  return {
    id,
    offered_listing: null,
    state: { id: 1, state_name: 'Pending' },
    created_at,
    responded_at: null,
  }
}

describe('groupProposals', () => {
  it('orders by time, not by the text of the date', () => {
    // As text, "…00Z" sorts after "…00.500Z", although it is half a second older.
    const { pending } = groupProposals([
      proposal(1, '2026-02-01T10:00:00Z'),
      proposal(2, '2026-02-01T10:00:00.500Z'),
    ])

    expect(pending.map((p) => p.id)).toEqual([2, 1])
  })

  it('breaks a tie on the date with the newest id', () => {
    const { pending } = groupProposals([
      proposal(3, '2026-02-01T10:00:00'),
      proposal(4, '2026-02-01T10:00:00'),
    ])

    expect(pending.map((p) => p.id)).toEqual([4, 3])
  })
})

describe('isNegotiationReadOnly', () => {
  it('treats exactly the active states as writable', () => {
    expect(ACTIVE_NEGOTIATION_STATES).toEqual(['Open', 'Agreed'])
  })

  it('returns false for active states (Open and Agreed)', () => {
    expect(isNegotiationReadOnly('Open')).toBe(false)
    expect(isNegotiationReadOnly('Agreed')).toBe(false)
    expect(isNegotiationReadOnly({ id: 1, state_name: 'Open' })).toBe(false)
    expect(isNegotiationReadOnly({ id: 2, state_name: 'Agreed' })).toBe(false)
  })

  it('returns true for terminal states (Completed, Cancelled, Unavailable)', () => {
    expect(isNegotiationReadOnly('Completed')).toBe(true)
    expect(isNegotiationReadOnly('Cancelled')).toBe(true)
    expect(isNegotiationReadOnly('Unavailable')).toBe(true)
    expect(isNegotiationReadOnly({ id: 3, state_name: 'Completed' })).toBe(true)
    expect(isNegotiationReadOnly({ id: 4, state_name: 'Cancelled' })).toBe(true)
    expect(isNegotiationReadOnly({ id: 5, state_name: 'Unavailable' })).toBe(true)
  })
})
