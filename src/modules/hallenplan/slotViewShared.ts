import { useCallback, useMemo, useState } from 'react'
import type { HallSlot, Team } from '../../types'
import { timeToMinutes } from '../../utils/dateHelpers'
import type { PositionedSlot } from './utils/timeGrid'

/**
 * Shared slot-view logic used by both WeekSlotView and DaySlotView.
 *
 * These views group positioned slots by a location key — `${dayIndex}:${hall}`
 * in the week view, `${hall}` in the day view — but the overlap-resolution and
 * team-resolution logic is identical. Extracting it here keeps the two views'
 * core display behaviour in one place. The helpers are deliberately key-agnostic:
 * they operate on the group Map's *values*, so either key format works.
 */

/**
 * Resolve teams referenced by a slot's M2M `team` field, skipping stale archived
 * ids. A slot's M2M can carry a stale archived team (e.g. left over from a season
 * rollover that re-linked the new team without dropping the old one) — and the
 * teams we load are active-only, so the archived id resolves to nothing. This
 * hook skips past those to the first resolvable team instead of blindly reading
 * `team[0]`, and exposes name/sport accessors.
 */
export function useTeamResolver(teams: Team[]) {
  const teamMap = useMemo(() => {
    const m = new Map<string, Team>()
    for (const t of teams) m.set(String(t.id), t)
    return m
  }, [teams])

  const resolveTeam = (slot: HallSlot): { name?: string; sport?: string } | undefined => {
    for (const tid of slot.team ?? []) {
      if (tid == null) continue
      if (typeof tid === 'object') return tid as { name?: string; sport?: string }
      const found = teamMap.get(String(tid))
      if (found) return found
    }
    return undefined
  }

  const getTeamName = (slot: HallSlot): string => resolveTeam(slot)?.name ?? ''

  const getTeamSport = (slot: HallSlot): 'volleyball' | 'basketball' | undefined =>
    resolveTeam(slot)?.sport as 'volleyball' | 'basketball' | undefined

  return { getTeamName, getTeamSport }
}

/**
 * Collect the ids of slots that overlap at least one sibling within the same
 * group. Pairwise start/end comparison per group; groups of <2 are skipped.
 */
export function computeOverlappingSlotIds(
  groups: Map<string, PositionedSlot[]>,
): Set<string> {
  const ids = new Set<string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      const a = group[i]
      const aStart = timeToMinutes(a.slot.start_time)
      const aEnd = timeToMinutes(a.slot.end_time)
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j]
        const bStart = timeToMinutes(b.slot.start_time)
        const bEnd = timeToMinutes(b.slot.end_time)
        if (aStart < bEnd && aEnd > bStart) {
          ids.add(a.slot.id)
          ids.add(b.slot.id)
        }
      }
    }
  }
  return ids
}

/**
 * For each group, the ordered list of overlapping slot ids (used for cycling
 * which slot is "boosted" to the front). Only groups with >=2 overlaps are kept.
 */
export function computeOverlapGroups(
  groups: Map<string, PositionedSlot[]>,
  overlappingSlotIds: Set<string>,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const [key, group] of groups.entries()) {
    const overlapIds = group.filter((p) => overlappingSlotIds.has(p.slot.id)).map((p) => p.slot.id)
    if (overlapIds.length >= 2) map.set(key, overlapIds)
  }
  return map
}

/**
 * Overlap-resolution state + handlers for a set of grouped, positioned slots.
 *
 * `groups` is keyed by the view's location key (`${dayIndex}:${hall}` in the
 * week view, `${hall}` in the day view). `overlapGroups` and `handleSwap` are
 * keyed identically, so callers pass the same key back into `handleSwap` /
 * `boostedMap.get`.
 */
export function useOverlapResolution(groups: Map<string, PositionedSlot[]>) {
  const overlappingSlotIds = useMemo(() => computeOverlappingSlotIds(groups), [groups])

  const overlapGroups = useMemo(
    () => computeOverlapGroups(groups, overlappingSlotIds),
    [groups, overlappingSlotIds],
  )

  // Track which slot is "boosted" (brought to front) per group key
  const [boostedMap, setBoostedMap] = useState<Map<string, string>>(new Map())

  const handleSwap = useCallback((key: string) => {
    const ids = overlapGroups.get(key)
    if (!ids || ids.length < 2) return
    setBoostedMap((prev) => {
      const next = new Map(prev)
      const current = next.get(key)
      const currentIdx = current ? ids.indexOf(current) : -1
      const nextIdx = (currentIdx + 1) % ids.length
      next.set(key, ids[nextIdx])
      return next
    })
  }, [overlapGroups])

  return { overlappingSlotIds, overlapGroups, boostedMap, handleSwap }
}
