import { useMemo, useState } from 'react'
import { useCollection } from '../../../lib/query'
import { flattenM2MTeams } from '../../../lib/api'

// Shared stable empty fallback. Using a module-level constant (not a fresh `[]`
// literal per render) keeps `?? EMPTY` referentially stable while a query is
// still loading, so the `computedSlots` memo below doesn't recompute to a new
// reference every render — which would make the stableSlots setState guard
// never settle ("Too many re-renders", fixed 2026-07-09).
const EMPTY: never[] = []
import { toISODate } from '../../../utils/dateHelpers'
import type { Hall, HallSlot, HallClosure, Team, Game, Training, HallEvent, SlotClaim } from '../../../types'
import {
  gameToVirtualSlots,
  trainingToVirtualSlot,
  hallEventToVirtualSlots,
  mergeVirtualSlots,
  CLOSURE_PATTERN,
  BB_GAME_PATTERN,
  resolveHallEventHalls,
  dedupeClosuresByPriority,
  FREED_HORIZON_WEEKS,
} from '../utils/virtualSlots'

export function useHallenplanData(
  selectedHallIds: string[],
  mondayStr: string,
  sundayStr: string,
  weekDays: Date[],
) {
  const { data: hallsRaw, isLoading: hallsLoading } = useCollection<Hall>('halls', {
    sort: ['name'],
    limit: 50,
  })
  const halls = hallsRaw ?? EMPTY

  const { data: teamsRaw, isLoading: teamsLoading } = useCollection<Team>('teams', {
    filter: { active: { _eq: true } },
    sort: ['name'],
    limit: 50,
  })
  const teams = teamsRaw ?? EMPTY

  const hallCondition = selectedHallIds.length > 0
    ? { hall: { _in: selectedHallIds } }
    : null
  const dateConditions: Record<string, unknown>[] = [
    { _or: [{ valid_from: { _lte: sundayStr } }, { valid_from: { _null: true } }] },
    { _or: [{ valid_until: { _gte: mondayStr } }, { valid_until: { _null: true } }] },
  ]
  const slotFilterConditions = [...dateConditions, ...(hallCondition ? [hallCondition] : [])]

  const {
    data: rawSlotsData,
    isLoading: slotsLoading,
    isPlaceholderData: slotsStale,
    refetch: refetchSlots,
  } = useCollection<HallSlot>('hall_slots', {
    filter: { _and: slotFilterConditions },
    all: true,
    sort: ['day_of_week', 'start_time'],
    // `teams.id` = junction row PK; SlotEditor sends it back on save so
    // unchanged team links update instead of re-inserting (migration 245's
    // `hall_slots_teams_pair_uq`). See `m2mUpdatePayload`.
    fields: ['*', 'teams.id', 'teams.teams_id'],
  })
  // Memoized — flattenM2MTeams builds a fresh array + fresh objects on every
  // call, so without this rawSlots (and thus computedSlots) would be a new
  // reference every render.
  const rawSlots = useMemo(() => flattenM2MTeams(rawSlotsData ?? EMPTY), [rawSlotsData])

  const closureDateConditions: Record<string, unknown>[] = [
    { start_date: { _lte: sundayStr } },
    { end_date: { _gte: mondayStr } },
  ]
  const closureFilterConditions = [...closureDateConditions, ...(hallCondition ? [hallCondition] : [])]

  const {
    data: closuresData,
    isLoading: closuresLoading,
    isPlaceholderData: closuresStale,
    refetch: refetchClosures,
  } = useCollection<HallClosure>('hall_closures', {
    filter: { _and: closureFilterConditions },
    limit: 100,
  })
  const closures = closuresData ?? EMPTY

  // Games for this week (exclude postponed)
  const { data: gamesRaw, isLoading: gamesLoading, isPlaceholderData: gamesStale, refetch: refetchGames } = useCollection<Game>('games', {
    filter: { _and: [{ date: { _gte: mondayStr } }, { date: { _lte: sundayStr } }, { away_team: { _nnull: true } }, { time: { _nnull: true } }, { _or: [{ status: { _neq: 'postponed' } }, { status: { _null: true } }] }] },
    limit: 100,
    sort: ['date', 'time'],
  })
  const games = gamesRaw ?? EMPTY

  // Trainings for this week
  const {
    data: trainingsRaw,
    isLoading: trainingsLoading,
    isPlaceholderData: trainingsStale,
    refetch: refetchTrainings,
  } = useCollection<Training>('trainings', {
    filter: { _and: [{ date: { _gte: mondayStr } }, { date: { _lte: sundayStr } }] },
    all: true,
    sort: ['date', 'start_time'],
  })
  const trainings = trainingsRaw ?? EMPTY

  // Hall events (GCal) for this week
  const { data: hallEventsRaw, isLoading: hallEventsLoading, isPlaceholderData: hallEventsStale, refetch: refetchHallEvents } = useCollection<HallEvent>('hall_events', {
    filter: { _and: [{ date: { _gte: mondayStr } }, { date: { _lte: sundayStr } }] },
    limit: 100,
    sort: ['date', 'start_time'],
    // closure_override is load-bearing below — an unlisted field would be
    // undefined, which reads as "not overridden" and silently re-closes the hall.
    fields: ['*'],
  })
  const hallEvents = hallEventsRaw ?? EMPTY

  // Slot claims for this week
  const {
    data: slotClaimsRaw,
    isLoading: claimsLoading,
    isPlaceholderData: claimsStale,
    refetch: refetchClaims,
  } = useCollection<SlotClaim>('slot_claims', {
    filter: { _and: [{ date: { _gte: mondayStr } }, { date: { _lte: sundayStr } }, { status: { _eq: 'active' } }] },
    limit: 100,
  })
  const slotClaims = slotClaimsRaw ?? EMPTY

  // Convert GCal closure events ("Halle geschlossen") into synthetic HallClosure records
  // and merge with real closures (deduplicating where a hall_closures record already exists)
  const mergedClosures = useMemo(() => {
    const syntheticClosures: HallClosure[] = []
    for (const he of hallEvents) {
      // ⚠ An admin override (migration 325) deletes the real hall_closures rows.
      // Without this guard the synthetic path below would re-add the closure from
      // the title alone, so the Hallenplan would keep showing the hall shut and
      // the override would look broken everywhere except the closures page.
      if (he.closure_override === false) continue
      if (!CLOSURE_PATTERN.test(he.title)) continue
      const hallIds = resolveHallEventHalls(he, halls)
      const dateStr = he.date.slice(0, 10)
      for (const hallId of hallIds) {
        // Skip if a real hall_closures record already covers this hall+date
        const alreadyCovered = closures.some(
          (c) => c.hall === hallId && c.start_date <= dateStr && c.end_date >= dateStr,
        )
        if (alreadyCovered) continue
        syntheticClosures.push({
          id: `gcal-closure-${he.id}-${hallId}`,
          collectionId: '',
          collectionName: 'hall_closures',
          created: '',
          updated: '',
          push_to_gcal: false, // synthetic: mirrors THEIR entry, never published back
          hall: hallId,
          start_date: dateStr,
          end_date: dateStr,
          reason: he.title,
          source: 'gcal',
        } as HallClosure)
      }
    }
    // Dedupe by source priority: school_holidays > admin > hauswart > gcal > auto.
    // A Sportferien/Ferien closure suppresses any lower-priority closure on
    // the same hall that it fully covers, so the display never doubles up.
    return dedupeClosuresByPriority([...closures, ...syntheticClosures])
  }, [closures, hallEvents, halls])

  // Recurring training templates only render as claimable "Frei" within the
  // backend generation horizon; past it they show as occupied (planned)
  // trainings. Computed once per mount — the exact day boundary is not critical.
  const freedHorizonDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + FREED_HORIZON_WEEKS * 7)
    return toISODate(d)
  }, [])

  // On a week switch, every date-scoped query briefly serves the PREVIOUS
  // week's rows as placeholder data (keepPreviousData in the global query
  // client). The recurring hall_slot templates are week-agnostic (keyed by
  // day_of_week), so they render for the new week immediately — but the
  // placeholder trainings/games still carry last week's dates, which map to no
  // cell in the new week, so nothing suppresses the templates and the grid
  // flashes all-green ("Frei") until the real occupancy resolves. Freeze on the
  // last fully-consistent slot set while ANY date-scoped query is still showing
  // placeholder data, then swap atomically once every query has resolved for
  // the current week. (isPlaceholderData is false during same-week background
  // refetches, so realtime refreshes still update in place.)
  const showingStale =
    slotsStale || trainingsStale || gamesStale || hallEventsStale || closuresStale || claimsStale

  // Convert and merge virtual slots. Computed from whatever data is currently
  // in cache — during a week transition this may be inconsistent (see below),
  // so the exposed `slots` routes around it via `stableSlots`.
  const computedSlots = useMemo(() => {
    const virtualSlots: HallSlot[] = []

    for (const game of games) {
      virtualSlots.push(...gameToVirtualSlots(game, weekDays, halls, teams))
    }

    for (const training of trainings) {
      const vs = trainingToVirtualSlot(training, weekDays)
      if (vs) virtualSlots.push(vs)
    }

    // Build a set of basketplan game date keys for BB GCal dedup
    const bpGameDateKeys = new Set(
      games
        .filter((g) => g.source === 'basketplan')
        .map((g) => {
          const t = g.time ? (g.time.includes(' ') ? g.time.split(' ')[1].slice(0, 5) : g.time.slice(0, 5)) : ''
          return `${g.date?.slice(0, 10)}-${t}`
        }),
    )

    for (const he of hallEvents) {
      // Skip closure events — they're handled as ClosureOverlay via mergedClosures
      if (CLOSURE_PATTERN.test(he.title)) continue
      // Skip BB GCal events when a basketplan game already covers that slot
      if (BB_GAME_PATTERN.test(he.title) && bpGameDateKeys.size > 0) {
        const heKey = `${he.date?.slice(0, 10)}-${he.start_time?.slice(0, 5)}`
        if (bpGameDateKeys.has(heKey)) continue
      }
      virtualSlots.push(...hallEventToVirtualSlots(he, weekDays, halls))
    }

    // Apply hall filter to virtual slots
    const hallSet = new Set(selectedHallIds)
    const filteredVirtual = hallSet.size > 0
      ? virtualSlots.filter((vs) => hallSet.has(vs.hall))
      : virtualSlots

    return mergeVirtualSlots(rawSlots, filteredVirtual, slotClaims, mergedClosures, games, weekDays, halls, teams, freedHorizonDate)
  }, [rawSlots, games, trainings, hallEvents, weekDays, halls, teams, selectedHallIds, slotClaims, mergedClosures, freedHorizonDate])

  // Hold the last fully-consistent merge so a week switch swaps atomically
  // instead of flashing the recurring templates as all-green ("Frei") while the
  // new week's trainings/games are still loading (they briefly serve the prior
  // week's placeholder rows, which map to no cell in the new week). While any
  // date-scoped query is showing placeholder data we keep the previous grid;
  // once they all resolve, `computedSlots` is consistent again and we swap it in
  // by adjusting state during render (React's endorsed "store info from previous
  // renders" pattern — https://react.dev/reference/react/useState).
  //
  // The equality guard only settles because `computedSlots` is now referentially
  // STABLE when the underlying data is unchanged — all of its memo inputs
  // (rawSlots + the `?? EMPTY` query arrays) are stable references. Before that
  // fix (rawSlots was a fresh array every render) the guard never settled and
  // this looped → "Too many re-renders". isPlaceholderData is false during
  // same-week background refetches, so realtime refreshes still update in place.
  const [stableSlots, setStableSlots] = useState<HallSlot[]>(computedSlots)
  if (!showingStale && stableSlots !== computedSlots) {
    setStableSlots(computedSlots)
  }
  const slots = showingStale ? stableSlots : computedSlots

  const refetch = () => {
    refetchSlots()
    refetchClosures()
    refetchClaims()
    refetchTrainings()
    refetchGames()
    refetchHallEvents()
  }

  const isLoading =
    hallsLoading || teamsLoading || slotsLoading || closuresLoading ||
    gamesLoading || trainingsLoading || hallEventsLoading || claimsLoading

  return { halls, teams, slots, rawSlots, closures: mergedClosures, slotClaims, isLoading, refetch }
}
