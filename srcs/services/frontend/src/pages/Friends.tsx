import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Icon from '../components/Icon'
import Button, { buttonClasses } from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import { EMPTY_STATE_CLASSES } from '../components/ListingCard'
import MessageCard from '../components/MessageCard'
import OnlineBadge from '../components/OnlineBadge'
import { useAuth } from '../context/AuthContext'
import {
  ApiError,
  apiGetFriends,
  apiRemoveFriend,
  type ApiFriend,
  type ApiFriendPage,
} from '../lib/api'
import { getPortugueseErrorMessage } from '../lib/errors'

const PAGE_SIZE = 20
// Same value as MAX_PAGE_OFFSET in the backend's schemas.py.
const MAX_OFFSET = 1_000_000_000
// Presence changes over time, so the list is fetched again in the background.
// The backend counts someone as online for 3 minutes, so once a minute is enough.
export const FRIENDS_REFRESH_MS = 60_000

export default function Friends() {
  const { logout } = useAuth()
  // The page lives in the URL, so it survives a reload and the Back button.
  const [searchParams, setSearchParams] = useSearchParams()
  const pageParam = Number(searchParams.get('page'))
  // A page past the backend's offset ceiling would only get a 422.
  const page =
    Number.isInteger(pageParam) && pageParam > 0 && (pageParam - 1) * PAGE_SIZE <= MAX_OFFSET
      ? pageParam
      : 1

  const [data, setData] = useState<ApiFriendPage | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped by "Tentar outra vez" to load the page again.
  const [attempt, setAttempt] = useState<number>(0)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // The friend in the confirmation dialog, or null when it is closed.
  const [removing, setRemoving] = useState<ApiFriend | null>(null)
  const [removeBusy, setRemoveBusy] = useState<boolean>(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Every list request remembers the generation it started in. Changing page,
  // removing a friend or leaving the page bumps it, so a late answer (for
  // example a background refresh that still lists the removed friend) is
  // dropped instead of replacing what is on screen.
  const generation = useRef(0)
  // The request in flight, if any. Only one runs at a time.
  const controller = useRef<AbortController | null>(null)

  function cancelRequest() {
    generation.current += 1
    controller.current?.abort()
    controller.current = null
  }

  // `silent` is the background refresh: no loading state, and a failure keeps
  // the list that is already on screen.
  function loadPage(silent: boolean) {
    cancelRequest()
    const current = generation.current
    const request = new AbortController()
    controller.current = request
    if (!silent) {
      setData(null)
      setLoading(true)
      setError(null)
    }
    apiGetFriends({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, request.signal)
      .then((result) => {
        if (generation.current !== current) return
        setData(result)
      })
      .catch((err) => {
        if (generation.current !== current) return
        if (err instanceof ApiError && err.status === 401) {
          // The session expired. Clearing it lets RequireAuth send them to login.
          void logout()
          return
        }
        if (!silent) {
          setError(getPortugueseErrorMessage(err, 'Não foi possível carregar os amigos. Tenta outra vez.'))
        }
      })
      .finally(() => {
        if (generation.current !== current) return
        controller.current = null
        if (!silent) setLoading(false)
      })
  }

  useEffect(() => {
    loadPage(false)
    return cancelRequest
    // loadPage reads page (listed) and stable refs; logout is recreated on
    // every render and does not change what is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, attempt])

  useEffect(() => {
    const id = window.setInterval(() => {
      // Skipped while the tab is hidden, while another request is running,
      // and while a removal is being confirmed or sent.
      if (document.visibilityState === 'hidden' || controller.current || removing) return
      loadPage(true)
    }, FRIENDS_REFRESH_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, removing])

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

  function openRemove(friend: ApiFriend) {
    // The timer does not start a refresh while the dialog is open, but one may
    // already be running: cancel it, so the list does not change under the
    // dialog. With the list on screen, a running request is always a silent
    // refresh; the next one comes from the timer after the dialog closes.
    if (!loading) cancelRequest()
    setRemoveError(null)
    setRemoving(friend)
  }

  // Takes the friend off the list right away, then fetches the page again so
  // that a friend from the next page moves up into the free spot.
  function dropFriend(id: number) {
    const left = (data?.items ?? []).filter((friend) => friend.id !== id)
    cancelRequest()
    setRemoving(null)
    setData((prev) => prev && {
      ...prev,
      items: prev.items.filter((friend) => friend.id !== id),
      total: Math.max(0, prev.total - 1),
    })
    if (left.length === 0 && page > 1) {
      goToPage(page - 1)
    } else {
      loadPage(true)
    }
  }

  async function confirmRemove() {
    if (!removing) return
    const friend = removing
    // No refresh starts while the dialog is open, so the generation only
    // changes meanwhile if the page is left (the effect cleanup bumps it).
    // Then the answer must not touch the list, the URL or start a request.
    const current = generation.current
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      await apiRemoveFriend(friend.id)
      if (generation.current !== current) return
      dropFriend(friend.id)
    } catch (err) {
      if (generation.current !== current) return
      if (err instanceof ApiError && err.status === 401) {
        setRemoving(null)
        void logout()
      } else if (err instanceof ApiError && err.status === 404) {
        // The friendship is already gone: the other user may have removed it.
        dropFriend(friend.id)
      } else {
        setRemoveError(getPortugueseErrorMessage(err, 'Não foi possível remover o amigo. Tenta outra vez.'))
      }
    } finally {
      if (generation.current === current) setRemoveBusy(false)
    }
  }

  if (error) {
    return (
      <MessageCard
        alert
        text={error}
        action={<Button onClick={() => setAttempt((n) => n + 1)}>Tentar outra vez</Button>}
      />
    )
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold text-ink mb-6">
        Amigos
      </h1>

      {/* Order matters: loading must come before the empty checks, or the
          "no friends" message would flash while the request is running. */}
      {loading || !data ? (
        <p className={EMPTY_STATE_CLASSES} role="status">A carregar amigos…</p>
      ) : items.length === 0 ? (
        total > 0 ? (
          // A page number past the end, e.g. from an old link.
          <div className={EMPTY_STATE_CLASSES}>
            <p className="mb-4">Não há mais resultados.</p>
            <Button onClick={() => goToPage(1)}>Voltar à primeira página</Button>
          </div>
        ) : (
          <div className={EMPTY_STATE_CLASSES}>
            <p className="mb-4">Ainda não tens amigos. Visita o perfil de alguém para o adicionares.</p>
            <Link className={buttonClasses()} to="/">Explorar anúncios</Link>
          </div>
        )
      ) : (
        <>
          <p className="text-sm text-muted mb-3" role="status">
            {total} {total === 1 ? 'amigo' : 'amigos'}
          </p>
          <ul className="space-y-3">
            {items.map((friend) => (
              <li key={friend.id}>
                <FriendCard friend={friend} onRemove={() => openRemove(friend)} />
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

      <ConfirmDialog
        open={removing !== null}
        title="Remover amigo"
        message={
          removing
            ? `Tens a certeza de que queres remover ${removing.user_name} dos teus amigos? A amizade termina para os dois.`
            : ''
        }
        confirmLabel="Sim, remover"
        busyLabel="A remover…"
        busy={removeBusy}
        error={removeError}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </main>
  )
}

function FriendCard({ friend, onRemove }: { friend: ApiFriend; onRemove: () => void }) {
  const { id, user_name, avatar, user_location, is_online } = friend

  return (
    <article className="flex flex-col sm:flex-row sm:items-center gap-4 bg-surface border border-line rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <Avatar avatar={avatar} user_name={user_name} size="sm" online={is_online} />
        <div className="min-w-0 space-y-1">
          <Link to={`/users/${id}`} className="block font-bold text-ink hover:text-brand wrap-break-word">
            {user_name}
          </Link>
          <OnlineBadge online={is_online} showLabel />
          {user_location && (
            <p className="text-xs text-muted flex items-center gap-1">
              <Icon name="location" size={12} />
              <span className="wrap-break-word">{user_location}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2 shrink-0">
        {/* A negotiation always starts from a listing, so this is the way to trade. */}
        <Link
          to={`/users/${id}#anuncios`}
          aria-label={`Ver anúncios de ${user_name}`}
          className={buttonClasses({ size: 'sm' })}
        >
          Ver anúncios
        </Link>
        <Button size="sm" variant="ghost" aria-label={`Remover ${user_name} dos amigos`} onClick={onRemove}>
          Remover
        </Button>
      </div>
    </article>
  )
}
