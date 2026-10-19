import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import {
  ApiError,
  apiDeleteAvatar,
  apiLogin,
  apiLogout,
  apiMe,
  apiDeleteAccount,
  apiRegister,
  apiUpdateProfile,
  apiUploadAvatar,
  type UpdateProfileData,
  type ApiUser,
} from '../lib/api'

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [loading, setLoading] = useState(true)

  // On first mount, ask the backend who we are. If a valid session cookie is
  // present, /auth/me returns the user; if not, it 401s and we stay logged
  // out. This is what restores a session after a page refresh -- the cookie
  // survives the reload, and this call reads it back.
  useEffect(() => {
    apiMe()
      .then((me) => setUser(me))
      .catch((err) => {
        // A 401 here is normal: it just means nobody is logged in. Anything
        // else (server down) also leaves us logged out, which is the safe
        // default. Either way, swallow it -- there is nothing to show.
        if (!(err instanceof ApiError)) {
          // Unexpected non-API error; leave user null but don't crash.
        }
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

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
    const me = await apiLogin(email, password)
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
    // Tell the server to delete the session row, then forget the user locally.
    // We clear user even if the request fails, because the intent is to be
    // logged out -- a failed logout should not trap someone in a signed-in UI.
    try {
      await apiLogout()
    } catch {
      // Network/server failure: still log out locally.
    } finally {
      setUser(null)
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
