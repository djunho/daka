import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NegotiationsDock from './NegotiationsDock'
import {
  ApiError,
  apiListNegotiations,
  type ApiNegotiationPage,
  type ApiNegotiationState,
  type ApiNegotiationSummary,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiListNegotiations: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../context/ChatContext', () => ({ useChat: vi.fn() }))

const ME = { id: 1, user_name: 'Ana', avatar: null, user_location: null, is_online: true, email: 'a@x.io', created_at: '2026-01-01' }
const OTHER = { id: 2, user_name: 'Bruno', avatar: null, user_location: null, is_online: true }
const logout = vi.fn().mockResolvedValue(undefined)
const openChat = vi.fn()

function negotiation(id: number, state: ApiNegotiationState['state_name'] = 'Open', updated_at = '2026-03-05T12:00:00'): ApiNegotiationSummary {
  return {
    id,
    requested_listing: {
      id,
      title: `Anúncio ${id}`,
      category: { id: 1, category_name: 'Books' },
      condition: { id: 1, condition_name: 'Good' },
      listing_location: null,
      wish: null,
      owner: ME,
      cover_image: null,
      created_at: '2026-01-01T00:00:00',
    },
    other_participant: OTHER,
    state: { id: 1, state_name: state },
    active_proposal: null,
    created_at: '2026-01-01T00:00:00',
    updated_at,
  }
}

const pageOf = (items: ApiNegotiationSummary[], total = items.length): ApiNegotiationPage => ({ items, total, limit: 15, offset: 0 })

// The dock asks for Open and Agreed separately
function listByState(open: ApiNegotiationPage, agreed: ApiNegotiationPage) {
  vi.mocked(apiListNegotiations).mockImplementation((params) =>
    Promise.resolve(params?.state === 'Agreed' ? agreed : open),
  )
}

function setUser(user: typeof ME | null) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout } as unknown as ReturnType<typeof useAuth>)
}

// A fresh element each time: React skips re-rendering an identical element reference.
const dock = () => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <NegotiationsDock />
  </MemoryRouter>
)
const renderDock = () => render(dock())
const flush = () => act(() => new Promise((r) => setTimeout(r)))
const openDrawer = () => fireEvent.click(screen.getByRole('button', { name: /Abrir gaveta de negociações/ }))

