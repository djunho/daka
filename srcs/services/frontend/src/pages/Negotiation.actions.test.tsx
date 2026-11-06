import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import Negotiation from './Negotiation'
import {
  ApiError,
  apiAcceptProposal,
  apiCancelNegotiation,
  apiCompleteNegotiation,
  apiCreateProposal,
  apiGetNegotiation,
  apiGetPublicProfile,
  apiRejectProposal,
  apiReopenProposal,
  apiWithdrawProposal,
  type ApiListingDetail,
  type ApiNegotiationDetail,
  type ApiNegotiationState,
  type ApiProposal,
  type ApiProposalState,
  type ApiPublicProfile,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiAcceptProposal: vi.fn(),
  apiCancelNegotiation: vi.fn(),
  apiCompleteNegotiation: vi.fn(),
  apiCreateProposal: vi.fn(),
  apiGetNegotiation: vi.fn(),
  apiGetPublicProfile: vi.fn(),
  apiRejectProposal: vi.fn(),
  apiReopenProposal: vi.fn(),
  apiWithdrawProposal: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

const OWNER = { id: 1, user_name: 'Ana', avatar: null, user_location: null }
const INTERESTED = { id: 2, user_name: 'Bruno', avatar: null, user_location: null }

const LISTING: ApiListingDetail = {
  id: 5,
  title: 'Bicicleta',
  category: { id: 1, category_name: 'Books' },
  condition: { id: 1, condition_name: 'Good' },
  listing_location: null,
  wish: null,
  owner: OWNER,
  cover_image: null,
  created_at: '2026-01-01T00:00:00',
  listing_dsc: null,
  images: [],
  is_favorited: false,
}

function proposal(id: number, state: ApiProposalState['state_name'], title: string | null): ApiProposal {
  return {
    id,
    offered_listing: title ? { ...LISTING, id: 100 + id, title, owner: INTERESTED } : null,
    state: { id, state_name: state },
    created_at: `2026-02-0${id}T10:00:00`,
    responded_at: null,
  }
}

function negotiation(state: ApiNegotiationState['state_name'], proposals: ApiProposal[] = []): ApiNegotiationDetail {
  return {
    id: 20,
    requested_listing: LISTING,
    owner: OWNER,
    interested_user: INTERESTED,
    state: { id: 1, state_name: state },
    proposals,
    cancelled_by: null,
    cancelled_at: null,
    created_at: '2026-01-15T10:00:00',
    updated_at: '2026-01-15T10:00:00',
  }
}

const logout = vi.fn().mockResolvedValue(undefined)

function signIn(person: typeof OWNER | null) {
  vi.mocked(useAuth).mockReturnValue({
    user: person && { ...person, email: 'x@x.io', created_at: '' },
    loading: false,
    logout,
  } as unknown as ReturnType<typeof useAuth>)
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/negotiations/20']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Link to="/negotiations/21">Outra negociação</Link>
      <Routes>
        <Route path="/negotiations/:id" element={<Negotiation />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function open(person: typeof OWNER, data: ApiNegotiationDetail) {
  signIn(person)
  vi.mocked(apiGetNegotiation).mockResolvedValue(data)
  renderPage()
  await screen.findByRole('heading', { level: 1, name: 'Bicicleta' })
}

const button = (name: string | RegExp) => screen.findByRole('button', { name })
const dialog = () => screen.findByRole('dialog')
const noButton = (name: string | RegExp) => expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()

describe('Negotiation actions', () => {
  // jsdom does not implement the native dialog methods.
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() { this.open = true }
    HTMLDialogElement.prototype.close = function close() { this.open = false }
  })

  beforeEach(() => {
    vi.mocked(apiGetNegotiation).mockReset()
    for (const fn of [apiAcceptProposal, apiRejectProposal, apiWithdrawProposal, apiReopenProposal, apiCreateProposal]) {
      vi.mocked(fn).mockReset().mockResolvedValue(proposal(1, 'Pending', 'x'))
    }
    vi.mocked(apiCancelNegotiation).mockReset()
    vi.mocked(apiCompleteNegotiation).mockReset()
    vi.mocked(apiGetPublicProfile).mockReset().mockResolvedValue({
      ...INTERESTED,
      is_online: false,
      last_seen: null,
      created_at: '',
      listings: [{ ...LISTING, id: 7, title: 'Livro', owner: INTERESTED }],
    } as ApiPublicProfile)
    logout.mockClear()
  })

  describe('offered listing', () => {
    it('links to it while the proposal is pending in an open negotiation', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro'), proposal(2, 'Rejected', 'Mesa')]))

      expect(screen.getByRole('link', { name: 'Livro' })).toHaveAttribute('href', '/listing/101')
      expect(screen.queryByRole('link', { name: 'Mesa' })).not.toBeInTheDocument()
    })

    it('does not link once the listings are reserved', async () => {
      await open(OWNER, negotiation('Agreed', [proposal(1, 'Accepted', 'Livro'), proposal(2, 'Pending', 'Mesa')]))

      expect(screen.queryByRole('link', { name: 'Livro' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Mesa' })).not.toBeInTheDocument()
    })
  })

  describe('permissions', () => {
    it('owner in Open: accepts and rejects, cannot propose, withdraw or complete', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))

      expect(await button('Aceitar proposta: Livro')).toBeInTheDocument()
      expect(await button('Rejeitar proposta: Livro')).toBeInTheDocument()
      expect(await button('Cancelar negociação')).toBeInTheDocument()
      noButton('Retirar proposta: Livro')
      noButton('Criar proposta')
      noButton('Confirmar conclusão')
    })

    it('interested in Open: proposes and withdraws, cannot accept or reject', async () => {
      await open(INTERESTED, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))

      expect(await button('Retirar proposta: Livro')).toBeInTheDocument()
      expect(await button('Criar proposta')).toBeInTheDocument()
      expect(await button('Cancelar negociação')).toBeInTheDocument()
      noButton('Aceitar proposta: Livro')
      noButton('Rejeitar proposta: Livro')
    })

    it('every pending proposal has its own actions', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro'), proposal(2, 'Pending', null)]))

      expect(await button('Aceitar proposta: Livro')).toBeInTheDocument()
      expect(await button('Aceitar proposta: sem anúncio oferecido')).toBeInTheDocument()
    })

    it('interested in Agreed: confirms or cancels, proposals on hold have no actions', async () => {
      await open(INTERESTED, negotiation('Agreed', [proposal(1, 'Accepted', 'Livro'), proposal(2, 'Pending', 'Mesa')]))

      expect(await button('Confirmar conclusão')).toBeInTheDocument()
      expect(await button('Cancelar negociação')).toBeInTheDocument()
      noButton('Retirar proposta: Mesa')
      noButton('Criar proposta')
    })

    it('owner in Agreed: waits for the confirmation and can cancel', async () => {
      await open(OWNER, negotiation('Agreed', [proposal(1, 'Accepted', 'Livro'), proposal(2, 'Pending', 'Mesa')]))

      expect(screen.getByText(/À espera de que a pessoa interessada confirme/)).toBeInTheDocument()
      expect(await button('Cancelar negociação')).toBeInTheDocument()
      noButton('Confirmar conclusão')
      noButton('Aceitar proposta: Mesa')
    })

    it.each([
      ['Completed', 'owner', OWNER],
      ['Completed', 'interested', INTERESTED],
      ['Cancelled', 'owner', OWNER],
      ['Cancelled', 'interested', INTERESTED],
      ['Unavailable', 'owner', OWNER],
      ['Unavailable', 'interested', INTERESTED],
    ] as const)('%s is read-only for the %s', async (state, _who, person) => {
      await open(person, negotiation(state, [proposal(1, 'Accepted', 'Livro'), proposal(2, 'ItemUnavailable', 'Mesa')]))

      expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument()
      expect(screen.getAllByRole('button')).toHaveLength(1)
    })

    it('a proposal with an unavailable listing has no actions, but another can be created', async () => {
      await open(INTERESTED, negotiation('Open', [proposal(1, 'ItemUnavailable', 'Livro')]))

      noButton(/proposta: Livro/)
      expect(await button('Criar proposta')).toBeInTheDocument()
    })
  })

  describe('creating a proposal', () => {
    async function openForm() {
      await open(INTERESTED, negotiation('Open'))
      await userEvent.click(await button('Criar proposta'))
      return screen.findByLabelText('O que ofereces em troca?')
    }

    it('asks for a choice before sending and focuses the field', async () => {
      const select = await openForm()

      expect(select).toHaveFocus()
      expect(await button('Enviar proposta')).toBeDisabled()
      expect(apiGetPublicProfile).toHaveBeenCalledWith(INTERESTED.id)
    })

    it('offers one of the listings, then loads the negotiation again', async () => {
      const select = await openForm()
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open', [proposal(1, 'Pending', 'Livro')]))

      await userEvent.selectOptions(select, 'Livro')
      await userEvent.click(await button('Enviar proposta'))

      expect(apiCreateProposal).toHaveBeenCalledWith(20, 7)
      expect(await screen.findByText('Proposta enviada.')).toHaveFocus()
      expect(screen.getByRole('heading', { name: 'Propostas pendentes' })).toBeInTheDocument()
      expect(screen.queryByLabelText('O que ofereces em troca?')).not.toBeInTheDocument()
    })

    it('can offer no listing, also when the user has none', async () => {
      vi.mocked(apiGetPublicProfile).mockResolvedValue({ ...INTERESTED, is_online: false, last_seen: null, created_at: '', listings: [] } as ApiPublicProfile)
      const select = await openForm()

      await userEvent.selectOptions(select, 'Não oferecer nenhum anúncio')
      await userEvent.click(await button('Enviar proposta'))

      expect(apiCreateProposal).toHaveBeenCalledWith(20, null)
    })

    it('explains a repeated proposal and keeps the form to choose another', async () => {
      const select = await openForm()
      vi.mocked(apiCreateProposal).mockRejectedValue(new ApiError(409, 'An identical proposal already exists.'))

      await userEvent.selectOptions(select, 'Livro')
      await userEvent.click(await button('Enviar proposta'))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Já existe uma proposta com este anúncio nesta negociação')
      // The message stays in the form, next to the choice to change.
      expect(alert.closest('form')).not.toBeNull()
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      await waitFor(() => expect(screen.getByLabelText('O que ofereces em troca?')).toHaveFocus())
      await waitFor(() => expect(apiGetNegotiation).toHaveBeenCalledTimes(2))
    })

    it('on a conflict after the negotiation closed, explains it at the top', async () => {
      const select = await openForm()
      vi.mocked(apiCreateProposal).mockRejectedValue(new ApiError(409, 'Only an open negotiation accepts proposals.'))
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Cancelled'))

      await userEvent.selectOptions(select, 'Livro')
      await userEvent.click(await button('Enviar proposta'))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Já existe uma proposta com este anúncio nesta negociação')
      expect(alert.closest('form')).toBeNull()
      expect(alert).toHaveFocus()
      expect(screen.queryByLabelText('O que ofereces em troca?')).not.toBeInTheDocument()
    })

    it('can retry when the listings fail to load, and can be cancelled', async () => {
      vi.mocked(apiGetPublicProfile).mockRejectedValueOnce(new ApiError(0, 'Could not reach the server.'))
      await open(INTERESTED, negotiation('Open'))
      await userEvent.click(await button('Criar proposta'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Verifica a tua ligação à internet.')
      await userEvent.click(await button('Tentar outra vez'))
      expect(await screen.findByLabelText('O que ofereces em troca?')).toBeInTheDocument()

      await userEvent.click(await button('Cancelar'))
      const again = await button('Criar proposta')
      await waitFor(() => expect(again).toHaveFocus())
    })

    it('on 401 while loading the listings clears the session', async () => {
      vi.mocked(apiGetPublicProfile).mockRejectedValueOnce(new ApiError(401, 'Not authenticated.'))
      await open(INTERESTED, negotiation('Open'))
      await userEvent.click(await button('Criar proposta'))

      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
      expect(screen.queryByText(/iniciar sessão/)).not.toBeInTheDocument()
    })
  })

  describe('confirmed actions', () => {
    it('withdraws after confirming and keeps the negotiation open', async () => {
      await open(INTERESTED, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open', [proposal(1, 'Withdrawn', 'Livro')]))

      await userEvent.click(await button('Retirar proposta: Livro'))
      expect(apiWithdrawProposal).not.toHaveBeenCalled()
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, retirar' }))

      expect(apiWithdrawProposal).toHaveBeenCalledWith(1)
      expect(await screen.findByText('Proposta retirada.')).toHaveFocus()
      expect(screen.getByText('Retirada')).toBeInTheDocument()
      expect(screen.getByText('Aberta')).toBeInTheDocument()
    })

    it('rejects after confirming and keeps the negotiation open', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open', [proposal(1, 'Rejected', 'Livro')]))

      await userEvent.click(await button('Rejeitar proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, rejeitar' }))

      expect(apiRejectProposal).toHaveBeenCalledWith(1)
      expect(await screen.findByText('Rejeitada')).toBeInTheDocument()
      expect(screen.getByText('Aberta')).toBeInTheDocument()
    })

    it('accepting warns about the reservation and leaves the others on hold', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro'), proposal(2, 'Pending', 'Mesa')]))
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Agreed', [proposal(1, 'Accepted', 'Livro'), proposal(2, 'Pending', 'Mesa')]))

      await userEvent.click(await button('Aceitar proposta: Livro'))
      const confirm = await dialog()
      expect(confirm).toHaveTextContent('Os dois anúncios ficam reservados, incluindo «Livro».')
      expect(confirm).toHaveTextContent('As outras propostas ficam em espera')
      await userEvent.click(within(confirm).getByRole('button', { name: 'Sim, aceitar' }))

      expect(apiAcceptProposal).toHaveBeenCalledWith(1)
      expect(await screen.findByRole('heading', { name: 'Propostas em espera' })).toBeInTheDocument()
      expect(screen.getByText('Em acordo')).toBeInTheDocument()
      expect(screen.queryByText('Não selecionada')).not.toBeInTheDocument()
    })

    it('accepting a proposal without a listing only mentions the requested listing', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', null)]))

      await userEvent.click(await button('Aceitar proposta: sem anúncio oferecido'))

      expect(await dialog()).toHaveTextContent('O teu anúncio fica reservado.')
    })

    it('completing closes the proposals on hold as not selected', async () => {
      await open(INTERESTED, negotiation('Agreed', [proposal(1, 'Accepted', 'Livro'), proposal(2, 'Pending', 'Mesa')]))
      vi.mocked(apiCompleteNegotiation).mockResolvedValue(
        negotiation('Completed', [proposal(1, 'Accepted', 'Livro'), proposal(2, 'NotSelected', 'Mesa')]),
      )

      await userEvent.click(await button('Confirmar conclusão'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, confirmar' }))

      expect(apiCompleteNegotiation).toHaveBeenCalledWith(20)
      expect(await screen.findByText('Troca concluída.')).toHaveFocus()
      expect(screen.getByText('Não selecionada')).toBeInTheDocument()
      expect(screen.getByText('Proposta aceite')).toBeInTheDocument()
      noButton('Cancelar negociação')
      expect(apiGetNegotiation).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['interested', INTERESTED, 'Withdrawn', 'Retirada'],
      ['owner', OWNER, 'Rejected', 'Rejeitada'],
    ] as const)('the %s cancels in Open: pending become %s', async (_who, person, closedState, label) => {
      await open(person, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      vi.mocked(apiCancelNegotiation).mockResolvedValue({
        ...negotiation('Cancelled', [proposal(1, closedState, 'Livro')]),
        cancelled_by: person,
        cancelled_at: '2026-03-05T10:00:00',
      })

      await userEvent.click(await button('Cancelar negociação'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, cancelar' }))

      expect(apiCancelNegotiation).toHaveBeenCalledWith(20)
      expect(await screen.findByText(label)).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`cancelada por ${person.user_name} a 5 de março de 2026`))).toBeInTheDocument()
      noButton('Cancelar negociação')
    })

    it.each([
      ['interested', INTERESTED, 'Withdrawn', 'Retirada'],
      ['owner', OWNER, 'Rejected', 'Rejeitada'],
    ] as const)('the %s cancels in Agreed: the accepted one stays as history', async (_who, person, closedState, label) => {
      await open(person, negotiation('Agreed', [proposal(1, 'Accepted', 'Livro'), proposal(2, 'Pending', 'Mesa')]))
      vi.mocked(apiCancelNegotiation).mockResolvedValue({
        ...negotiation('Cancelled', [proposal(1, 'Accepted', 'Livro'), proposal(2, closedState, 'Mesa')]),
        cancelled_by: person,
        cancelled_at: '2026-03-05T10:00:00',
      })

      await userEvent.click(await button('Cancelar negociação'))
      const confirm = await dialog()
      expect(confirm).toHaveTextContent('Os anúncios reservados voltam a ficar disponíveis.')
      await userEvent.click(within(confirm).getByRole('button', { name: 'Sim, cancelar' }))

      expect(await screen.findByText('Proposta aceite')).toBeInTheDocument()
      expect(screen.getByText(label)).toBeInTheDocument()
    })

    it('does nothing when the confirmation is dismissed', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))

      await userEvent.click(await button('Rejeitar proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Cancelar' }))

      expect(apiRejectProposal).not.toHaveBeenCalled()
      expect(screen.getByText('Aberta')).toBeInTheDocument()
    })
  })

  describe('failures', () => {
    it('on 409 explains, closes the dialog and shows the real state', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      vi.mocked(apiAcceptProposal).mockRejectedValue(new ApiError(409, 'A listing in this proposal is no longer available.'))
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Cancelled', [proposal(1, 'Withdrawn', 'Livro')]))

      await userEvent.click(await button('Aceitar proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, aceitar' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Os dados desta negociação foram alterados')
      expect(alert).toHaveFocus()
      expect(await screen.findByText('Cancelada')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(apiGetNegotiation).toHaveBeenCalledTimes(2)
    })

    it('"Atualizar" waits for an action to finish, and clears its old result', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      let finish: (value: ApiProposal) => void = () => {}
      vi.mocked(apiRejectProposal).mockReturnValueOnce(new Promise((r) => { finish = r }))
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open', [proposal(1, 'Rejected', 'Livro')]))

      await userEvent.click(await button('Rejeitar proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, rejeitar' }))
      expect(screen.getByRole('button', { hidden: true, name: 'Atualizar' })).toBeDisabled()

      await act(async () => { finish(proposal(1, 'Rejected', 'Livro')) })
      expect(await screen.findByText('Proposta rejeitada.')).toBeInTheDocument()

      await userEvent.click(await button('Atualizar'))
      expect(screen.queryByText('Proposta rejeitada.')).not.toBeInTheDocument()
    })

    it('a confirmed action clears an earlier refresh failure', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      vi.mocked(apiGetNegotiation).mockRejectedValueOnce(new ApiError(0, 'Could not reach the server.'))
      await userEvent.click(await button('Atualizar'))
      expect(await screen.findByRole('alert')).toHaveTextContent('Verifica a tua ligação à internet.')

      vi.mocked(apiCancelNegotiation).mockResolvedValue({
        ...negotiation('Cancelled', [proposal(1, 'Rejected', 'Livro')]),
        cancelled_by: OWNER,
        cancelled_at: '2026-03-05T10:00:00',
      })
      await userEvent.click(await button('Cancelar negociação'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, cancelar' }))

      expect(await screen.findByText('Negociação cancelada.')).toBeInTheDocument()
      expect(screen.queryByText(/Verifica a tua ligação/)).not.toBeInTheDocument()
    })

    it('an action still running does not lock the next negotiation', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      vi.mocked(apiRejectProposal).mockReturnValueOnce(new Promise(() => {}))
      await userEvent.click(await button('Rejeitar proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, rejeitar' }))
      await waitFor(() => expect(apiRejectProposal).toHaveBeenCalledTimes(1))

      vi.mocked(apiGetNegotiation).mockResolvedValue({ ...negotiation('Open', [proposal(2, 'Pending', 'Mesa')]), id: 21 })
      await userEvent.click(screen.getByRole('link', { name: 'Outra negociação' }))

      const reject = await button('Rejeitar proposta: Mesa')
      expect(reject).toBeEnabled()
      await userEvent.click(reject)
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, rejeitar' }))
      await waitFor(() => expect(apiRejectProposal).toHaveBeenCalledTimes(2))
      expect(apiRejectProposal).toHaveBeenLastCalledWith(2)
    })

    it('a network failure stays in the dialog, in Portuguese, and can be retried', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      vi.mocked(apiRejectProposal).mockRejectedValueOnce(new ApiError(0, 'Could not reach the server.'))

      await userEvent.click(await button('Rejeitar proposta: Livro'))
      const confirm = await dialog()
      await userEvent.click(within(confirm).getByRole('button', { name: 'Sim, rejeitar' }))

      expect(await within(confirm).findByRole('alert')).toHaveTextContent('Verifica a tua ligação à internet.')
      expect(apiGetNegotiation).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Pendente')).toBeInTheDocument()

      await userEvent.click(within(confirm).getByRole('button', { name: 'Sim, rejeitar' }))
      expect(await screen.findByText('Proposta rejeitada.')).toBeInTheDocument()
    })

    it('on 401 clears the session', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      vi.mocked(apiRejectProposal).mockRejectedValue(new ApiError(401, 'Not authenticated.'))

      await userEvent.click(await button('Rejeitar proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, rejeitar' }))

      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    })

    it('blocks repeated clicks and other actions while one is running', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro'), proposal(2, 'Pending', 'Mesa')]))
      vi.mocked(apiAcceptProposal).mockReturnValue(new Promise(() => {}))

      await userEvent.click(await button('Aceitar proposta: Livro'))
      const confirm = await dialog()
      await userEvent.dblClick(within(confirm).getByRole('button', { name: 'Sim, aceitar' }))

      expect(apiAcceptProposal).toHaveBeenCalledTimes(1)
      expect(within(confirm).getByRole('button', { name: 'A aceitar…' })).toBeDisabled()
      expect(within(confirm).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
      for (const b of screen.getAllByRole('button', { hidden: true, name: /proposta: / })) {
        expect(b).toBeDisabled()
      }
    })

    it('a refresh already on its way cannot undo the result of an action', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Pending', 'Livro')]))

      let resolveOld: (value: ApiNegotiationDetail) => void = () => {}
      vi.mocked(apiGetNegotiation).mockReturnValueOnce(new Promise((r) => { resolveOld = r }))
      await userEvent.click(await button('Atualizar'))

      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open', [proposal(1, 'Rejected', 'Livro')]))
      await userEvent.click(await button('Rejeitar proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, rejeitar' }))
      expect(await screen.findByText('Rejeitada')).toBeInTheDocument()
      // The first call loaded the page; the second is the refresh left behind.
      expect(vi.mocked(apiGetNegotiation).mock.calls[1][1]?.aborted).toBe(true)

      resolveOld(negotiation('Open', [proposal(1, 'Pending', 'Livro')]))
      await new Promise((r) => setTimeout(r))

      expect(screen.getByText('Rejeitada')).toBeInTheDocument()
      expect(screen.queryByText('Pendente')).not.toBeInTheDocument()
    })
  })

  describe('reopening a withdrawn proposal', () => {
    it('only the interested user sees "Reabrir", and only on withdrawn proposals', async () => {
      const proposals = [proposal(1, 'Withdrawn', 'Livro'), proposal(2, 'Rejected', 'Mesa'), proposal(3, 'ItemUnavailable', 'Cadeira')]
      await open(INTERESTED, negotiation('Open', proposals))

      expect(await button('Reabrir proposta: Livro')).toBeInTheDocument()
      noButton('Reabrir proposta: Mesa')
      noButton('Reabrir proposta: Cadeira')
    })

    it('the owner cannot reopen', async () => {
      await open(OWNER, negotiation('Open', [proposal(1, 'Withdrawn', 'Livro')]))

      noButton(/Reabrir/)
    })

    it('a closed negotiation keeps its withdrawn proposals closed', async () => {
      await open(INTERESTED, negotiation('Cancelled', [proposal(1, 'Withdrawn', 'Livro')]))

      noButton(/Reabrir/)
    })

    it('reopens after confirming, and the proposal is pending again', async () => {
      await open(INTERESTED, negotiation('Open', [proposal(1, 'Withdrawn', 'Livro')]))
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open', [proposal(1, 'Pending', 'Livro')]))

      await userEvent.click(await button('Reabrir proposta: Livro'))
      const confirm = await dialog()
      expect(confirm).toHaveTextContent('A proposta volta a ficar pendente: Livro. Ana pode aceitá-la ou rejeitá-la.')
      expect(apiReopenProposal).not.toHaveBeenCalled()
      await userEvent.click(within(confirm).getByRole('button', { name: 'Sim, reabrir' }))

      expect(apiReopenProposal).toHaveBeenCalledWith(1)
      expect(await screen.findByText('Proposta reaberta.')).toHaveFocus()
      expect(screen.getByRole('heading', { name: 'Propostas pendentes' })).toBeInTheDocument()
      expect(await button('Retirar proposta: Livro')).toBeInTheDocument()
    })

    it('cancelling the dialog does not reopen', async () => {
      await open(INTERESTED, negotiation('Open', [proposal(1, 'Withdrawn', 'Livro')]))

      await userEvent.click(await button('Reabrir proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Cancelar' }))

      expect(apiReopenProposal).not.toHaveBeenCalled()
    })

    it('on 409 loads the negotiation again and explains why', async () => {
      await open(INTERESTED, negotiation('Open', [proposal(1, 'Withdrawn', 'Livro')]))
      vi.mocked(apiReopenProposal).mockRejectedValue(new ApiError(409, 'Offered listing is not available.'))

      await userEvent.click(await button('Reabrir proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, reabrir' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível reabrir a proposta: a negociação ou o anúncio oferecido mudaram entretanto.',
      )
      expect(apiGetNegotiation).toHaveBeenCalledTimes(2)
    })

    it('on 401 clears the session', async () => {
      await open(INTERESTED, negotiation('Open', [proposal(1, 'Withdrawn', 'Livro')]))
      vi.mocked(apiReopenProposal).mockRejectedValue(new ApiError(401, 'Not authenticated.'))

      await userEvent.click(await button('Reabrir proposta: Livro'))
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Sim, reabrir' }))

      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    })
  })

  describe('new proposal choices', () => {
    const BOOK = { ...LISTING, id: 7, title: 'Livro', owner: INTERESTED }
    const TABLE = { ...LISTING, id: 8, title: 'Mesa', owner: INTERESTED }

    async function openFormWith(proposals: ApiProposal[]) {
      vi.mocked(apiGetPublicProfile).mockResolvedValue({ ...INTERESTED, is_online: false, last_seen: null, created_at: '', listings: [BOOK, TABLE] } as ApiPublicProfile)
      await open(INTERESTED, negotiation('Open', proposals))
      await userEvent.click(await button('Criar proposta'))
    }

    it('leaves out the listings and the "no listing" option this negotiation already used', async () => {
      await openFormWith([
        { ...proposal(1, 'Withdrawn', null), offered_listing: BOOK },
        proposal(2, 'Rejected', null),
      ])

      const select = await screen.findByLabelText('O que ofereces em troca?')
      const options = within(select).getAllByRole('option').map((option) => option.textContent)
      expect(options).toEqual(['Escolhe uma opção', 'Mesa'])
    })

    it('clears a choice that another tab used first, so it cannot be sent again', async () => {
      await openFormWith([])
      const select = await screen.findByLabelText('O que ofereces em troca?')
      vi.mocked(apiCreateProposal).mockRejectedValue(new ApiError(409, 'An identical proposal already exists.'))
      // The reload after the 409 shows the proposal the other tab made with Livro.
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open', [{ ...proposal(1, 'Pending', null), offered_listing: BOOK }]))

      await userEvent.selectOptions(select, 'Livro')
      await userEvent.click(await button('Enviar proposta'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma proposta com este anúncio nesta negociação')
      await waitFor(() => expect(screen.getByLabelText('O que ofereces em troca?')).toHaveValue(''))
      expect(within(screen.getByLabelText('O que ofereces em troca?')).queryByRole('option', { name: 'Livro' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Enviar proposta' })).toBeDisabled()
      expect(apiCreateProposal).toHaveBeenCalledTimes(1)
    })

    it('keeps the 409 explanation when it used up the last choice', async () => {
      // Only Livro is left: Mesa and "no listing" are already used.
      await openFormWith([
        { ...proposal(1, 'Rejected', null), offered_listing: TABLE },
        proposal(2, 'Pending', null),
      ])
      const select = await screen.findByLabelText('O que ofereces em troca?')
      vi.mocked(apiCreateProposal).mockRejectedValue(new ApiError(409, 'An identical proposal already exists.'))
      vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open', [
        { ...proposal(1, 'Rejected', null), offered_listing: TABLE },
        proposal(2, 'Pending', null),
        { ...proposal(3, 'Pending', null), offered_listing: BOOK },
      ]))

      await userEvent.selectOptions(select, 'Livro')
      await userEvent.click(await button('Enviar proposta'))

      expect(await screen.findByText(/Já usaste todos os teus anúncios disponíveis nesta negociação/)).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Já existe uma proposta com este anúncio nesta negociação')
    })

    it('says nothing is left and points to the history when everything was used', async () => {
      await openFormWith([
        { ...proposal(1, 'Withdrawn', null), offered_listing: BOOK },
        { ...proposal(2, 'Rejected', null), offered_listing: TABLE },
        proposal(3, 'Pending', null),
      ])

      expect(await screen.findByText(/Já usaste todos os teus anúncios disponíveis nesta negociação\./)).toHaveTextContent(
        'Podes reabrir uma proposta retirada no histórico.',
      )
      expect(screen.queryByLabelText('O que ofereces em troca?')).not.toBeInTheDocument()
    })
  })
})
