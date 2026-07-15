import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createRecord, updateRecord, deleteRecord, kscwApi } from '../../../lib/api'
import { useCollection } from '../../../lib/query'
import { useAuth } from '../../../hooks/useAuth'
import type {
  GameSchedulingSeason,
  Team,
  Hall,
  HallClosure,
  HallSlot,
  GameSchedulingSlot,
  BasketballHallAvailability,
} from '../../../types'
import {
  probasketConfigForSeason,
  probasketCandidateDates,
  parseYmd,
  toYmd,
  jsDayToDbDow,
  type CandidateDate,
  type ProbasketSeasonConfig,
} from '../utils/probasketSeason'

/** Computed hint for a (date, hall) cell — guides what availability to declare. */
export type HallCellStatus = 'blackout' | 'closed' | 'club_block' | 'vb_using' | 'training_only' | 'free'

export interface DateOverlay {
  /** ProBasket blackout label (Ferien/Sperrdaten), or null. */
  blackoutLabel: string | null
  /** Club-wide blackout (scheduling_global_blocks) covers this date. */
  clubBlocked: boolean
  /** hall name → computed status. */
  perHall: Record<string, HallCellStatus>
}

export type AvailabilityPatch = Partial<
  Pick<BasketballHallAvailability, 'unavailable' | 'windows' | 'note'>
>

interface ClubBlock {
  start_date: string
  end_date: string
}

export const availKey = (teamId: string | number, date: string) => `${teamId}|${date}`

/** Expand an inclusive [start,end] YYYY-MM-DD range into individual day keys. */
function eachDay(start: string, end: string, cb: (ymd: string) => void) {
  const last = parseYmd(end)
  for (const d = parseYmd(start); d <= last; d.setDate(d.getDate() + 1)) cb(toYmd(d))
}

/**
 * Everything the Basketball prep view needs for one season: the candidate Fri/Sat/Sun
 * home dates, per-(date,hall) overlays (VB usage / closures / club blocks / training),
 * the saved availability, and upsert/clear writers (Directus items API → auto actor log).
 *
 * Reads go through the shared React-Query `useCollection` wrapper (cached, declarative —
 * no manual effects); the club-wide blocks come from a superadmin-gated endpoint (empty
 * for a non-superadmin bb_admin, never throws).
 */
