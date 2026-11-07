import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Favorites from './Favorites'
import { useAuth } from '../context/AuthContext'
import { useFavorites } from '../context/FavoritesContext'
import { ApiError, apiGetFavorites, type ApiListingPage, type ApiListingSummary } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGetFavorites: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../context/FavoritesContext', () => ({ useFavorites: vi.fn() }))

const OWNER = { id: 1, user_name: 'Ana', avatar: null, user_location: null, is_online: false }
const listing = (id: number): ApiListingSummary => ({
  id,
  title: `Anúncio ${id}`,
  category: { id: 1, category_name: 'Books' },
  condition: { id: 1, condition_name: 'Good' },
  listing_location: null,
  wish: null,
  owner: OWNER,
  cover_image: null,
  created_at: '2026-01-01T00:00:00',
})
const page = (ids: number[], total = ids.length): ApiListingPage => ({
  items: ids.map(listing),
  total,
  limit: 12,
  offset: 0,
})

const logout = vi.fn().mockResolvedValue(undefined)
// The ids the mocked context says are saved. Change it and rerender to
// simulate a heart being emptied.
let saved = new Set<number>()

function useMockedFavorites() {
  vi.mocked(useFavorites).mockImplementation(() => ({
    ready: true,
    isFavorite: (id: number) => saved.has(id),
    isPending: () => false,
    toggleFavorite: vi.fn(),
  }))
}

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Favorites />
    </MemoryRouter>,
  )
}

describe('Favorites page', () => {
  beforeEach(() => {
    saved = new Set([1, 2])
    vi.mocked(useAuth).mockReturnValue({ user: { id: 2 }, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
    useMockedFavorites()
    vi.mocked(apiGetFavorites).mockReset().mockResolvedValue(page([1, 2]))
    logout.mockClear()
  })

  it('shows a loading state, then the saved listings', async () => {
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('A carregar favoritos…')
    expect(await screen.findByRole('heading', { level: 3, name: 'Anúncio 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Anúncio 2' })).toBeInTheDocument()
    expect(screen.getByText('2 artigos guardados')).toBeInTheDocument()
  })

  it('has a friendly empty state with a way back home', async () => {
    vi.mocked(apiGetFavorites).mockResolvedValue(page([]))
    renderPage()

    expect(await screen.findByText('Ainda não tens artigos guardados nos favoritos. Explora as trocas disponíveis!')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/')
  })

  it('takes a card off the list once it is no longer a favorite', async () => {
    const { rerender } = renderPage()
    await screen.findByRole('heading', { level: 3, name: 'Anúncio 1' })

    saved = new Set([2])
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Favorites />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('heading', { level: 3, name: 'Anúncio 1' })).not.toBeInTheDocument()
    expect(screen.getByText('1 artigo guardado')).toBeInTheDocument()
  })

  it('loads more after the cards still on screen', async () => {
    vi.mocked(apiGetFavorites)
      .mockResolvedValueOnce(page([1, 2], 3))
      .mockResolvedValueOnce({ ...page([3], 3), offset: 2 })
    saved = new Set([1, 2, 3])
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }))

    expect(await screen.findByRole('heading', { level: 3, name: 'Anúncio 3' })).toBeInTheDocument()
    expect(vi.mocked(apiGetFavorites).mock.calls[1][0]).toEqual({ limit: 12, offset: 2 })
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
  })

  it('explains a failure and lets the user try again', async () => {
    vi.mocked(apiGetFavorites).mockRejectedValueOnce(new ApiError(429, 'Too many requests.'))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível carregar os favoritos. Tenta outra vez.')

    await userEvent.click(within(alert.parentElement!).getByRole('button', { name: 'Tentar outra vez' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Anúncio 1' })).toBeInTheDocument()
  })

  it('clears an expired session, so the route guard sends the user to login', async () => {
    vi.mocked(apiGetFavorites).mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    renderPage()

    await waitFor(() => expect(logout).toHaveBeenCalled())
  })
})
