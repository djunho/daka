import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Button, { buttonClasses } from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import MessageCard from '../components/MessageCard'
import { useChat } from '../context/ChatContext'
import ProposalForm from '../components/ProposalForm'
import { useAuth } from '../context/AuthContext'
import {
  ApiError,
  apiAcceptProposal,
  apiCancelNegotiation,
  apiCompleteNegotiation,
  apiCreateProposal,
  apiGetNegotiation,
  apiRejectProposal,
  apiReopenProposal,
  apiWithdrawProposal,
  type ApiNegotiationDetail,
  type ApiProposal,
  type ApiPublicUser,
} from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'
import { categoryTint } from '../types/listing'
import {
  formatDate,
  groupProposals,
  isNegotiationReadOnly,
  NEGOTIATION_STATE_LABELS,
  PROPOSAL_STATE_LABELS,
} from '../types/negotiation'

const CONFLICT_MESSAGE = 'Os dados desta negociação foram alterados ou deixaram de estar disponíveis. A página foi atualizada.'

// The action waiting for confirmation in the dialog.
type PendingAction =
  | { kind: 'accept' | 'reject' | 'withdraw' | 'reopen'; proposal: ApiProposal }
  | { kind: 'cancel' | 'complete' }

function proposalName(proposal: ApiProposal): string {
  return proposal.offered_listing?.title ?? 'sem anúncio oferecido'
}

function actionCopy(action: PendingAction, negotiation: ApiNegotiationDetail) {
  switch (action.kind) {
    case 'accept':
      return {
        title: 'Aceitar proposta',
        message: `${action.proposal.offered_listing
          ? `Os dois anúncios ficam reservados, incluindo «${action.proposal.offered_listing.title}».`
          : 'O teu anúncio fica reservado. Esta proposta não oferece nenhum anúncio.'} As outras propostas ficam em espera e serão encerradas quando a troca for concluída ou cancelada.`,
        confirmLabel: 'Sim, aceitar',
        busyLabel: 'A aceitar…',
        confirmVariant: 'primary' as const,
        success: 'Proposta aceite. Os anúncios estão reservados.',
      }
    case 'reject':
      return {
        title: 'Rejeitar proposta',
        message: `Vais rejeitar a proposta: ${proposalName(action.proposal)}. A negociação continua aberta.`,
        confirmLabel: 'Sim, rejeitar',
        busyLabel: 'A rejeitar…',
        confirmVariant: 'danger' as const,
        success: 'Proposta rejeitada.',
      }
    case 'withdraw':
      return {
        title: 'Retirar proposta',
        message: `Vais retirar a proposta: ${proposalName(action.proposal)}. A negociação continua aberta.`,
        confirmLabel: 'Sim, retirar',
        busyLabel: 'A retirar…',
        confirmVariant: 'danger' as const,
        success: 'Proposta retirada.',
      }
    case 'reopen':
      return {
        title: 'Reabrir proposta',
        message: `A proposta volta a ficar pendente: ${proposalName(action.proposal)}. ${negotiation.owner.user_name} pode aceitá-la ou rejeitá-la.`,
        confirmLabel: 'Sim, reabrir',
        busyLabel: 'A reabrir…',
        confirmVariant: 'primary' as const,
        success: 'Proposta reaberta.',
      }
    case 'complete':
      return {
        title: 'Confirmar conclusão',
        message: 'Confirma apenas depois de a troca ter sido feita. Os anúncios passam a trocados, as propostas em espera são encerradas e a negociação fica concluída. Esta ação não pode ser desfeita.',
        confirmLabel: 'Sim, confirmar',
        busyLabel: 'A confirmar…',
        confirmVariant: 'primary' as const,
        success: 'Troca concluída.',
      }
    case 'cancel':
      return {
        title: 'Cancelar negociação',
        message: `O cancelamento encerra a negociação e as propostas pendentes.${negotiation.state.state_name === 'Agreed' ? ' Os anúncios reservados voltam a ficar disponíveis.' : ''} As propostas e as mensagens continuam visíveis.`,
        confirmLabel: 'Sim, cancelar',
        busyLabel: 'A cancelar…',
        confirmVariant: 'danger' as const,
        success: 'Negociação cancelada.',
      }
  }
}

