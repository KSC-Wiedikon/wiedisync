/**
 * Shared data hooks — deduplicated, cached queries for commonly used collections.
 *
 * Import these instead of calling useCollection('teams', ...) in every component.
 * TanStack Query deduplicates under the hood, but shared hooks also:
 * - Enforce consistent filter/sort/field selection
 * - Provide typed return values
 * - Are easy to find and refactor
 */

import { useCollection } from '../lib/query'
import type { Team, Member, Hall, HallSlot, Sponsor } from '../types'

/** All active teams, sorted by name. Cached globally. */
export function useActiveTeams() {
  return useCollection<Team>('teams', {
    filter: { active: { _eq: true } },
    sort: ['name'],
    all: true,
    staleTime: 60_000, // teams rarely change
  })
}

/** All active members. Cached globally. */
export function useActiveMembers(fields?: string[]) {
  return useCollection<Member>('members', {
    filter: { kscw_membership_active: { _eq: true } },
    sort: ['last_name', 'first_name'],
    fields: fields ?? ['id', 'first_name', 'last_name', 'email', 'photo', 'number', 'position', 'role'],
    all: true,
    staleTime: 60_000,
  })
}

/** All halls. Cached globally. */
export function useHalls() {
  return useCollection<Hall>('halls', {
    sort: ['name'],
    all: true,
    staleTime: 120_000, // halls almost never change
  })
}

/** All hall slots (with M2M teams resolved). */
export function useHallSlots(filter?: Record<string, unknown>) {
  return useCollection<HallSlot>('hall_slots', {
    filter,
    all: true,
    staleTime: 60_000,
    fields: ['*', 'teams.teams_id'],
  })
}

/** Active sponsors, sorted by sort_order. */
export function useSponsors() {
  return useCollection<Sponsor>('sponsors', {
    filter: { active: { _eq: true } },
    sort: ['sort_order'],
    all: true,
    staleTime: 120_000,
  })
}

/** Volleyball teams only. */
export function useVolleyballTeams() {
  return useCollection<Team>('teams', {
    filter: { active: { _eq: true }, sport: { _eq: 'volleyball' } },
    sort: ['name'],
    all: true,
    staleTime: 60_000,
  })
}

/** Basketball teams only. */
export function useBasketballTeams() {
  return useCollection<Team>('teams', {
    filter: { active: { _eq: true }, sport: { _eq: 'basketball' } },
    sort: ['name'],
    all: true,
    staleTime: 60_000,
  })
}
