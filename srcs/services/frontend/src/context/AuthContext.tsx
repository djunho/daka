import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import {
  apiDeleteAvatar,
  apiLogin,
  apiLogout,
  apiDeleteAccount,
  apiRegister,
  apiSession,
  apiUpdateProfile,
  apiUploadAvatar,
  type UpdateProfileData,
  type ApiUser,
} from '../lib/api'
import { AccountCreatedError } from '../lib/errors'

// The single place that knows who is logged in. Any component that needs the
// current user -- the header, the route guard, a profile page -- reads it from
// here instead of calling the API itself. That keeps one consistent answer
// across the whole app and one place to change how auth works.

type AuthContextValue = {
  // The logged-in user, or null when nobody is. undefined would be ambiguous,
  // so we use null explicitly for "checked, and nobody is logged in".
  user: ApiUser | null
  // True only during the very first /auth/me check on page load. The UI uses
  // it to avoid flashing the logged-out header for a moment before we know.
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (data: UpdateProfileData) => Promise<void>
  deleteAccount: () => Promise<void>
  uploadAvatar: (file: File) => Promise<void>
  removeAvatar: () => Promise<void>
}

// createContext needs a default. We pass null and guard against it in the hook
// below, so using the context outside its provider fails loudly instead of
// silently handing back a broken default.
const AuthContext = createContext<AuthContextValue | null>(null)

// The backend counts a user as online for 3 minutes after their last
// authenticated request, so one heartbeat a minute keeps an open tab online.
const HEARTBEAT_INTERVAL_MS = 60_000
// When a hidden tab becomes visible again, beat right away only if the last
// beat is at least this old.
const HEARTBEAT_MIN_GAP_MS = 30_000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [loading, setLoading] = useState(true)

  // On first mount, ask the backend who we are. If a valid session cookie is
  // present, /auth/session returns the user; if not, it returns user null and
  // we stay logged out. This is what restores a session after a page refresh
  // -- the cookie survives the reload, and this call reads it back. It is not
  // /auth/me because that answers 401 without a session, and the browser
  // prints every 401 in red in the console, on every visit.
  useEffect(() => {
    apiSession()
      .then(({ user: current }) => setUser(current))
      .catch(() => {
        // The server could not be reached or failed: staying logged out is
        // the safe default, and there is nothing to show.
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (user === null) return

    let active = true
    let intervalId: ReturnType<typeof window.setInterval> | null = null
    // The user was fetched just before this effect runs (page load or login),
    // so that request counts as the latest heartbeat.
    let lastHeartbeatAt = Date.now()

    const stopHeartbeat = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    const runHeartbeat = async () => {
      lastHeartbeatAt = Date.now()
      try {
        // /auth/session rather than /auth/me: when the session ends with the
        // site open (it expires, or another tab logs out), the answer is
        // user null instead of a 401 printed in red in the console.
        const { user: current } = await apiSession()
        if (!active) return
        if (current === null) {
          stopHeartbeat()
          setUser(null)
          return
        }
        // Keep the same object while the session still belongs to the same
        // account. A new object on every beat would re-run every effect that
        // depends on `user` (the profile form would reset what is being
        // typed). Only a different account (a login in another tab) replaces it.
        setUser((prev) => (prev?.id === current.id ? prev : current))
      } catch {
        // A server or network failure keeps the session: the next beat tries again.
      }
    }

    const startHeartbeat = () => {
      if (intervalId !== null || document.visibilityState === 'hidden') return
      intervalId = window.setInterval(() => {
        void runHeartbeat()
      }, HEARTBEAT_INTERVAL_MS)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopHeartbeat()
        return
      }
      // Switching back and forth between tabs must not send a request each
      // time: the backend keeps someone online for 3 minutes anyway.
      if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MIN_GAP_MS) {
        void runHeartbeat()
      }
      startHeartbeat()
    }

    startHeartbeat()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      active = false
      stopHeartbeat()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [user !== null])

  // These wrap the API calls and, on success, update the shared user so the
  // whole app re-renders as logged in. The backend sets the cookie in its
  // response; we just record who it now belongs to.
  async function login(email: string, password: string) {
    const me = await apiLogin(email, password)
    setUser(me)
  }

  async function register(name: string, email: string, password: string) {
    // Create the account, then log in immediately so the user lands signed in
    // rather than being sent back to the sign-in tab. This is the "auto login
    // after register" behaviour we chose.
    await apiRegister(name, email, password)
    let me: ApiUser
    try {
      me = await apiLogin(email, password)
    } catch (err) {
      // The account exists from here on: say so, rather than let the sign-in
      // error look like the sign-up failed.
      throw new AccountCreatedError(err)
    }
    setUser(me)
  }

  async function updateProfile(data: UpdateProfileData) {
    // Update the user profile
    const updated = await apiUpdateProfile(data)
    setUser(updated)
  }

  async function deleteAccount() {
    await apiDeleteAccount()
    setUser(null)
    // Perform a clean window-level navigation rather than React Router's SPA navigate.
    // Account deletion is a destructive terminal event; this ensures all in-memory client
    // state is flushed and prevents <RequireAuth> from intercepting the URL transition
    // and stripping the ?error= query parameter.
    window.location.replace('/login?error=account_deleted')
  }

  // Both avatar calls answer with the updated user, so storing it here is
  // enough for every avatar on screen (profile page, header menu) to change.
  async function uploadAvatar(file: File) {
    const updated = await apiUploadAvatar(file)
    setUser(updated)
  }

  async function removeAvatar() {
    const updated = await apiDeleteAvatar()
    setUser(updated)
  }

  async function logout() {
    // Forget the user first, so the UI leaves the signed-in state at once.
    // Pages call this when the server already answered 401: waiting for
    // /auth/logout would leave them on screen, with no message, for as long as
    // that request takes. It is still sent, to delete the session row and the
    // cookie, and a failure is ignored: a failed logout should not trap
    // someone in a signed-in UI.
    setUser(null)
    try {
      await apiLogout()
    } catch {
      // Network/server failure: already logged out locally.
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        updateProfile,
        deleteAccount,
        uploadAvatar,
        removeAvatar,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// The hook every component uses: `const { user, logout } = useAuth()`. Throwing
// when there is no provider turns a whole class of "why is user always null?"
// bugs into an immediate, clear error.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (ctx === null) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return ctx
}
