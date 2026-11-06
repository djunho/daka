import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import Button from './Button'
import { ApiError, apiGetPublicProfile, type ApiListingSummary } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { getPortugueseErrorMessage } from '../lib/errors'

// The select holds strings, so "no listing" needs a value of its own.
const NO_LISTING = 'none'

type ProposalFormProps = {
  userId: number
  // What this negotiation's proposals already use, in any state.
  usedListingIds: number[]
  hasNoListingProposal: boolean
  // Whether the history has a withdrawn proposal that could be reopened.
  canReopen: boolean
  busy: boolean
  error: string | null
  onSubmit: (offeredListingId: number | null) => void
  onCancel: () => void
}

// A negotiation holds at most one proposal per offered listing, and one without
// a listing, whatever their state (ADR-0002). The backend enforces it with a
// 409; the form only leaves out the choices that would get one. A withdrawn
// proposal can be reopened from the history instead (ADR-0003).
export default function ProposalForm({
  userId,
  usedListingIds,
  hasNoListingProposal,
  canReopen,
  busy,
  error,
  onSubmit,
  onCancel,
}: ProposalFormProps) {
  const { logout } = useAuth()
  const [listings, setListings] = useState<ApiListingSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<number>(0)
  const [choice, setChoice] = useState<string>('')
  const selectId = useId()
  const selectRef = useRef<HTMLSelectElement>(null)

  // The public profile only lists the user's Available listings, which are the
  // only ones that can be offered.
  useEffect(() => {
    let ignore = false

    setListings(null)
    setLoadError(null)
    apiGetPublicProfile(userId)
      .then((profile) => {
        if (ignore) return
        setListings(profile.listings)
      })
      .catch((err) => {
        if (ignore) return
        if (err instanceof ApiError && err.status === 401) {
          // The session expired, as anywhere else on this page: clearing it lets
          // RequireAuth send the user to login.
          void logout()
          return
        }
        setLoadError(getPortugueseErrorMessage(err, 'Não foi possível carregar os teus anúncios. Tenta outra vez.'))
      })

    return () => {
      ignore = true
    }
    // logout is recreated on every render and does not change what is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, attempt])

  const ready = listings !== null
  const offerable = (listings ?? []).filter((listing) => !usedListingIds.includes(listing.id))
  const nothingLeft = ready && offerable.length === 0 && hasNoListingProposal
  // The choice can stop being offered while the form is open: a 409 reloads the
  // negotiation, and another tab may have used that listing first.
  const choiceAvailable =
    choice === NO_LISTING ? !hasNoListingProposal : offerable.some((listing) => String(listing.id) === choice)
  useEffect(() => {
    if (ready && choice && !choiceAvailable) setChoice('')
  }, [ready, choice, choiceAvailable])
  useEffect(() => {
    if (ready) selectRef.current?.focus()
  }, [ready])

  // The submit button is disabled while sending, which drops the focus. After
  // an error, the choice is what the user has to look at again.
  useEffect(() => {
    if (error) selectRef.current?.focus()
  }, [error])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!choice || !choiceAvailable || busy) return
    onSubmit(choice === NO_LISTING ? null : Number(choice))
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-line rounded-xl p-4 shadow-sm space-y-3">
      {loadError ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-accent">{loadError}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>Tentar outra vez</Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
          </div>
        </div>
      ) : !listings ? (
        <p role="status" className="text-sm text-muted">A carregar os teus anúncios…</p>
      ) : nothingLeft ? (
        <div className="space-y-3">
          <p role="status" className="text-sm text-muted">
            Já usaste todos os teus anúncios disponíveis nesta negociação.
            {canReopen && ' Podes reabrir uma proposta retirada no histórico.'}
          </p>
          {/* A 409 can be what used up the last choice: its explanation stays. */}
          {error && <p role="alert" className="text-sm text-accent">{error}</p>}
          <Button variant="ghost" size="sm" onClick={onCancel}>Fechar</Button>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor={selectId} className="block text-sm font-medium text-ink mb-1.5">
              O que ofereces em troca?
            </label>
            <select
              id={selectId}
              ref={selectRef}
              value={choice}
              disabled={busy}
              onChange={(e) => setChoice(e.target.value)}
              className="w-full px-3 py-2.5 bg-paper border border-line rounded-xl text-base text-ink focus:border-brand transition-colors"
            >
              <option value="" disabled>Escolhe uma opção</option>
              {offerable.map((listing) => (
                <option key={listing.id} value={listing.id}>{listing.title}</option>
              ))}
              {!hasNoListingProposal && <option value={NO_LISTING}>Não oferecer nenhum anúncio</option>}
            </select>
          </div>
          {error && <p role="alert" className="text-sm text-accent">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={!choice || !choiceAvailable} loading={busy}>
              {busy ? 'A enviar…' : 'Enviar proposta'}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancelar</Button>
          </div>
        </>
      )}
    </form>
  )
}
