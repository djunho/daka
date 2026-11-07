import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import Avatar from './Avatar'
import Icon from './Icon'
import { ApiError, apiListNegotiations, type ApiNegotiationPage, type ApiNegotiationSummary } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'
import { ACTIVE_NEGOTIATION_STATES, isNegotiationReadOnly } from '../types/negotiation'
import { DOCK_TRIGGER_ID } from '../types/chat'

// Cards per active state. Closed negotiations are not listed here: their
// read-only chat is reachable from the negotiation page (linked from /negotiations).
const DOCK_CARDS = 15

/**
 * NegotiationsDock:
 * Floating dock / drawer pinned at the bottom-right of the viewport.
 * When minimized: displays a compact floating square with the swap icon and active count badge.
 * When expanded: displays the active negotiations (Open and Agreed) as cards matching
 * Daniel's wireframe, allowing instant 1-click access to open the chat or navigate to
 * the full negotiation page.
 */
export default function NegotiationsDock() {
  const { user, logout } = useAuth()
  const { activeChat, openChat } = useChat()
  const [isOpen, setIsOpen] = useState(false)

  // Opening and collapsing swap the focused element for another one, so move
  // the focus along: into the drawer when it opens, back to the trigger when
  // it collapses, unless something else took it (a chat opened from a card
  // focuses the chat widget).
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const wasOpenRef = useRef(false)
  // Set by the footer link: the person is going to another page, whose own
  // focus handling applies, so the trigger must not pull the focus back here.
  const navigatingAwayRef = useRef(false)
  useEffect(() => {
    if (isOpen) {
      panelRef.current?.focus()
    } else if (wasOpenRef.current && !navigatingAwayRef.current) {
      const active = document.activeElement
      if (!active || active === document.body) triggerRef.current?.focus()
    }
    navigatingAwayRef.current = false
    wasOpenRef.current = isOpen
  }, [isOpen])
  const [negotiations, setNegotiations] = useState<ApiNegotiationSummary[]>([])
  // Server-side totals of Open + Agreed: exact even beyond the cards shown
  // null when the last load failed: unknown is not the same as none
  const [activeCount, setActiveCount] = useState<number | null>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One request in flight at a time: a refresh, a logout or an unmount cancels
  // the previous one, so a slow response cannot repopulate the list afterwards
  // (e.g. with the previous account's negotiations after signing out).
  const controllerRef = useRef<AbortController | null>(null)
  // logout is recreated on every AuthProvider render; the ref keeps
  // loadNegotiations stable so the effect below only follows `user`.
  const logoutRef = useRef(logout)
  useEffect(() => {
    logoutRef.current = logout
  }, [logout])

  const loadNegotiations = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError(null)
    try {
      // The list filter takes one state, so each active state is one request.
      // All are awaited to the end: a 401 on any must sign out, even when
      // another one failed first.
      const results = await Promise.allSettled(
        ACTIVE_NEGOTIATION_STATES.map((state) =>
          apiListNegotiations({ state, limit: DOCK_CARDS }, controller.signal),
        ),
      )
      if (controller.signal.aborted) return
      const failures = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
      if (failures.some((err) => err instanceof ApiError && err.status === 401)) {
        // The session expired. Clearing it lets RequireAuth send them to login.
        void logoutRef.current()
        return
      }
      if (failures.length > 0) {
        // No half-loaded or outdated list under the error message
        setNegotiations([])
        setActiveCount(null)
        setError('Não foi possível carregar as negociações.')
        return
      }
      const pages = results.map((r) => (r as PromiseFulfilledResult<ApiNegotiationPage>).value)
      // Each page holds its state's newest DOCK_CARDS, so the newest DOCK_CARDS of
      // their union are exactly the newest active ones overall.
      // A negotiation that changed state between the requests can be in two
      // pages; keep it once (its newest copy comes first after sorting).
      const seen = new Set<number>()
      setNegotiations(
        pages
          .flatMap((page) => page.items)
          .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id)
          .filter((n) => !seen.has(n.id) && seen.add(n.id) !== undefined)
          .slice(0, DOCK_CARDS),
      )
      setActiveCount(pages.reduce((sum, page) => sum + page.total, 0))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user) {
      void loadNegotiations()
    } else {
      setNegotiations([])
      setActiveCount(0)
      setLoading(false)
      setIsOpen(false)
    }
    return () => controllerRef.current?.abort()
  }, [user, loadNegotiations])

  // Don't render anything for unauthenticated visitors
  if (!user) return null

  const activeLabel = activeCount === 1 ? '1 negociação ativa' : `${activeCount} negociações ativas`
  const triggerLabel =
    activeCount === null
      ? 'Abrir gaveta de negociações, não foi possível carregar as negociações'
      : activeCount > 0
        ? `Abrir gaveta de negociações, ${activeLabel}`
        : 'Abrir gaveta de negociações'

  return (
    <aside
      aria-label="Gaveta de negociações rápidas"
      className="flex items-end"
    >
      {/* 1. Minimized mode: compact floating trigger button with the swap icon */}
      {!isOpen ? (
        <button
          ref={triggerRef}
          id={DOCK_TRIGGER_ID}
          type="button"
          onClick={() => {
            setIsOpen(true)
            void loadNegotiations()
          }}
          aria-label={triggerLabel}
          title="Ver negociações"
          className="relative mb-3 w-12 h-12 flex items-center justify-center bg-brand hover:opacity-90 text-white rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-200 select-none hover:scale-105 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
        >
          <Icon name="swap" size={26} />
          {(activeCount === null || activeCount > 0) && (
            // The count is read as part of the button's label: an aria-label on a
            // plain span is ignored by screen readers. "!" marks an unknown count.
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -right-1.5 bg-accent text-white text-[10px] font-bold min-w-5 h-5 px-1 flex items-center justify-center rounded-full border-2 border-surface shadow-sm"
            >
              {activeCount ?? '!'}
            </span>
          )}
        </button>
      ) : (
        /* 2. Expanded mode: card drawer with avatar, user name, listing title and action buttons */
        <div
          ref={panelRef}
          tabIndex={-1}
          role="region"
          aria-label="As Minhas Negociações"
          className="w-[min(20rem,calc(100vw-1rem))] sm:w-88 bg-surface border border-line rounded-t-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 focus:outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-brand text-white">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="swap" size={18} />
              <h3 className="font-semibold text-sm truncate">As Minhas Negociações</h3>
              {activeCount !== null && activeCount > 0 && (
                <span className="text-[10px] bg-white/20 text-white font-bold px-2 py-0.5 rounded-full shrink-0">
                  {activeCount}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void loadNegotiations()}
                disabled={loading}
                aria-label="Atualizar negociações"
                title="Atualizar lista"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/20 text-white transition-colors disabled:opacity-50"
              >
                <Icon name="refresh" size={16} />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Minimizar negociações"
                title="Minimizar"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/20 text-white transition-colors"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>

          {/* Negotiations list (scrollable) */}
          <div className="max-h-96 overflow-y-auto p-3 space-y-2.5 bg-paper">
            {loading && negotiations.length === 0 && (
              <div className="py-8 text-center text-xs text-muted">
                A carregar negociações...
              </div>
            )}

            {error && (
              <div className="py-4 px-3 bg-accent/10 border border-accent/20 rounded-xl text-center text-xs text-accent">
                {error}
              </div>
            )}

            {!loading && !error && negotiations.length === 0 && (
              <div className="py-8 text-center text-muted px-4">
                <Icon name="inbox" size={28} className="mx-auto mb-1.5" />
                <p className="text-xs font-medium text-ink">Sem negociações ativas</p>
                <p className="text-[11px] text-muted mt-0.5">
                  Não tens negociações em curso. Explora os anúncios para propor trocas!
                </p>
              </div>
            )}

            {negotiations.map((neg) => {
              const otherUser = neg.other_participant
              const isCurrentChat = activeChat?.negotiationId === neg.id

              return (
                <article
                  key={neg.id}
                  className="bg-surface border border-line rounded-xl p-3 shadow-xs hover:border-brand transition-all flex flex-col gap-2.5"
                >
                  {/* Card top row: avatar + user name + listing title */}
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      avatar={otherUser.avatar}
                      user_name={otherUser.user_name}
                      size="sm"
                      online={otherUser.is_online}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="font-semibold text-xs text-ink truncate">
                          {otherUser.user_name}
                        </p>
                        <span className="text-[10px] font-medium text-muted bg-paper border border-line px-1.5 py-0.5 rounded shrink-0">
                          #{neg.id}
                        </span>
                      </div>
                      <p
                        className="text-xs text-muted truncate mt-0.5"
                        title={neg.requested_listing.title}
                      >
                        {neg.requested_listing.title}
                      </p>
                    </div>
                  </div>

                  {/* Card bottom row: Chat and Negotiation action buttons */}
                  <div className="flex items-center gap-2 pt-1 border-t border-line/60">
                    <button
                      type="button"
                      onClick={() => {
                        // Always writable for the states listed; kept so the call
                        // stays right if the list ever widens.
                        openChat(neg.id, otherUser, isNegotiationReadOnly(neg.state))
                        // Picking a conversation collapses the drawer so the chat gets the
                        // space; on phones both panels would not fit side by side.
                        setIsOpen(false)
                      }}
                      className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                        isCurrentChat
                          ? 'bg-brand/15 text-brand border border-brand/30'
                          : 'bg-brand hover:opacity-90 text-white'
                      }`}
                    >
                      <Icon name="chat" size={14} />
                      <span>{isCurrentChat ? 'A conversar' : 'Chat'}</span>
                    </button>
                    <Link
                      to={`/negotiations/${neg.id}`}
                      className="flex-1 py-1.5 px-2 bg-paper hover:bg-surface border border-line text-ink text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors no-underline text-center"
                    >
                      <Icon name="document" size={14} />
                      <span>Negociação</span>
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>

          {/* Drawer footer: the full list also holds the closed negotiations */}
          <div className="p-2.5 bg-surface border-t border-line text-center">
            <Link
              to="/negotiations"
              onClick={() => {
                navigatingAwayRef.current = true
                setIsOpen(false)
              }}
              className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1"
            >
              <span>Ver todas as negociações</span>
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>
        </div>
      )}
    </aside>
  )
}
