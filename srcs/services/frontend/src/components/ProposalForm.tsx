import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import Button from './Button'
import { apiGetPublicProfile, type ApiListingSummary } from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'

// The select holds strings, so "no listing" needs a value of its own.
const NO_LISTING = 'none'

type ProposalFormProps = {
  userId: number
  busy: boolean
  error: string | null
  onSubmit: (offeredListingId: number | null) => void
  onCancel: () => void
}

// Whether a listing was already offered in this negotiation is the backend's
// rule: a repeated proposal comes back as a 409.
export default function ProposalForm({ userId, busy, error, onSubmit, onCancel }: ProposalFormProps) {
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
        setLoadError(getPortugueseErrorMessage(err, 'Não foi possível carregar os teus anúncios. Tenta outra vez.'))
      })

    return () => {
      ignore = true
    }
  }, [userId, attempt])

  const ready = listings !== null
  useEffect(() => {
    if (ready) selectRef.current?.focus()
  }, [ready])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!choice || busy) return
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
              {listings.map((listing) => (
                <option key={listing.id} value={listing.id}>{listing.title}</option>
              ))}
              <option value={NO_LISTING}>Não oferecer nenhum anúncio</option>
            </select>
          </div>
          {error && <p role="alert" className="text-sm text-accent">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={!choice} loading={busy}>
              {busy ? 'A enviar…' : 'Enviar proposta'}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancelar</Button>
          </div>
        </>
      )}
    </form>
  )
}
