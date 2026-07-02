import { useMemo } from 'react'
import { useCollection } from '../../../lib/query'
import { flattenM2MTeams } from '../../../lib/api'
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
  const halls = hallsRaw ?? []

  const { data: teamsRaw, isLoading: teamsLoading } = useCollection<Team>('teams', {
    filter: { active: { _eq: true } },
    sort: ['name'],
    limit: 50,
  })
  const teams = teamsRaw ?? []

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
    refetch: refetchSlots,
  } = useCollection<HallSlot>('hall_slots', {
    filter: { _and: slotFilterConditions },
    all: true,
    sort: ['day_of_week', 'start_time'],
    fields: ['*', 'teams.teams_id'],
  })
  const rawSlots = flattenM2MTeams(rawSlotsData ?? [])

  const closureDateConditions: Record<string, unknown>[] = [
    { start_date: { _lte: sundayStr } },
    { end_date: { _gte: mondayStr } },
  ]
  const closureFilterConditions = [...closureDateConditions, ...(hallCondition ? [hallCondition] : [])]

  const {
    data: closuresData,
    isLoading: closuresLoading,
    refetch: refetchClosures,
  } = useCollection<HallClosure>('hall_closures', {
    filter: { _and: closureFilterConditions },
    limit: 100,
  })
  const closures = closuresData ?? []

  // Games for this week (exclude postponed)
  const { data: gamesRaw, isLoading: gamesLoading, refetch: refetchGames } = useCollection<Game>('games', {
    filter: { _and: [{ date: { _gte: mondayStr } }, { date: { _lte: sundayStr } }, { away_team: { _nnull: true } }, { time: { _nnull: true } }, { _or: [{ status: { _neq: 'postponed' } }, { status: { _null: true } }] }] },
    limit: 100,
    sort: ['date', 'time'],
  })
  const games = gamesRaw ?? []

  // Trainings for this week
  const {
    data: trainingsRaw,
    isLoading: trainingsLoading,
    refetch: refetchTrainings,
  } = useCollection<Training>('trainings', {
    filter: { _and: [{ date: { _gte: mondayStr } }, { date: { _lte: sundayStr } }] },
    all: true,
    sort: ['date', 'start_time'],
  })
  const trainings = trainingsRaw ?? []

  // Hall events (GCal) for this week
  const { data: hallEventsRaw, isLoading: hallEventsLoading, refetch: refetchHallEvents } = useCollection<HallEvent>('hall_events', {
    filter: { _and: [{ date: { _gte: mondayStr } }, { date: { _lte: sundayStr } }] },
    limit: 100,
    sort: ['date', 'start_time'],
  })
  const hallEvents = hallEventsRaw ?? []

  // Slot claims for this week
  const {
    data: slotClaimsRaw,
    isLoading: claimsLoading,
    refetch: refetchClaims,
  } = useCollection<SlotClaim>('slot_claims', {
    filter: { _and: [{ date: { _gte: mondayStr } }, { date: { _lte: sundayStr } }, { status: { _eq: 'active' } }] },
    limit: 100,
  })
  const slotClaims = slotClaimsRaw ?? []

  // Convert GCal closure events ("Halle geschlossen") into synthetic HallClosure records
  // and merge with real closures (deduplicating where a hall_closures record already exists)
  const mergedClosures = useMemo(() => {
    const syntheticClosures: HallClosure[] = []
    for (const he of hallEvents) {
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

  // Convert and merge virtual slots
  const slots = useMemo(() => {
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

    return mergeVirtualSlots(rawSlots, filteredVirtual, slotClaims, mergedClosures, games, weekDays, halls, teams)
  }, [rawSlots, games, trainings, hallEvents, weekDays, halls, teams, selectedHallIds, slotClaims, mergedClosures])

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
