import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import Negotiation from './Negotiation'
import {
  ApiError,
  apiGetNegotiation,
  type ApiListingDetail,
  type ApiNegotiationDetail,
  type ApiProposal,
  type ApiProposalState,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGetNegotiation: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

const OWNER = { id: 1, user_name: 'Ana', avatar: null, user_location: null, is_online: false }
const INTERESTED = { id: 2, user_name: 'Bruno', avatar: null, user_location: null, is_online: false }

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

function proposal(id: number, state: ApiProposalState['state_name'], title: string | null, overrides: Partial<ApiProposal> = {}): ApiProposal {
  return {
    id,
    offered_listing: title ? { ...LISTING, id: 100 + id, title, owner: INTERESTED } : null,
    state: { id, state_name: state },
    created_at: `2026-02-0${id}T10:00:00`,
    responded_at: null,
    ...overrides,
  }
}

function negotiation(overrides: Partial<ApiNegotiationDetail> = {}): ApiNegotiationDetail {
  return {
    id: 20,
    requested_listing: LISTING,
    owner: OWNER,
    interested_user: INTERESTED,
    state: { id: 1, state_name: 'Open' },
    proposals: [],
    cancelled_by: null,
    cancelled_at: null,
    created_at: '2026-01-15T10:00:00',
    updated_at: '2026-01-15T10:00:00',
    ...overrides,
  }
}

const logout = vi.fn().mockResolvedValue(undefined)

function renderPage(entry = '/negotiations/20', { strict = false } = {}) {
  const page = (
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Link to="/negotiations/21">Outra negociação</Link>
      <Routes>
        <Route path="/negotiations/:id" element={<Negotiation />} />
      </Routes>
    </MemoryRouter>
  )
  return render(strict ? <StrictMode>{page}</StrictMode> : page)
}

// The signal given to each request, in call order.
const signals = () => vi.mocked(apiGetNegotiation).mock.calls.map((call) => call[1])

const flush = () => act(() => new Promise((r) => setTimeout(r)))

describe('Negotiation', () => {
  beforeEach(() => {
    vi.mocked(apiGetNegotiation).mockReset().mockResolvedValue(negotiation())
    vi.mocked(useAuth).mockReturnValue({ user: { ...INTERESTED, email: 'b@x.io', created_at: '' }, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
    logout.mockClear()
  })

  it('shows loading, then the header with the participants and links', async () => {
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('A carregar negociação…')

    const heading = await screen.findByRole('heading', { level: 1, name: 'Bicicleta' })
    expect(within(heading).getByRole('link')).toHaveAttribute('href', '/listing/5')
    expect(screen.getByText('Aberta')).toBeInTheDocument()
    expect(screen.getByText('Iniciada a 15 de janeiro de 2026')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ana' })).toHaveAttribute('href', '/users/1')
    expect(screen.getByText('Bruno (tu)')).toBeInTheDocument()
    expect(apiGetNegotiation).toHaveBeenCalledWith(20, expect.any(AbortSignal))
  })

  it('does not link to a listing the backend would answer 404 for', async () => {
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation({ state: { id: 2, state_name: 'Agreed' } }))
    renderPage()

    const heading = await screen.findByRole('heading', { level: 1, name: 'Bicicleta' })
    expect(within(heading).queryByRole('link')).not.toBeInTheDocument()
  })

  it('explains when there are no proposals', async () => {
    renderPage()

    expect(await screen.findByText('Ainda não há propostas nesta negociação.')).toBeInTheDocument()
  })

  it('shows several pending proposals, newest first, including one without a listing', async () => {
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation({
      proposals: [proposal(1, 'Pending', 'Livro'), proposal(2, 'Pending', null), proposal(3, 'Pending', 'Candeeiro')],
    }))
    renderPage()

    const group = (await screen.findByRole('heading', { name: 'Propostas pendentes' })).parentElement!
    const titles = within(group).getAllByRole('article').map((card) => card.querySelector('p')?.textContent)
    expect(titles).toEqual(['Candeeiro', 'Sem anúncio oferecido', 'Livro'])
  })

  it('in an agreement shows the accepted proposal and keeps the others on hold', async () => {
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation({
      state: { id: 2, state_name: 'Agreed' },
      proposals: [
        proposal(1, 'Accepted', 'Livro', { responded_at: '2026-02-09T10:00:00' }),
        proposal(2, 'Pending', 'Candeeiro'),
      ],
    }))
    renderPage()

    const accepted = (await screen.findByRole('heading', { name: 'Proposta aceite' })).parentElement!
    expect(within(accepted).getByText('Livro')).toBeInTheDocument()
    expect(within(accepted).getByText(/Respondida a 9 de fevereiro de 2026/)).toBeInTheDocument()

    const onHold = screen.getByRole('heading', { name: 'Propostas em espera' }).parentElement!
    expect(within(onHold).getByText('Candeeiro')).toBeInTheDocument()
    expect(within(onHold).getByText('Serão encerradas quando a troca for concluída ou cancelada.')).toBeInTheDocument()
  })

  it('keeps closed proposals as history and explains ItemUnavailable', async () => {
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation({
      proposals: [
        proposal(1, 'Rejected', 'Livro'),
        proposal(2, 'Withdrawn', 'Candeeiro'),
        proposal(3, 'NotSelected', 'Mesa'),
        proposal(4, 'ItemUnavailable', 'Cadeira'),
      ],
    }))
    renderPage()

    const history = (await screen.findByRole('heading', { name: 'Histórico' })).parentElement!
    expect(within(history).getAllByRole('article')).toHaveLength(4)
    for (const label of ['Rejeitada', 'Retirada', 'Não selecionada', 'Anúncio indisponível']) {
      expect(within(history).getByText(label)).toBeInTheDocument()
    }
    expect(within(history).getByText('Um dos anúncios desta proposta já não está disponível.')).toBeInTheDocument()
  })

  it.each([
    ['Completed', /Esta troca foi concluída/],
    ['Unavailable', /O anúncio solicitado deixou de estar disponível/],
  ] as const)('explains the final state %s', async (state, text) => {
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation({ state: { id: 3, state_name: state } }))
    renderPage()

    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('shows who cancelled and when', async () => {
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation({
      state: { id: 4, state_name: 'Cancelled' },
      cancelled_by: OWNER,
      cancelled_at: '2026-03-05T10:00:00',
    }))
    renderPage()

    expect(await screen.findByText(/Negociação cancelada por Ana a 5 de março de 2026/)).toBeInTheDocument()
  })

  it('does not ask the backend about an id that cannot exist', async () => {
    renderPage('/negotiations/abc')

    expect(await screen.findByRole('heading', { name: 'Negociação não encontrada' })).toBeInTheDocument()
    expect(apiGetNegotiation).not.toHaveBeenCalled()
  })

  it('on 404 says it was not found', async () => {
    vi.mocked(apiGetNegotiation).mockRejectedValue(new ApiError(404, 'Negotiation not found.'))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Negociação não encontrada' })).toBeInTheDocument()
  })

  it('on 403 says the user has no access', async () => {
    vi.mocked(apiGetNegotiation).mockRejectedValue(new ApiError(403, 'Only negotiation participants may access this negotiation.'))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Sem acesso a esta negociação' })).toBeInTheDocument()
  })

  it('on 401 clears the session', async () => {
    vi.mocked(apiGetNegotiation).mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    renderPage()

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a loading failure and can try again', async () => {
    vi.mocked(apiGetNegotiation)
      .mockRejectedValueOnce(new ApiError(0, 'Could not reach the server.'))
      .mockResolvedValueOnce(negotiation())
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verifica a tua ligação à internet.')
    await userEvent.click(screen.getByRole('button', { name: 'Tentar outra vez' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Bicicleta' })).toBeInTheDocument()
  })

  it('updates when the page regains focus', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Bicicleta' })

    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation({ state: { id: 2, state_name: 'Agreed' } }))
    act(() => { window.dispatchEvent(new Event('focus')) })

    expect(await screen.findByText('Em acordo')).toBeInTheDocument()
    expect(apiGetNegotiation).toHaveBeenCalledTimes(2)
  })

  it('updates with the manual action, without duplicating a request in flight', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Bicicleta' })

    let resolve: (value: ApiNegotiationDetail) => void = () => {}
    vi.mocked(apiGetNegotiation).mockReturnValue(new Promise((r) => { resolve = r }))
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    const busy = screen.getByRole('button', { name: 'A atualizar…' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toBeDisabled()
    await userEvent.click(busy)
    act(() => { window.dispatchEvent(new Event('focus')) })

    expect(apiGetNegotiation).toHaveBeenCalledTimes(2)

    await act(async () => { resolve(negotiation({ state: { id: 3, state_name: 'Completed' } })) })
    expect(await screen.findByText('Concluída')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument()
  })

  it('keeps the negotiation on screen when a refresh fails', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Bicicleta' })

    vi.mocked(apiGetNegotiation).mockRejectedValue(new ApiError(0, 'Could not reach the server.'))
    act(() => { window.dispatchEvent(new Event('focus')) })

    expect(await screen.findByRole('alert')).toHaveTextContent('Verifica a tua ligação à internet.')
    expect(screen.getByRole('heading', { level: 1, name: 'Bicicleta' })).toBeInTheDocument()
  })

  it('never shows the previous negotiation under a new URL', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Bicicleta' })

    let resolve: (value: ApiNegotiationDetail) => void = () => {}
    vi.mocked(apiGetNegotiation).mockReturnValue(new Promise((r) => { resolve = r }))
    await userEvent.click(screen.getByRole('link', { name: 'Outra negociação' }))

    expect(await screen.findByRole('status')).toHaveTextContent('A carregar negociação…')
    expect(screen.queryByRole('heading', { level: 1, name: 'Bicicleta' })).not.toBeInTheDocument()

    await act(async () => { resolve(negotiation({ id: 21, requested_listing: { ...LISTING, title: 'Mesa' } })) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Mesa' })).toBeInTheDocument()
  })

  it('drops a late response from the previous negotiation', async () => {
    let resolveOld: (value: ApiNegotiationDetail) => void = () => {}
    vi.mocked(apiGetNegotiation)
      .mockReturnValueOnce(new Promise((r) => { resolveOld = r }))
      .mockResolvedValueOnce(negotiation({ id: 21, requested_listing: { ...LISTING, title: 'Mesa' } }))
    renderPage()

    await userEvent.click(screen.getByRole('link', { name: 'Outra negociação' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Mesa' })).toBeInTheDocument()

    await act(async () => { resolveOld(negotiation()) })
    await flush()

    expect(screen.getByRole('heading', { level: 1, name: 'Mesa' })).toBeInTheDocument()
    expect(signals().map((signal) => signal?.aborted)).toEqual([true, false])
  })

  it('keeps one request in flight when React runs the effect twice (StrictMode)', async () => {
    renderPage('/negotiations/20', { strict: true })
    await screen.findByRole('heading', { level: 1, name: 'Bicicleta' })

    expect(signals().length).toBeGreaterThan(0)
    expect(signals().filter((signal) => signal && !signal.aborted)).toHaveLength(1)
  })
})
