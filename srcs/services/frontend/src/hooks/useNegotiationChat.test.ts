import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNegotiationChat } from './useNegotiationChat'
import { ApiError, apiGetNegotiation, apiListNegotiationMessages, type ApiNegotiationDetail } from '../lib/api'
import { WS_CLOSE_CODES } from '../types/chat'
import { useAuth } from '../context/AuthContext'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiListNegotiationMessages: vi.fn(),
  apiGetNegotiation: vi.fn(),
}))

type MessagePage = Awaited<ReturnType<typeof apiListNegotiationMessages>>

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  sentData: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  simulateOpen() {
    this.readyState = 1 // OPEN
    this.onopen?.(new Event('open'))
  }

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }

  simulateClose(code: number, reason = '') {
    this.readyState = 3 // CLOSED
    this.onclose?.({ code, reason } as CloseEvent)
  }

  send(data: string) {
    this.sentData.push(data)
  }

  close(code = 1000, reason = '') {
    this.readyState = 3
    this.onclose?.({ code, reason } as CloseEvent)
  }
}

describe('useNegotiationChat', () => {
  const originalWebSocket = window.WebSocket
  const logout = vi.fn().mockResolvedValue(undefined)
  const syncUser = vi.fn().mockResolvedValue('signedOut')

  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instances = []
    window.WebSocket = MockWebSocket as unknown as typeof WebSocket
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, user_name: 'Daniel', email: 'd@daka.pt', avatar: null, user_location: null, is_online: false, created_at: '' },
      loading: false,
      logout,
      syncUser,
    } as unknown as ReturnType<typeof useAuth>)

    vi.mocked(apiGetNegotiation).mockResolvedValue({ id: 42, state: { id: 1, state_name: 'Open' } } as ApiNegotiationDetail)
    vi.mocked(apiListNegotiationMessages).mockResolvedValue({
      items: [
        {
          id: 10,
          negotiation_id: 42,
          sender: { id: 2, user_name: 'Beatriz', avatar: null },
          content: 'Mensagem antiga',
          created_at: '2026-10-28T10:00:00Z',
        },
      ],
      limit: 50,
      next_before_id: null,
      has_more: false,
    })
  })

  afterEach(() => {
    window.WebSocket = originalWebSocket
  })

  it('stays disconnected and does not load history when negotiationId is null', () => {
    const { result } = renderHook(() => useNegotiationChat(null))

    expect(result.current.status).toBe('disconnected')
    expect(result.current.messages).toEqual([])
    expect(apiListNegotiationMessages).not.toHaveBeenCalled()
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('loads history via REST and connects to WebSocket on mount', async () => {
    const { result } = renderHook(() => useNegotiationChat(42))

    expect(result.current.status).toBe('connecting')
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toContain('/api/ws/negotiations/42')

    // Simulate WebSocket connected
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    expect(result.current.status).toBe('connected')

    // Wait for REST history to resolve
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toEqual({
      id: 10,
      negotiationId: 42,
      senderId: 2,
      content: 'Mensagem antiga',
      createdAt: '2026-10-28T10:00:00Z',
      isOwn: false,
    })
  })

  it('appends broadcasted messages and deduplicates', async () => {
    const { result } = renderHook(() => useNegotiationChat(42))

    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })

    // Receive message.created
    act(() => {
      MockWebSocket.instances[0].simulateMessage({
        type: 'message.created',
        message: {
          id: 25,
          negotiation_id: 42,
          sender_id: 1,
          content: 'Mensagem em tempo real',
          created_at: '2026-10-28T10:05:00Z',
        },
      })
    })

    expect(result.current.messages.some((m) => m.id === 25)).toBe(true)

    // Receive duplicate broadcast
    act(() => {
      MockWebSocket.instances[0].simulateMessage({
        type: 'message.created',
        message: {
          id: 25,
          negotiation_id: 42,
          sender_id: 1,
          content: 'Mensagem em tempo real',
          created_at: '2026-10-28T10:05:00Z',
        },
      })
    })

    // Should not have duplicated
    const matches = result.current.messages.filter((m) => m.id === 25)
    expect(matches).toHaveLength(1)
  })

  it('sends message frame when socket is open', () => {
    const { result } = renderHook(() => useNegotiationChat(42))
    const ws = MockWebSocket.instances[0]

    act(() => {
      ws.simulateOpen()
    })

    let sent = false
    act(() => {
      sent = result.current.sendMessage('  Troca confirmada!  ')
    })

    expect(sent).toBe(true)
    expect(ws.sentData).toHaveLength(1)
    expect(JSON.parse(ws.sentData[0])).toEqual({
      type: 'message.send',
      content: 'Troca confirmada!',
    })
  })

  it('trims like the server, so a text ending in a character only Python strips is still confirmed', () => {
    const { result } = renderHook(() => useNegotiationChat(42))
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.simulateOpen()
    })

    act(() => {
      result.current.sendMessage('Olá\u001f\u0085 ')
    })
    expect(JSON.parse(ws.sentData[0]).content).toBe('Olá')
    // The backend strips the same characters and echoes 'Olá'
    act(() => {
      ws.simulateMessage({ type: 'message.created', message: { id: 40, negotiation_id: 42, sender_id: 1, content: 'Olá', created_at: '2026-10-28T10:05:00Z' } })
    })
    expect(result.current.isSending).toBe(false)
    expect(result.current.confirmedSends).toBe(1)
  })

  it('frees an in-flight send when the socket is replaced for another user', () => {
    const { result, rerender } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    act(() => {
      result.current.sendMessage('Em curso')
    })
    expect(result.current.isSending).toBe(true)

    // Same negotiation, different account: the effect re-runs and ignores the old onclose
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 9, user_name: 'Outra', email: 'o@daka.pt', avatar: null, user_location: null, created_at: '' },
      loading: false,
      logout,
      syncUser,
    } as unknown as ReturnType<typeof useAuth>)
    rerender()
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    expect(result.current.isSending).toBe(false)
  })

  it('holds one send in flight until the server confirms or rejects it', () => {
    const { result } = renderHook(() => useNegotiationChat(42))
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.simulateOpen()
    })

    act(() => {
      result.current.sendMessage('Primeira')
    })
    expect(result.current.isSending).toBe(true)
    // A second one waits for the answer
    let second = true
    act(() => {
      second = result.current.sendMessage('Segunda')
    })
    expect(second).toBe(false)
    expect(ws.sentData).toHaveLength(1)

    // Someone else's message with the same text is not our confirmation
    act(() => {
      ws.simulateMessage({ type: 'message.created', message: { id: 30, negotiation_id: 42, sender_id: 2, content: 'Primeira', created_at: '2026-10-28T10:05:00Z' } })
    })
    expect(result.current.isSending).toBe(true)
    expect(result.current.confirmedSends).toBe(0)

    act(() => {
      ws.simulateMessage({ type: 'message.created', message: { id: 31, negotiation_id: 42, sender_id: 1, content: 'Primeira', created_at: '2026-10-28T10:05:01Z' } })
    })
    expect(result.current.isSending).toBe(false)
    expect(result.current.confirmedSends).toBe(1)

    // A rejection frees the composer without confirming
    act(() => {
      result.current.sendMessage('Terceira')
    })
    act(() => {
      ws.simulateMessage({ type: 'error', error: { code: 'rate_limited', message: 'Too many', retry_after: 3 } })
    })
    expect(result.current.isSending).toBe(false)
    expect(result.current.confirmedSends).toBe(1)

    // delivery_failed means stored: confirmed, so it is not resent
    act(() => {
      result.current.sendMessage('Quarta')
    })
    act(() => {
      ws.simulateMessage({ type: 'error', error: { code: 'delivery_failed', message: 'Stored but not delivered' } })
    })
    expect(result.current.confirmedSends).toBe(2)

    // A drop with a send in flight frees the composer too
    act(() => {
      result.current.sendMessage('Quinta')
    })
    act(() => {
      ws.simulateClose(1006, 'Drop')
    })
    expect(result.current.isSending).toBe(false)
    expect(result.current.confirmedSends).toBe(2)
  })

  it('blocks sending when in read-only mode and sets localized error', () => {
    const { result } = renderHook(() => useNegotiationChat(42, { isReadOnly: true }))

    let sent = true
    act(() => {
      sent = result.current.sendMessage('Tentativa bloqueada')
    })

    expect(sent).toBe(false)
    expect(result.current.error).toBe('Esta negociação está encerrada. O chat está em modo de leitura.')
  })

  it('opens read-only when the negotiation is already closed, whatever the caller believed', async () => {
    vi.mocked(apiGetNegotiation).mockResolvedValueOnce({ id: 42, state: { id: 3, state_name: 'Cancelled' } } as ApiNegotiationDetail)
    const { result } = renderHook(() => useNegotiationChat(42, { isReadOnly: false }))
    expect(apiGetNegotiation).toHaveBeenCalledWith(42, expect.any(AbortSignal))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.isReadOnly).toBe(true)
  })

  it('stays writable for an active negotiation, and when its state cannot be read', async () => {
    const { result, unmount } = renderHook(() => useNegotiationChat(42))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.isReadOnly).toBe(false)
    unmount()

    vi.mocked(apiGetNegotiation).mockRejectedValueOnce(new ApiError(500, 'boom'))
    const second = renderHook(() => useNegotiationChat(42))
    await act(async () => {
      await Promise.resolve()
    })
    expect(second.result.current.isReadOnly).toBe(false)
    expect(second.result.current.error).toBeNull()
  })

  it('switches to read-only dynamically when server emits negotiation_read_only error', () => {
    const { result } = renderHook(() => useNegotiationChat(42))
    const ws = MockWebSocket.instances[0]

    act(() => {
      ws.simulateOpen()
    })
    expect(result.current.isReadOnly).toBe(false)

    // Simulate backend rejecting with negotiation_read_only
    act(() => {
      ws.simulateMessage({
        type: 'error',
        error: {
          code: 'negotiation_read_only',
          message: 'Negotiation no longer accepts new messages.',
        },
      })
    })

    // Hook must dynamically switch isReadOnly to true and set Portuguese error message
    expect(result.current.isReadOnly).toBe(true)
    expect(result.current.error).toBe('Esta negociação está encerrada. O chat está em modo de leitura.')

    // Subsequent sends must be blocked locally
    let sent = true
    act(() => {
      sent = result.current.sendMessage('Nova tentativa')
    })
    expect(sent).toBe(false)
  })

  it('handles terminal close codes without reconnecting', () => {
    const { result } = renderHook(() => useNegotiationChat(42))
    const ws = MockWebSocket.instances[0]

    act(() => {
      ws.simulateClose(4403, 'Forbidden')
    })

    expect(result.current.status).toBe('disconnected')
    expect(result.current.error).toContain('Não tens permissão')
    // No new connection created, and the session is kept: only 4401 signs out
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(logout).not.toHaveBeenCalled()
  })

  it('attempts reconnection with backoff on unexpected socket drop', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useNegotiationChat(42))
    const ws1 = MockWebSocket.instances[0]

    act(() => {
      ws1.simulateOpen()
    })
    expect(result.current.status).toBe('connected')

    // Simulate unexpected drop (code 1006 abnormal closure)
    act(() => {
      ws1.simulateClose(1006, 'Abnormal closure')
    })
    expect(result.current.status).toBe('connecting')

    // Advance 1s (initial backoff delay)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    // Second connection attempt initiated
    expect(MockWebSocket.instances).toHaveLength(2)
    const ws2 = MockWebSocket.instances[1]
    expect(ws2.url).toContain('/api/ws/negotiations/42')

    act(() => {
      ws2.simulateOpen()
    })
    expect(result.current.status).toBe('connected')

    // On reconnect, REST history must be fetched again to sync missed messages
    expect(apiListNegotiationMessages).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('replaces the thread when more than a page arrived while offline, so nothing is silently missing', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.messages.map((m) => m.id)).toEqual([10])
    expect(result.current.hasOlder).toBe(false)

    // Drop, then the backfill page does not reach id 10: a hole would be left by merging
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [60, 61].map((id) => ({
        id, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: `Perdida ${id}`, created_at: '2026-10-28T12:00:00Z',
      })),
      limit: 50,
      next_before_id: 60,
      has_more: true,
    })
    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.messages.map((m) => m.id)).toEqual([60, 61])
    expect(result.current.hasOlder).toBe(true)

    // Paging backwards now continues from the page, not from the stale thread
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({ items: [], limit: 50, next_before_id: null, has_more: false })
    await act(async () => {
      await result.current.loadOlder()
    })
    expect(apiListNegotiationMessages).toHaveBeenLastCalledWith(42, { limit: 50, before_id: 60 })
    vi.useRealTimers()
  })

  it('merges an overlapping backfill and keeps paging state consistent with it', async () => {
    vi.useFakeTimers()
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [{ id: 10, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: 'Antiga', created_at: '2026-10-28T10:00:00Z' }],
      limit: 50,
      next_before_id: 10,
      has_more: true,
    })
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.hasOlder).toBe(true)

    // The backfill still reaches id 10: nothing was missed, so it merges
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [10, 11].map((id) => ({
        id, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: `Mensagem ${id}`, created_at: '2026-10-28T12:00:00Z',
      })),
      limit: 50,
      next_before_id: 10,
      has_more: true,
    })
    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.messages.map((m) => m.id)).toEqual([10, 11])
    expect(result.current.hasOlder).toBe(true)
    vi.useRealTimers()
  })

  it('still detects the gap when a live message lands during the backfill, and keeps that message', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.messages.map((m) => m.id)).toEqual([10])

    let resolveBackfill!: (page: Awaited<ReturnType<typeof apiListNegotiationMessages>>) => void
    vi.mocked(apiListNegotiationMessages).mockReturnValueOnce(new Promise((r) => { resolveBackfill = r }))
    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    // The other side writes on the new socket before the backfill answers
    act(() => {
      MockWebSocket.instances[1].simulateMessage({
        type: 'message.created',
        message: { id: 111, negotiation_id: 42, sender_id: 2, content: 'Ao vivo', created_at: '2026-10-28T13:00:00Z' },
      })
    })
    await act(async () => {
      resolveBackfill({
        items: [60, 61].map((id) => ({
          id, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: `Perdida ${id}`, created_at: '2026-10-28T12:00:00Z',
        })),
        limit: 50,
        next_before_id: 60,
        has_more: true,
      })
      await Promise.resolve()
    })

    expect(result.current.messages.map((m) => m.id)).toEqual([60, 61, 111])
    expect(result.current.hasOlder).toBe(true)
    vi.useRealTimers()
  })

  it('judges the first page of a switched negotiation against an empty thread, not the previous one', async () => {
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [10, 60].map((id) => ({
        id, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: `Mensagem ${id}`, created_at: '2026-10-28T10:00:00Z',
      })),
      limit: 50,
      next_before_id: null,
      has_more: false,
    })
    const { result, rerender } = renderHook(({ id }: { id: number }) => useNegotiationChat(id), { initialProps: { id: 42 } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.messages.map((m) => m.id)).toEqual([10, 60])

    // Ids are global: negotiation 43's newest page sits inside 42's id range
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [30, 31].map((id) => ({
        id, negotiation_id: 43, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: `Outra ${id}`, created_at: '2026-10-28T11:00:00Z',
      })),
      limit: 50,
      next_before_id: 30,
      has_more: true,
    })
    rerender({ id: 43 })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.messages.map((m) => m.id)).toEqual([30, 31])
    expect(result.current.hasOlder).toBe(true)
  })

  it('drops an older page that was requested before the thread was replaced', async () => {
    vi.useFakeTimers()
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [{ id: 10, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: 'Antiga', created_at: '2026-10-28T10:00:00Z' }],
      limit: 50,
      next_before_id: 10,
      has_more: true,
    })
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })

    // "Ver mensagens anteriores" hangs on a slow network
    let resolveOlder!: (page: Awaited<ReturnType<typeof apiListNegotiationMessages>>) => void
    vi.mocked(apiListNegotiationMessages).mockReturnValueOnce(new Promise((r) => { resolveOlder = r }))
    act(() => {
      void result.current.loadOlder()
    })
    expect(result.current.isLoadingOlder).toBe(true)

    // Meanwhile a reconnect finds a gap and replaces the thread
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [120, 121].map((id) => ({
        id, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: `Nova ${id}`, created_at: '2026-10-28T12:00:00Z',
      })),
      limit: 50,
      next_before_id: 120,
      has_more: true,
    })
    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.messages.map((m) => m.id)).toEqual([120, 121])

    // The stale older page lands: it belongs to the old thread and would open a hole
    await act(async () => {
      resolveOlder({
        items: [{ id: 5, negotiation_id: 42, sender: { id: 1, user_name: 'Daniel', avatar: null }, content: 'Muito antiga', created_at: '2026-10-27T10:00:00Z' }],
        limit: 50,
        next_before_id: null,
        has_more: false,
      })
      await Promise.resolve()
    })
    expect(result.current.messages.map((m) => m.id)).toEqual([120, 121])
    expect(result.current.hasOlder).toBe(true)
    expect(result.current.isLoadingOlder).toBe(false)
    vi.useRealTimers()
  })

  it('rejects empty or whitespace-only message submissions without sending', () => {
    const { result } = renderHook(() => useNegotiationChat(42))
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.simulateOpen()
    })

    let sent1 = true
    let sent2 = true
    act(() => {
      sent1 = result.current.sendMessage('')
      sent2 = result.current.sendMessage('    \n\t  ')
    })

    expect(sent1).toBe(false)
    expect(sent2).toBe(false)
    expect(ws.sentData).toHaveLength(0)
  })

  it('validates message length based on Unicode code points', () => {
    const { result } = renderHook(() => useNegotiationChat(42))
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.simulateOpen()
    })

    // 251 characters is over the 250 limit
    let sentOver = true
    act(() => {
      sentOver = result.current.sendMessage('a'.repeat(251))
    })
    expect(sentOver).toBe(false)
    expect(ws.sentData).toHaveLength(0)

    // Exactly 250 unicode emojis is valid
    const emoji250 = '😀'.repeat(250)
    let sent250 = false
    act(() => {
      sent250 = result.current.sendMessage(emoji250)
    })
    expect(sent250).toBe(true)
    expect(ws.sentData).toHaveLength(1)
  })

  it('reports the chat as not connected when sending before the socket opens', () => {
    const { result } = renderHook(() => useNegotiationChat(42))
    // Socket is in CONNECTING state (readyState = 0)
    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CONNECTING)

    let sent = true
    act(() => {
      sent = result.current.sendMessage('Mensagem precoce')
    })

    expect(sent).toBe(false)
    expect(result.current.error).toBe('O chat não está ligado. Aguarda a reconexão e tenta novamente.')
  })

  it('loads the page before the oldest message on demand until nothing older is left', async () => {
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [
        { id: 10, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: 'Mensagem antiga', created_at: '2026-10-28T10:00:00Z' },
      ],
      limit: 50,
      next_before_id: 10,
      has_more: true,
    })
    const { result } = renderHook(() => useNegotiationChat(42))

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.hasOlder).toBe(true)
    expect(apiListNegotiationMessages).toHaveBeenLastCalledWith(42, { limit: 50, before_id: undefined })

    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [
        { id: 5, negotiation_id: 42, sender: { id: 1, user_name: 'Daniel', avatar: null }, content: 'Ainda mais antiga', created_at: '2026-10-27T10:00:00Z' },
      ],
      limit: 50,
      next_before_id: null,
      has_more: false,
    })
    await act(async () => {
      await result.current.loadOlder()
    })

    expect(apiListNegotiationMessages).toHaveBeenLastCalledWith(42, { limit: 50, before_id: 10 })
    expect(result.current.messages.map((m) => m.id)).toEqual([5, 10])
    expect(result.current.messages[0].isOwn).toBe(true)
    expect(result.current.hasOlder).toBe(false)
    expect(result.current.isLoadingOlder).toBe(false)

    // Nothing older: a further call does not hit the API
    await act(async () => {
      await result.current.loadOlder()
    })
    expect(apiListNegotiationMessages).toHaveBeenCalledTimes(2)
  })

  it('drops an older page that arrives after switching to another negotiation', async () => {
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [
        { id: 10, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: 'Mensagem antiga', created_at: '2026-10-28T10:00:00Z' },
      ],
      limit: 50,
      next_before_id: 10,
      has_more: true,
    })
    const { result, rerender } = renderHook(({ id }: { id: number }) => useNegotiationChat(id), { initialProps: { id: 42 } })
    await act(async () => {
      await Promise.resolve()
    })

    let resolveOlder!: (page: Awaited<ReturnType<typeof apiListNegotiationMessages>>) => void
    vi.mocked(apiListNegotiationMessages).mockReturnValueOnce(new Promise((r) => { resolveOlder = r }))
    act(() => {
      void result.current.loadOlder()
    })
    expect(result.current.isLoadingOlder).toBe(true)

    // Switch chats while the older page of 42 is still in flight
    rerender({ id: 43 })
    await act(async () => {
      resolveOlder({
        items: [
          { id: 5, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: 'Pertence à 42', created_at: '2026-10-27T10:00:00Z' },
        ],
        limit: 50,
        next_before_id: null,
        has_more: false,
      })
      await Promise.resolve()
    })

    expect(result.current.messages.some((m) => m.content === 'Pertence à 42')).toBe(false)
    expect(result.current.isLoadingOlder).toBe(false)
  })

  it('reports a failed older page, clears it on a retry that works, and ignores refusals', async () => {
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [{ id: 10, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: 'Antiga', created_at: '2026-10-28T10:00:00Z' }],
      limit: 50,
      next_before_id: 10,
      has_more: true,
    })
    const { result } = renderHook(() => useNegotiationChat(42))
    await act(async () => {
      await Promise.resolve()
    })

    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new Error('Blip'))
    await act(async () => {
      await result.current.loadOlder()
    })
    expect(result.current.olderFailed).toBe(true)
    expect(result.current.hasOlder).toBe(true)

    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({ items: [], limit: 50, next_before_id: null, has_more: false })
    await act(async () => {
      await result.current.loadOlder()
    })
    expect(result.current.olderFailed).toBe(false)
    expect(result.current.hasOlder).toBe(false)
  })

  it('reports a refused older page itself, since an idle socket does not learn about it', async () => {
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [{ id: 10, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: 'Antiga', created_at: '2026-10-28T10:00:00Z' }],
      limit: 50,
      next_before_id: 10,
      has_more: true,
    })
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })

    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new ApiError(403, 'Not a participant'))
    await act(async () => {
      await result.current.loadOlder()
    })
    expect(result.current.error).toContain('Não tens permissão')
    expect(result.current.connectionRefused).toBe(true)
    expect(result.current.hasOlder).toBe(false)
    expect(result.current.olderFailed).toBe(false)
    expect(logout).not.toHaveBeenCalled()
  })

  it('signs out when an older page answers 401', async () => {
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [{ id: 10, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: 'Antiga', created_at: '2026-10-28T10:00:00Z' }],
      limit: 50,
      next_before_id: 10,
      has_more: true,
    })
    const { result } = renderHook(() => useNegotiationChat(42))
    await act(async () => {
      await Promise.resolve()
    })
    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new ApiError(401, 'Not authenticated'))
    await act(async () => {
      await result.current.loadOlder()
    })
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('drops an older-page failure notice when a reconnect replaces the thread', async () => {
    vi.useFakeTimers()
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [{ id: 10, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: 'Antiga', created_at: '2026-10-28T10:00:00Z' }],
      limit: 50,
      next_before_id: 10,
      has_more: true,
    })
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new Error('Blip'))
    await act(async () => {
      await result.current.loadOlder()
    })
    expect(result.current.olderFailed).toBe(true)

    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce({
      items: [120, 121].map((id) => ({
        id, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: `Nova ${id}`, created_at: '2026-10-28T12:00:00Z',
      })),
      limit: 50,
      next_before_id: 120,
      has_more: true,
    })
    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.messages.map((m) => m.id)).toEqual([120, 121])
    expect(result.current.olderFailed).toBe(false)
    vi.useRealTimers()
  })

  it('marks the connection refused only on terminal closes', () => {
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateClose(WS_CLOSE_CODES.FORBIDDEN, 'Forbidden')
    })
    expect(result.current.connectionRefused).toBe(true)

    const other = renderHook(() => useNegotiationChat(43))
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    act(() => {
      MockWebSocket.instances[1].simulateClose(WS_CLOSE_CODES.NORMAL_CLOSURE, 'Bye')
    })
    expect(other.result.current.connectionRefused).toBe(false)
  })

  it('clears an old history notice when the reconnect backfill is refused', async () => {
    vi.useFakeTimers()
    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new Error('Blip'))
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(true)

    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new ApiError(403, 'Not a participant'))
    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(false)
    vi.useRealTimers()
  })

  it('clears error with clearError callback', () => {
    const { result } = renderHook(() => useNegotiationChat(42, { isReadOnly: true }))

    act(() => {
      result.current.sendMessage('Bloqueado')
    })
    expect(result.current.error).not.toBeNull()

    act(() => {
      result.current.clearError()
    })
    expect(result.current.error).toBeNull()
  })

  it('handles REST history failure gracefully without breaking websocket', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(
      new Error('Network failure loading history'),
    )

    const { result } = renderHook(() => useNegotiationChat(42))

    await act(async () => {
      await Promise.resolve()
    })

    // History loading ends, the failure is reported and messages default to empty
    expect(result.current.isLoadingHistory).toBe(false)
    expect(result.current.historyFailed).toBe(true)
    expect(result.current.messages).toEqual([])

    // WebSocket can still connect normally
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    expect(result.current.status).toBe('connected')

    // Retrying asks for the first page again
    act(() => {
      result.current.retryHistory()
    })
    expect(result.current.isLoadingHistory).toBe(true)
    await act(async () => {
      await Promise.resolve()
    })
    expect(apiListNegotiationMessages).toHaveBeenCalledTimes(2)
    expect(result.current.historyFailed).toBe(false)
    expect(result.current.messages.map((m) => m.id)).toEqual([10])
    warnSpy.mockRestore()
  })

  it('ignores a first page that fails after a reconnect backfill already loaded the thread', async () => {
    vi.useFakeTimers()
    let rejectFirst!: (err: Error) => void
    vi.mocked(apiListNegotiationMessages).mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject }))
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })

    // The first GET hangs on a dying connection; the socket drops and comes back
    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.messages.map((m) => m.id)).toEqual([10])

    await act(async () => {
      rejectFirst(new Error('Connection reset'))
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(false)
    expect(result.current.isLoadingHistory).toBe(false)
    vi.useRealTimers()
  })

  it('ignores the outcome of an attempt that a retry replaced', async () => {
    let rejectFirst!: (err: Error) => void
    vi.mocked(apiListNegotiationMessages).mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject }))
    const { result } = renderHook(() => useNegotiationChat(42))
    expect(result.current.isLoadingHistory).toBe(true)

    act(() => {
      result.current.retryHistory()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.messages.map((m) => m.id)).toEqual([10])
    expect(result.current.historyFailed).toBe(false)

    await act(async () => {
      rejectFirst(new Error('Too late'))
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(false)
  })

  it('reports a refused retry of the first page instead of showing an empty thread', async () => {
    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new Error('Blip'))
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(true)

    // The socket sits idle; meanwhile the membership was revoked
    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new ApiError(403, 'Not a participant'))
    act(() => {
      result.current.retryHistory()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(false)
    expect(result.current.connectionRefused).toBe(true)
    expect(result.current.error).toContain('Não tens permissão')

    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new ApiError(401, 'Not authenticated'))
    act(() => {
      result.current.retryHistory()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('does not offer a retry when the history is refused (the socket reports 403/404)', async () => {
    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new ApiError(403, 'Not a participant'))
    const { result } = renderHook(() => useNegotiationChat(42))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.isLoadingHistory).toBe(false)
    expect(result.current.historyFailed).toBe(false)
    expect(result.current.messages).toEqual([])
  })

  it('reports a failed reconnect backfill, and a retry recovers from it', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(false)

    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new Error('Blip'))
    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(true)

    const page: MessagePage = {
      items: [10, 11].map((id) => ({
        id, negotiation_id: 42, sender: { id: 2, user_name: 'Beatriz', avatar: null }, content: `Mensagem ${id}`, created_at: '2026-10-28T12:00:00Z',
      })),
      limit: 50,
      next_before_id: null,
      has_more: false,
    }
    vi.mocked(apiListNegotiationMessages).mockResolvedValueOnce(page)
    act(() => {
      result.current.retryHistory()
    })
    // The notice stays while the retry runs; the widget disables its button
    expect(result.current.historyFailed).toBe(true)
    expect(result.current.isLoadingHistory).toBe(true)
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(false)
    expect(result.current.messages.map((m) => m.id)).toEqual([10, 11])
    vi.useRealTimers()
  })

  it('keeps reporting a failed backfill when the retry fails too', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })

    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new Error('Blip'))
    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(true)

    // Still flaky: the thread may still be missing messages, so the notice must stay
    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new Error('Still down'))
    act(() => {
      result.current.retryHistory()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(true)
    expect(result.current.isLoadingHistory).toBe(false)
    vi.useRealTimers()
  })

  it('clears a failed first page when the backfill after a reconnect succeeds', async () => {
    vi.useFakeTimers()
    vi.mocked(apiListNegotiationMessages).mockRejectedValueOnce(new Error('Network failure loading history'))
    const { result } = renderHook(() => useNegotiationChat(42))
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.historyFailed).toBe(true)

    act(() => {
      MockWebSocket.instances[0].simulateClose(1006, 'Drop')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      MockWebSocket.instances[1].simulateOpen()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.historyFailed).toBe(false)
    expect(result.current.messages.map((m) => m.id)).toEqual([10])
    vi.useRealTimers()
  })

  it.each(['same', 'unknown'] as const)(
    'after a 4401 answered %s, stays quiet and reconnects with the current cookie',
    async (outcome) => {
      vi.useFakeTimers()
      let resolveSync!: (value: typeof outcome) => void
      syncUser.mockReturnValueOnce(new Promise((r) => { resolveSync = r }))
      const { result } = renderHook(() => useNegotiationChat(42))
      act(() => {
        MockWebSocket.instances[0].simulateClose(WS_CLOSE_CODES.UNAUTHORIZED, 'Unauthorized')
      })
      // No alarming message while the session is being checked
      expect(result.current.status).toBe('connecting')
      expect(result.current.error).toBeNull()
      expect(result.current.connectionRefused).toBe(false)

      await act(async () => {
        resolveSync(outcome)
        await Promise.resolve()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(MockWebSocket.instances).toHaveLength(2)
      expect(result.current.error).toBeNull()
      expect(logout).not.toHaveBeenCalled()
      vi.useRealTimers()
    },
  )

  it.each(['signedOut', 'changed'] as const)(
    'after a 4401 answered %s, explains and stays disconnected',
    async (outcome) => {
      vi.useFakeTimers()
      syncUser.mockResolvedValueOnce(outcome)
      const { result } = renderHook(() => useNegotiationChat(42))
      act(() => {
        MockWebSocket.instances[0].simulateClose(WS_CLOSE_CODES.UNAUTHORIZED, 'Unauthorized')
      })
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(result.current.status).toBe('disconnected')
      expect(result.current.error).toContain('A tua sessão expirou')
      expect(result.current.connectionRefused).toBe(true)
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(logout).not.toHaveBeenCalled()
      vi.useRealTimers()
    },
  )

  it('handles terminal close codes 4401 and 4404 with appropriate copy and no reconnect', async () => {
    // Test 4401: Session expired
    const { result: res4401 } = renderHook(() => useNegotiationChat(42))
    const ws4401 = MockWebSocket.instances[0]
    act(() => {
      ws4401.simulateClose(WS_CLOSE_CODES.UNAUTHORIZED, 'Unauthorized')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(res4401.current.status).toBe('disconnected')
    expect(res4401.current.error).toContain('A tua sessão expirou')
    // The socket's session may not be the cookie's: re-read it, never POST /auth/logout
    expect(syncUser).toHaveBeenCalledTimes(1)
    expect(logout).not.toHaveBeenCalled()

    // Test 4404: Negotiation not found
    const { result: res4404 } = renderHook(() => useNegotiationChat(999))
    const ws4404 = MockWebSocket.instances[1]
    act(() => {
      ws4404.simulateClose(WS_CLOSE_CODES.NOT_FOUND, 'Not Found')
    })
    expect(res4404.current.status).toBe('disconnected')
    expect(res4404.current.error).toContain('A negociação não foi encontrada')
    expect(syncUser).toHaveBeenCalledTimes(1)
    expect(logout).not.toHaveBeenCalled()

    // No reconnect attempts spawned
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('cleans up and closes socket with normal closure code on unmount', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useNegotiationChat(42))
    const ws = MockWebSocket.instances[0]

    act(() => {
      ws.simulateOpen()
    })

    // Simulate unexpected drop to schedule a reconnect timer
    act(() => {
      ws.simulateClose(1006, 'Drop')
    })

    // Unmount before timer fires
    unmount()

    // Fast forward past the reconnect timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // No second WebSocket should be created after unmount
    expect(MockWebSocket.instances).toHaveLength(1)
    vi.useRealTimers()
  })
})
