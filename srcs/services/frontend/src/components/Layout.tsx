import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import Header from './Header'

// A page can send a one-off message to the next one through the navigation
// state, e.g. navigate('/', { state: { notice: 'O teu anúncio foi removido.' } }).
type NoticeState = { notice?: string } | null

// Shared shell: Header on top, the current page in the middle (<Outlet/>),
// and a footer with the legally-required links reachable from every page.
export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(null)

  // A new page starts at the top. Changing the route does not reload the
  // document, so without this the scroll position of the previous page stays
  // (and a notice at the top of the new page would be out of sight).
  // A notice also belongs to the page it was sent to: going anywhere else drops it.
  useEffect(() => {
    window.scrollTo(0, 0)
    setNotice(null)
  }, [location.pathname])

  useEffect(() => {
    const incoming = (location.state as NoticeState)?.notice
    if (!incoming) return
    setNotice(incoming)
    // Clear it from the history entry, so a reload or coming Back to this
    // page does not show the same notice again.
    navigate(location.pathname + location.search + location.hash, { replace: true, state: null })
  }, [location, navigate])

  return (
    <>
      <Header />
      {/* Always in the page, so screen readers announce the text put in it. */}
      <div role="status">
        {notice && (
          <div className="px-4 sm:px-6 pt-4">
            {/* w-fit: the box is as wide as its message, no empty stretch. */}
            <div className="w-fit max-w-full flex items-center gap-3 bg-brand text-white rounded-xl pl-4 pr-2 py-2.5 shadow-md">
              <span aria-hidden="true" className="font-bold">✓</span>
              <p className="text-sm font-semibold">{notice}</p>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Fechar aviso"
                className="text-white/70 hover:text-white hover:bg-white/15 rounded-lg px-2 py-0.5"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>
        )}
      </div>
      <Outlet />
      <footer className="flex justify-center items-center gap-1 px-4 sm:px-6 py-6 mt-6 border-t border-line text-muted text-sm">
        <Link to="/privacy" className="inline-flex items-center min-h-11 px-3 hover:text-brand transition-colors no-underline">Privacidade</Link>
        <span aria-hidden="true">·</span>
        <Link to="/terms" className="inline-flex items-center min-h-11 px-3 hover:text-brand transition-colors no-underline">Termos</Link>
      </footer>
    </>
  )
}
