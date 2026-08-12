import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchItem, fetchAllItems, updateRecord } from '../lib/api'
import { coercePositions, normalizePositionsForSport } from '../utils/memberPositions'
import type { Member, MemberTeam, Team } from '../types'
import { asObj, relId } from '../utils/relations'

export type ExpandedMemberTeam = Omit<MemberTeam, 'member'> & { member: (Member & { id: string }) | string }

export function useTeamMembers(
  teamId: string | undefined,
  // Whether to PERSIST the sport-normalization of member positions. This hook
  // runs on read-only surfaces (team detail, referee expenses) viewed by plain
  // members, who lack the members.position update grant — so persisting the
  // auto-heal from those surfaces fires a 403 per stale row (logged as an
  // api_error; surfaced in the 2026-06-20 error-log audit). Only the
  // leader-gated RosterEditor opts in; everywhere else we normalize for display
  // only and never PATCH.
  opts?: { persistNormalization?: boolean },
) {
  const persistNormalization = opts?.persistNormalization ?? false
  const [members, setMembers] = useState<ExpandedMemberTeam[]>([])
  // loadedKey is derived-state for isLoading: undefined = never loaded (initial),
  // null = loaded "no teamId" state, string = loaded data for that key.
  // Deriving isLoading synchronously from key mismatch eliminates the flash
  // where isLoading briefly stays false between a teamId change and the effect
  // firing setIsLoading(true).
  const [loadedKey, setLoadedKey] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  // Discards out-of-order responses: a slow stale fetch resolving after a newer
  // teamId selection must not overwrite loadedKey and re-trigger loading.
  const latestKeyRef = useRef<string | null>(null)

  const safeTeamId = teamId ? relId(teamId) : ''
  const requestedKey = safeTeamId || null
  const isLoading = loadedKey !== requestedKey

  // The reset half of the old fetch() — the "no team selected" empty state and
  // the error clear — is applied during render (adjust-state-during-render) so
  // the effect below carries no synchronous setState (react-hooks/set-state-in-
  // effect). `undefined` seeds a first pass on mount, matching the effect's
  // mount run; the load path itself is unchanged.
  const [primedKey, setPrimedKey] = useState<string | null | undefined>(undefined)
  if (primedKey !== requestedKey) {
    setPrimedKey(requestedKey)
    if (requestedKey === null) {
      setMembers([])
      setLoadedKey(null)
    } else {
      setError(null)
    }
  }

  const load = useCallback(async () => {
    if (!safeTeamId) {
      latestKeyRef.current = null
      return
    }

    const key = safeTeamId
    latestKeyRef.current = key

    // The member_teams query doesn't depend on the team record (sport is only
    // used afterwards for normalization), so run both in parallel to halve the
    // latency on every roster / team-detail open.
    // ⚠ Keyed on the team FK ALONE — never also on member_teams.season. The
    // rollover mints a NEW team id per season, so the FK already pins the
    // season; the season column is a create-time stamp uncoupled from the
    // (manually-run) rollover, and filtering on it made this hook return an
    // empty roster for every team between the Jun-1 cutover and the rollover.
    // Nor may `teams.active` be added here: historical activities legitimately
    // resolve their archived team's roster.
    const filter: Record<string, unknown> = { team: { _eq: safeTeamId } }
    // Settled through `.then(onOk, onErr)` rather than try/catch/finally so that
    // every setState below sits strictly *after* an await — a try block wrapping
    // the await leaves its catch/finally synchronously reachable, which trips
    // react-hooks/set-state-in-effect at the call site. Same success/error paths.
    const outcome = await Promise.all([
      fetchItem<Team>('teams', safeTeamId, { fields: ['id', 'sport'] }),
      fetchAllItems<ExpandedMemberTeam>('member_teams', {
        filter,
        fields: ['*', 'member.*'],
        sort: ['member'],
      }),
    ]).then(
      ([team, result]) => ({ ok: true, team, result }) as const,
      (err: unknown) => ({ ok: false, err }) as const,
    )

    if (outcome.ok) {
      const { team, result } = outcome
      const updates: Promise<unknown>[] = []
      const normalized = result.map((mt) => {
        const member = asObj<Member>(mt.member)
        if (!member) return mt
        const originalPositions = coercePositions(member.position)
        const safePositions = normalizePositionsForSport(member.position, team.sport)
        if (originalPositions.join('|') !== safePositions.join('|')) {
          if (persistNormalization) {
            updates.push(updateRecord('members', member.id, { position: safePositions }))
          }
          return {
            ...mt,
            member: { ...member, position: safePositions } as Member,
          } as ExpandedMemberTeam
        }
        return mt
      })
      if (latestKeyRef.current !== key) return
      setMembers(normalized)
      if (updates.length > 0) {
        void Promise.allSettled(updates)
      }
    } else if (latestKeyRef.current === key) {
      setError(outcome.err instanceof Error ? outcome.err : new Error(String(outcome.err)))
    }
    if (latestKeyRef.current === key) setLoadedKey(key)
  }, [safeTeamId, persistNormalization])

  // Manual refetch keeps fetch()'s original eager resets (callers invoke it from
  // event handlers / realtime callbacks, never from an effect body).
  const refetch = useCallback(async () => {
    if (requestedKey === null) {
      setMembers([])
      setLoadedKey(null)
    } else {
      setError(null)
    }
    await load()
  }, [requestedKey, load])

  useEffect(() => {
    load()
  }, [load])

  return { members, isLoading, error, refetch }
}

