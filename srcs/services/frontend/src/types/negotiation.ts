import type { ApiNegotiationState, ApiProposal, NegotiationRole } from '../lib/api'

export const NEGOTIATION_STATE_LABELS: Record<ApiNegotiationState['state_name'], string> = {
  Open: 'Aberta',
  Agreed: 'Em acordo',
  Completed: 'Concluída',
  Cancelled: 'Cancelada',
  Unavailable: 'Indisponível',
}

export const NEGOTIATION_ROLE_LABELS: Record<NegotiationRole, string> = {
  owner: 'Proprietário',
  interested: 'Interessado',
}

// One line about the proposal shown on a negotiation in the list. The backend
// only sends an accepted or pending proposal here, and it may offer no listing.
export function activeProposalSummary(proposal: ApiProposal): string {
  const prefix = proposal.state.state_name === 'Accepted' ? 'Proposta aceite' : 'Proposta pendente'
  const offered = proposal.offered_listing?.title ?? 'sem anúncio oferecido'
  return `${prefix}: ${offered}`
}
