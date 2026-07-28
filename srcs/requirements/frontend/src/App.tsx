import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Login from './pages/Login'
import ListingDetail from './pages/ListingDetail'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import NotFound from './pages/NotFound'

// The router reads the address bar and decides which page component to show.
// BrowserRouter enables it; Routes picks the first Route whose path matches.
// URLs are in English; the visible text stays in Portuguese.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* ---- Public routes ---- */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/listing/:id" element={<ListingDetail />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />

          {/* ---- Private routes (to be wrapped in an auth guard later,
                  once authentication exists): /publish, /trades,
                  /settings, /messages ---- */}

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
