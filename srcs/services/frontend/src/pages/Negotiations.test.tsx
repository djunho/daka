import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import Negotiations from './Negotiations'
import RequireAuth from '../components/RequireAuth'
import {
  ApiError,
  apiListNegotiations,
  type ApiListingSummary,
  type ApiNegotiationPage,
  type ApiNegotiationSummary,
  type ApiPublicUser,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiListNegotiations: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

const ME = { id: 1, user_name: 'Ana', avatar: null, user_location: null, email: 'a@x.io', created_at: '2026-01-01' }
const OTHER = { id: 2, user_name: 'Bruno', avatar: null, user_location: null }

function listing(id: number, title: string, owner: ApiPublicUser = ME): ApiListingSummary {
  return {
    id,
    title,
    category: { id: 1, category_name: 'Books' },
    condition: { id: 1, condition_name: 'Good' },
    listing_location: null,
    wish: null,
    owner,
    cover_image: null,
    created_at: '2026-01-01T00:00:00',
  }
}

function negotiation(id: number, overrides: Partial<ApiNegotiationSummary> = {}): ApiNegotiationSummary {
  return {
    id,
    requested_listing: listing(id, `Anúncio ${id}`),
    other_participant: OTHER,
    state: { id: 1, state_name: 'Open' },
    active_proposal: null,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-03-05T12:00:00',
    ...overrides,
  }
}

function pageOf(items: ApiNegotiationSummary[], total = items.length, offset = 0): ApiNegotiationPage {
  return { items, total, limit: 20, offset }
}

const logout = vi.fn().mockResolvedValue(undefined)

function SearchProbe() {
  const location = useLocation()
  return <span data-testid="search">{location.search}</span>
}

function NegotiationProbe() {
  const { id } = useParams()
  return <p>Negociação {id}</p>
}

function renderPage(entry = '/negotiations') {
  return render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SearchProbe />
      <Routes>
        <Route path="/" element={<p>Início</p>} />
        <Route path="/login" element={<p>Página de login</p>} />
        <Route path="/negotiations" element={<RequireAuth><Negotiations /></RequireAuth>} />
        <Route path="/negotiations/:id" element={<NegotiationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const lastCall = () => vi.mocked(apiListNegotiations).mock.lastCall?.[0]
const search = () => screen.getByTestId('search').textContent

describe('Negotiations', () => {
  beforeEach(() => {
    vi.mocked(apiListNegotiations).mockReset().mockResolvedValue(pageOf([negotiation(1)]))
    vi.mocked(useAuth).mockReturnValue({ user: ME, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
    logout.mockClear()
  })

  it('is protected: a visitor goes to login and nothing is requested', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
    renderPage()

    expect(await screen.findByText('Página de login')).toBeInTheDocument()
    expect(apiListNegotiations).not.toHaveBeenCalled()
  })

  it('shows loading, then each negotiation with its details', async () => {
    vi.mocked(apiListNegotiations).mockResolvedValue(pageOf([
      negotiation(1, {
        state: { id: 2, state_name: 'Agreed' },
        active_proposal: {
          id: 9,
          offered_listing: listing(7, 'Livro oferecido', OTHER),
          state: { id: 2, state_name: 'Accepted' },
          created_at: '2026-01-02T00:00:00',
          responded_at: '2026-01-03T00:00:00',
        },
      }),
    ]))
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('A carregar negociações…')

    const card = await screen.findByRole('article')
    expect(within(card).getByRole('heading', { name: 'Anúncio 1' })).toBeInTheDocument()
    expect(within(card).getByText('Bruno')).toBeInTheDocument()
    expect(within(card).getByText('Em acordo')).toBeInTheDocument()
    expect(within(card).getByText('Proprietário')).toBeInTheDocument()
    expect(within(card).getByText('Proposta aceite: Livro oferecido')).toBeInTheDocument()
    expect(within(card).getByText('Atualizada a 5 de março de 2026')).toBeInTheDocument()
  })

  it('shows the interested role and a proposal without an offered listing', async () => {
    vi.mocked(apiListNegotiations).mockResolvedValue(pageOf([
      negotiation(1, {
        requested_listing: listing(1, 'Anúncio 1', OTHER),
        active_proposal: {
          id: 9,
          offered_listing: null,
          state: { id: 1, state_name: 'Pending' },
          created_at: '2026-01-02T00:00:00',
          responded_at: null,
        },
      }),
    ]))
    renderPage()

    expect(await screen.findByText('Interessado')).toBeInTheDocument()
    expect(screen.getByText('Proposta pendente: sem anúncio oferecido')).toBeInTheDocument()
  })

  it('opens the selected negotiation', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('link', { name: 'Abrir negociação sobre Anúncio 1' }))

    expect(await screen.findByText('Negociação 1')).toBeInTheDocument()
  })

  it('filters by role, keeping it in the URL', async () => {
    renderPage()
    await screen.findByRole('article')

    await userEvent.selectOptions(screen.getByLabelText('Participação'), 'Como interessado')

    expect(search()).toBe('?role=interested')
    expect(lastCall()).toEqual({ role: 'interested', state: undefined, limit: 20, offset: 0 })
  })

  it('filters by state, keeping it in the URL', async () => {
    renderPage()
    await screen.findByRole('article')

    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'Cancelada')

    expect(search()).toBe('?state=Cancelled')
    expect(lastCall()).toEqual({ role: undefined, state: 'Cancelled', limit: 20, offset: 0 })
  })

  it('reads filters and page from the URL', async () => {
    vi.mocked(apiListNegotiations).mockResolvedValue(pageOf([negotiation(1)], 45, 20))
    renderPage('/negotiations?role=owner&state=Open&page=2')
    await screen.findByRole('article')

    expect(lastCall()).toEqual({ role: 'owner', state: 'Open', limit: 20, offset: 20 })
    expect(screen.getByLabelText('Participação')).toHaveValue('owner')
    expect(screen.getByLabelText('Estado')).toHaveValue('Open')
  })

  it('ignores values in the URL that the backend would reject', async () => {
    renderPage('/negotiations?role=admin&state=Nope&page=abc')
    await screen.findByRole('article')

    expect(lastCall()).toEqual({ role: undefined, state: undefined, limit: 20, offset: 0 })
  })

  it('goes through the pages keeping the filters, and a filter goes back to page one', async () => {
    vi.mocked(apiListNegotiations).mockImplementation(async (params) =>
      pageOf([negotiation((params?.offset ?? 0) + 1)], 45, params?.offset),
    )
    renderPage('/negotiations?state=Open')
    await screen.findByText('Página 1 de 3')
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Seguinte' }))
    await screen.findByText('Página 2 de 3')
    expect(search()).toBe('?state=Open&page=2')
    expect(lastCall()).toEqual({ role: undefined, state: 'Open', limit: 20, offset: 20 })
    expect(screen.getByRole('heading', { name: 'Negociações' })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    await screen.findByText('Página 1 de 3')
    expect(search()).toBe('?state=Open')

    await userEvent.click(screen.getByRole('button', { name: 'Seguinte' }))
    await screen.findByText('Página 2 de 3')
    await userEvent.selectOptions(screen.getByLabelText('Participação'), 'Como proprietário')
    expect(search()).toBe('?state=Open&role=owner')
  })

  it('says when there are no more results on the last page', async () => {
    vi.mocked(apiListNegotiations).mockResolvedValue(pageOf([negotiation(41)], 41, 40))
    renderPage('/negotiations?page=3')

    expect(await screen.findByText(/Não há mais resultados\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seguinte' })).toBeDisabled()
  })

  it('offers the first page when the page number is past the end', async () => {
    vi.mocked(apiListNegotiations).mockResolvedValue(pageOf([], 3, 180))
    renderPage('/negotiations?page=10')

    await userEvent.click(await screen.findByRole('button', { name: 'Voltar à primeira página' }))

    expect(search()).toBe('')
  })

  it('explains an empty list', async () => {
    vi.mocked(apiListNegotiations).mockResolvedValue(pageOf([]))
    renderPage()

    expect(await screen.findByText(/Ainda não tens negociações/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver anúncios' })).toHaveAttribute('href', '/')
  })

  it('explains a filter with no results and can clear it', async () => {
    vi.mocked(apiListNegotiations).mockResolvedValue(pageOf([]))
    renderPage('/negotiations?state=Completed')

    expect(await screen.findByText('Nenhuma negociação corresponde aos filtros.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))

    expect(search()).toBe('')
  })

  it('shows a failure and can try again', async () => {
    vi.mocked(apiListNegotiations)
      .mockRejectedValueOnce(new ApiError(0, 'Could not reach the server.'))
      .mockResolvedValueOnce(pageOf([negotiation(1)]))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verifica a tua ligação à internet.')
    await userEvent.click(screen.getByRole('button', { name: 'Tentar outra vez' }))

    expect(await screen.findByRole('article')).toBeInTheDocument()
    expect(apiListNegotiations).toHaveBeenCalledTimes(2)
  })

  it('clears the session on 401 instead of showing an error', async () => {
    vi.mocked(apiListNegotiations).mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    renderPage()

    await vi.waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('drops a slow response for filters that already changed', async () => {
    let resolveOld: (value: ApiNegotiationPage) => void = () => {}
    vi.mocked(apiListNegotiations)
      .mockReturnValueOnce(new Promise((r) => { resolveOld = r }))
      .mockResolvedValueOnce(pageOf([negotiation(2)]))
    renderPage()

    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'Aberta')
    expect(await screen.findByRole('heading', { name: 'Anúncio 2' })).toBeInTheDocument()

    resolveOld(pageOf([negotiation(1)]))
    await new Promise((r) => setTimeout(r))

    expect(screen.getByRole('heading', { name: 'Anúncio 2' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Anúncio 1' })).not.toBeInTheDocument()
  })
})
