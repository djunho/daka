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
// The ids the mocked context says are saved, and those being sent. Change
// them and rerender to simulate a heart being emptied.
let saved = new Set<number>()
let pending = new Set<number>()
// What snapshotFavorites answers: bump it to say a favorite changed.
let snapshot = 0
// Like the real one: what the page hands over becomes saved.
const rememberFavorites = vi.fn((ids: number[]) => {
  ids.forEach((id) => saved.add(id))
})

function useMockedFavorites() {
  vi.mocked(useFavorites).mockImplementation(() => ({
    ready: true,
    isFavorite: (id: number) => saved.has(id),
    isPending: (id: number) => pending.has(id),
    toggleFavorite: vi.fn(),
    snapshotFavorites: () => snapshot,
    rememberFavorites,
  }))
}

function signIn(id: number) {
  vi.mocked(useAuth).mockReturnValue({ user: { id }, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
}

const page$ = () => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Favorites />
  </MemoryRouter>
)

function renderPage() {
  return render(page$())
}

const heart = (title: string) => screen.getByRole('button', { name: `Guardar nos favoritos: ${title}` })

describe('Favorites page', () => {
  beforeEach(() => {
    saved = new Set([1, 2])
    pending = new Set()
    snapshot = 0
    rememberFavorites.mockClear()
    signIn(2)
    useMockedFavorites()
    vi.mocked(apiGetFavorites).mockReset().mockResolvedValue(page([1, 2]))
    logout.mockClear()
  })

  it('shows a loading state, then the saved listings', async () => {
    renderPage()

    expect(screen.getByText('A carregar favoritos…')).toHaveAttribute('role', 'status')
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
    rerender(page$())

    expect(screen.queryByRole('heading', { level: 3, name: 'Anúncio 1' })).not.toBeInTheDocument()
    expect(screen.getByText('1 artigo guardado')).toBeInTheDocument()
  })

  it('keeps the cards saved on another device after login, and asks only once', async () => {
    // The context knows none of them: they were saved after it loaded.
    saved = new Set()
    const ids = Array.from({ length: 12 }, (_, i) => i + 1)
    vi.mocked(apiGetFavorites).mockResolvedValue(page(ids, 13))
    renderPage()

    expect(await screen.findByRole('heading', { level: 3, name: 'Anúncio 12' })).toBeInTheDocument()
    expect(screen.getByText('13 artigos guardados')).toBeInTheDocument()
    expect(rememberFavorites).toHaveBeenCalledWith(ids, 0)
    // Long enough for a reload loop to show.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(apiGetFavorites).toHaveBeenCalledTimes(1)
  })

  it('gives the focus to the next heart when a card leaves, and says so', async () => {
    const { rerender } = renderPage()
    await screen.findByRole('heading', { level: 3, name: 'Anúncio 1' })
    heart('Anúncio 1').focus()

    saved = new Set([2])
    rerender(page$())

    await waitFor(() => expect(heart('Anúncio 2')).toHaveFocus())
    expect(screen.getByText('«Anúncio 1» removido dos favoritos.')).toHaveAttribute('role', 'status')
  })

  it('gives the focus to the heading when the last card leaves', async () => {
    saved = new Set([1])
    vi.mocked(apiGetFavorites).mockResolvedValue(page([1]))
    const { rerender } = renderPage()
    await screen.findByRole('heading', { level: 3, name: 'Anúncio 1' })
    heart('Anúncio 1').focus()

    saved = new Set()
    rerender(page$())

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Favoritos' })).toHaveFocus())
    expect(screen.getByText(/Ainda não tens artigos guardados/)).toBeInTheDocument()
  })

  it('brings in the next favorites when every card on screen was removed', async () => {
    vi.mocked(apiGetFavorites)
      .mockResolvedValueOnce(page([1], 2))
      .mockResolvedValueOnce(page([2], 1))
    const { rerender } = renderPage()
    await screen.findByRole('heading', { level: 3, name: 'Anúncio 1' })

    saved = new Set([2])
    rerender(page$())

    expect(await screen.findByRole('heading', { level: 3, name: 'Anúncio 2' })).toBeInTheDocument()
    expect(apiGetFavorites).toHaveBeenCalledTimes(2)
  })

  it('waits for a removal under way before loading more', async () => {
    vi.mocked(apiGetFavorites).mockResolvedValue(page([1, 2], 3))
    pending = new Set([1])
    renderPage()

    expect(await screen.findByRole('button', { name: 'Carregar mais' })).toBeDisabled()
  })

  it('asks again for the next page when a card was removed while it was on its way', async () => {
    let answer!: (value: ApiListingPage) => void
    vi.mocked(apiGetFavorites)
      .mockResolvedValueOnce(page([1, 2], 3))
      .mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
      .mockResolvedValueOnce({ ...page([3], 2), offset: 1 })
    saved = new Set([1, 2, 3])
    const { rerender } = renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }))
    // Listing 1 is removed meanwhile, and the server reads its list after
    // that: from offset 2 it skips listing 3.
    saved = new Set([2, 3])
    snapshot = 2
    rerender(page$())
    answer({ items: [], total: 2, limit: 12, offset: 2 })

    expect(await screen.findByRole('heading', { level: 3, name: 'Anúncio 3' })).toBeInTheDocument()
    expect(vi.mocked(apiGetFavorites).mock.calls[2][0]).toEqual({ limit: 12, offset: 1 })
    expect(screen.getByText('2 artigos guardados')).toBeInTheDocument()
  })

  it('loads the list again when another account signs in', async () => {
    const { rerender } = renderPage()
    await screen.findByRole('heading', { level: 3, name: 'Anúncio 1' })

    vi.mocked(apiGetFavorites).mockResolvedValue(page([7]))
    signIn(3)
    rerender(page$())

    expect(await screen.findByRole('heading', { level: 3, name: 'Anúncio 7' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Anúncio 1' })).not.toBeInTheDocument()
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
