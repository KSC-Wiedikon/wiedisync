import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createRecord, deleteRecord, updateRecord, kscwApi } from '../../../lib/api'
import { useCollection } from '../../../lib/query'
import { useAuth } from '../../../hooks/useAuth'
import type {
  GameSchedulingSeason,
  Team,
  Hall,
  HallClosure,
  GameSchedulingSlot,
  BasketballSlotPlan,
  BasketballHallAvailability,
  BasketballTeamLink,
} from '../../../types'
import {
  probasketConfigForSeason,
  probasketCandidateDates,
  parseYmd,
  toYmd,
  slotsForDate,
  HALL_A,
  HALL_B,
  HALL_AB,
  type CandidateDate,
  type ProbasketSeasonConfig,
} from '../utils/probasketSeason'

export type SlotStatus = 'unavailable' | 'vb' | 'game' | 'free'

export interface HallCell {
  hall: string
  status: SlotStatus
  placement: BasketballSlotPlan | null
  /** This A/B half is covered by a combined 'KWI A+B' placement. */
  viaCombined?: boolean
}

export interface DateInfo {
  /** ProBasket blackout label (Ferien/Sperrdaten), or null. */
  blackout: string | null
  /** Hall names closed that day ('*' = all halls). */
  closedHalls: Set<string>
  /** Whole day is unavailable (blackout, club-wide block, or all halls closed). */
  fullyBlocked: boolean
  reason: string | null
}

export interface PlaceGameInput {
  kscw_team?: string | number | null
  kscw_team_label?: string | null
  opponent?: string | null
  sex?: 'm' | 'f' | 'mixed' | null
  game_type?: 'home' | 'guest'
  note?: string | null
}

interface ClubBlock { start_date: string; end_date: string }

export const slotKey = (date: string, time: string, hall: string) => `${date}|${time}|${hall}`
const availKey = (teamId: string | number, date: string) => `${teamId}|${date}`

function eachDay(start: string, end: string, cb: (ymd: string) => void) {
  const last = parseYmd(end)
  for (const d = parseYmd(start); d <= last; d.setDate(d.getDate() + 1)) cb(toYmd(d))
}

/**
 * Slot-grid planner data for the Basketball prep view: candidate dates, per-date
 * blackout/closure info, per-(date,time,hall) status (unavailable / vb / game / free)
 * with A+B combined-court occupancy, plus placement + availability writers.
 */
