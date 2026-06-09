import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchAllItems, fetchItem } from '../lib/api'
import { useRealtime } from './useRealtime'
import type { Absence, Member, MemberTeam } from '../types'
import { asObj, flattenMemberIds } from '../utils/relations'

export type AbsenceWithMember = Absence & { member: Member | string }

export function useTeamAbsences(teamIds: string[], startDate: string, endDate: string) {
  const [absences, setAbsences] = useState<AbsenceWithMember[]>([])
  const [memberMap, setMemberMap] = useState<Record<string, Member>>({})
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
      setLoadedKey(null)
      return
    }

    const key = `${teamIdsKey}|${startDate}|${endDate}`
    latestKeyRef.current = key
    setError(null)
    try {
      // Get players from member_teams for all teams
      const memberTeams = await fetchAllItems<MemberTeam>('member_teams', {
        filter: { team: { _in: teamIds } },
      })
      const memberIdSet = new Set(memberTeams.map((mt) => mt.member))

      // Also include coaches and team_responsibles (they may not have member_teams records).
      // CRITICAL: must request `coach.members_id` + `team_responsible.members_id` — without
      // expansion Directus returns the M2M junction row IDs (teams_coaches.id) which look
      // like member IDs but aren't. flattenMemberIds then pollutes the set with random
      // members whose id happens to equal a junction id (ghost roster bug, 2026-05-12).
      const validTeamIds = teamIds.filter((id) => id != null && id !== '' && id !== 'null' && id !== 'undefined')
      for (const teamId of validTeamIds) {
        try {
          const team = await fetchItem<Record<string, unknown>>('teams', teamId, {
            fields: ['coach.members_id', 'team_responsible.members_id'],
          })
          const coachIds = flattenMemberIds(team.coach)
          const trIds = flattenMemberIds(team.team_responsible)
          for (const id of [...coachIds, ...trIds]) {
            if (id) memberIdSet.add(id)
          }
        } catch {
          // team fetch failed — continue
        }
      }

      const memberIds = [...memberIdSet]

      if (memberIds.length === 0) {
        if (latestKeyRef.current === key) {
          setAbsences([])
          setMemberMap({})
        }
        return
      }

      const result = await fetchAllItems<AbsenceWithMember>('absences', {
        filter: {
          _and: [
            { member: { _in: memberIds } },
            { end_date: { _gte: startDate } },
            { start_date: { _lte: endDate } },
          ],
        },
        fields: ['*', 'member.*'],
        sort: ['start_date'],
      })

      // `affects` is an *activity-type* filter (`all` | `trainings` | `games` |
      // `events`), NOT a team filter — earlier code mistakenly intersected it
      // with `teamIds` which caused absences with `affects: ['trainings']` to
      // disappear from team views entirely (2026-05-12). Membership scoping is
      // already enforced by the member._in fetch above, so we keep every row
      // returned by the absences query.
      const relevant = result

      // Build member map from absence expands
      const mMap: Record<string, Member> = {}
      for (const a of relevant) {
        const memberObj = asObj<Member>(a.member)
        if (memberObj) {
          mMap[memberObj.id] = memberObj
        }
      }

      // Fetch member details for all team members (for "available" list)
      const knownIds = new Set(Object.keys(mMap))
      const missingIds = memberIds.filter((id) => !knownIds.has(id))
      if (missingIds.length > 0) {
        const members = await fetchAllItems<Member>('members', {
          filter: { id: { _in: missingIds } },
        })
        for (const m of members) {
          mMap[m.id] = m
        }
      }

      // Discard this response if a newer team/date selection has superseded it.
      if (latestKeyRef.current !== key) return
      setAbsences(relevant)
      setMemberMap(mMap)
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

  return { absences, memberMap, isLoading, error, refetch: fetch }
}
