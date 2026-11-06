import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNegotiationChat } from './useNegotiationChat'
import { apiListNegotiationMessages } from '../lib/api'
import { WS_CLOSE_CODES } from '../types/chat'
import { useAuth } from '../context/AuthContext'

vi.mock('../lib/api', () => ({
  apiListNegotiationMessages: vi.fn(),
}))

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

  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instances = []
    window.WebSocket = MockWebSocket as unknown as typeof WebSocket
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, user_name: 'Daniel', email: 'd@daka.pt', avatar: null, user_location: null, created_at: '' },
      loading: false,
      logout,
    } as unknown as ReturnType<typeof useAuth>)

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

  it('blocks sending when in read-only mode and sets localized error', () => {
    const { result } = renderHook(() => useNegotiationChat(42, { isReadOnly: true }))

    let sent = true
    act(() => {
      sent = result.current.sendMessage('Tentativa bloqueada')
    })

    expect(sent).toBe(false)
    expect(result.current.error).toBe('Esta negociação está encerrada. O chat está em modo de leitura.')
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

    // History loading ends gracefully and messages default to empty
    expect(result.current.isLoadingHistory).toBe(false)
    expect(result.current.messages).toEqual([])

    // WebSocket can still connect normally
    act(() => {
      MockWebSocket.instances[0].simulateOpen()
    })
    expect(result.current.status).toBe('connected')
    warnSpy.mockRestore()
  })

  it('handles terminal close codes 4401 and 4404 with appropriate copy and no reconnect', () => {
    // Test 4401: Session expired
    const { result: res4401 } = renderHook(() => useNegotiationChat(42))
    const ws4401 = MockWebSocket.instances[0]
    act(() => {
      ws4401.simulateClose(WS_CLOSE_CODES.UNAUTHORIZED, 'Unauthorized')
    })
    expect(res4401.current.status).toBe('disconnected')
    expect(res4401.current.error).toContain('A tua sessão expirou')
    // Same as a REST 401 on the pages: clear the session so RequireAuth takes over
    expect(logout).toHaveBeenCalledTimes(1)

    // Test 4404: Negotiation not found
    const { result: res4404 } = renderHook(() => useNegotiationChat(999))
    const ws4404 = MockWebSocket.instances[1]
    act(() => {
      ws4404.simulateClose(WS_CLOSE_CODES.NOT_FOUND, 'Not Found')
    })
    expect(res4404.current.status).toBe('disconnected')
    expect(res4404.current.error).toContain('A negociação não foi encontrada')
    expect(logout).toHaveBeenCalledTimes(1)

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
