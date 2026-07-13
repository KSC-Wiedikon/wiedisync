import { useState, useEffect } from 'react'
import { fetchAllItems } from '../lib/api'
import { relId } from '../utils/relations'

interface Result {
  teamEventIds: string[]
  invitedEventIds: string[]
  isLoading: boolean
  error: Error | null
}

/**
 * Resolve which events the current user can see via team membership + direct
 * invite, returned as flat ID arrays. Frontend code then filters events with
 * `{ id: { _in: [...] } }` instead of walking `events.teams.teams_id` —
 * avoiding the deep-M2M-filter trap where the policy and the frontend both
 * traverse the same alias and Directus silently returns []. Same pattern as
 * useMultiTeamMembers / useTeamAbsences.
 */
export function useUserVisibleEventIds(
  teamIds: string[],
  userId: string | undefined,
  enabled = true,
): Result {
  const [teamEventIds, setTeamEventIds] = useState<string[]>([])
  const [invitedEventIds, setInvitedEventIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const teamKey = teamIds.map(String).filter(Boolean).sort().join(',')
  const key = `${enabled ? '1' : '0'}|${teamKey}|${userId ?? ''}`

  // Disabled → drop any previously-loaded ids so a later re-enable can't serve
  // stale results while its fetch is in flight. This is a reset-on-input-change,
  // so it runs during render (React's adjust-state-during-render pattern) on the
  // same trigger the effect used (`key` changed) instead of inside the effect.
  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    if (!enabled) {
      setTeamEventIds([])
      setInvitedEventIds([])
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        // allSettled (not all): the two junctions are independent, so a failure
        // of the team-scope query must not also wipe the user's direct-invite
        // list (and vice-versa). Each fetchAllItems already reports its own
        // failure via captureApiError; we only flag `error` if BOTH fail.
        const [teamRes, memberRes] = await Promise.allSettled([
          teamIds.length > 0
            ? fetchAllItems<{ events_id: string | number }>('events_teams', {
                filter: { teams_id: { _in: teamIds } },
                fields: ['events_id'],
              })
            : Promise.resolve([]),
          userId
            ? fetchAllItems<{ events_id: string | number }>('events_members', {
                filter: { members_id: { _eq: userId } },
                fields: ['events_id'],
              })
            : Promise.resolve([]),
        ])
        if (cancelled) return
        const teamJunctions = teamRes.status === 'fulfilled' ? teamRes.value : []
        const memberJunctions = memberRes.status === 'fulfilled' ? memberRes.value : []
        setTeamEventIds([...new Set(teamJunctions.map(j => relId(j.events_id)).filter(Boolean))])
        setInvitedEventIds([...new Set(memberJunctions.map(j => relId(j.events_id)).filter(Boolean))])
        if (teamRes.status === 'rejected' && memberRes.status === 'rejected') {
          const reason = teamRes.reason
          setError(reason instanceof Error ? reason : new Error(String(reason)))
        }
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

  return { teamEventIds, invitedEventIds, isLoading, error }
}
