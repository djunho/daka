import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Button, { buttonClasses } from '../components/Button'
import { useAuth } from '../context/AuthContext'
import {
  ApiError,
  apiGetNegotiation,
  type ApiNegotiationDetail,
  type ApiProposal,
  type ApiPublicUser,
} from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'
import { categoryTint } from '../types/listing'
import {
  formatDate,
  groupProposals,
  NEGOTIATION_STATE_LABELS,
  PROPOSAL_STATE_LABELS,
} from '../types/negotiation'

// The header and the proposals panel (#97). The chat (#123) goes below them.
export default function Negotiation() {
  const { id } = useParams()
  const { user, logout } = useAuth()
  // Anything that is not a positive whole number can never exist, so it goes
  // straight to "not found" without asking the backend.
  const negotiationId = Number(id)
  const validId = Number.isInteger(negotiationId) && negotiationId > 0

  const [negotiation, setNegotiation] = useState<ApiNegotiationDetail | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [problem, setProblem] = useState<'notFound' | 'forbidden' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  // Bumped when the id changes or the page closes, so a late response for the
  // previous negotiation is dropped instead of being shown under this URL.
  const generation = useRef(0)
  const inFlight = useRef(false)
  // Cancels the request in flight when the id changes or the page closes, so
  // React running the effect twice in development (StrictMode) does not leave
  // two requests open.
  const controller = useRef<AbortController | null>(null)
  // "Atualizar" is disabled while it works, which drops the keyboard focus.
  // Holds the button until the refresh ends, so the focus can go back to it.
  const refreshButton = useRef<HTMLButtonElement | null>(null)

  // A refresh keeps what is on screen, so a failure while the tab regains focus
  // does not hide the negotiation, and the chat below is left alone.
  const refresh = useCallback(() => {
    if (inFlight.current) return

    const current = generation.current
    const request = new AbortController()
    controller.current = request
    inFlight.current = true
    setRefreshing(true)
    setRefreshError(null)
    apiGetNegotiation(negotiationId, request.signal)
      .then((data) => {
        if (generation.current !== current) return
        setNegotiation(data)
      })
      .catch((err) => {
        if (generation.current !== current) return
        if (err instanceof ApiError && err.status === 401) {
          // The session expired. Clearing it lets RequireAuth send them to login.
          void logout()
        } else if (err instanceof ApiError && err.status === 403) {
          setNegotiation(null)
          setProblem('forbidden')
        } else if (err instanceof ApiError && err.status === 404) {
          setNegotiation(null)
          setProblem('notFound')
        } else {
          const message = getPortugueseErrorMessage(err, 'Não foi possível carregar a negociação. Tenta outra vez.')
          setRefreshError(message)
          setError(message)
        }
      })
      .finally(() => {
        if (generation.current !== current) return
        inFlight.current = false
        setRefreshing(false)
        setLoading(false)
      })
    // logout is recreated on every render and does not change what is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negotiationId])

  function refreshByHand(e: MouseEvent<HTMLButtonElement>) {
    if (document.activeElement === e.currentTarget) refreshButton.current = e.currentTarget
    refresh()
  }

  useEffect(() => {
    if (refreshing || !refreshButton.current) return
    refreshButton.current.focus()
    refreshButton.current = null
  }, [refreshing])

  function retry() {
    setError(null)
    setLoading(true)
    refresh()
  }

  useEffect(() => {
    if (!validId) return

    // Going from one negotiation straight to another keeps this page mounted:
    // drop the previous one so it is never shown under the new URL.
    setNegotiation(null)
    setLoading(true)
    setProblem(null)
    setError(null)
    setRefreshError(null)
    refresh()

    return () => {
      generation.current += 1
      controller.current?.abort()
      controller.current = null
      inFlight.current = false
    }
  }, [refresh, validId])

  // Proposals do not arrive over the WebSocket, so the page catches up when the
  // user comes back to it.
  useEffect(() => {
    if (!validId) return

    function handleVisibility() {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh, validId])

  if (!validId || problem === 'notFound') {
    return (
      <Message title="Negociação não encontrada" text="A negociação que procuras não existe." />
    )
  }

  if (problem === 'forbidden') {
    return (
      <Message title="Sem acesso a esta negociação" text="Só os participantes podem ver esta negociação." />
    )
  }

  if (negotiation && negotiation.id === negotiationId) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <NegotiationHeader negotiation={negotiation} currentUserId={user?.id} />

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={refreshByHand} loading={refreshing}>
            {refreshing ? 'A atualizar…' : 'Atualizar'}
          </Button>
          {refreshError && <p role="alert" className="text-sm text-accent">{refreshError}</p>}
        </div>

        <ProposalsPanel negotiation={negotiation} />
      </main>
    )
  }

  if (error && !loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-surface border border-line rounded-2xl p-8 text-center shadow-sm">
          <p role="alert" className="text-sm text-muted mb-6">{error}</p>
          <Button onClick={retry}>Tentar outra vez</Button>
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <p role="status" className="p-12 text-center text-muted border border-dashed border-line rounded-[14px]">
        A carregar negociação…
      </p>
    </main>
  )
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-surface border border-line rounded-2xl p-8 text-center shadow-sm">
        <h1 className="font-display text-2xl font-bold text-ink mb-2">{title}</h1>
        <p className="text-sm text-muted mb-6">{text}</p>
        <Link className={buttonClasses()} to="/negotiations">Ver negociações</Link>
      </div>
    </main>
  )
}

