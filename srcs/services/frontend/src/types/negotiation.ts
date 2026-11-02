import type { ApiNegotiationState, ApiProposal, ApiProposalState, NegotiationRole } from '../lib/api'

export const PROPOSAL_STATE_LABELS: Record<ApiProposalState['state_name'], string> = {
  Pending: 'Pendente',
  Accepted: 'Aceite',
  Rejected: 'Rejeitada',
  Withdrawn: 'Retirada',
  NotSelected: 'Não selecionada',
  ItemUnavailable: 'Anúncio indisponível',
}

// "5 de março de 2026"
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// Groups a negotiation's proposals the way the panel shows them, newest first.
// There can be several pending ones, so nothing here assumes a single proposal.
export function groupProposals(proposals: ApiProposal[]) {
  const newestFirst = [...proposals].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
  )
  return {
    accepted: newestFirst.filter((p) => p.state.state_name === 'Accepted'),
    pending: newestFirst.filter((p) => p.state.state_name === 'Pending'),
    closed: newestFirst.filter((p) => p.state.state_name !== 'Accepted' && p.state.state_name !== 'Pending'),
  }
}

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
