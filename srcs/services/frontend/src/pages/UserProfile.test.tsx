import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import UserProfile from './UserProfile'
import {
  ApiError,
  apiAddFriend,
  apiGetFriendStatus,
  apiGetPublicProfile,
  apiRemoveFriend,
  type ApiFriend,
  type ApiFriendStatus,
  type ApiPublicProfile,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGetPublicProfile: vi.fn(),
  apiGetFriendStatus: vi.fn(),
  apiAddFriend: vi.fn(),
  apiRemoveFriend: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))

const ME = { id: 1, user_name: 'Ana', avatar: null, user_location: null, email: 'ana@x.io', created_at: '' }

function profile(overrides: Partial<ApiPublicProfile> = {}): ApiPublicProfile {
  return {
    id: 2,
    user_name: 'Bruno',
    avatar: null,
    user_location: 'Lisboa',
    is_online: true,
    last_seen: '2026-11-05T10:00:00Z',
    created_at: '2026-01-15T10:00:00',
    listings: [],
    ...overrides,
  }
}

const FRIEND: ApiFriend = { id: 2, user_name: 'Bruno', avatar: null, user_location: 'Lisboa', is_online: true, last_seen: null }

// A promise the test settles by hand, to look at the page while a request is
// still in flight.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const logout = vi.fn().mockResolvedValue(undefined)

function renderPage(entry = '/users/2') {
  return render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Link to="/users/3">Outro perfil</Link>
      <Routes>
        <Route path="/users/:id" element={<UserProfile />} />
      </Routes>
    </MemoryRouter>,
  )
}

const flush = () => act(() => new Promise((r) => setTimeout(r)))

