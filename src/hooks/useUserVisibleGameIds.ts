import { useState, useEffect } from 'react'
import { fetchAllItems } from '../lib/api'
import { relId } from '../utils/relations'

interface Result {
  /** Games this member was invited to as a guest, beyond their own teams' fixtures. */
  guestGameIds: string[]
  isLoading: boolean
  error: Error | null
}

/**
 * Resolve which games the current user can see through a guest invitation
 * (migration 271), returned as a flat ID array.
 *
 * Every personal game surface — home, calendar, the games list — filters on
 * `kscw_team ∈ my teams`, which is exactly the filter a borrowed player fails: a
 * guest has no `member_teams` row on the team whose fixture it is. Callers OR this
 * list into those filters as `{ id: { _in: [...] } }`.
 *
 * Deliberately a flat junction-first fetch rather than a filter that walks
 * `games.guests.member.user`: the read policy on `game_guests` walks the same
 * relation, and Directus cannot reliably AND a frontend filter with a policy filter
 * through one alias — it silently returns [] for non-admins while looking correct to
 * an admin. Same pattern as useUserVisibleEventIds / useMultiTeamMembers.
 */
export function useUserVisibleGameIds(userId: string | undefined, enabled = true): Result {
  const [guestGameIds, setGuestGameIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const key = `${enabled ? '1' : '0'}|${userId ?? ''}`

  // Reset-on-input-change during render (React's adjust-state-during-render pattern),
  // so a re-enable can't serve the previous member's ids while its fetch is in flight.
  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    if (!enabled || !userId) {
      setGuestGameIds([])
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!enabled || !userId) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const rows = await fetchAllItems<{ game: string | number }>('game_guests', {
          filter: { member: { _eq: userId } },
          fields: ['game'],
        })
        if (cancelled) return
        setGuestGameIds([...new Set(rows.map(r => relId(r.game)).filter(Boolean))])
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { guestGameIds, isLoading, error }
}
