import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ChatProvider } from './context/ChatContext'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import Home from './pages/Home'
import Login from './pages/Login'
import Profile from './pages/Profile'
import UserProfile from './pages/UserProfile'
import ListingDetail from './pages/ListingDetail'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import NotFound from './pages/NotFound'
import Publish from './pages/Publish'
import EditListing from './pages/EditListing'
import Negotiation from './pages/Negotiation'
import Negotiations from './pages/Negotiations'

// The router reads the address bar and decides which page component to show.
// BrowserRouter enables it; Routes picks the first Route whose path matches.
// URLs are in English; visible text is in English too now.
//
// AuthProvider wraps everything INSIDE BrowserRouter, so the context is
// available to every page, and so its helpers (like navigate on logout) can
// use the router. It runs one /auth/me check on load to restore any session.
export default function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AuthProvider>
        <ChatProvider>
          <Routes>
          <Route element={<Layout />}>
            {/* ---- Public routes ---- */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/profile" element={
                <RequireAuth>
                    <Profile />
                </RequireAuth>
            } />
            <Route path="/users/:id" element={
                <RequireAuth>
                    <UserProfile />
                </RequireAuth>
            } />
            <Route path="/listing/:id" element={<ListingDetail />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />

            {/* ---- Private routes ----
                RequireAuth (src/components/RequireAuth.tsx) redirects logged-out
                visitors to /login. The real protection is on the backend; this
                is only so they don't hit a broken page. */}
            <Route path="/publish" element={
                <RequireAuth>
                    <Publish />
                </RequireAuth>
            } />
            <Route path="/listing/:id/edit" element={
                <RequireAuth>
                    <EditListing />
                </RequireAuth>
            } />
            <Route path="/negotiations" element={
                <RequireAuth>
                    <Negotiations />
                </RequireAuth>
            } />
            <Route path="/negotiations/:id" element={
                <RequireAuth>
                    <Negotiation />
                </RequireAuth>
            } />

            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        </ChatProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
