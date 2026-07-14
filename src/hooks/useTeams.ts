import { useCollection } from '../lib/query'
import type { Team } from '../types'

// Shared frozen fallback. A fresh `[]` here would hand every caller a new array
// identity on each render while the query is in flight, which breaks any consumer
// that compares it by reference — `ManualGameModal` seeds form state during render
// and re-rendered forever on an unstable `allTeams` (React #301, prod 2026-07-14).
const NO_TEAMS: Team[] = []

export function useTeams(sport?: 'volleyball' | 'basketball' | 'all') {
  const filter: Record<string, unknown> =
    sport && sport !== 'all'
      ? { _and: [{ active: { _eq: true } }, { sport: { _eq: sport } }] }
      : { active: { _eq: true } }

  const result = useCollection<Team>('teams', {
    filter,
    sort: ['name'],
    limit: 50,
  })

  return { ...result, data: result.data ?? NO_TEAMS }
}
