import { useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'
import { ApiError, apiLogin, apiLogout, apiRegister, apiSession, type ApiUser } from '../lib/api'
import { AccountCreatedError } from '../lib/errors'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiSession: vi.fn(),
  apiLogout: vi.fn(),
  apiRegister: vi.fn(),
  apiLogin: vi.fn(),
}))

const ME: ApiUser = {
  id: 1,
  user_name: 'Ana',
  avatar: null,
  user_location: null, is_online: false,
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

  // The page load and every beat call /auth/session: the first call is the
  // page load, the next ones are beats.
  const NO_SESSION = { user: null }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(apiSession).mockReset().mockResolvedValue({ user: ME })
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('beats every 60s with a session and stops when the session has ended', async () => {
    vi.mocked(apiSession)
      .mockResolvedValueOnce({ user: ME })
      .mockResolvedValueOnce(NO_SESSION)

    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()
    expect(apiSession).toHaveBeenCalledTimes(1)

    // The session ended with the site open (expired, or logged out in another
    // tab): the beat answers user null, not a 401, and the page logs out.
    await advance(60_000)
    expect(apiSession).toHaveBeenCalledTimes(2)
    await advance(0)
    expect(screen.getByText('Sem sessão')).toBeInTheDocument()

    await advance(120_000)
    expect(apiSession).toHaveBeenCalledTimes(2)
  })

  it('does not beat without a session', async () => {
    vi.mocked(apiSession).mockResolvedValue(NO_SESSION)

    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Sem sessão')).toBeInTheDocument()

    await advance(180_000)
    expect(apiSession).toHaveBeenCalledTimes(1)
  })

  it('stays logged out when the check on page load fails', async () => {
    vi.mocked(apiSession).mockRejectedValue(new ApiError(0, 'Could not reach the server.'))

    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Sem sessão')).toBeInTheDocument()
    await advance(180_000)
    expect(apiSession).toHaveBeenCalledTimes(1)
  })

  it('pauses heartbeat while hidden and resumes on visible', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()
    expect(apiSession).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(120_000)
    expect(apiSession).toHaveBeenCalledTimes(1)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(apiSession).toHaveBeenCalledTimes(2)

    await advance(60_000)
    expect(apiSession).toHaveBeenCalledTimes(3)
  })

  it('does not beat right away when the tab comes back within 30s', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()
    expect(apiSession).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(10_000)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(apiSession).toHaveBeenCalledTimes(1)

    // The interval still runs after coming back.
    await advance(60_000)
    expect(apiSession).toHaveBeenCalledTimes(2)
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
    vi.mocked(apiSession).mockImplementation(async () => ({ user: { ...ME } }))

    render(<AuthProvider><Probe /><UserWatcher /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()
    const callsAfterLogin = onUserChange.mock.calls.length

    await advance(60_000)
    await advance(60_000)
    expect(apiSession).toHaveBeenCalledTimes(3)
    expect(onUserChange).toHaveBeenCalledTimes(callsAfterLogin)
  })

  it('replaces the user when the session now belongs to another account', async () => {
    vi.mocked(apiSession)
      .mockResolvedValueOnce({ user: ME })
      .mockResolvedValueOnce({ user: { ...ME, id: 2, user_name: 'Rita' } })
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
    vi.mocked(apiSession)
      .mockResolvedValueOnce({ user: ME })
      .mockRejectedValueOnce(error)

    render(<AuthProvider><Probe /></AuthProvider>)

    await advance(0)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()

    await advance(60_000)
    expect(apiSession).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Com sessão')).toBeInTheDocument()

    await advance(60_000)
    expect(apiSession).toHaveBeenCalledTimes(3)
  })
})

