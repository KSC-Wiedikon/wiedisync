import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { kscwApi } from '../../../lib/api'

/**
 * What the opponent clubs answered: which DATES suit them, per KSCW team
 * (`basketball_club_date_prefs`, migration 296; endpoint in basketball-portal.js).
 *
 * ⚠ These are availabilities, not bookings. A preference holds no hall slot and blocks no
 * other club — the planner reads them, decides, and then creates the `basketball_slot_plan`
 * row, which is the thing that actually claims the floor (migrations 278 + 295).
 *
 * Read through the admin endpoint rather than the items API, like the rest of this module: the
 * rows carry an opponent's contact name and address, so they stay behind the basketball gate.
 */

export interface BbDatePref {
  id: number
  /** 'YYYY-MM-DD'. */
  date: string
  kscw_team: number
  kscw_team_name: string
  bp_club: number
  club_name: string
  note: string
  responder_name: string
  responder_email: string
  date_updated: string | null
}

/** All clubs that can play a given team on a given date — the planner's unit of decision. */
export interface BbDatePrefGroup {
  date: string
  kscw_team: number
  kscw_team_name: string
  clubs: BbDatePref[]
}

export function useBasketballDatePrefs(seasonId: string | number | null | undefined) {
  const enabled = seasonId != null && seasonId !== ''

  const query = useQuery({
    queryKey: ['bb-date-prefs', String(seasonId ?? '')],
    enabled,
    queryFn: () =>
      kscwApi<{ prefs: BbDatePref[] }>(
        `/admin/terminplanung/bb/date-prefs?season=${encodeURIComponent(String(seasonId))}`,
      ),
  })

  const prefs = useMemo(() => query.data?.prefs ?? [], [query.data])

  /**
   * Grouped by (team, date) because that is what a planner acts on: "on 26.09 our DU14 could
   * host Uster or Kriens". A flat list would make them do that join by eye.
   */
  const groups = useMemo(() => {
    const byKey = new Map<string, BbDatePrefGroup>()
    for (const p of prefs) {
      const key = `${p.kscw_team}|${p.date}`
      const g = byKey.get(key)
      if (g) g.clubs.push(p)
      else byKey.set(key, { date: p.date, kscw_team: p.kscw_team, kscw_team_name: p.kscw_team_name, clubs: [p] })
    }
    return [...byKey.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.kscw_team_name.localeCompare(b.kscw_team_name),
    )
  }, [prefs])

  /** How many distinct clubs have answered at all — the "is anyone back yet?" number. */
  const clubsAnswered = useMemo(() => new Set(prefs.map((p) => p.bp_club)).size, [prefs])

  return {
    prefs,
    groups,
    clubsAnswered,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
  }
}
