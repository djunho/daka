import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import ListingDetail from './ListingDetail'
import { ApiError, apiCreateNegotiation, apiGetListing, type ApiListingDetail, type ApiNegotiationDetail } from '../lib/api'
import { useAuth } from '../context/AuthContext'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGetListing: vi.fn(),
  apiCreateNegotiation: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

const OWNER = { id: 1, user_name: 'Ana', avatar: null, user_location: null, is_online: false }
const VISITOR = { id: 2, user_name: 'Bia', avatar: null, user_location: null, is_online: false, email: 'b@x.io', created_at: '2026-01-01' }

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

const NEGOTIATION = { id: 20 } as ApiNegotiationDetail
const logout = vi.fn().mockResolvedValue(undefined)

function signIn(user: typeof VISITOR | null, loading = false) {
  vi.mocked(useAuth).mockReturnValue({ user, loading, logout } as unknown as ReturnType<typeof useAuth>)
}

function LoginProbe() {
  const location = useLocation()
  return <p>Login, depois {(location.state as { from: string }).from}</p>
}

function NegotiationProbe() {
  const { id } = useParams()
  return <p>Negociação {id}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/listing/5']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<p>Início</p>} />
        <Route path="/listing/:id" element={<ListingDetail />} />
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/negotiations/:id" element={<NegotiationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const findAction = () => screen.findByRole('button', { name: 'Iniciar negociação' })

describe('Iniciar negociação em ListingDetail', () => {
  beforeEach(() => {
    vi.mocked(apiGetListing).mockReset().mockResolvedValue(LISTING)
    vi.mocked(apiCreateNegotiation).mockReset()
    logout.mockClear()
  })

  it('sends a visitor to login, keeping the destination and creating nothing', async () => {
    signIn(null)
    renderPage()

    await userEvent.click(await findAction())

    expect(await screen.findByText('Login, depois /listing/5')).toBeInTheDocument()
    expect(apiCreateNegotiation).not.toHaveBeenCalled()
  })

  it('hides the action from the owner', async () => {
    signIn({ ...VISITOR, id: OWNER.id })
    renderPage()

    expect(await screen.findByText('Este é o teu anúncio.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar negociação' })).not.toBeInTheDocument()
  })

  it('hides the action until the session check finishes', async () => {
    signIn(null, true)
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Bicicleta' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar negociação' })).not.toBeInTheDocument()
  })

  it('creates or reuses the negotiation and opens it', async () => {
    signIn(VISITOR)
    vi.mocked(apiCreateNegotiation).mockResolvedValue(NEGOTIATION)
    renderPage()

    await userEvent.click(await findAction())

    expect(await screen.findByText('Negociação 20')).toBeInTheDocument()
    expect(apiCreateNegotiation).toHaveBeenCalledWith(5)
  })

  it('sends one request for repeated clicks and shows that it is working', async () => {
    signIn(VISITOR)
    vi.mocked(apiCreateNegotiation).mockReturnValue(new Promise(() => {}))
    renderPage()

    await userEvent.dblClick(await findAction())

    expect(apiCreateNegotiation).toHaveBeenCalledTimes(1)
    const busy = screen.getByRole('button', { name: 'A abrir negociação…' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
  })

  it('does not pull the user away if they left before the response', async () => {
    signIn(VISITOR)
    let resolve: (value: ApiNegotiationDetail) => void = () => {}
    vi.mocked(apiCreateNegotiation).mockReturnValue(new Promise((r) => { resolve = r }))
    renderPage()

    await userEvent.click(await findAction())
    await userEvent.click(screen.getByRole('link', { name: 'Voltar ao início' }))
    expect(await screen.findByText('Início')).toBeInTheDocument()

    resolve(NEGOTIATION)
    await new Promise((r) => setTimeout(r))

    expect(screen.getByText('Início')).toBeInTheDocument()
    expect(screen.queryByText('Negociação 20')).not.toBeInTheDocument()
  })

  it('on 401 clears the session and goes to login, keeping the destination', async () => {
    signIn(VISITOR)
    vi.mocked(apiCreateNegotiation).mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    renderPage()

    await userEvent.click(await findAction())

    expect(await screen.findByText('Login, depois /listing/5')).toBeInTheDocument()
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('on 401 does not go to login if the user left the page during logout', async () => {
    signIn(VISITOR)
    let finishLogout = () => {}
    logout.mockImplementationOnce(() => new Promise<void>((resolve) => { finishLogout = resolve }))
    vi.mocked(apiCreateNegotiation).mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    renderPage()

    await userEvent.click(await findAction())
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('link', { name: 'Voltar ao início' }))
    expect(await screen.findByText('Início')).toBeInTheDocument()

    finishLogout()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText('Início')).toBeInTheDocument()
    expect(screen.queryByText(/^Login, depois/)).not.toBeInTheDocument()
  })

  it('on 404 shows the not found state', async () => {
    signIn(VISITOR)
    vi.mocked(apiCreateNegotiation).mockRejectedValue(new ApiError(404, 'Listing not found.'))
    renderPage()

    await userEvent.click(await findAction())

    expect(await screen.findByRole('heading', { name: 'Anúncio não encontrado' })).toBeInTheDocument()
  })

  it('on 409 explains in Portuguese, describes the button and moves the focus', async () => {
    signIn(VISITOR)
    vi.mocked(apiCreateNegotiation).mockRejectedValue(new ApiError(409, 'Listing is not available.'))
    renderPage()

    await userEvent.click(await findAction())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Este anúncio já não está disponível para negociação.')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Iniciar negociação' })).toHaveAttribute('aria-describedby', alert.id)
  })

  it('on 409 for a cancelled negotiation says it cannot be reopened', async () => {
    signIn(VISITOR)
    vi.mocked(apiCreateNegotiation).mockRejectedValue(
      new ApiError(409, 'A cancelled negotiation cannot be reopened.'),
    )
    renderPage()

    await userEvent.click(await findAction())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('A tua negociação deste anúncio foi cancelada e não pode ser reaberta.')
    expect(alert).not.toHaveTextContent('já não está disponível')
    await waitFor(() => expect(alert).toHaveFocus())
  })

  it('after a network failure lets the user try again', async () => {
    signIn(VISITOR)
    vi.mocked(apiCreateNegotiation)
      .mockRejectedValueOnce(new ApiError(0, 'Could not reach the server.'))
      .mockResolvedValueOnce(NEGOTIATION)
    renderPage()

    await userEvent.click(await findAction())
    expect(await screen.findByRole('alert')).toHaveTextContent('Verifica a tua ligação à internet.')

    await userEvent.click(await findAction())

    expect(await screen.findByText('Negociação 20')).toBeInTheDocument()
    expect(apiCreateNegotiation).toHaveBeenCalledTimes(2)
  })
})
