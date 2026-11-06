import { useEffect, useState } from 'react'
import { apiGetPublicProfile } from '../lib/api'

// The backend reports a user online while their last activity is within its
// presence window (180s by default); one poll a minute keeps the badge current.
export const PRESENCE_POLL_MS = 60_000

/**
 * Whether a user is online right now, refreshed every minute while mounted.
 * Returns undefined until the first answer, or when the profile cannot be read,
 * so callers can hide the badge instead of showing a wrong state.
 */
export function useUserPresence(userId: number | null): boolean | undefined {
  const [online, setOnline] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    setOnline(undefined)
    if (!userId) return

    let ignore = false
    const controller = new AbortController()
    const load = async () => {
      try {
        const profile = await apiGetPublicProfile(userId, controller.signal)
        if (!ignore) setOnline(profile.is_online)
      } catch {
        // Best effort: an unreadable profile hides the badge rather than guessing.
        if (!ignore) setOnline(undefined)
      }
    }

    void load()
    const timer = setInterval(() => void load(), PRESENCE_POLL_MS)
    return () => {
      ignore = true
      controller.abort()
      clearInterval(timer)
    }
  }, [userId])

  return online
}