export function useBasketballAvailability(season: GameSchedulingSeason | null) {
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
    fields: ['id', 'name', 'league', 'gender', 'sport', 'active'],
    sort: ['name'],
    all: true,
    staleTime: 60_000,
  })
  const availQ = useCollection<BasketballHallAvailability>('basketball_hall_availability', {
    filter: { season: { _eq: seasonId } },
    fields: ['*'],
    all: true,
    enabled: hasSeason,
  })
  const hallsQ = useCollection<Hall>('halls', {
    fields: ['id', 'name'],
    sort: ['name'],
    all: true,
    staleTime: 120_000,
  })
  const closuresQ = useCollection<HallClosure>('hall_closures', {
    fields: ['hall', 'start_date', 'end_date', 'reason', 'source'],
    filter: config ? { end_date: { _gte: config.vorrundeStart } } : undefined,
    all: true,
    enabled: !!config,
  })
  const vbSlotsQ = useCollection<GameSchedulingSlot>('game_scheduling_slots', {
    filter: { season: { _eq: seasonId }, status: { _in: ['booked', 'blocked'] } },
    fields: ['id', 'date', 'status', 'hall'],
    all: true,
    enabled: hasSeason,
  })
  const trainingQ = useCollection<HallSlot>('hall_slots', {
    filter: { sport: { _eq: 'basketball' }, slot_type: { _eq: 'training' } },
    fields: ['id', 'day_of_week', 'hall', 'slot_type', 'sport'],
    all: true,
    staleTime: 60_000,
  })
  // Club-wide blocks — superadmin-gated endpoint; a non-superadmin bb_admin just gets
  // nothing (never throws), same as SchedulingCalendar.
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

  const { kwiHalls, overlayByDate } = useMemo(() => {
    const halls = hallsQ.data ?? []
    const hallName = new Map<string, string>()
    for (const h of halls) hallName.set(String(h.id), h.name)
    const kwi = halls
      .filter((h) => /^KWI\b/i.test(h.name))
      .map((h) => h.name)
      .sort()

    // Per-day closed halls (keep the hall; a null hall closes everything, key '*').
    const closedByDate = new Map<string, Set<string>>()
    for (const c of closuresQ.data ?? []) {
      const hn = c.hall ? hallName.get(String(c.hall)) ?? null : null
      eachDay(c.start_date, c.end_date, (ymd) => {
        const set = closedByDate.get(ymd) ?? new Set<string>()
        set.add(hn ?? '*')
        closedByDate.set(ymd, set)
      })
    }

    const clubBlockedDates = new Set<string>()
    for (const b of clubBlocksQ.data ?? []) eachDay(b.start_date, b.end_date, (ymd) => clubBlockedDates.add(ymd))

    // VB occupancy: a 'booked' slot means volleyball actively uses that KWI hall.
    const vbUsingByDate = new Map<string, Set<string>>()
    for (const s of vbSlotsQ.data ?? []) {
      if (s.status !== 'booked') continue
      const hn = hallName.get(String(s.hall))
      if (!hn) continue
      const set = vbUsingByDate.get(s.date) ?? new Set<string>()
      set.add(hn)
      vbUsingByDate.set(s.date, set)
    }

    // Basketball training by weekday+hall (DB day_of_week 0=Mon..6=Sun).
    const trainingByDow = new Map<number, Set<string>>()
    for (const tr of trainingQ.data ?? []) {
      const hn = hallName.get(String(tr.hall))
      if (hn == null) continue
      const set = trainingByDow.get(tr.day_of_week) ?? new Set<string>()
      set.add(hn)
      trainingByDow.set(tr.day_of_week, set)
    }

    const overlay = new Map<string, DateOverlay>()
    for (const cd of candidateDates) {
      const closed = closedByDate.get(cd.date)
      const clubBlocked = clubBlockedDates.has(cd.date)
      const vbUsing = vbUsingByDate.get(cd.date)
      const training = trainingByDow.get(jsDayToDbDow(cd.dow))
      const perHall: Record<string, HallCellStatus> = {}
      for (const h of kwi) {
        let status: HallCellStatus = 'free'
        if (cd.blackout) status = 'blackout'
        else if (closed && (closed.has('*') || closed.has(h))) status = 'closed'
        else if (clubBlocked) status = 'club_block'
        else if (vbUsing?.has(h)) status = 'vb_using'
        else if (training?.has(h)) status = 'training_only'
        perHall[h] = status
      }
      overlay.set(cd.date, { blackoutLabel: cd.blackout?.label ?? null, clubBlocked, perHall })
    }
    return { kwiHalls: kwi, overlayByDate: overlay }
  }, [hallsQ.data, closuresQ.data, clubBlocksQ.data, vbSlotsQ.data, trainingQ.data, candidateDates])

  const availability = useMemo(() => {
    const m = new Map<string, BasketballHallAvailability>()
    for (const r of availQ.data ?? []) m.set(availKey(r.team, r.date), r)
    return m
  }, [availQ.data])

  const isLoading =
    teamsQ.isLoading ||
    hallsQ.isLoading ||
    trainingQ.isLoading ||
    (hasSeason && (availQ.isLoading || vbSlotsQ.isLoading || closuresQ.isLoading))
  const error = (teamsQ.error ||
    availQ.error ||
    hallsQ.error ||
    closuresQ.error ||
    vbSlotsQ.error ||
    trainingQ.error) as Error | null

  const refetchAvail = availQ.refetch

  const saveAvailability = useCallback(
    async (teamId: string | number, date: string, patch: AvailabilityPatch) => {
      if (seasonId == null) return
      const existing = availability.get(availKey(teamId, date))
      const saved = existing
        ? await updateRecord<BasketballHallAvailability>('basketball_hall_availability', existing.id, patch)
        : await createRecord<BasketballHallAvailability>('basketball_hall_availability', {
            season: seasonId,
            team: teamId,
            date,
            unavailable: false,
            windows: [],
            note: '',
            created_by: user?.id ?? null,
            ...patch,
          })
      await refetchAvail()
      return saved
    },
    [seasonId, user?.id, availability, refetchAvail],
  )

  const clearAvailability = useCallback(
    async (teamId: string | number, date: string) => {
      const existing = availability.get(availKey(teamId, date))
      if (!existing) return
      await deleteRecord('basketball_hall_availability', existing.id)
      await refetchAvail()
    },
    [availability, refetchAvail],
  )

  return {
    config,
    teams,
    kwiHalls,
    candidateDates,
    overlayByDate,
    availability,
    availKey,
    isLoading,
    error,
    saveAvailability,
    clearAvailability,
  }
}