describe('NegotiationsDock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setUser(ME)
    vi.mocked(useChat).mockReturnValue({ activeChat: null, openChat, closeChat: vi.fn(), isChatOpen: () => false })
    listByState(pageOf([negotiation(7, 'Open', '2026-03-04T12:00:00')]), pageOf([negotiation(8, 'Agreed', '2026-03-05T12:00:00')]))
  })

  it('renders nothing and requests nothing for a visitor', () => {
    setUser(null)
    const { container } = renderDock()
    expect(container).toBeEmptyDOMElement()
    expect(apiListNegotiations).not.toHaveBeenCalled()
  })

  it('loads the active negotiations on mount and lists them, most recently updated first', async () => {
    renderDock()
    await flush()
    expect(apiListNegotiations).toHaveBeenCalledWith({ state: 'Open', limit: 15 }, expect.any(AbortSignal))
    expect(apiListNegotiations).toHaveBeenCalledWith({ state: 'Agreed', limit: 15 }, expect.any(AbortSignal))

    openDrawer()
    const titles = screen.getAllByText(/^Anúncio \d+$/).map((el) => el.textContent)
    expect(titles).toEqual(['Anúncio 8', 'Anúncio 7'])
    // The other participant's presence comes with the list
    expect(screen.getAllByText('Online')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Ver todas as negociações' })).toHaveAttribute('href', '/negotiations')
  })

  it('counts from the server totals, not from the cards it shows', async () => {
    listByState(pageOf([negotiation(7)], 20), pageOf([], 3))
    renderDock()
    await flush()
    expect(screen.getByRole('button', { name: 'Abrir gaveta de negociações, 23 negociações ativas' })).toBeInTheDocument()

    openDrawer()
    expect(screen.getByText('23')).toBeInTheDocument()
    expect(screen.getAllByText(/^Anúncio \d+$/)).toHaveLength(1)
  })

  it('lists exactly the newest active negotiations across both states', async () => {
    // 15 older Open ones, and 2 Agreed ones newer than all of them
    const open = Array.from({ length: 15 }, (_, i) => negotiation(100 + i, 'Open', `2026-02-${String(10 + i).padStart(2, '0')}T12:00:00`))
    const agreed = [negotiation(200, 'Agreed', '2026-03-01T12:00:00'), negotiation(201, 'Agreed', '2026-03-02T12:00:00')]
    listByState(pageOf(open, 20), pageOf(agreed, 2))
    renderDock()
    await flush()
    openDrawer()

    const titles = screen.getAllByText(/^Anúncio \d+$/).map((el) => el.textContent)
    expect(titles).toHaveLength(15)
    expect(titles.slice(0, 2)).toEqual(['Anúncio 201', 'Anúncio 200'])
    // The two oldest Open ones are not among the newest 15
    expect(titles).not.toContain('Anúncio 100')
    expect(titles).not.toContain('Anúncio 101')
    expect(screen.getByRole('button', { name: 'Minimizar negociações' })).toBeInTheDocument()
  })

  it('clears the previous cards when a later load fails', async () => {
    renderDock()
    await flush()
    openDrawer()
    // Opening the drawer reloads; "Atualizar" is disabled until that load ends
    await flush()
    expect(screen.getByText('Anúncio 7')).toBeInTheDocument()

    vi.mocked(apiListNegotiations).mockImplementation((params) =>
      params?.state === 'Agreed' ? Promise.reject(new ApiError(500, 'boom')) : Promise.resolve(pageOf([negotiation(7)])),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar negociações' }))
    await flush()
    expect(screen.getByText('Não foi possível carregar as negociações.')).toBeInTheDocument()
    expect(screen.queryByText('Anúncio 7')).not.toBeInTheDocument()

    // Closed again, the button says the count is unknown rather than zero
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar negociações' }))
    expect(
      screen.getByRole('button', { name: 'Abrir gaveta de negociações, não foi possível carregar as negociações' }),
    ).toHaveTextContent('!')
  })

  it('shows a negotiation once even if it moved between states during the load', async () => {
    listByState(pageOf([negotiation(7, 'Open', '2026-03-04T12:00:00')]), pageOf([negotiation(7, 'Agreed', '2026-03-05T12:00:00')]))
    renderDock()
    await flush()
    openDrawer()
    await flush()
    expect(screen.getAllByText('Anúncio 7')).toHaveLength(1)
  })

  it('offers the full list even when nothing is active', async () => {
    listByState(pageOf([]), pageOf([]))
    renderDock()
    await flush()
    openDrawer()
    await flush()
    expect(screen.getByText('Sem negociações ativas')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver todas as negociações' })).toBeInTheDocument()
  })

  it('opens the chat of a card and collapses the drawer', async () => {
    renderDock()
    await flush()
    openDrawer()

    fireEvent.click(screen.getAllByRole('button', { name: 'Chat' })[0])

    expect(openChat).toHaveBeenCalledWith(8, expect.objectContaining({ id: 2, user_name: 'Bruno' }), false)
    expect(screen.queryByText('Anúncio 8')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Abrir gaveta de negociações/ })).toBeInTheDocument()
  })

  it('announces the active count on the trigger, with the singular form', async () => {
    listByState(pageOf([negotiation(7)]), pageOf([]))
    renderDock()
    await flush()
    expect(screen.getByRole('button', { name: 'Abrir gaveta de negociações, 1 negociação ativa' })).toBeInTheDocument()

    listByState(pageOf([negotiation(7)]), pageOf([negotiation(9, 'Agreed')]))
    openDrawer()
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar negociações' }))
    expect(screen.getByRole('button', { name: 'Abrir gaveta de negociações, 2 negociações ativas' })).toBeInTheDocument()
  })

  it('marks the card of the open chat in European Portuguese', async () => {
    vi.mocked(useChat).mockReturnValue({
      activeChat: { negotiationId: 7, interlocutorId: 2, interlocutorName: 'Bruno' },
      openChat,
      closeChat: vi.fn(),
      isChatOpen: (id) => id === 7,
    })
    renderDock()
    await flush()
    openDrawer()

    expect(screen.getByRole('button', { name: 'A conversar' })).toBeInTheDocument()
    expect(screen.queryByText('Conversando')).not.toBeInTheDocument()
  })

  it('aborts both requests in flight when unmounted', () => {
    vi.mocked(apiListNegotiations).mockReturnValue(new Promise(() => {}))
    const { unmount } = renderDock()
    const calls = vi.mocked(apiListNegotiations).mock.calls
    const signal = calls[0][1] as AbortSignal
    expect(signal.aborted).toBe(false)
    // One controller for both states, so one abort cancels the whole load
    expect(calls[1][1]).toBe(signal)

    unmount()
    expect(signal.aborted).toBe(true)
  })

  it('drops a response that arrives after logout instead of repopulating the list', async () => {
    let resolve!: (page: ApiNegotiationPage) => void
    vi.mocked(apiListNegotiations).mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const { rerender } = renderDock()
    const signal = vi.mocked(apiListNegotiations).mock.calls[0][1] as AbortSignal

    setUser(null)
    rerender(dock())
    expect(signal.aborted).toBe(true)

    // The old account's response lands after signing out
    resolve(pageOf([negotiation(7)]))
    await flush()

    // Someone signs in again; their own loads (mount and drawer open) stay pending
    setUser(ME)
    vi.mocked(apiListNegotiations).mockReturnValue(new Promise(() => {}))
    rerender(dock())
    openDrawer()
    await flush()

    expect(screen.queryByText('Anúncio 7')).not.toBeInTheDocument()
    expect(screen.getByText('A carregar negociações...')).toBeInTheDocument()
  })

  it('signs out when the list answers 401', async () => {
    vi.mocked(apiListNegotiations).mockRejectedValueOnce(new ApiError(401, 'Not authenticated'))
    renderDock()
    await flush()
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('signs out when one state fails first and the other answers 401 later', async () => {
    let rejectAgreed!: (err: Error) => void
    vi.mocked(apiListNegotiations).mockImplementation((params) =>
      params?.state === 'Agreed'
        ? new Promise((_resolve, reject) => { rejectAgreed = reject })
        : Promise.reject(new ApiError(500, 'boom')),
    )
    renderDock()
    await flush()
    // Nothing decided yet: the Agreed request is still running
    expect(logout).not.toHaveBeenCalled()

    await act(async () => {
      rejectAgreed(new ApiError(401, 'Not authenticated'))
    })
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('shows an error when one of the two states cannot be loaded', async () => {
    vi.mocked(apiListNegotiations).mockImplementation((params) =>
      params?.state === 'Agreed' ? Promise.reject(new ApiError(500, 'boom')) : Promise.resolve(pageOf([negotiation(7)])),
    )
    renderDock()
    await flush()
    openDrawer()
    await flush()
    expect(screen.getByText('Não foi possível carregar as negociações.')).toBeInTheDocument()
    expect(screen.queryByText('Anúncio 7')).not.toBeInTheDocument()
  })

  it('shows an error when the list cannot be loaded', async () => {
    vi.mocked(apiListNegotiations).mockRejectedValue(new ApiError(500, 'boom'))
    renderDock()
    await flush()
    openDrawer()
    await flush()
    expect(screen.getByText('Não foi possível carregar as negociações.')).toBeInTheDocument()
    expect(logout).not.toHaveBeenCalled()
  })
})
