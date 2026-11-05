import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'
import { ApiError, apiLogin, apiMe, apiRegister, type ApiUser } from '../lib/api'
import { AccountCreatedError } from '../lib/errors'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiMe: vi.fn(),
  apiRegister: vi.fn(),
  apiLogin: vi.fn(),
}))

const ME: ApiUser = {
  id: 1,
  user_name: 'Ana',
  avatar: null,
  user_location: null,
  email: 'ana@example.com',
  created_at: '2026-01-01T00:00:00',
}

// findBy* waits with setTimeout, which the fake timers freeze. Advance the
// fake clock inside act() instead, so promises settle and React re-renders.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
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

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()
    expect(apiMe).toHaveBeenCalledTimes(1)

    await advance(60_000)
    expect(apiMe).toHaveBeenCalledTimes(2)
    await advance(0)
    expect(screen.getByText('Sem sessão')).toBeInTheDocument()

    await advance(120_000)
    expect(apiMe).toHaveBeenCalledTimes(2)
  })

  it('does not run heartbeat without session', async () => {
    vi.mocked(apiMe).mockRejectedValue(new ApiError(401, 'Not authenticated.'))

    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Sem sessão')).toBeInTheDocument()
    expect(apiMe).toHaveBeenCalledTimes(1)

    await advance(180_000)
    expect(apiMe).toHaveBeenCalledTimes(1)
  })

  it('pauses heartbeat while hidden and resumes on visible', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()
    expect(apiMe).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(120_000)
    expect(apiMe).toHaveBeenCalledTimes(1)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(apiMe).toHaveBeenCalledTimes(2)

    await advance(60_000)
    expect(apiMe).toHaveBeenCalledTimes(3)
  })

  it('does not beat right away when the tab comes back within 30s', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()
    expect(apiMe).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(10_000)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(apiMe).toHaveBeenCalledTimes(1)

    // The interval still runs after coming back.
    await advance(60_000)
    expect(apiMe).toHaveBeenCalledTimes(2)
  })

  it('keeps the same user object when the heartbeat returns the same account', async () => {
    const onUserChange = vi.fn()
    function UserWatcher() {
      const { user } = useAuth()
      useEffect(() => {
        onUserChange(user)
      }, [user])
      return null
    }
    // A fresh object with the same data, as the API would return.
    vi.mocked(apiMe).mockImplementation(async () => ({ ...ME }))

    render(<AuthProvider><Probe /><UserWatcher /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()
    const callsAfterLogin = onUserChange.mock.calls.length

    await advance(60_000)
    await advance(60_000)
    expect(apiMe).toHaveBeenCalledTimes(3)
    expect(onUserChange).toHaveBeenCalledTimes(callsAfterLogin)
  })

  it('replaces the user when the session now belongs to another account', async () => {
    vi.mocked(apiMe)
      .mockResolvedValueOnce(ME)
      .mockResolvedValueOnce({ ...ME, id: 2, user_name: 'Rita' })
    function NameProbe() {
      const { user } = useAuth()
      return <p>{user?.user_name}</p>
    }

    render(<AuthProvider><NameProbe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Ana')).toBeInTheDocument()
    await advance(60_000)
    expect(screen.getByText('Rita')).toBeInTheDocument()
  })

  it.each([
    ['a server error', new ApiError(500, 'Server error')],
    ['a network error', new TypeError('Failed to fetch')],
  ])('keeps the session and the timer after %s', async (_, error) => {
    vi.mocked(apiMe)
      .mockResolvedValueOnce(ME)
      .mockRejectedValueOnce(error)

    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()

    await advance(60_000)
    expect(apiMe).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()

    await advance(60_000)
    expect(apiMe).toHaveBeenCalledTimes(3)
  })
})
describe('AuthContext register', () => {
  let register: ReturnType<typeof useAuth>['register'] | null = null

  function Capture() {
    register = useAuth().register
    return null
  }

  beforeEach(() => {
    vi.mocked(apiMe).mockReset().mockRejectedValue(new ApiError(401, 'Not authenticated.'))
    vi.mocked(apiRegister).mockReset().mockResolvedValue(ME)
    vi.mocked(apiLogin).mockReset().mockResolvedValue(ME)
  })

  async function renderAndRegister() {
    render(<AuthProvider><Capture /><Probe /></AuthProvider>)
    await screen.findByText('Sem sessão')
    let thrown: unknown = null
    await act(async () => {
      try {
        await register!('Ana', ME.email, 'correct-horse-battery')
      } catch (err) {
        thrown = err
      }
    })
    return thrown
  }

  it('signs in right after creating the account', async () => {
    expect(await renderAndRegister()).toBeNull()
    expect(apiLogin).toHaveBeenCalledWith(ME.email, 'correct-horse-battery')
    expect(screen.getByText('Com sessão')).toBeInTheDocument()
  })

  it('says the account was created when only the sign-in after it fails', async () => {
    const loginError = new ApiError(401, 'Incorrect email or password.')
    vi.mocked(apiLogin).mockRejectedValue(loginError)

    const thrown = await renderAndRegister()
    expect(thrown).toBeInstanceOf(AccountCreatedError)
    expect((thrown as AccountCreatedError).cause).toBe(loginError)
    expect(screen.getByText('Sem sessão')).toBeInTheDocument()
  })

  it('keeps the original error when the account could not be created', async () => {
    const conflict = new ApiError(409, 'An account with this email already exists.')
    vi.mocked(apiRegister).mockRejectedValue(conflict)

    expect(await renderAndRegister()).toBe(conflict)
    expect(apiLogin).not.toHaveBeenCalled()
  })
})
