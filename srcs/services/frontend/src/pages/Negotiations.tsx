import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Button, { buttonClasses } from '../components/Button'
import { EMPTY_STATE_CLASSES } from '../components/ListingCard'
import { useAuth } from '../context/AuthContext'
import {
  ApiError,
  apiListNegotiations,
  type ApiNegotiationPage,
  type ApiNegotiationState,
  type ApiNegotiationSummary,
  type NegotiationRole,
} from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'
import { categoryTint } from '../types/listing'
import {
  activeProposalSummary,
  NEGOTIATION_ROLE_LABELS,
  NEGOTIATION_STATE_LABELS,
} from '../types/negotiation'

const PAGE_SIZE = 20
// Same value as MAX_PAGE_OFFSET in the backend's schemas.py.
const MAX_OFFSET = 1_000_000_000
const ROLES = Object.keys(NEGOTIATION_ROLE_LABELS) as NegotiationRole[]
const STATES = Object.keys(NEGOTIATION_STATE_LABELS) as ApiNegotiationState['state_name'][]

const SELECT_CLASSES =
  'px-3 py-2.5 bg-paper border border-line rounded-full text-base text-ink focus:border-brand transition-colors'

export default function Negotiations() {
  const { user, logout } = useAuth()
  // Filters and page live in the URL, so they survive a reload and the Back
  // button. Values edited by hand are ignored: the backend would answer 422.
  const [searchParams, setSearchParams] = useSearchParams()
  const role = ROLES.find((r) => r === searchParams.get('role'))
  const state = STATES.find((s) => s === searchParams.get('state'))
  const pageParam = Number(searchParams.get('page'))
  // A page past the backend's offset ceiling would only get a 422.
  const page =
    Number.isInteger(pageParam) && pageParam > 0 && (pageParam - 1) * PAGE_SIZE <= MAX_OFFSET
      ? pageParam
      : 1
  const hasFilters = role !== undefined || state !== undefined

  const [data, setData] = useState<ApiNegotiationPage | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped by "Tentar outra vez" to run the request below again.
  const [attempt, setAttempt] = useState<number>(0)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    // Set by the cleanup when the filters change again: the slow response for
    // the old filters is dropped instead of replacing the current list.
    let ignore = false
    // The cleanup also cancels that old request, so only one is ever in flight.
    // This covers fast filter changes and React running the effect twice in
    // development (StrictMode).
    const controller = new AbortController()

    setData(null)
    setLoading(true)
    setError(null)
    apiListNegotiations({ role, state, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, controller.signal)
      .then((result) => {
        if (ignore) return
        setData(result)
      })
      .catch((err) => {
        if (ignore) return
        if (err instanceof ApiError && err.status === 401) {
          // The session expired. Clearing it lets RequireAuth send them to login.
          void logout()
          return
        }
        setError(getPortugueseErrorMessage(err, 'Não foi possível carregar as negociações. Tenta outra vez.'))
      })
      .finally(() => {
        if (ignore) return
        setLoading(false)
      })

    return () => {
      ignore = true
      controller.abort()
    }
    // logout is recreated on every render and does not change what is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, state, page, attempt])

  // A filter applies to the whole list, so it always goes back to page one.
  function setFilter(name: 'role' | 'state', value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set(name, value)
    } else {
      next.delete(name)
    }
    next.delete('page')
    setSearchParams(next)
  }

  function goToPage(target: number) {
    const next = new URLSearchParams(searchParams)
    if (target > 1) {
      next.set('page', String(target))
    } else {
      next.delete('page')
    }
    setSearchParams(next)
    // The new page starts at the top. This also tells screen readers it changed.
    headingRef.current?.focus()
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold text-ink mb-6">
        Negociações
      </h1>

      <div className="flex flex-wrap gap-4 mb-6">
        <label className="flex items-center gap-2 text-sm text-muted">
          Participação
          <select
            value={role ?? ''}
            onChange={(e) => setFilter('role', e.target.value)}
            className={SELECT_CLASSES}
          >
            <option value="">Todas</option>
            <option value="owner">Como proprietário</option>
            <option value="interested">Como interessado</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          Estado
          <select
            value={state ?? ''}
            onChange={(e) => setFilter('state', e.target.value)}
            className={SELECT_CLASSES}
          >
            <option value="">Todos</option>
            {STATES.map((s) => (
              <option key={s} value={s}>{NEGOTIATION_STATE_LABELS[s]}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Order matters: loading must come before the empty checks, or the
          "nothing here" message would flash while the request is running. */}
      {error ? (
        <div className={EMPTY_STATE_CLASSES}>
          <p role="alert" className="mb-4">{error}</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>Tentar outra vez</Button>
        </div>
      ) : loading || !data ? (
        <p className={EMPTY_STATE_CLASSES} role="status">A carregar negociações…</p>
      ) : items.length === 0 ? (
        <EmptyList
          hasFilters={hasFilters}
          pastTheEnd={total > 0}
          onClearFilters={() => setSearchParams({})}
          onFirstPage={() => goToPage(1)}
        />
      ) : (
        <>
          <p className="text-sm text-muted mb-3" role="status">
            {total} {total === 1 ? 'negociação' : 'negociações'}
          </p>
          <ul className="space-y-4">
            {items.map((negotiation) => (
              <li key={negotiation.id}>
                <NegotiationCard negotiation={negotiation} currentUserId={user?.id} />
              </li>
            ))}
          </ul>

          <nav aria-label="Paginação" className="flex flex-col items-center gap-3 mt-8">
            <p className="text-sm text-muted">
              Página {page} de {lastPage}
              {page >= lastPage && ' · Não há mais resultados.'}
            </p>
            {lastPage > 1 && (
              <div className="flex gap-3">
                <Button disabled={page <= 1} onClick={() => goToPage(page - 1)}>Anterior</Button>
                <Button disabled={page >= lastPage} onClick={() => goToPage(page + 1)}>Seguinte</Button>
              </div>
            )}
          </nav>
        </>
      )}
    </main>
  )
}

function EmptyList({
  hasFilters,
  pastTheEnd,
  onClearFilters,
  onFirstPage,
}: {
  hasFilters: boolean
  pastTheEnd: boolean
  onClearFilters: () => void
  onFirstPage: () => void
}) {
  // A page number past the end, e.g. from an old link or after others closed.
  if (pastTheEnd) {
    return (
      <div className={EMPTY_STATE_CLASSES}>
        <p className="mb-4">Não há mais resultados.</p>
        <Button onClick={onFirstPage}>Voltar à primeira página</Button>
      </div>
    )
  }
  if (hasFilters) {
    return (
      <div className={EMPTY_STATE_CLASSES}>
        <p className="mb-4">Nenhuma negociação corresponde aos filtros.</p>
        <Button onClick={onClearFilters}>Limpar filtros</Button>
      </div>
    )
  }
  return (
    <div className={EMPTY_STATE_CLASSES}>
      <p className="mb-4">Ainda não tens negociações. Encontra um anúncio e inicia uma.</p>
      <Link className={buttonClasses()} to="/">Ver anúncios</Link>
    </div>
  )
}

function NegotiationCard({
  negotiation,
  currentUserId,
}: {
  negotiation: ApiNegotiationSummary
  currentUserId: number | undefined
}) {
  const { id, requested_listing: listing, other_participant: other, state, active_proposal, updated_at } = negotiation
  const role: NegotiationRole = listing.owner.id === currentUserId ? 'owner' : 'interested'

  const updatedAt = new Date(updated_at).toLocaleDateString('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <article className="flex gap-4 bg-surface border border-line rounded-2xl p-4 shadow-sm">
      <div
        className="shrink-0 self-start w-20 sm:w-28 aspect-square rounded-xl overflow-hidden bg-brand-soft"
        style={{ backgroundColor: categoryTint(listing.category) }}
      >
        {listing.cover_image && (
          // alt is empty: the title right next to it already names the listing.
          <img src={listing.cover_image} alt="" className="w-full h-full object-cover" loading="lazy" />
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold bg-paper text-label border border-line px-2.5 py-1 rounded-full">
            {NEGOTIATION_STATE_LABELS[state.state_name]}
          </span>
          <span className="text-xs text-muted">{NEGOTIATION_ROLE_LABELS[role]}</span>
        </div>

        <h2 className="font-bold text-base text-ink wrap-break-word">{listing.title}</h2>

        <div className="flex items-center gap-2 min-w-0">
          <Avatar avatar={other.avatar} user_name={other.user_name} size="xs" />
          <span className="text-sm text-muted wrap-break-word">{other.user_name}</span>
        </div>

        {active_proposal && (
          <p className="text-sm text-ink wrap-break-word">{activeProposalSummary(active_proposal)}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted">Atualizada a {updatedAt}</p>
          <Link
            to={`/negotiations/${id}`}
            aria-label={`Abrir negociação sobre ${listing.title}`}
            className={buttonClasses({ variant: 'primary', size: 'sm' })}
          >
            Abrir negociação
          </Link>
        </div>
      </div>
    </article>
  )
}