describe('UserProfile friend button', () => {
  beforeEach(() => {
    vi.mocked(apiGetPublicProfile).mockReset().mockImplementation(async (id) => profile({ id }))
    vi.mocked(apiGetFriendStatus).mockReset().mockResolvedValue({ is_friend: false })
    vi.mocked(apiAddFriend).mockReset().mockResolvedValue(FRIEND)
    vi.mocked(apiRemoveFriend).mockReset().mockResolvedValue(undefined)
    vi.mocked(useAuth).mockReturnValue({ user: ME, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
    logout.mockClear()
  })

  it('asks for the profile and the friendship at the same time', async () => {
    renderPage()

    expect(apiGetPublicProfile).toHaveBeenCalledWith(2)
    expect(apiGetFriendStatus).toHaveBeenCalledWith(2, expect.any(AbortSignal))
    expect(await screen.findByRole('button', { name: 'Adicionar amigo' })).toBeEnabled()
  })

  it('offers to remove a friend', async () => {
    vi.mocked(apiGetFriendStatus).mockResolvedValue({ is_friend: true })
    renderPage()

    expect(await screen.findByRole('button', { name: 'Remover amigo' })).toBeEnabled()
  })

  it('shows whether the user is online', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Bruno' })
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('shows offline users as offline', async () => {
    vi.mocked(apiGetPublicProfile).mockResolvedValue(profile({ is_online: false, last_seen: null }))
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Bruno' })
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('keeps the button disabled until the friendship is known', async () => {
    const status = deferred<ApiFriendStatus>()
    vi.mocked(apiGetFriendStatus).mockReturnValue(status.promise)
    renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Bruno' })
    expect(screen.getByRole('button', { name: 'A verificar amizade…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /amigo$/ })).not.toBeInTheDocument()

    await act(async () => status.resolve({ is_friend: true }))
    expect(screen.getByRole('button', { name: 'Remover amigo' })).toBeEnabled()
  })

  it('adds and removes a friend without reloading the page', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar amigo' }))
    expect(apiAddFriend).toHaveBeenCalledWith(2)
    await userEvent.click(await screen.findByRole('button', { name: 'Remover amigo' }))
    expect(apiRemoveFriend).toHaveBeenCalledWith(2)
    expect(await screen.findByRole('button', { name: 'Adicionar amigo' })).toBeInTheDocument()
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(1)
  })

  it('blocks repeated clicks while the request is running', async () => {
    const add = deferred<ApiFriend>()
    vi.mocked(apiAddFriend).mockReturnValue(add.promise)
    renderPage()

    const button = await screen.findByRole('button', { name: 'Adicionar amigo' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(apiAddFriend).toHaveBeenCalledTimes(1)

    await act(async () => add.resolve(FRIEND))
    expect(screen.getByRole('button', { name: 'Remover amigo' })).toBeEnabled()
  })

  it('has no button and does not ask for the friendship on your own profile', async () => {
    vi.mocked(apiGetPublicProfile).mockResolvedValue(profile({ id: 1, user_name: 'Ana' }))
    renderPage('/users/1')

    expect(await screen.findByRole('link', { name: 'Editar o meu perfil' })).toBeInTheDocument()
    expect(apiGetFriendStatus).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /amigo|amizade/ })).not.toBeInTheDocument()
  })

  it('keeps the profile when only the friendship request fails, and retries', async () => {
    vi.mocked(apiGetFriendStatus)
      .mockRejectedValueOnce(new ApiError(500, 'Server error'))
      .mockResolvedValueOnce({ is_friend: true })
    renderPage()

    expect(await screen.findByText('Não foi possível verificar a amizade.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Bruno' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Tentar outra vez' }))
    expect(await screen.findByRole('button', { name: 'Remover amigo' })).toBeInTheDocument()
    expect(apiGetFriendStatus).toHaveBeenCalledTimes(2)
  })

  it('treats 409 on add as already friends', async () => {
    vi.mocked(apiAddFriend).mockRejectedValue(new ApiError(409, 'User is already in your friends list.'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar amigo' }))
    expect(await screen.findByRole('button', { name: 'Remover amigo' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('treats 404 on remove as no longer friends', async () => {
    vi.mocked(apiGetFriendStatus).mockResolvedValue({ is_friend: true })
    vi.mocked(apiRemoveFriend).mockRejectedValue(new ApiError(404, 'User is not in your friends list.'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Remover amigo' }))
    expect(await screen.findByRole('button', { name: 'Adicionar amigo' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the not found page when the user is gone on add', async () => {
    vi.mocked(apiAddFriend).mockRejectedValue(new ApiError(404, 'User not found.'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar amigo' }))
    expect(await screen.findByText('Utilizador não encontrado')).toBeInTheDocument()
  })

  it('shows a short message for other errors and keeps the button', async () => {
    vi.mocked(apiAddFriend).mockRejectedValue(new ApiError(500, 'Server error'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar amigo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocorreu um erro no servidor.')
    expect(screen.getByRole('button', { name: 'Adicionar amigo' })).toBeEnabled()
  })

  it('ends the session on 401', async () => {
    vi.mocked(apiAddFriend).mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar amigo' }))
    await flush()
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('scrolls to the listings when opened from "Ver anúncios"', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    renderPage('/users/2#anuncios')

    // The scroll runs in an effect after the profile renders.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView.mock.contexts[0]).toHaveAttribute('id', 'anuncios')
  })

  it('cancels the friendship request when moving to another profile', async () => {
    vi.mocked(apiGetFriendStatus).mockReturnValueOnce(deferred<ApiFriendStatus>().promise)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Bruno' })
    const first = vi.mocked(apiGetFriendStatus).mock.calls[0][1] as AbortSignal
    expect(first.aborted).toBe(false)

    await userEvent.click(screen.getByRole('link', { name: 'Outro perfil' }))

    expect(first.aborted).toBe(true)
    expect(await screen.findByRole('button', { name: 'Adicionar amigo' })).toBeEnabled()
  })

  it('cancels the failed request before trying again', async () => {
    vi.mocked(apiGetFriendStatus)
      .mockRejectedValueOnce(new ApiError(500, 'Server error'))
      .mockResolvedValueOnce({ is_friend: true })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Tentar outra vez' }))

    expect(await screen.findByRole('button', { name: 'Remover amigo' })).toBeInTheDocument()
    const [first, second] = vi.mocked(apiGetFriendStatus).mock.calls.map((call) => call[1] as AbortSignal)
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)
  })

  it('ignores answers that arrive after moving to another profile', async () => {
    const add = deferred<ApiFriend>()
    vi.mocked(apiAddFriend).mockReturnValue(add.promise)
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar amigo' }))
    await userEvent.click(screen.getByRole('link', { name: 'Outro perfil' }))
    await screen.findByRole('heading', { level: 1, name: 'Bruno' })
    expect(await screen.findByRole('button', { name: 'Adicionar amigo' })).toBeEnabled()
    expect(apiGetFriendStatus).toHaveBeenLastCalledWith(3, expect.any(AbortSignal))

    // The add for user 2 finishes late: user 3 must still show "Adicionar".
    await act(async () => add.resolve(FRIEND))
    expect(screen.getByRole('button', { name: 'Adicionar amigo' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Remover amigo' })).not.toBeInTheDocument()
  })
})
