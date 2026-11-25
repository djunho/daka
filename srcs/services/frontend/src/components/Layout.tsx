import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import Header from './Header'
import Icon from './Icon'
import NegotiationChatWidget from './NegotiationChatWidget'
import NegotiationsDock from './NegotiationsDock'
import { useChat } from '../context/ChatContext'

// A page can send a one-off message to the next one through the navigation
// state, e.g. navigate('/', { state: { notice: 'O teu anúncio foi removido.' } }).
type NoticeState = { notice?: string } | null

// Shared shell: Header on top, the current page in the middle (<Outlet/>),
// and a footer with the legally-required links reachable from every page.
export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(null)
  const { activeChat, closeChat } = useChat()

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
              <Icon name="check" size={18} />
              <p className="text-sm font-semibold">{notice}</p>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Fechar aviso"
                className="text-white/70 hover:text-white hover:bg-white/15 rounded-lg p-1.5"
              >
                <Icon name="close" size={16} />
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
        <span aria-hidden="true">·</span>
        <Link to="/design-system" className="inline-flex items-center min-h-11 px-3 hover:text-brand transition-colors no-underline">Design system</Link>
      </footer>

      {/* Floating dock container pinned to the bottom-right. The chat widget and
          the dock sit side by side; when they do not fit (phones) the row wraps
          and the dock drops below the chat instead of overflowing off-screen. */}
      <div className="fixed bottom-0 right-2 sm:right-6 z-50 flex flex-wrap justify-end items-end gap-3 pointer-events-none max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-3rem)]">
        {/* 1. Chat Widget (positioned to the left of the dock) */}
        {activeChat && (
          <div className="pointer-events-auto">
            <NegotiationChatWidget
              key={activeChat.negotiationId}
              negotiationId={activeChat.negotiationId}
              interlocutorId={activeChat.interlocutorId}
              interlocutorName={activeChat.interlocutorName}
              isReadOnly={activeChat.isReadOnly}
              onClose={closeChat}
            />
          </div>
        )}

        {/* 2. Negotiations Dock (anchored on the far right) */}
        <div className="pointer-events-auto">
          <NegotiationsDock />
        </div>
      </div>
    </>
  )
}
