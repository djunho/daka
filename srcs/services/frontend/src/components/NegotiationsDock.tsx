import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import Avatar from './Avatar'
import { apiListNegotiations, type ApiNegotiationSummary } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'
import { isNegotiationReadOnly } from '../types/negotiation'

/**
 * NegotiationsDock:
 * Floating dock / drawer pinned at the bottom-right of the viewport.
 * When minimized: displays a compact floating square with a 🤝 icon and active count badge.
 * When expanded: displays the list of negotiations as cards matching Daniel's wireframe,
 * allowing instant 1-click access to open the chat or navigate to the full negotiation page.
 */
export default function NegotiationsDock() {
  const { user } = useAuth()
  const { activeChat, openChat } = useChat()
  const [isOpen, setIsOpen] = useState(false)
  const [negotiations, setNegotiations] = useState<ApiNegotiationSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadNegotiations = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const page = await apiListNegotiations({ limit: 15 })
      setNegotiations(page.items)
    } catch {
      setError('Não foi possível carregar as negociações.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) {
      loadNegotiations()
    } else {
      setNegotiations([])
      setIsOpen(false)
    }
  }, [user, loadNegotiations])

  // Don't render anything for unauthenticated visitors
  if (!user) return null

  // Count active negotiations (not in read-only mode)
  const activeCount = negotiations.filter((n) => !isNegotiationReadOnly(n.state)).length

  return (
    <aside
      aria-label="Gaveta de negociações rápidas"
      className="flex items-end"
    >
      {/* 1. Minimized mode: compact floating trigger button with 🤝 symbol */}
      {!isOpen ? (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true)
            loadNegotiations()
          }}
          aria-label="Abrir gaveta de negociações"
          title="Ver negociações"
          className="relative mb-3 w-12 h-12 flex items-center justify-center bg-brand hover:bg-brand-hover text-white rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-200 select-none hover:scale-105 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
        >
          <span className="text-2xl" aria-hidden="true">🤝</span>
          {activeCount > 0 && (
            <span
              aria-label={`${activeCount} negociações ativas`}
              className="absolute -top-1.5 -right-1.5 bg-accent text-white text-[10px] font-bold min-w-5 h-5 px-1 flex items-center justify-center rounded-full border-2 border-surface shadow-sm"
            >
              {activeCount}
            </span>
          )}
        </button>
      ) : (
        /* 2. Expanded mode: card drawer with avatar, user name, listing title and action buttons */
        <div className="w-80 sm:w-88 bg-surface border border-line rounded-t-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 select-none">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-brand text-white">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg" aria-hidden="true">🤝</span>
              <h3 className="font-semibold text-sm truncate">As Minhas Negociações</h3>
              {negotiations.length > 0 && (
                <span className="text-[10px] bg-white/20 text-white font-bold px-2 py-0.5 rounded-full shrink-0">
                  {negotiations.length}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={loadNegotiations}
                disabled={loading}
                aria-label="Atualizar negociações"
                title="Atualizar lista"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/20 text-white text-xs font-bold transition-colors disabled:opacity-50"
              >
                ↻
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Minimizar negociações"
                title="Minimizar"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/20 text-white text-xs font-bold transition-colors"
              >
                ✕
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
                <span className="text-2xl mb-1 block" aria-hidden="true">📭</span>
                <p className="text-xs font-medium text-ink">Sem negociações</p>
                <p className="text-[11px] text-muted mt-0.5">
                  Ainda não tens negociações em curso. Explora os anúncios para propor trocas!
                </p>
              </div>
            )}

            {negotiations.map((neg) => {
              const otherUser = neg.other_participant
              const isCurrentChat = activeChat?.negotiationId === neg.id

              return (
                <article
                  key={neg.id}
                  className="bg-surface border border-line rounded-xl p-3 shadow-xs hover:border-line-strong transition-all flex flex-col gap-2.5"
                >
                  {/* Card top row: avatar + user name + listing title */}
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      avatar={otherUser.avatar}
                      user_name={otherUser.user_name}
                      size="sm"
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
                      onClick={() => openChat(neg.id, otherUser.user_name, isNegotiationReadOnly(neg.state))}
                      className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                        isCurrentChat
                          ? 'bg-brand/15 text-brand border border-brand/30'
                          : 'bg-brand hover:bg-brand-hover text-white'
                      }`}
                    >
                      <span aria-hidden="true">💬</span>
                      <span>{isCurrentChat ? 'Conversando' : 'Chat'}</span>
                    </button>
                    <Link
                      to={`/negotiations/${neg.id}`}
                      className="flex-1 py-1.5 px-2 bg-paper hover:bg-surface border border-line text-ink text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors no-underline text-center"
                    >
                      <span aria-hidden="true">📄</span>
                      <span>Negociação</span>
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>

          {/* Drawer footer */}
          {negotiations.length > 0 && (
            <div className="p-2.5 bg-surface border-t border-line text-center">
              <Link
                to="/negotiations"
                onClick={() => setIsOpen(false)}
                className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1"
              >
                <span>Ver todas as negociações</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
