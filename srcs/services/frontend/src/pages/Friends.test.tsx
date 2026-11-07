import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import App from '../App'
import Friends, { FRIENDS_REFRESH_MS } from './Friends'
import {
  ApiError,
  apiGetFriends,
  apiRemoveFriend,
  type ApiFriend,
  type ApiFriendPage,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGetFriends: vi.fn(),
  apiRemoveFriend: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const ME = { id: 1, user_name: 'Ana', avatar: null, user_location: null, email: 'ana@x.io', created_at: '' }

function friend(id: number, user_name: string, overrides: Partial<ApiFriend> = {}): ApiFriend {
  return { id, user_name, avatar: null, user_location: null, is_online: false, last_seen: null, ...overrides }
}

function page(items: ApiFriend[], overrides: Partial<ApiFriendPage> = {}): ApiFriendPage {
  return { items, total: items.length, limit: 20, offset: 0, ...overrides }
}

const BRUNO = friend(2, 'Bruno', { is_online: true, user_location: 'Lisboa' })
const CARLA = friend(3, 'Carla')

const logout = vi.fn().mockResolvedValue(undefined)

function renderPage(entry = '/friends') {
  return render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Link to="/friends?page=3">Página três</Link>
      <Routes>
        <Route path="/friends" element={<Friends />} />
        <Route path="/users/:id" element={<p>Perfil aberto</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

// The card of one friend, found by the link with their name.
function card(name: string) {
  return screen.getByRole('link', { name }).closest('article') as HTMLElement
}

let visibility: DocumentVisibilityState

// jsdom has no native dialog methods. The stand-ins are put back as they were
// after each test, so nothing leaks into other tests.
const { showModal, close } = HTMLDialogElement.prototype

describe('Friends', () => {
  afterEach(() => {
    HTMLDialogElement.prototype.showModal = showModal
    HTMLDialogElement.prototype.close = close
  })

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() { this.open = true }
    HTMLDialogElement.prototype.close = function close() { this.open = false }
    vi.mocked(apiGetFriends).mockReset().mockResolvedValue(page([BRUNO, CARLA]))
    vi.mocked(apiRemoveFriend).mockReset().mockResolvedValue(undefined)
    vi.mocked(useAuth).mockReturnValue({ user: ME, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
    logout.mockClear()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  })

  it('shows loading, then each friend with their online state and links', async () => {
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('A carregar amigos…')

    expect(await screen.findByText('2 amigos')).toBeInTheDocument()
    expect(apiGetFriends).toHaveBeenCalledWith({ limit: 20, offset: 0 }, expect.any(AbortSignal))

    const bruno = card('Bruno')
    expect(within(bruno).getByRole('link', { name: 'Bruno' })).toHaveAttribute('href', '/users/2')
    expect(within(bruno).getByRole('link', { name: 'Ver anúncios de Bruno' })).toHaveAttribute('href', '/users/2#anuncios')
    expect(within(bruno).getByText('Lisboa')).toBeInTheDocument()
    // The avatar dot and the label both say it, for screen readers too.
    expect(within(bruno).getAllByText('Online').length).toBeGreaterThan(0)
    expect(within(card('Carla')).getAllByText('Offline').length).toBeGreaterThan(0)
  })

  it('keeps the order the backend sends (online first)', async () => {
    vi.mocked(apiGetFriends).mockResolvedValue(page([BRUNO, CARLA]))
    renderPage()

    await screen.findByText('2 amigos')
    const names = screen.getAllByRole('article').map((article) => within(article).getAllByRole('link')[0].textContent)
    expect(names).toEqual(['Bruno', 'Carla'])
  })

  it('explains when there are no friends yet', async () => {
    vi.mocked(apiGetFriends).mockResolvedValue(page([]))
    renderPage()

    expect(await screen.findByText('Ainda não tens amigos. Visita o perfil de alguém para o adicionares.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explorar anúncios' })).toHaveAttribute('href', '/')
  })

  it('asks for confirmation and takes the friend off the list', async () => {
    renderPage()
    await screen.findByText('2 amigos')
    vi.mocked(apiGetFriends).mockResolvedValue(page([CARLA]))

    await userEvent.click(screen.getByRole('button', { name: 'Remover Bruno dos amigos' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Tens a certeza de que queres remover Bruno dos teus amigos? A amizade termina para os dois.')
    expect(apiRemoveFriend).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Sim, remover' }))
    expect(apiRemoveFriend).toHaveBeenCalledWith(2)
    expect(screen.queryByRole('link', { name: 'Bruno' })).not.toBeInTheDocument()
    expect(await screen.findByText('1 amigo')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open')
  })

  it('keeps the friend when the confirmation is cancelled', async () => {
    renderPage()
    await screen.findByText('2 amigos')

    await userEvent.click(screen.getByRole('button', { name: 'Remover Bruno dos amigos' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(apiRemoveFriend).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Bruno' })).toBeInTheDocument()
  })

  it('also takes the friend off the list on 404 (already removed)', async () => {
    vi.mocked(apiRemoveFriend).mockRejectedValue(new ApiError(404, 'User is not in your friends list.'))
    renderPage()
    await screen.findByText('2 amigos')
    vi.mocked(apiGetFriends).mockResolvedValue(page([CARLA]))

    await userEvent.click(screen.getByRole('button', { name: 'Remover Bruno dos amigos' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sim, remover' }))
    expect(screen.queryByRole('link', { name: 'Bruno' })).not.toBeInTheDocument()
  })

  it('does nothing with a removal that answers after leaving the page', async () => {
    let answerRemove!: () => void
    vi.mocked(apiRemoveFriend).mockReturnValue(new Promise<void>((resolve) => { answerRemove = resolve }))
    const { unmount } = renderPage()
    await screen.findByText('2 amigos')

    await userEvent.click(screen.getByRole('button', { name: 'Remover Bruno dos amigos' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sim, remover' }))
    expect(apiRemoveFriend).toHaveBeenCalledWith(BRUNO.id)

    // The person goes Back while the removal is still running.
    unmount()
    await act(async () => answerRemove())

    // No refresh of a page that is gone.
    expect(apiGetFriends).toHaveBeenCalledTimes(1)
  })

  it('shows other removal errors in the dialog and keeps the friend', async () => {
    vi.mocked(apiRemoveFriend).mockRejectedValue(new ApiError(500, 'Server error'))
    renderPage()
    await screen.findByText('2 amigos')

    await userEvent.click(screen.getByRole('button', { name: 'Remover Bruno dos amigos' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sim, remover' }))
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Ocorreu um erro no servidor.')
    expect(screen.getByRole('link', { name: 'Bruno' })).toBeInTheDocument()
  })

  it('ends the session on 401', async () => {
    vi.mocked(apiGetFriends).mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    renderPage()
    await act(() => new Promise((r) => setTimeout(r)))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('shows a load error with a retry', async () => {
    vi.mocked(apiGetFriends)
      .mockRejectedValueOnce(new ApiError(500, 'Server error'))
      .mockResolvedValueOnce(page([BRUNO]))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocorreu um erro no servidor.')
    await userEvent.click(screen.getByRole('button', { name: 'Tentar outra vez' }))
    expect(await screen.findByText('1 amigo')).toBeInTheDocument()
  })

  it('asks for the right offset and moves between pages', async () => {
    vi.mocked(apiGetFriends).mockResolvedValue(page([BRUNO], { total: 41, offset: 20 }))
    renderPage('/friends?page=2')

    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument()
    expect(apiGetFriends).toHaveBeenLastCalledWith({ limit: 20, offset: 20 }, expect.any(AbortSignal))

    await userEvent.click(screen.getByRole('button', { name: 'Seguinte' }))
    expect(apiGetFriends).toHaveBeenLastCalledWith({ limit: 20, offset: 40 }, expect.any(AbortSignal))
  })

  it('goes back a page when the last friend on it is removed', async () => {
    vi.mocked(apiGetFriends).mockResolvedValue(page([CARLA], { total: 21, offset: 20 }))
    renderPage('/friends?page=2')
    await screen.findByText(/^Página 2 de 2/)
    vi.mocked(apiGetFriends).mockResolvedValue(page([BRUNO], { total: 20 }))

    await userEvent.click(screen.getByRole('button', { name: 'Remover Carla dos amigos' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sim, remover' }))
    expect(await screen.findByText('Página 1 de 1 · Não há mais resultados.')).toBeInTheDocument()
    expect(apiGetFriends).toHaveBeenLastCalledWith({ limit: 20, offset: 0 }, expect.any(AbortSignal))
  })

  it('cancels the previous request when the page changes', async () => {
    vi.mocked(apiGetFriends).mockResolvedValue(page([BRUNO], { total: 41 }))
    renderPage()
    await screen.findByText('Página 1 de 3')

    // Page 2 never answers; going to page 3 must cancel it.
    vi.mocked(apiGetFriends).mockReturnValueOnce(new Promise(() => {}))
    await userEvent.click(screen.getByRole('button', { name: 'Seguinte' }))
    await userEvent.click(screen.getByRole('link', { name: 'Página três' }))

    const calls = vi.mocked(apiGetFriends).mock.calls
    expect(calls.map((call) => call[0]?.offset)).toEqual([0, 20, 40])
    expect(calls[1][1]!.aborted).toBe(true)
    expect(calls[2][1]!.aborted).toBe(false)
  })

  describe('background refresh', () => {
    // findBy* waits with setTimeout, which the fake timers freeze, so these
    // tests advance the fake clock inside act() and then read the screen.
    async function advance(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('updates the online state on every refresh', async () => {
      renderPage()
      await advance(0)
      expect(screen.getByText('2 amigos')).toBeInTheDocument()

      vi.mocked(apiGetFriends).mockResolvedValue(page([BRUNO, { ...CARLA, is_online: true }]))
      await advance(FRIENDS_REFRESH_MS)
      expect(apiGetFriends).toHaveBeenCalledTimes(2)
      expect(within(card('Carla')).getAllByText('Online').length).toBeGreaterThan(0)
      // A silent refresh: no loading message in between.
      expect(screen.queryByText('A carregar amigos…')).not.toBeInTheDocument()
    })

    it('keeps the list on screen when a refresh fails', async () => {
      renderPage()
      await advance(0)

      vi.mocked(apiGetFriends).mockRejectedValue(new ApiError(500, 'Server error'))
      await advance(FRIENDS_REFRESH_MS)
      expect(apiGetFriends).toHaveBeenCalledTimes(2)
      expect(screen.getByText('2 amigos')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('does not refresh while the tab is hidden', async () => {
      renderPage()
      await advance(0)

      visibility = 'hidden'
      await advance(FRIENDS_REFRESH_MS * 3)
      expect(apiGetFriends).toHaveBeenCalledTimes(1)

      visibility = 'visible'
      await advance(FRIENDS_REFRESH_MS)
      expect(apiGetFriends).toHaveBeenCalledTimes(2)
    })

    it('cancels a refresh already running when the removal dialog opens', async () => {
      renderPage()
      await advance(0)

      // The refresh starts and has not answered yet.
      let answerRefresh!: (value: ApiFriendPage) => void
      vi.mocked(apiGetFriends).mockReturnValueOnce(new Promise((resolve) => { answerRefresh = resolve }))
      await advance(FRIENDS_REFRESH_MS)
      const refresh = vi.mocked(apiGetFriends).mock.calls[1][1]!
      expect(refresh.aborted).toBe(false)

      act(() => screen.getByRole('button', { name: 'Remover Bruno dos amigos' }).click())
      expect(refresh.aborted).toBe(true)

      // Its late answer, without Carla, does not change the list under the dialog.
      await act(async () => answerRefresh(page([BRUNO])))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Carla' })).toBeInTheDocument()
    })

    it('drops a refresh that still lists a friend removed meanwhile', async () => {
      renderPage()
      await advance(0)

      // The refresh starts and answers late, still with Bruno in it.
      let answerRefresh!: (value: ApiFriendPage) => void
      vi.mocked(apiGetFriends).mockReturnValueOnce(new Promise((resolve) => { answerRefresh = resolve }))
      await advance(FRIENDS_REFRESH_MS)

      vi.mocked(apiGetFriends).mockResolvedValue(page([CARLA]))
      act(() => screen.getByRole('button', { name: 'Remover Bruno dos amigos' }).click())
      act(() => within(screen.getByRole('dialog')).getByRole('button', { name: 'Sim, remover' }).click())
      await advance(0)
      expect(screen.queryByRole('link', { name: 'Bruno' })).not.toBeInTheDocument()

      await act(async () => answerRefresh(page([BRUNO, CARLA])))
      expect(screen.queryByRole('link', { name: 'Bruno' })).not.toBeInTheDocument()
    })
  })
})

describe('Friends route and menu', () => {
  beforeEach(() => {
    vi.mocked(apiGetFriends).mockReset().mockResolvedValue(page([BRUNO]))
    // The layout scrolls to the top on navigation; jsdom has no scrolling.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  afterEach(() => {
    window.history.pushState({}, '', '/')
    vi.mocked(window.scrollTo).mockRestore()
  })

  it('links to the friends page from the account menu', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: ME, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
    window.history.pushState({}, '', '/friends')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Amigos' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Menu da conta' }))
    expect(screen.getByRole('menuitem', { name: 'Amigos' })).toHaveAttribute('href', '/friends')
  })

  it('sends a logged-out visitor to the login page', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
    window.history.pushState({}, '', '/friends')
    render(<App />)

    await act(() => new Promise((r) => setTimeout(r)))
    expect(window.location.pathname).toBe('/login')
    expect(apiGetFriends).not.toHaveBeenCalled()
  })
})