// The header, the actions and the proposals panel (#97). The chat (#123) is the
// floating widget in Layout, opened from here. Which actions appear is only a
// convenience: the backend decides.
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
  const { activeChat, isChatOpen, openChat, closeChat } = useChat()
  const chatOpen = negotiation ? isChatOpen(negotiation.id) : false

  // Keep active chat read-only state in sync with the negotiation state
  useEffect(() => {
    if (!negotiation) return
    const isReadOnly = isNegotiationReadOnly(negotiation.state)
    if (activeChat?.negotiationId === negotiation.id && activeChat.isReadOnly !== isReadOnly) {
      openChat(negotiation.id, activeChat.interlocutorName, isReadOnly)
    }
  }, [negotiation, activeChat, openChat])

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [proposalFormOpen, setProposalFormOpen] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const newProposalRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)
  // Bumped when the id changes, so an action that finishes late says nothing
  // about the negotiation now on screen.
  const visit = useRef(0)

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
  // does not hide the negotiation, and the floating chat is left alone.
  // Resolves with the negotiation it loaded, or null if it loaded nothing new.
  const refresh = useCallback((): Promise<ApiNegotiationDetail | null> => {
    if (inFlight.current) return Promise.resolve(null)

    const current = generation.current
    const request = new AbortController()
    controller.current = request
    inFlight.current = true
    setRefreshing(true)
    setRefreshError(null)
    return apiGetNegotiation(negotiationId, request.signal)
      .then((data) => {
        if (generation.current !== current) return null
        setNegotiation(data)
        return data
      })
      .catch((err) => {
        if (generation.current !== current) return null
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
        return null
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
    // The result of an earlier action no longer describes what is about to load.
    setNotice(null)
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

  // After an action, a refresh already on its way may carry the state from
  // before it, so that request is cancelled in favour of a new one.
  function reload() {
    generation.current += 1
    controller.current?.abort()
    inFlight.current = false
    return refresh()
  }

  function applyDetail(data: ApiNegotiationDetail) {
    generation.current += 1
    controller.current?.abort()
    inFlight.current = false
    setRefreshing(false)
    // The backend just confirmed the current state, so an earlier failed
    // refresh no longer applies.
    setRefreshError(null)
    setNegotiation(data)
  }

  // Runs an action and shows only what the backend confirms. Nothing changes
  // on screen beforehand, so a rejected action leaves nothing to undo.
  async function perform(
    run: () => Promise<ApiNegotiationDetail | ApiProposal>,
    success: string,
    conflict: string = CONFLICT_MESSAGE,
    { inlineConflict = false }: { inlineConflict?: boolean } = {},
  ): Promise<boolean> {
    if (busyRef.current) return false

    const current = visit.current
    busyRef.current = true
    setBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      const result = await run()
      if (visit.current !== current) return false
      if ('proposals' in result) {
        applyDetail(result)
      } else {
        await reload()
      }
      setPendingAction(null)
      setNotice({ tone: 'success', text: success })
      return true
    } catch (err) {
      if (visit.current !== current) return false
      if (err instanceof ApiError && err.status === 401) {
        setPendingAction(null)
        void logout()
      } else if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        const text = err.status === 409 ? conflict : CONFLICT_MESSAGE
        setPendingAction(null)
        const fresh = await reload()
        if (visit.current !== current) return false
        // While the form is still there, the message stays next to the choice
        // to change. If the negotiation closed meanwhile, the form is gone too.
        if (inlineConflict && fresh?.state.state_name === 'Open') {
          setActionError(text)
        } else {
          setNotice({ tone: 'error', text })
        }
      } else {
        setActionError(getPortugueseErrorMessage(err, 'Não foi possível concluir a ação. Tenta outra vez.'))
      }
      return false
    } finally {
      // After a move to another negotiation, busy belongs to that visit.
      if (visit.current === current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  function confirmAction() {
    if (!pendingAction) return

    const success = actionCopy(pendingAction, negotiation!).success
    switch (pendingAction.kind) {
      case 'accept':
        void perform(() => apiAcceptProposal(pendingAction.proposal.id), success)
        break
      case 'reject':
        void perform(() => apiRejectProposal(pendingAction.proposal.id), success)
        break
      case 'withdraw':
        void perform(() => apiWithdrawProposal(pendingAction.proposal.id), success)
        break
      case 'reopen':
        void perform(
          () => apiReopenProposal(pendingAction.proposal.id),
          success,
          'Não foi possível reabrir a proposta: a negociação ou o anúncio oferecido mudaram entretanto. A página foi atualizada.',
        )
        break
      case 'cancel':
        void perform(() => apiCancelNegotiation(negotiationId), success)
        break
      case 'complete':
        void perform(() => apiCompleteNegotiation(negotiationId), success)
        break
    }
  }

  function askToConfirm(action: PendingAction) {
    setActionError(null)
    setNotice(null)
    setPendingAction(action)
  }

  async function submitProposal(offeredListingId: number | null) {
    const created = await perform(
      () => apiCreateProposal(negotiationId, offeredListingId),
      'Proposta enviada.',
      'Já existe uma proposta com este anúncio nesta negociação, ou os dados foram alterados. Se a retiraste, podes reabri-la no histórico. A página foi atualizada.',
      { inlineConflict: true },
    )
    if (created) setProposalFormOpen(false)
  }

  function closeProposalForm() {
    setProposalFormOpen(false)
    setActionError(null)
    // The form held the focus; give it back to the button that opened it.
    setTimeout(() => newProposalRef.current?.focus())
  }

  // The dialog gives the focus back to the button that opened it, which may be
  // gone by now. The result is what the user needs to hear next.
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  useEffect(() => {
    if (!validId) return

    // Going from one negotiation straight to another keeps this page mounted:
    // drop the previous one so it is never shown under the new URL.
    setNegotiation(null)
    setLoading(true)
    setProblem(null)
    setError(null)
    setRefreshError(null)
    setPendingAction(null)
    setProposalFormOpen(false)
    setActionError(null)
    setNotice(null)
    // An action still running for the previous negotiation must not lock this one.
    busyRef.current = false
    setBusy(false)
    refresh()

    return () => {
      generation.current += 1
      controller.current?.abort()
      controller.current = null
      inFlight.current = false
      visit.current += 1
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
      <MessageCard
        title="Negociação não encontrada"
        text="A negociação que procuras não existe."
        action={<Link className={buttonClasses()} to="/negotiations">Ver negociações</Link>}
      />
    )
  }

  if (problem === 'forbidden') {
    return (
      <MessageCard
        title="Sem acesso a esta negociação"
        text="Só os participantes podem ver esta negociação."
        action={<Link className={buttonClasses()} to="/negotiations">Ver negociações</Link>}
      />
    )
  }

  if (negotiation && negotiation.id === negotiationId) {
    const copy = pendingAction ? actionCopy(pendingAction, negotiation) : null
    const isOwner = user?.id === negotiation.owner.id
    const isInterested = user?.id === negotiation.interested_user.id
    const stateName = negotiation.state.state_name
    const hasAccepted = negotiation.proposals.some((p) => p.state.state_name === 'Accepted')

    return (
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <NegotiationHeader negotiation={negotiation} currentUserId={user?.id} />

        {notice && (
          <p
            ref={noticeRef}
            tabIndex={-1}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`text-sm border rounded-xl px-4 py-3 ${notice.tone === 'error' ? 'text-accent border-accent' : 'text-ink bg-paper border-line'}`}
          >
            {notice.text}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {/* The conversation stays readable after the negotiation closes (the
              widget goes read-only), so this button is offered in every state. */}
          <Button
            size="sm"
            variant={chatOpen ? 'secondary' : 'primary'}
            onClick={() => {
              if (chatOpen) {
                closeChat()
              } else {
                const partnerName = isOwner
                  ? negotiation.interested_user.user_name
                  : negotiation.owner.user_name
                const isReadOnly = isNegotiationReadOnly(negotiation.state)
                openChat(negotiation.id, partnerName, isReadOnly)
              }
            }}
          >
            <span aria-hidden="true">💬</span> {chatOpen ? 'Fechar conversa' : 'Conversar'}
          </Button>
          {(stateName === 'Open' || stateName === 'Agreed') && (
            <>
              {stateName === 'Agreed' && isInterested && hasAccepted && (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => askToConfirm({ kind: 'complete' })}>
                  Confirmar conclusão
                </Button>
              )}
              {stateName === 'Agreed' && isOwner && (
                <p className="text-sm text-muted">À espera de que a pessoa interessada confirme a conclusão da troca.</p>
              )}
              <Button variant="dangerOutline" size="sm" disabled={busy} onClick={() => askToConfirm({ kind: 'cancel' })}>
                Cancelar negociação
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={refreshByHand} disabled={busy} loading={refreshing}>
            {refreshing ? 'A atualizar…' : 'Atualizar'}
          </Button>
          {refreshError && <p role="alert" className="text-sm text-accent">{refreshError}</p>}
        </div>

        <ProposalsPanel
          negotiation={negotiation}
          isOwner={isOwner}
          isInterested={isInterested}
          busy={busy}
          onAction={askToConfirm}
          newProposal={
            isInterested && stateName === 'Open' && user && (
              proposalFormOpen ? (
                <ProposalForm
                  userId={user.id}
                  usedListingIds={negotiation.proposals.flatMap((p) => (p.offered_listing ? [p.offered_listing.id] : []))}
                  hasNoListingProposal={negotiation.proposals.some((p) => p.offered_listing === null)}
                  canReopen={negotiation.proposals.some((p) => p.state.state_name === 'Withdrawn')}
                  busy={busy}
                  error={actionError}
                  onSubmit={submitProposal}
                  onCancel={closeProposalForm}
                />
              ) : (
                <button
                  ref={newProposalRef}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setActionError(null)
                    setNotice(null)
                    setProposalFormOpen(true)
                  }}
                  className={buttonClasses({ variant: 'primary', size: 'sm' })}
                >
                  Criar proposta
                </button>
              )
            )
          }
        />

        <ConfirmDialog
          open={pendingAction !== null}
          title={copy?.title ?? ''}
          message={copy?.message ?? ''}
          confirmLabel={copy?.confirmLabel ?? ''}
          busyLabel={copy?.busyLabel ?? ''}
          confirmVariant={copy?.confirmVariant}
          busy={busy}
          error={actionError}
          onConfirm={confirmAction}
          onCancel={() => {
            setPendingAction(null)
            setActionError(null)
          }}
        />
      </main>
    )
  }

  if (error && !loading) {
    return (
      <MessageCard alert text={error} action={<Button onClick={retry}>Tentar outra vez</Button>} />
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

function ProposalsPanel({
  negotiation,
  isOwner,
  isInterested,
  busy,
  onAction,
  newProposal,
}: {
  negotiation: ApiNegotiationDetail
  isOwner: boolean
  isInterested: boolean
  busy: boolean
  onAction: (action: PendingAction) => void
  newProposal: ReactNode
}) {
  const { accepted, pending, closed } = groupProposals(negotiation.proposals)
  const onHold = negotiation.state.state_name === 'Agreed'
  // Only a pending proposal in an open negotiation can still change.
  const canAct = negotiation.state.state_name === 'Open'

  function pendingActions(proposal: ApiProposal) {
    if (!canAct) return null
    const name = proposalName(proposal)
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        {isOwner && (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              aria-label={`Aceitar proposta: ${name}`}
              onClick={() => onAction({ kind: 'accept', proposal })}
            >
              Aceitar
            </Button>
            <Button
              variant="dangerOutline"
              size="sm"
              disabled={busy}
              aria-label={`Rejeitar proposta: ${name}`}
              onClick={() => onAction({ kind: 'reject', proposal })}
            >
              Rejeitar
            </Button>
          </>
        )}
        {isInterested && (
          <Button
            variant="dangerOutline"
            size="sm"
            disabled={busy}
            aria-label={`Retirar proposta: ${name}`}
            onClick={() => onAction({ kind: 'withdraw', proposal })}
          >
            Retirar
          </Button>
        )}
      </div>
    )
  }

  // Only the interested user may reopen, and only what they withdrew (ADR-0003).
  function closedActions(proposal: ApiProposal) {
    if (!canAct || !isInterested || proposal.state.state_name !== 'Withdrawn') return null
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          disabled={busy}
          aria-label={`Reabrir proposta: ${proposalName(proposal)}`}
          onClick={() => onAction({ kind: 'reopen', proposal })}
        >
          Reabrir
        </Button>
      </div>
    )
  }

  return (
    <section aria-labelledby="proposals-heading" className="space-y-5">
      <h2 id="proposals-heading" className="font-display text-xl font-bold text-ink">Propostas</h2>

      {negotiation.proposals.length === 0 && (
        <p className="p-8 text-center text-sm text-muted border border-dashed border-line rounded-[14px]">
          Ainda não há propostas nesta negociação.
        </p>
      )}

      {newProposal}

      <ProposalGroup title="Proposta aceite" proposals={accepted} />
      <ProposalGroup
        title={onHold ? 'Propostas em espera' : 'Propostas pendentes'}
        description={onHold ? 'Serão encerradas quando a troca for concluída ou cancelada.' : undefined}
        proposals={pending}
        renderActions={pendingActions}
        linkListings={canAct}
      />
      <ProposalGroup title="Histórico" proposals={closed} renderActions={closedActions} />
    </section>
  )
}

function ProposalGroup({
  title,
  description,
  proposals,
  renderActions,
  linkListings = false,
}: {
  title: string
  description?: string
  proposals: ApiProposal[]
  renderActions?: (proposal: ApiProposal) => ReactNode
  linkListings?: boolean
}) {
  if (proposals.length === 0) return null

  return (
    <div>
      <h3 className="font-bold text-base text-ink">{title}</h3>
      {description && <p className="text-sm text-muted mt-1">{description}</p>}
      <ul className="space-y-3 mt-3">
        {proposals.map((proposal) => (
          <li key={proposal.id}>
            <ProposalCard proposal={proposal} actions={renderActions?.(proposal)} linkListing={linkListings} />
          </li>
        ))}
      </ul>
    </div>
  )
}

// linkListing is only set for pending proposals in an open negotiation: their
// offered listing is still Available, and the backend answers 404 for any other
// state. It can still be reserved through another negotiation meanwhile.
function ProposalCard({
  proposal,
  actions,
  linkListing = false,
}: {
  proposal: ApiProposal
  actions?: ReactNode
  linkListing?: boolean
}) {
  const { offered_listing: offered, state, created_at, responded_at } = proposal

  return (
    <article className="bg-surface border border-line rounded-xl p-4 shadow-sm space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-sm text-ink wrap-break-word min-w-0">
          {!offered ? (
            'Sem anúncio oferecido'
          ) : linkListing ? (
            <Link to={`/listing/${offered.id}`} className="hover:text-brand hover:underline">{offered.title}</Link>
          ) : (
            offered.title
          )}
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
      {actions}
    </article>
  )
}
