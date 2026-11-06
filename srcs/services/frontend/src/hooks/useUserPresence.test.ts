import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { PRESENCE_MIN_GAP_MS, PRESENCE_POLL_MS, useUserPresence } from './useUserPresence'
import { apiGetPublicProfile, type ApiPublicProfile } from '../lib/api'

vi.mock('../lib/api', () => ({ apiGetPublicProfile: vi.fn() }))

const profile = (is_online: boolean) => ({ id: 2, is_online } as ApiPublicProfile)
const flush = () => act(async () => { await Promise.resolve() })

let visibility: DocumentVisibilityState = 'visible'
function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('useUserPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    vi.mocked(apiGetPublicProfile).mockReset().mockResolvedValue(profile(true))
  })
  afterEach(() => vi.useRealTimers())

  it('is unknown until the profile answers, then follows it on every poll', async () => {
    const { result } = renderHook(() => useUserPresence(2))
    expect(result.current).toBeUndefined()

    await flush()
    expect(result.current).toBe(true)
    expect(apiGetPublicProfile).toHaveBeenCalledWith(2, expect.any(AbortSignal))

    vi.mocked(apiGetPublicProfile).mockResolvedValue(profile(false))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESENCE_POLL_MS)
    })
    expect(result.current).toBe(false)
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(2)
  })

  it('hides the state when the profile cannot be read and asks nothing without a user', async () => {
    vi.mocked(apiGetPublicProfile).mockRejectedValue(new Error('offline'))
    const { result, rerender } = renderHook(({ id }: { id: number | null }) => useUserPresence(id), { initialProps: { id: 2 as number | null } })
    await flush()
    expect(result.current).toBeUndefined()

    rerender({ id: null })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESENCE_POLL_MS * 2)
    })
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(1)
  })

  it('pauses while the tab is hidden, so the viewer is not kept online, and resumes on return', async () => {
    const { result } = renderHook(() => useUserPresence(2))
    await flush()
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESENCE_POLL_MS * 3)
    })
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(1)

    // Back: poll right away, then keep the cadence
    vi.mocked(apiGetPublicProfile).mockResolvedValue(profile(false))
    setVisibility('visible')
    await flush()
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESENCE_POLL_MS)
    })
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(3)
  })

  it('keeps the last known state when hiding the tab aborts its own request', async () => {
    const { result } = renderHook(() => useUserPresence(2))
    await flush()
    expect(result.current).toBe(true)

    // The next poll stays in flight and honours its signal, like the real request()
    vi.mocked(apiGetPublicProfile).mockImplementationOnce(
      (_id, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESENCE_POLL_MS)
    })
    const signal = vi.mocked(apiGetPublicProfile).mock.calls[1][1] as AbortSignal

    setVisibility('hidden')
    await flush()
    expect(signal.aborted).toBe(true)
    expect(result.current).toBe(true)
  })

  it('does not poll again on a quick return to the tab, only after the minimum gap', async () => {
    renderHook(() => useUserPresence(2))
    await flush()
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(1)

    // Rapid switching: back within the gap, no extra request
    setVisibility('hidden')
    setVisibility('visible')
    setVisibility('hidden')
    setVisibility('visible')
    await flush()
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(1)

    // Away longer than the gap: polls at once on return
    setVisibility('hidden')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESENCE_MIN_GAP_MS)
    })
    setVisibility('visible')
    await flush()
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(2)
  })

  it('polls on a quick return when the previous poll was aborted before answering', async () => {
    // The mount poll stays in flight and honours its signal
    vi.mocked(apiGetPublicProfile).mockImplementationOnce(
      (_id, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const { result } = renderHook(() => useUserPresence(2))
    setVisibility('hidden')
    await flush()
    expect(result.current).toBeUndefined()

    // Back within the gap: the aborted poll did not count, so it polls at once
    setVisibility('visible')
    await flush()
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(true)
  })

  it('does not start polling when mounted in a hidden tab', async () => {
    visibility = 'hidden'
    renderHook(() => useUserPresence(2))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESENCE_POLL_MS * 2)
    })
    expect(apiGetPublicProfile).not.toHaveBeenCalled()

    setVisibility('visible')
    await flush()
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(1)
  })

  it('stops polling and aborts the request in flight on unmount', async () => {
    vi.mocked(apiGetPublicProfile).mockReturnValue(new Promise(() => {}))
    const { unmount } = renderHook(() => useUserPresence(2))
    const signal = vi.mocked(apiGetPublicProfile).mock.calls[0][1] as AbortSignal

    unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRESENCE_POLL_MS * 2)
    })
    expect(apiGetPublicProfile).toHaveBeenCalledTimes(1)
  })
})