export function useBasketballPlan(season: GameSchedulingSeason | null) {
  const { user } = useAuth()
  const seasonId = season?.id ?? null
  const config = useMemo<ProbasketSeasonConfig | null>(
    () => probasketConfigForSeason(season?.season),
    [season?.season],
  )
  const candidateDates = useMemo<CandidateDate[]>(
    () => (config ? probasketCandidateDates(config) : []),
    [config],
  )
  const hasSeason = seasonId != null && !!config

  const teamsQ = useCollection<Team>('teams', {
    filter: { sport: { _eq: 'basketball' }, active: { _eq: true } },
    fields: ['id', 'name', 'league', 'gender', 'sport', 'active', 'bb_source_id'],
    sort: ['name'],
    all: true,
    staleTime: 60_000,
  })
  const planQ = useCollection<BasketballSlotPlan>('basketball_slot_plan', {
    filter: { season: { _eq: seasonId } },
    fields: ['*'],
    all: true,
    enabled: hasSeason,
  })
  const availQ = useCollection<BasketballHallAvailability>('basketball_hall_availability', {
    filter: { season: { _eq: seasonId } },
    fields: ['*'],
    all: true,
    enabled: hasSeason,
  })
  const linksQ = useCollection<BasketballTeamLink>('basketball_team_links', {
    filter: { season: { _eq: seasonId } },
    fields: ['*'],
    all: true,
    enabled: hasSeason,
  })
  const hallsQ = useCollection<Hall>('halls', { fields: ['id', 'name'], sort: ['name'], all: true, staleTime: 120_000 })
  const closuresQ = useCollection<HallClosure>('hall_closures', {
    fields: ['hall', 'start_date', 'end_date', 'reason', 'source'],
    filter: config ? { end_date: { _gte: config.vorrundeStart } } : undefined,
    all: true,
    enabled: !!config,
  })
  const vbSlotsQ = useCollection<GameSchedulingSlot>('game_scheduling_slots', {
    filter: { season: { _eq: seasonId }, status: { _eq: 'booked' } },
    fields: ['id', 'date', 'status', 'hall', 'start_time'],
    all: true,
    enabled: hasSeason,
  })
  const clubBlocksQ = useQuery<ClubBlock[]>({
    queryKey: ['bb-prep', 'club-blocked-dates'],
    queryFn: async () => {
      try {
        const res = await kscwApi<{ blocks: ClubBlock[] }>('/terminplanung/admin/club-blocked-dates')
        return res?.blocks ?? []
      } catch {
        return []
      }
    },
    staleTime: 60_000,
  })

  const teams = useMemo(() => teamsQ.data ?? [], [teamsQ.data])

  // Per-date blackout / closed-hall / club-block info.
  const dateInfoByDate = useMemo(() => {
    const halls = hallsQ.data ?? []
    const hallName = new Map<string, string>()
    for (const h of halls) hallName.set(String(h.id), h.name)

    const closedByDate = new Map<string, Set<string>>()
    for (const c of closuresQ.data ?? []) {
      const hn = c.hall ? hallName.get(String(c.hall)) ?? null : null
      eachDay(c.start_date, c.end_date, (ymd) => {
        const set = closedByDate.get(ymd) ?? new Set<string>()
        set.add(hn ?? '*')
        closedByDate.set(ymd, set)
      })
    }
    const clubBlocked = new Set<string>()
    for (const b of clubBlocksQ.data ?? []) eachDay(b.start_date, b.end_date, (ymd) => clubBlocked.add(ymd))

    const info = new Map<string, DateInfo>()
    for (const cd of candidateDates) {
      const closedHalls = closedByDate.get(cd.date) ?? new Set<string>()
      const { halls: dayHalls } = slotsForDate(cd.dow)
      const allClosed = dayHalls.length > 0 && dayHalls.every((h) => closedHalls.has('*') || closedHalls.has(h))
      const isClubBlocked = clubBlocked.has(cd.date)
      const fullyBlocked = !!cd.blackout || isClubBlocked || allClosed
      const reason = cd.blackout ? cd.blackout.label : isClubBlocked ? 'club_block' : allClosed ? 'closed' : null
      info.set(cd.date, { blackout: cd.blackout?.label ?? null, closedHalls, fullyBlocked, reason })
    }
    return info
  }, [hallsQ.data, closuresQ.data, clubBlocksQ.data, candidateDates])

  // VB-occupied halls per date (conservative: a booked slot blocks that hall all day).
  const vbHallsByDate = useMemo(() => {
    const halls = hallsQ.data ?? []
    const hallName = new Map<string, string>()
    for (const h of halls) hallName.set(String(h.id), h.name)
    const m = new Map<string, Set<string>>()
    for (const s of vbSlotsQ.data ?? []) {
      const hn = hallName.get(String(s.hall))
      if (!hn) continue
      const set = m.get(s.date) ?? new Set<string>()
      set.add(hn)
      m.set(s.date, set)
    }
    return m
  }, [vbSlotsQ.data, hallsQ.data])

  const hallNameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const h of hallsQ.data ?? []) m.set(String(h.id), h.name)
    return m
  }, [hallsQ.data])

  // Volleyball home games (booked slots) + hall closures — shown on the basketball
  // calendar for cross-sport hall coordination.
  const vbGames = useMemo(
    () =>
      (vbSlotsQ.data ?? [])
        .map((s) => ({ date: s.date, time: String(s.start_time ?? '').slice(0, 5), hall: hallNameMap.get(String(s.hall)) ?? '' }))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    [vbSlotsQ.data, hallNameMap],
  )
  const closureEntries = useMemo(
    () =>
      (closuresQ.data ?? []).map((c) => ({
        start: c.start_date,
        end: c.end_date,
        hall: c.hall ? hallNameMap.get(String(c.hall)) ?? null : null,
        reason: c.reason ?? '',
      })),
    [closuresQ.data, hallNameMap],
  )

  const placements = useMemo(() => {
    const m = new Map<string, BasketballSlotPlan>()
    for (const p of planQ.data ?? []) m.set(slotKey(p.date, p.time, p.hall), p)
    return m
  }, [planQ.data])

  const availability = useMemo(() => {
    const m = new Map<string, BasketballHallAvailability>()
    for (const r of availQ.data ?? []) m.set(availKey(r.team, r.date), r)
    return m
  }, [availQ.data])

  /** Per-hall view of a (date, time): status + placement, resolving A+B combined occupancy. */
  const slotView = useCallback(
    (date: string, dow: number, time: string): { cells: HallCell[]; canCombineAB: boolean } => {
      const info = dateInfoByDate.get(date)
      const vb = vbHallsByDate.get(date) ?? new Set<string>()
      const { halls } = slotsForDate(dow)
      const combined = placements.get(slotKey(date, time, HALL_AB)) ?? null
      const cells: HallCell[] = halls.map((hall) => {
        if (info?.blackout || info?.closedHalls.has('*') || info?.closedHalls.has(hall)) {
          return { hall, status: 'unavailable', placement: null }
        }
        if (combined && (hall === HALL_A || hall === HALL_B)) {
          return { hall, status: 'game', placement: combined, viaCombined: true }
        }
        const own = placements.get(slotKey(date, time, hall)) ?? null
        if (own) return { hall, status: 'game', placement: own }
        if (vb.has(hall)) return { hall, status: 'vb', placement: null }
        return { hall, status: 'free', placement: null }
      })
      const aFree = cells.find((c) => c.hall === HALL_A)?.status === 'free'
      const bFree = cells.find((c) => c.hall === HALL_B)?.status === 'free'
      return { cells, canCombineAB: !!aFree && !!bFree }
    },
    [dateInfoByDate, vbHallsByDate, placements],
  )

  const links = useMemo(() => linksQ.data ?? [], [linksQ.data])

  // teamId → { same, diff } partner team ids (both link directions).
  const partnersByTeam = useMemo(() => {
    const m = new Map<string, { same: Set<string>; diff: Set<string> }>()
    const ensure = (id: string) => {
      let e = m.get(id)
      if (!e) {
        e = { same: new Set(), diff: new Set() }
        m.set(id, e)
      }
      return e
    }
    for (const l of links) {
      const a = String(l.team_a)
      const b = String(l.team_b)
      const bucket = l.link_type === 'same' ? 'same' : 'diff'
      ensure(a)[bucket].add(b)
      ensure(b)[bucket].add(a)
    }
    return m
  }, [links])

  // (date|time) → team ids placed there (any hall).
  const teamsByDateTime = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const p of placements.values()) {
      if (p.kscw_team == null) continue
      const k = `${p.date}|${p.time}`
      const s = m.get(k) ?? new Set<string>()
      s.add(String(p.kscw_team))
      m.set(k, s)
    }
    return m
  }, [placements])

  /** For a selected team, mark a (date,time) as a suggested same-time slot or a conflict. */
  const highlightFor = useCallback(
    (teamId: string | number | null | undefined, date: string, time: string): 'suggest' | 'conflict' | null => {
      if (teamId == null) return null
      const p = partnersByTeam.get(String(teamId))
      if (!p) return null
      const here = teamsByDateTime.get(`${date}|${time}`)
      if (!here || here.size === 0) return null
      for (const tid of here) if (p.diff.has(tid)) return 'conflict'
      for (const tid of here) if (p.same.has(tid)) return 'suggest'
      return null
    },
    [partnersByTeam, teamsByDateTime],
  )

  const refetchLinks = linksQ.refetch
  const addLink = useCallback(
    async (teamA: string | number, teamB: string | number, linkType: 'same' | 'diff') => {
      if (seasonId == null || String(teamA) === String(teamB)) return
      await createRecord('basketball_team_links', {
        season: seasonId, team_a: teamA, team_b: teamB, link_type: linkType, created_by: user?.id ?? null,
      })
      await refetchLinks()
    },
    [seasonId, user?.id, refetchLinks],
  )
  const removeLink = useCallback(
    async (id: string | number) => {
      await deleteRecord('basketball_team_links', id)
      await refetchLinks()
    },
    [refetchLinks],
  )

  const isLoading =
    teamsQ.isLoading || hallsQ.isLoading || (hasSeason && (planQ.isLoading || vbSlotsQ.isLoading || closuresQ.isLoading))
  const error = (teamsQ.error || planQ.error || availQ.error || hallsQ.error || vbSlotsQ.error) as Error | null

  const refetchPlan = planQ.refetch
  const refetchAvail = availQ.refetch

  const placeGame = useCallback(
    async (date: string, time: string, hall: string, input: PlaceGameInput) => {
      if (seasonId == null) return
      const key = slotKey(date, time, hall)
      const existing = placements.get(key)
      const payload = {
        season: seasonId,
        date,
        time,
        hall,
        kscw_team: input.kscw_team ?? null,
        kscw_team_label: input.kscw_team_label ?? null,
        opponent: input.opponent ?? null,
        sex: input.sex ?? null,
        game_type: input.game_type ?? 'home',
        note: input.note ?? null,
        created_by: user?.id ?? null,
      }
      if (existing) await updateRecord<BasketballSlotPlan>('basketball_slot_plan', existing.id, payload)
      else await createRecord<BasketballSlotPlan>('basketball_slot_plan', payload)
      await refetchPlan()
    },
    [seasonId, user?.id, placements, refetchPlan],
  )

  const removeGame = useCallback(
    async (id: string | number) => {
      await deleteRecord('basketball_slot_plan', id)
      await refetchPlan()
    },
    [refetchPlan],
  )

  /** Per-team, per-date availability override for the ProBasket export (Nicht Verfügbar x). */
  const setDateUnavailable = useCallback(
    async (teamId: string | number, date: string, unavailable: boolean) => {
      if (seasonId == null) return
      const existing = availability.get(availKey(teamId, date))
      if (existing) await updateRecord('basketball_hall_availability', existing.id, { unavailable })
      else
        await createRecord('basketball_hall_availability', {
          season: seasonId,
          team: teamId,
          date,
          unavailable,
          windows: [],
          created_by: user?.id ?? null,
        })
      await refetchAvail()
    },
    [seasonId, user?.id, availability, refetchAvail],
  )

  return {
    config,
    candidateDates,
    teams,
    dateInfoByDate,
    vbHallsByDate,
    placements,
    availability,
    availKey,
    slotView,
    vbGames,
    closureEntries,
    links,
    highlightFor,
    addLink,
    removeLink,
    isLoading,
    error,
    placeGame,
    removeGame,
    setDateUnavailable,
  }
}
