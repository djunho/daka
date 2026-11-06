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

const ME = { id: 1, user_name: 'Ana', avatar: null, user_location: null, email: 'a@x.io', created_at: '2026-01-01' }
const OTHER = { id: 2, user_name: 'Bruno', avatar: null, user_location: null }
const logout = vi.fn().mockResolvedValue(undefined)
const openChat = vi.fn()

function negotiation(id: number, state: ApiNegotiationState['state_name'] = 'Open'): ApiNegotiationSummary {
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
    updated_at: '2026-03-05T12:00:00',
  }
}

const pageOf = (items: ApiNegotiationSummary[]): ApiNegotiationPage => ({ items, total: items.length, limit: 15, offset: 0 })

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
    vi.mocked(apiListNegotiations).mockResolvedValue(pageOf([negotiation(7), negotiation(8, 'Completed')]))
  })

  it('renders nothing and requests nothing for a visitor', () => {
    setUser(null)
    const { container } = renderDock()
    expect(container).toBeEmptyDOMElement()
    expect(apiListNegotiations).not.toHaveBeenCalled()
  })

  it('loads the negotiations on mount and lists them when opened', async () => {
    renderDock()
    await flush()
    expect(apiListNegotiations).toHaveBeenCalledWith({ limit: 15 }, expect.any(AbortSignal))

    openDrawer()
    expect(screen.getByText('Anúncio 7')).toBeInTheDocument()
    expect(screen.getByText('Anúncio 8')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver todas as negociações' })).toHaveAttribute('href', '/negotiations')
  })

  it('opens the chat of a card with its read-only state and collapses the drawer', async () => {
    renderDock()
    await flush()
    openDrawer()

    fireEvent.click(screen.getAllByRole('button', { name: 'Chat' })[1])

    expect(openChat).toHaveBeenCalledWith(8, 'Bruno', true)
    expect(screen.queryByText('Anúncio 8')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Abrir gaveta de negociações/ })).toBeInTheDocument()
  })

  it('aborts the request in flight when unmounted', () => {
    vi.mocked(apiListNegotiations).mockReturnValueOnce(new Promise(() => {}))
    const { unmount } = renderDock()
    const signal = vi.mocked(apiListNegotiations).mock.calls[0][1] as AbortSignal
    expect(signal.aborted).toBe(false)

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

    // Someone signs in again; their own load is still pending
    setUser(ME)
    vi.mocked(apiListNegotiations).mockReturnValueOnce(new Promise(() => {}))
    rerender(dock())
    openDrawer()

    expect(screen.queryByText('Anúncio 7')).not.toBeInTheDocument()
    expect(screen.getByText('A carregar negociações...')).toBeInTheDocument()
  })

  it('signs out when the list answers 401', async () => {
    vi.mocked(apiListNegotiations).mockRejectedValueOnce(new ApiError(401, 'Not authenticated'))
    renderDock()
    await flush()
    expect(logout).toHaveBeenCalledTimes(1)
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
