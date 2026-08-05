import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { kscwApi } from '../../../lib/api'
import { HALL_A, HALL_B, HALL_AB } from '../utils/probasketSeason'

/**
 * The GENERATED basketball candidate inventory (`basketball_slots`, migration 278).
 *
 * Read through the custom endpoint rather than the items API on purpose: the generator
 * writes with raw knex behind its own gate and the Terminplanung policy holds READ only,
 * so `GET /terminplanung/admin/basketball/slots` is the single documented reader. The two
 * mutating calls (generate / clear) are POSTs on the same endpoint, which captures the
 * actor via `writeUserLog` — a client-side loop over the items API would not.
 */

export interface BasketballSlotReason {
  code: string
  delta: number
}

export interface BasketballSlot {
  id: number
  kscw_team: number
  /** 'YYYY-MM-DD'. */
  date: string
  /** 'HH:MM' tip-off. */
  time: string
  end_time: string
  /** 'KWI A' | 'KWI B' | 'KWI C' | 'KWI A+B'. */
  hall: string
  status: 'available' | 'placed' | 'blocked'
  source: 'generated' | 'manual'
  /** Soft ranking — higher is better. */
  score: number
  score_reasons: BasketballSlotReason[]
  plan: number | null
  generation_run: string | null
  generated_at: string | null
  note: string | null
}

export interface BasketballGeneratePerTeam {
  team: number
  league: string
  candidates: number
  kept: number
  /** reject reason code → how many candidates it removed. */
  rejects: Record<string, number>
}

export interface BasketballGenerateResult {
  run_id: string
  created: number
  updated: number
  deleted: number
  total: number
  per_team: BasketballGeneratePerTeam[]
}

/** How many of a team's best slots get the "top pick" marker in the prep grid. */
export const TOP_SUGGESTION_COUNT = 8

export const slotCellKey = (date: string, time: string, hall: string) => `${date}|${time}|${hall}`

function parseReasons(value: unknown): BasketballSlotReason[] {
  if (Array.isArray(value)) return value as BasketballSlotReason[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as BasketballSlotReason[]) : []
    } catch {
      return []
    }
  }
  return []
}

export interface UseBasketballSlotsOptions {
  /** Restrict the fetch to one team (the prep grid). Omitted → the whole season. */
  teamId?: string | number | null
  enabled?: boolean
}

export function useBasketballSlots(
  seasonId: string | number | null | undefined,
  opts: UseBasketballSlotsOptions = {},
) {
  const teamId = opts.teamId ?? null
  const enabled = seasonId != null && opts.enabled !== false

  const [generating, setGenerating] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [result, setResult] = useState<BasketballGenerateResult | null>(null)

  const slotsQ = useQuery<BasketballSlot[]>({
    queryKey: ['bb-slots', String(seasonId ?? ''), String(teamId ?? 'all')],
    queryFn: async () => {
      const qs = new URLSearchParams({ season_id: String(seasonId) })
      if (teamId != null && teamId !== '') qs.set('team_id', String(teamId))
      const res = await kscwApi<{ slots: Record<string, unknown>[] }>(
        `/terminplanung/admin/basketball/slots?${qs.toString()}`,
      )
      return (res?.slots ?? []).map((s) => ({
        ...(s as unknown as BasketballSlot),
        score: Number(s.score ?? 0),
        score_reasons: parseReasons(s.score_reasons),
      }))
    },
    enabled,
    staleTime: 30_000,
  })

  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data])

  /** teams.id → its candidate slots, best first. */
  const byTeam = useMemo(() => {
    const m = new Map<string, BasketballSlot[]>()
    for (const s of slots) {
      const k = String(s.kscw_team)
      const arr = m.get(k) ?? []
      arr.push(s)
      m.set(k, arr)
    }
    for (const arr of m.values()) arr.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
    return m
  }, [slots])

  /** teams.id → how many slots are still offerable (a placed one is no longer a candidate). */
  const availableByTeam = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of slots) {
      if (s.status !== 'available') continue
      const k = String(s.kscw_team)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [slots])

  const refetch = slotsQ.refetch

  /**
   * (date|time|hall) → the slot generated for `teamId`. Only built when the hook is
   * scoped to one team; a season-wide map would collide across teams on the same pitch.
   */
  const byCell = useMemo(() => {
    const m = new Map<string, BasketballSlot>()
    if (teamId == null || teamId === '') return m
    for (const s of slots) {
      if (String(s.kscw_team) !== String(teamId)) continue
      const key = slotCellKey(s.date, s.time, s.hall)
      const prev = m.get(key)
      if (!prev || s.score > prev.score) m.set(key, s)
    }
    return m
  }, [slots, teamId])

  /** The selected team's highest-scoring slots — marked as top picks in the grid. */
  const topCellKeys = useMemo(() => {
    const keys = new Set<string>()
    if (teamId == null || teamId === '') return keys
    const mine = (byTeam.get(String(teamId)) ?? []).filter((s) => s.status === 'available')
    for (const s of mine.slice(0, TOP_SUGGESTION_COUNT)) keys.add(slotCellKey(s.date, s.time, s.hall))
    return keys
  }, [byTeam, teamId])

  /**
   * The suggestion for one grid cell. A 'KWI A+B' candidate is reported on the A and B
   * cells too (flagged `combined`), because the grid has no A+B column — the planner
   * picks the combined court inside the place-game modal.
   */
  const suggestionAt = useCallback(
    (date: string, time: string, hall: string): { slot: BasketballSlot; combined: boolean; top: boolean } | null => {
      const own = byCell.get(slotCellKey(date, time, hall))
      if (own) return { slot: own, combined: false, top: topCellKeys.has(slotCellKey(date, time, hall)) }
      if (hall === HALL_A || hall === HALL_B) {
        const ab = byCell.get(slotCellKey(date, time, HALL_AB))
        if (ab) return { slot: ab, combined: true, top: topCellKeys.has(slotCellKey(date, time, HALL_AB)) }
      }
      return null
    },
    [byCell, topCellKeys],
  )

  const generate = useCallback(async () => {
    if (seasonId == null) return null
    setGenerating(true)
    try {
      const res = await kscwApi<BasketballGenerateResult & { success: boolean }>(
        '/terminplanung/admin/basketball/generate-slots',
        { method: 'POST', body: { season_id: seasonId } },
      )
      setResult(res)
      await refetch()
      return res
    } finally {
      setGenerating(false)
    }
  }, [seasonId, refetch])

  const clearSlots = useCallback(async () => {
    if (seasonId == null) return null
    setClearing(true)
    try {
      const res = await kscwApi<{ deleted: number }>('/terminplanung/admin/basketball/clear-slots', {
        method: 'POST',
        body: { season_id: seasonId },
      })
      setResult(null)
      await refetch()
      return res
    } finally {
      setClearing(false)
    }
  }, [seasonId, refetch])

  return {
    slots,
    byTeam,
    availableByTeam,
    byCell,
    suggestionAt,
    topCellKeys,
    isLoading: slotsQ.isLoading,
    error: (slotsQ.error as Error | null) ?? null,
    generating,
    clearing,
    result,
    generate,
    clearSlots,
    refetch,
  }
}
