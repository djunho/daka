import { useEffect, useState } from 'react'
import { apiGetPublicProfile } from '../lib/api'

// The backend reports a user online while their last activity is within its
// presence window (180s by default); one poll a minute keeps the badge current.
export const PRESENCE_POLL_MS = 60_000
// Returning to the tab polls at once only if the last poll is at least this
// old, like the AuthContext heartbeat, so rapid tab switching is not a burst.
export const PRESENCE_MIN_GAP_MS = 30_000

/**
 * Whether a user is online right now, refreshed every minute while mounted
 * and the tab is visible. Returns undefined until the first answer, or when
 * the profile cannot be read, so callers can hide the badge instead of
 * showing a wrong state.
 */
export function useUserPresence(userId: number | null): boolean | undefined {
  const [online, setOnline] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    setOnline(undefined)
    if (!userId) return

    let ignore = false
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let lastPollAt = -Infinity

    const load = async () => {
      controller?.abort()
      const current = new AbortController()
      controller = current
      const startedAt = Date.now()
      try {
        const profile = await apiGetPublicProfile(userId, current.signal)
        if (ignore || current.signal.aborted) return
        lastPollAt = startedAt
        setOnline(profile.is_online)
      } catch {
        // Our own abort (tab hidden, a newer poll, unmount) is not a failure:
        // keep the last known state, and do not count it as a recent poll.
        // An unreadable profile hides the badge rather than guessing.
        if (ignore || current.signal.aborted) return
        lastPollAt = startedAt
        setOnline(undefined)
      }
    }

    // Every authenticated request counts as activity for the viewer's own
    // presence (get_current_user touches last_seen), so the poll stops while
    // the tab is hidden, like the AuthContext heartbeat. Otherwise an open chat
    // would keep the viewer "online" for as long as the tab exists.
    const start = () => {
      if (timer !== null || document.visibilityState === 'hidden') return
      if (Date.now() - lastPollAt >= PRESENCE_MIN_GAP_MS) void load()
      timer = setInterval(() => void load(), PRESENCE_POLL_MS)
    }
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      controller?.abort()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stop()
      else start()
    }

    start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      ignore = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [userId])

  return online
}