/** Fetch members from multiple teams, deduplicating by member ID.
 *  `teamsByMember` maps each memberId → the list of the requested teamIds they
 *  belong to (built from the RAW junction rows, before the dedupe below drops
 *  the extra team associations). Callers rendering a multi-team roster use it to
 *  filter by team — the deduped `members` array keeps only the first junction
 *  row per member, so `mt.team` alone can't tell you every team a shared player
 *  is on. */
export function useMultiTeamMembers(teamIds: string[]) {
  const [members, setMembers] = useState<ExpandedMemberTeam[]>([])
  const [teamsByMember, setTeamsByMember] = useState<Map<string, string[]>>(new Map())
  const [loadedKey, setLoadedKey] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  // Discards out-of-order responses: a slow stale fetch resolving after a newer
  // team selection must not overwrite loadedKey and re-trigger loading.
  const latestKeyRef = useRef<string | null>(null)
  // Defensive: ensure all IDs are scalars
  const safeIds = teamIds.map(id => relId(id)).filter(Boolean)
  const key = safeIds.slice().sort().join(',')
  const requestedKey = safeIds.length === 0 ? null : key
  const isLoading = loadedKey !== requestedKey

  // Reset half of the old fetch(), applied during render — see useTeamMembers.
  const [primedKey, setPrimedKey] = useState<string | null | undefined>(undefined)
  if (primedKey !== requestedKey) {
    setPrimedKey(requestedKey)
    if (requestedKey === null) {
      setMembers([])
      setTeamsByMember(new Map())
      setLoadedKey(null)
    } else {
      setError(null)
    }
  }

  const load = useCallback(async () => {
    if (safeIds.length === 0) {
      latestKeyRef.current = null
      return
    }

    latestKeyRef.current = key

    // Single-level junction fetch (`member_teams` filtered by `team: { _in }`)
    // to sidestep the deep-M2M-filter-vs-policy silent-[] trap. `_in` with one
    // id behaves like `_eq`, and the dedupe below is a no-op for a single team,
    // so both cases share this one path.
    // Settled through `.then(onOk, onErr)` rather than try/catch/finally — see
    // useTeamMembers above for why (keeps every setState strictly post-await).
    const outcome = await fetchAllItems<ExpandedMemberTeam>('member_teams', {
      filter: { team: { _in: safeIds } },
      fields: ['*', 'member.*'],
      sort: ['member'],
    }).then(
      (result) => ({ ok: true, result }) as const,
      (err: unknown) => ({ ok: false, err }) as const,
    )

    if (outcome.ok) {
      const { result } = outcome
      // Deduplicate by member ID — keep the first occurrence. Build the
      // member→teams map from the RAW rows first so a player on two invited
      // teams keeps both associations even though only one row survives dedupe.
      const byMember = new Map<string, string[]>()
      for (const mt of result) {
        const memberId = String(asObj<Member>(mt.member)?.id ?? mt.member)
        const teamId = String(relId((mt as { team?: unknown }).team))
        if (!teamId) continue
        const arr = byMember.get(memberId)
        if (arr) { if (!arr.includes(teamId)) arr.push(teamId) }
        else byMember.set(memberId, [teamId])
      }
      const seen = new Set<string>()
      const deduped = result.filter(mt => {
        const memberId = String(asObj<Member>(mt.member)?.id ?? mt.member)
        if (seen.has(memberId)) return false
        seen.add(memberId)
        return true
      })
      if (latestKeyRef.current !== key) return
      setMembers(deduped)
      setTeamsByMember(byMember)
    } else if (latestKeyRef.current === key) {
      setError(outcome.err instanceof Error ? outcome.err : new Error(String(outcome.err)))
    }
    if (latestKeyRef.current === key) setLoadedKey(key)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Manual refetch keeps fetch()'s original eager resets — see useTeamMembers.
  const refetch = useCallback(async () => {
    if (requestedKey === null) {
      setMembers([])
      setTeamsByMember(new Map())
      setLoadedKey(null)
    } else {
      setError(null)
    }
    await load()
  }, [requestedKey, load])

  useEffect(() => {
    load()
  }, [load])

  return { members, teamsByMember, isLoading, error, refetch }
}
