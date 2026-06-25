import { useState, useEffect, useCallback, useRef } from 'react'
import { useRealtime } from './useRealtime'
import type { Member } from '../types'
import { fetchTeamAbsences } from './teamAbsencesFetch'
import type { AbsenceWithMember, MemberTeamRef } from './teamAbsencesFetch'

// Re-exported so existing importers of these types from this module keep working.
export type { AbsenceWithMember, MemberTeamRef } from './teamAbsencesFetch'

export function useTeamAbsences(teamIds: string[], startDate: string, endDate: string) {
  const [absences, setAbsences] = useState<AbsenceWithMember[]>([])
  const [memberMap, setMemberMap] = useState<Record<string, Member>>({})
  // member id → teams (within the viewed scope) the member belongs to. Lets the
  // calendar day modal group/label absences by team when several teams are in view.
  const [memberTeams, setMemberTeams] = useState<Record<string, MemberTeamRef[]>>({})
  // Derived loading: compare requested key to the one we've loaded. Prevents
  // the flash where isLoading stays false after teamIds flip but before the
  // refetch effect runs setIsLoading(true).
  const [loadedKey, setLoadedKey] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  // Tracks the most recently requested key so out-of-order responses can be
  // discarded. Without this, switching from "all teams" (slow, large query) to
  // a single team (fast) leaves the page stuck on "Loading…": the stale
  // all-teams fetch resolves last and overwrites loadedKey with its own key, so
  // loadedKey !== requestedKey stays true forever and no new fetch ever fires.
  const latestKeyRef = useRef<string | null>(null)

  // Stable key for dependency tracking
  const teamIdsKey = teamIds.join(',')
  const requestedKey = teamIds.length === 0 ? null : `${teamIdsKey}|${startDate}|${endDate}`
  const isLoading = loadedKey !== requestedKey

  const fetch = useCallback(async () => {
    if (teamIds.length === 0) {
      latestKeyRef.current = null
      setAbsences([])
      setMemberMap({})
      setMemberTeams({})
      setLoadedKey(null)
      return
    }

    const key = `${teamIdsKey}|${startDate}|${endDate}`
    latestKeyRef.current = key
    setError(null)
    try {
      const { absences: relevant, memberMap: mMap, memberTeams: teamsByMember } =
        await fetchTeamAbsences(teamIds, startDate, endDate)

      // Discard this response if a newer team/date selection has superseded it.
      if (latestKeyRef.current !== key) return
      setAbsences(relevant)
      setMemberMap(mMap)
      setMemberTeams(teamsByMember)
    } catch (err) {
      if (latestKeyRef.current === key) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      // Only the latest in-flight request may mark itself as loaded, so a slow
      // stale fetch can't reopen "Loading…" after the current one finished.
      if (latestKeyRef.current === key) setLoadedKey(key)
    }
  }, [teamIdsKey, startDate, endDate]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch()
  }, [fetch])

  // Realtime: when an absence is created/updated/deleted anywhere, refetch
  // so team-scope views (e.g. coach creating a weekly for a player) update
  // immediately instead of leaving the staff member uncertain about whether
  // the save actually persisted.
  useRealtime('absences', fetch)

  return { absences, memberMap, memberTeams, isLoading, error, refetch: fetch }
}
