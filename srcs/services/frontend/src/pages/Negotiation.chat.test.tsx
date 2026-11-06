import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Negotiation from './Negotiation'
import { apiGetNegotiation, type ApiNegotiationDetail, type ApiNegotiationState } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGetNegotiation: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../context/ChatContext', () => ({ useChat: vi.fn() }))

const OWNER = { id: 1, user_name: 'Ana', avatar: null, user_location: null, is_online: false }
const INTERESTED = { id: 2, user_name: 'Bruno', avatar: null, user_location: null, is_online: true }

function negotiation(state: ApiNegotiationState['state_name']): ApiNegotiationDetail {
  return {
    id: 20,
    requested_listing: {
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
    },
    owner: OWNER,
    interested_user: INTERESTED,
    state: { id: 1, state_name: state },
    proposals: [],
    cancelled_by: null,
    cancelled_at: null,
    created_at: '2026-01-15T10:00:00',
    updated_at: '2026-01-15T10:00:00',
  }
}

const openChat = vi.fn()
const closeChat = vi.fn()

function chat(activeId: number | null, isReadOnly = false) {
  vi.mocked(useChat).mockReturnValue({
    activeChat: activeId === null ? null : { negotiationId: activeId, interlocutorId: 1, interlocutorName: 'Ana', isReadOnly },
    openChat,
    closeChat,
    isChatOpen: (id) => id === activeId,
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/negotiations/20']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/negotiations/:id" element={<Negotiation />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Negotiation chat button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({
      user: { ...INTERESTED, email: 'b@x.io', created_at: '' },
      loading: false,
      logout: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>)
    chat(null)
  })

  it('opens the chat with the other participant of an open negotiation', async () => {
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Conversar' }))

    expect(openChat).toHaveBeenCalledWith(20, expect.objectContaining({ id: 1, user_name: 'Ana' }), false)
  })

  it('still offers the conversation, read-only, once the negotiation is closed', async () => {
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Completed'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Conversar' }))

    expect(openChat).toHaveBeenCalledWith(20, expect.objectContaining({ id: 1, user_name: 'Ana' }), true)
    expect(screen.queryByRole('button', { name: 'Cancelar negociação' })).not.toBeInTheDocument()
  })

  it('never reopens a read-only chat as writable from a stale page', async () => {
    // The dock opened the chat read-only from a fresh list; this page still has the negotiation as Open
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Open'))
    chat(20, true)
    renderPage()

    await screen.findByRole('button', { name: 'Fechar conversa' })
    expect(openChat).not.toHaveBeenCalled()
  })

  it('syncs an open chat to read-only and closes it from the page', async () => {
    vi.mocked(apiGetNegotiation).mockResolvedValue(negotiation('Cancelled'))
    chat(20)
    renderPage()

    // The chat was opened while the negotiation was active; the page re-opens it read-only
    const close = await screen.findByRole('button', { name: 'Fechar conversa' })
    expect(openChat).toHaveBeenCalledWith(20, { id: 1, user_name: 'Ana' }, true)

    await userEvent.click(close)
    expect(closeChat).toHaveBeenCalledTimes(1)
  })
})