describe('AuthContext syncUser', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.mocked(apiSession).mockReset()
    vi.mocked(apiLogout).mockReset()
  })

  // Calls syncUser once on demand and shows its outcome and the current user
  function SyncProbe() {
    const { user, syncUser } = useAuth()
    const outcome = useRef<string>('')
    const [, rerender] = useState(0)
    return (
      <div>
        <p>{user ? user.user_name : 'Sem sessão'}</p>
        <p data-testid="outcome">{outcome.current}</p>
        <button
          onClick={async () => {
            outcome.current = await syncUser()
            rerender((n) => n + 1)
          }}
        >
          sync
        </button>
      </div>
    )
  }

  async function sync() {
    await act(async () => {
      screen.getByText('sync').click()
    })
  }

  it.each([
    ['same', ME, 'Ana'],
    ['changed', { ...ME, id: 2, user_name: 'Rita' }, 'Rita'],
  ] as const)('reports %s and keeps the matching user', async (outcome, me, shown) => {
    vi.mocked(apiSession)
      .mockResolvedValueOnce({ user: ME })
      .mockResolvedValueOnce({ user: me })
    render(<AuthProvider><SyncProbe /></AuthProvider>)
    expect(await screen.findByText('Ana')).toBeInTheDocument()

    await sync()
    expect(screen.getByTestId('outcome')).toHaveTextContent(outcome)
    expect(screen.getByText(shown)).toBeInTheDocument()
  })

  it('signs out locally on user null without revoking the cookie\'s session', async () => {
    vi.mocked(apiSession)
      .mockResolvedValueOnce({ user: ME })
      .mockResolvedValueOnce({ user: null })
    render(<AuthProvider><SyncProbe /></AuthProvider>)
    expect(await screen.findByText('Ana')).toBeInTheDocument()

    await sync()
    expect(screen.getByTestId('outcome')).toHaveTextContent('signedOut')
    expect(screen.getByText('Sem sessão')).toBeInTheDocument()
    expect(apiLogout).not.toHaveBeenCalled()
  })

  it('keeps the session when the check itself fails', async () => {
    vi.mocked(apiSession)
      .mockResolvedValueOnce({ user: ME })
      .mockRejectedValueOnce(new ApiError(0, 'offline'))
    render(<AuthProvider><SyncProbe /></AuthProvider>)
    expect(await screen.findByText('Ana')).toBeInTheDocument()

    await sync()
    expect(screen.getByTestId('outcome')).toHaveTextContent('unknown')
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })
})

describe('AuthContext logout', () => {
  it('clears the user at once, without waiting for /auth/logout to answer', async () => {
    vi.mocked(apiSession).mockReset().mockResolvedValue({ user: ME })
    let answer!: () => void
    vi.mocked(apiLogout).mockReset().mockReturnValue(new Promise<void>((resolve) => { answer = resolve }))
    let logout: ReturnType<typeof useAuth>['logout'] | null = null
    function Capture() {
      logout = useAuth().logout
      return null
    }
    render(<AuthProvider><Capture /><Probe /></AuthProvider>)
    await screen.findByText('Com sessão')

    let done: Promise<void> | null = null
    act(() => {
      done = logout!()
    })

    // The request is still running, and the user is already gone.
    expect(apiLogout).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Sem sessão')).toBeInTheDocument()
    await act(async () => {
      answer()
      await done
    })
  })

  it('stays logged out when /auth/logout fails', async () => {
    vi.mocked(apiSession).mockReset().mockResolvedValue({ user: ME })
    vi.mocked(apiLogout).mockReset().mockRejectedValue(new ApiError(0, 'Could not reach the server.'))
    let logout: ReturnType<typeof useAuth>['logout'] | null = null
    function Capture() {
      logout = useAuth().logout
      return null
    }
    render(<AuthProvider><Capture /><Probe /></AuthProvider>)
    await screen.findByText('Com sessão')

    await act(async () => {
      await logout!()
    })

    expect(screen.getByText('Sem sessão')).toBeInTheDocument()
  })
})

describe('AuthContext register', () => {
  let register: ReturnType<typeof useAuth>['register'] | null = null

  function Capture() {
    register = useAuth().register
    return null
  }

  beforeEach(() => {
    vi.mocked(apiSession).mockReset().mockResolvedValue({ user: null })
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
