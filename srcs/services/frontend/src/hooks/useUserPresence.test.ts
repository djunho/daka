import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { PRESENCE_POLL_MS, useUserPresence } from './useUserPresence'
import { apiGetPublicProfile, type ApiPublicProfile } from '../lib/api'

vi.mock('../lib/api', () => ({ apiGetPublicProfile: vi.fn() }))

const profile = (is_online: boolean) => ({ id: 2, is_online } as ApiPublicProfile)
const flush = () => act(async () => { await Promise.resolve() })

describe('useUserPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
