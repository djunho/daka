import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavoritesProvider, useFavorites } from './FavoritesContext'
import { useAuth } from './AuthContext'
import {
  ApiError,
  apiAddFavorite,
  apiGetFavorites,
  apiRemoveFavorite,
  type ApiListingPage,
  type ApiListingSummary,
} from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGetFavorites: vi.fn(),
  apiAddFavorite: vi.fn(),
  apiRemoveFavorite: vi.fn(),
}))
vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const listing = (id: number) => ({ id }) as ApiListingSummary
const page = (ids: number[], total = ids.length, offset = 0): ApiListingPage => ({
  items: ids.map(listing),
  total,
  limit: 100,
  offset,
})

function signIn(id: number | null) {
  vi.mocked(useAuth).mockReturnValue({ user: id === null ? null : { id } } as unknown as ReturnType<typeof useAuth>)
}

// The error the last toggleFavorite threw, if any.
let lastError: unknown = null

// Shows the state of listings 1 and 2, with a button to toggle each.
function Probe() {
  const { ready, isFavorite, isPending, toggleFavorite } = useFavorites()
  if (!ready) return <p>A carregar</p>
  return (
    <>
      {[1, 2].map((id) => (
        <button
          key={id}
          onClick={() => {
            toggleFavorite(id).catch((err: unknown) => {
              lastError = err
            })
          }}
        >
          {`${id}: ${isFavorite(id) ? 'guardado' : 'não guardado'}${isPending(id) ? ' (a enviar)' : ''}`}
        </button>
      ))}
    </>
  )
}

function renderProvider() {
  return render(
    <FavoritesProvider>
      <Probe />
    </FavoritesProvider>,
  )
}

describe('FavoritesContext', () => {
  beforeEach(() => {
    lastError = null
    vi.mocked(apiGetFavorites).mockReset().mockResolvedValue(page([1]))
    vi.mocked(apiAddFavorite).mockReset().mockResolvedValue(undefined)
    vi.mocked(apiRemoveFavorite).mockReset().mockResolvedValue(undefined)
  })

  it('asks nothing for a visitor, who has nothing to wait for', () => {
    signIn(null)
    renderProvider()

    expect(screen.getByRole('button', { name: '1: não guardado' })).toBeInTheDocument()
    expect(apiGetFavorites).not.toHaveBeenCalled()
  })

  it('is not ready until the favorites of the user are known', async () => {
    signIn(7)
    renderProvider()

    expect(screen.getByText('A carregar')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '1: guardado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2: não guardado' })).toBeInTheDocument()
  })

  it('reads every page of favorites', async () => {
    vi.mocked(apiGetFavorites)
      .mockResolvedValueOnce(page([1], 2))
      .mockResolvedValueOnce(page([2], 2, 1))
    signIn(7)
    renderProvider()

    expect(await screen.findByRole('button', { name: '2: guardado' })).toBeInTheDocument()
    expect(vi.mocked(apiGetFavorites).mock.calls.map((call) => call[0])).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 1 },
    ])
  })

  it('stays not ready when the favorites cannot be loaded', async () => {
    vi.mocked(apiGetFavorites).mockRejectedValue(new ApiError(500, 'Server error'))
    signIn(7)
    renderProvider()

    await waitFor(() => expect(apiGetFavorites).toHaveBeenCalled())
    expect(screen.getByText('A carregar')).toBeInTheDocument()
  })

  it('changes the heart at once and sends one request for repeated clicks', async () => {
    const add = deferred<void>()
    vi.mocked(apiAddFavorite).mockReturnValue(add.promise)
    signIn(7)
    renderProvider()

    const button = await screen.findByRole('button', { name: '2: não guardado' })
    await userEvent.click(button)
    expect(button).toHaveTextContent('2: guardado (a enviar)')
    await userEvent.click(button)

    add.resolve()
    await waitFor(() => expect(button).toHaveTextContent('2: guardado'))
    expect(button).not.toHaveTextContent('a enviar')
    expect(apiAddFavorite).toHaveBeenCalledTimes(1)
    expect(apiAddFavorite).toHaveBeenCalledWith(2)
  })

  it('removes a favorite', async () => {
    signIn(7)
    renderProvider()

    await userEvent.click(await screen.findByRole('button', { name: '1: guardado' }))

    expect(await screen.findByRole('button', { name: '1: não guardado' })).toBeInTheDocument()
    expect(apiRemoveFavorite).toHaveBeenCalledWith(1)
  })

  it('puts the heart back and passes the error on when the request fails', async () => {
    const error = new ApiError(500, 'Server error')
    vi.mocked(apiAddFavorite).mockRejectedValue(error)
    signIn(7)
    renderProvider()

    await userEvent.click(await screen.findByRole('button', { name: '2: não guardado' }))

    expect(await screen.findByRole('button', { name: '2: não guardado' })).toBeInTheDocument()
    expect(lastError).toBe(error)
  })

  it('accepts what another tab already did', async () => {
    vi.mocked(apiAddFavorite).mockRejectedValue(new ApiError(409, 'Listing is already in your favorites.'))
    vi.mocked(apiRemoveFavorite).mockRejectedValue(new ApiError(404, 'Favorite not found.'))
    signIn(7)
    renderProvider()

    await userEvent.click(await screen.findByRole('button', { name: '2: não guardado' }))
    await userEvent.click(screen.getByRole('button', { name: /^1: guardado/ }))

    expect(await screen.findByRole('button', { name: '2: guardado' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '1: não guardado' })).toBeInTheDocument()
    expect(lastError).toBeNull()
  })

  it('treats the other 409 (your own listing) as a failure', async () => {
    vi.mocked(apiAddFavorite).mockRejectedValue(new ApiError(409, 'You cannot favorite your own listing.'))
    signIn(7)
    renderProvider()

    await userEvent.click(await screen.findByRole('button', { name: '2: não guardado' }))

    expect(await screen.findByRole('button', { name: '2: não guardado' })).toBeInTheDocument()
    expect(lastError).toBeInstanceOf(ApiError)
  })

  it('forgets the favorites of the previous account', async () => {
    signIn(7)
    const { rerender } = renderProvider()
    expect(await screen.findByRole('button', { name: '1: guardado' })).toBeInTheDocument()

    const next = deferred<ApiListingPage>()
    vi.mocked(apiGetFavorites).mockReturnValue(next.promise)
    signIn(8)
    rerender(
      <FavoritesProvider>
        <Probe />
      </FavoritesProvider>,
    )

    // Never the previous account's hearts, not even for one render.
    expect(screen.getByText('A carregar')).toBeInTheDocument()
    next.resolve(page([2]))
    expect(await screen.findByRole('button', { name: '1: não guardado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2: guardado' })).toBeInTheDocument()
  })

  it('fails loudly outside its provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('useFavorites must be used inside <FavoritesProvider>')
    vi.mocked(console.error).mockRestore()
  })
})
