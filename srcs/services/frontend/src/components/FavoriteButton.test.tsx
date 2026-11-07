import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import FavoriteButton, { FAVORITE_ERROR_MS } from './FavoriteButton'
import { useAuth } from '../context/AuthContext'
import { useFavorites } from '../context/FavoritesContext'
import { ApiError } from '../lib/api'

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../context/FavoritesContext', () => ({ useFavorites: vi.fn() }))

const ME = { id: 2 }
const logout = vi.fn().mockResolvedValue(undefined)
const toggleFavorite = vi.fn()

function setUp({
  user = ME as typeof ME | null,
  authLoading = false,
  ready = true,
  saved = false,
}: { user?: typeof ME | null; authLoading?: boolean; ready?: boolean; saved?: boolean } = {}) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: authLoading, logout } as unknown as ReturnType<typeof useAuth>)
  vi.mocked(useFavorites).mockReturnValue({
    ready,
    isFavorite: () => saved,
    isPending: () => false,
    toggleFavorite,
  })
}

function LoginProbe() {
  const location = useLocation()
  return <p>Login, depois {(location.state as { from: string }).from}</p>
}

function renderButton(variant: 'card' | 'detail' = 'card') {
  return render(
    <MemoryRouter initialEntries={['/?q=livros']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<FavoriteButton listingId={5} ownerId={1} title="Bicicleta" variant={variant} />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const cardButton = () => screen.getByRole('button', { name: 'Guardar nos favoritos: Bicicleta' })

describe('FavoriteButton', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset()
    vi.mocked(useFavorites).mockReset()
    toggleFavorite.mockReset().mockResolvedValue(undefined)
    logout.mockClear()
  })

  it('on a card, is a toggle that says whether the listing is saved', () => {
    setUp({ saved: true })
    renderButton()

    expect(cardButton()).toHaveAttribute('aria-pressed', 'true')
  })

  it('on a card, is not pressed for a listing that is not saved', () => {
    setUp()
    renderButton()

    expect(cardButton()).toHaveAttribute('aria-pressed', 'false')
  })

  it('on the listing page, says the state in its text', () => {
    setUp({ saved: true })
    const { unmount } = renderButton('detail')
    expect(screen.getByRole('button', { name: 'Guardado nos favoritos' })).toBeInTheDocument()
    unmount()

    setUp()
    renderButton('detail')
    expect(screen.getByRole('button', { name: 'Guardar nos favoritos' })).toBeInTheDocument()
  })

  it('is hidden on the user\'s own listing', () => {
    setUp({ user: { id: 1 } })
    renderButton()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is hidden until the session and the favorites are known', () => {
    setUp({ authLoading: true })
    const { unmount } = renderButton()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    unmount()

    setUp({ ready: false })
    renderButton()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('toggles the favorite', async () => {
    setUp()
    renderButton()

    await userEvent.click(cardButton())

    expect(toggleFavorite).toHaveBeenCalledWith(5)
  })

  it('sends a visitor to login, keeping the page and its filters, and saves nothing', async () => {
    setUp({ user: null })
    renderButton()

    await userEvent.click(cardButton())

    expect(await screen.findByText('Login, depois /?q=livros')).toBeInTheDocument()
    expect(toggleFavorite).not.toHaveBeenCalled()
  })

  it('on 401 clears the session and goes to login', async () => {
    toggleFavorite.mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    setUp()
    renderButton()

    await userEvent.click(cardButton())

    expect(await screen.findByText('Login, depois /?q=livros')).toBeInTheDocument()
    expect(logout).toHaveBeenCalled()
  })

  it('explains a failure in Portuguese, then hides it after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      toggleFavorite.mockRejectedValue(new ApiError(429, 'Too many requests.'))
      setUp()
      renderButton()

      await userEvent.click(cardButton())

      expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível guardar nos favoritos. Tenta outra vez.')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FAVORITE_ERROR_MS)
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says when the listing is no longer available', async () => {
    toggleFavorite.mockRejectedValue(new ApiError(404, 'Listing not found.'))
    setUp()
    renderButton()

    await userEvent.click(cardButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Este anúncio já não está disponível.')
  })
})