function NegotiationHeader({
  negotiation,
  currentUserId,
}: {
  negotiation: ApiNegotiationDetail
  currentUserId: number | undefined
}) {
  const { requested_listing: listing, owner, interested_user, state, created_at, cancelled_by, cancelled_at } = negotiation

  // The backend answers 404 for a listing that is not Available, which is what
  // these two states mean for it. An open negotiation's listing can still be
  // reserved through another negotiation, and then this link shows "not found".
  const listingIsPublic = state.state_name === 'Open' || state.state_name === 'Cancelled'

  return (
    <header className="bg-surface border border-line rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
      <div className="flex gap-4">
        <div
          className="shrink-0 self-start w-20 sm:w-28 aspect-square rounded-xl overflow-hidden bg-brand-soft"
          style={{ backgroundColor: categoryTint(listing.category) }}
        >
          {listing.cover_image && (
            // alt is empty: the title right next to it already names the listing.
            <img src={listing.cover_image} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <span className="inline-block text-xs font-semibold bg-paper text-label border border-line px-2.5 py-1 rounded-full">
            {NEGOTIATION_STATE_LABELS[state.state_name]}
          </span>
          <h1 className="font-display text-2xl font-bold text-ink wrap-break-word">
            {listingIsPublic ? (
              <Link to={`/listing/${listing.id}`} className="hover:text-brand hover:underline">{listing.title}</Link>
            ) : (
              listing.title
            )}
          </h1>
          <p className="text-xs text-muted">Iniciada a {formatDate(created_at)}</p>
        </div>
      </div>

      <dl className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-line">
        <Participant label="Proprietário" person={owner} currentUserId={currentUserId} />
        <Participant label="Interessado" person={interested_user} currentUserId={currentUserId} />
      </dl>

      <StateNotice negotiation={negotiation} cancelledBy={cancelled_by} cancelledAt={cancelled_at} />
    </header>
  )
}

function Participant({
  label,
  person,
  currentUserId,
}: {
  label: string
  person: ApiPublicUser
  currentUserId: number | undefined
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted mb-1.5">{label}</dt>
      <dd className="flex items-center gap-2 min-w-0">
        <Avatar avatar={person.avatar} user_name={person.user_name} size="xs" />
        {person.id === currentUserId ? (
          <span className="text-sm font-semibold text-ink wrap-break-word">{person.user_name} (tu)</span>
        ) : (
          <Link to={`/users/${person.id}`} className="text-sm font-semibold text-ink hover:text-brand hover:underline wrap-break-word">
            {person.user_name}
          </Link>
        )}
      </dd>
    </div>
  )
}

// Why the negotiation can no longer change, in words rather than only colour.
function StateNotice({
  negotiation,
  cancelledBy,
  cancelledAt,
}: {
  negotiation: ApiNegotiationDetail
  cancelledBy: ApiPublicUser | null
  cancelledAt: string | null
}) {
  const classes = 'text-sm text-ink bg-paper border border-line rounded-xl px-4 py-3'

  switch (negotiation.state.state_name) {
    case 'Completed':
      return <p className={classes}>Esta troca foi concluída. A negociação fica disponível só para consulta.</p>
    case 'Unavailable':
      return <p className={classes}>O anúncio solicitado deixou de estar disponível. A negociação fica disponível só para consulta.</p>
    case 'Cancelled':
      return (
        <p className={classes}>
          Negociação cancelada{cancelledBy && ` por ${cancelledBy.user_name}`}
          {cancelledAt && ` a ${formatDate(cancelledAt)}`}. Fica disponível só para consulta.
        </p>
      )
    default:
      return null
  }
}

function ProposalsPanel({ negotiation }: { negotiation: ApiNegotiationDetail }) {
  const { accepted, pending, closed } = groupProposals(negotiation.proposals)
  const onHold = negotiation.state.state_name === 'Agreed'

  return (
    <section aria-labelledby="proposals-heading" className="space-y-5">
      <h2 id="proposals-heading" className="font-display text-xl font-bold text-ink">Propostas</h2>

      {negotiation.proposals.length === 0 && (
        <p className="p-8 text-center text-sm text-muted border border-dashed border-line rounded-[14px]">
          Ainda não há propostas nesta negociação.
        </p>
      )}

      <ProposalGroup title="Proposta aceite" proposals={accepted} />
      <ProposalGroup
        title={onHold ? 'Propostas em espera' : 'Propostas pendentes'}
        description={onHold ? 'Serão encerradas quando a troca for concluída ou cancelada.' : undefined}
        proposals={pending}
      />
      <ProposalGroup title="Histórico" proposals={closed} />
    </section>
  )
}

function ProposalGroup({
  title,
  description,
  proposals,
}: {
  title: string
  description?: string
  proposals: ApiProposal[]
}) {
  if (proposals.length === 0) return null

  return (
    <div>
      <h3 className="font-bold text-base text-ink">{title}</h3>
      {description && <p className="text-sm text-muted mt-1">{description}</p>}
      <ul className="space-y-3 mt-3">
        {proposals.map((proposal) => (
          <li key={proposal.id}>
            <ProposalCard proposal={proposal} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProposalCard({ proposal }: { proposal: ApiProposal }) {
  const { offered_listing: offered, state, created_at, responded_at } = proposal

  return (
    <article className="bg-surface border border-line rounded-xl p-4 shadow-sm space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-sm text-ink wrap-break-word min-w-0">
          {offered ? offered.title : 'Sem anúncio oferecido'}
        </p>
        <span className="shrink-0 text-xs font-semibold bg-paper text-label border border-line px-2.5 py-1 rounded-full">
          {PROPOSAL_STATE_LABELS[state.state_name]}
        </span>
      </div>
      {/* The backend uses this state for the offered and the requested listing,
          and a proposal may offer none, so the text cannot name just one. */}
      {state.state_name === 'ItemUnavailable' && (
        <p className="text-sm text-muted">Um dos anúncios desta proposta já não está disponível.</p>
      )}
      <p className="text-xs text-muted">
        Criada a {formatDate(created_at)}
        {responded_at && ` · Respondida a ${formatDate(responded_at)}`}
      </p>
    </article>
  )
}
