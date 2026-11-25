import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'

// Wraps a private route. If nobody is logged in, it sends the visitor to the
// login page instead of rendering the protected content. Used in App.tsx like:
//
//   <Route path="/publish" element={<RequireAuth><Publish /></RequireAuth>} />
//
// This is a client-side convenience, NOT a security boundary. The real
// protection is on the backend: every private endpoint checks the session with
// get_current_user. A user could bypass this guard by editing the page in
// their browser, but they still could not call the API without a valid cookie.
// The guard just spares logged-out users a broken page and a confusing 401.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  // While the first /auth/me check is still running we don't yet know whether
  // there is a session, so render nothing rather than briefly bouncing a
  // logged-in user to /login. A spinner could go here later.
  if (loading) {
    return null
  }

  if (user === null) {
    // Redirect to login, remembering where they were headed so we could send
    // them back after they sign in (a nicety a later step can use via
    // location.state.from). `replace` avoids piling the guarded URL onto the
    // history stack.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}