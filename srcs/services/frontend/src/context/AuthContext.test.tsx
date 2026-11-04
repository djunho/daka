import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'
import { ApiError, apiMe, type ApiUser } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiMe: vi.fn(),
}))

const ME: ApiUser = {
  id: 1,
  user_name: 'Ana',
  avatar: null,
  user_location: null,
  email: 'ana@example.com',
  created_at: '2026-01-01T00:00:00',
}

function Probe() {
  const { user } = useAuth()
  return <p>{user ? 'Com sessão' : 'Sem sessão'}</p>
}

describe('AuthContext heartbeat', () => {
  let visibility: DocumentVisibilityState

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(apiMe).mockReset().mockResolvedValue(ME)
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls heartbeat every 60s with session and stops on 401', async () => {
    vi.mocked(apiMe)
      .mockResolvedValueOnce(ME)
      .mockRejectedValueOnce(new ApiError(401, 'Not authenticated.'))

    render(<AuthProvider><Probe /></AuthProvider>)

    expect(await screen.findByText('Com sessão')).toBeInTheDocument()
    expect(apiMe).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(apiMe).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Sem sessão')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(apiMe).toHaveBeenCalledTimes(2)
  })

  it('does not run heartbeat without session', async () => {
    vi.mocked(apiMe).mockRejectedValue(new ApiError(401, 'Not authenticated.'))

    render(<AuthProvider><Probe /></AuthProvider>)

    expect(await screen.findByText('Sem sessão')).toBeInTheDocument()
    expect(apiMe).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(180_000)
    expect(apiMe).toHaveBeenCalledTimes(1)
  })

  it('pauses heartbeat while hidden and resumes on visible', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)

    expect(await screen.findByText('Com sessão')).toBeInTheDocument()
    expect(apiMe).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(apiMe).toHaveBeenCalledTimes(1)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(apiMe).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(apiMe).toHaveBeenCalledTimes(3)
  })
})