import { describe, it, expect } from 'vitest'
import { buildOverview, leagueKey, pickState, teamFits, parseRoles } from '../bb-tournament-picks.js'

const T = {
  id: 438, date: '2026-11-01', end_date: null, host_club: 'Phönix Basket', hall: 'Sportanlage Wisacher',
  time_from: '08:00:00', time_to: '18:00:00', leagues: ['DU12Tu', 'MixU10M', 'MixU 8M'], deadline: '2026-10-25',
  registration_open: true, registered_count: 34, kscw_bp_team_ids: ['5104'],
}
const DU12 = { id: 70, name: 'DU12', league: 'DU12Tu', bb_source_id: '5104' }
const MU10 = { id: 87, name: 'MU10', league: 'MixU10M', bb_source_id: '5287' }
const MU8 = { id: 88, name: 'MU8', league: 'MixU 8M', bb_source_id: '6724' }
const HU14 = { id: 83, name: 'HU14', league: 'HU14B', bb_source_id: '5790' }

describe('bb tournament picks', () => {
  it('matches leagues ignoring spaces and case', () => {
    expect(leagueKey('MixU 8M')).toBe('mixu8m')
    expect(teamFits(MU8, { leagues: ['mixu8m'] })).toBe(true)
    expect(teamFits(HU14, T)).toBe(false)
    expect(teamFits({ league: null }, T)).toBe(false)
  })
  it('registered comes from Basketplan, not from the pick', () => {
    expect(pickState(DU12, T, null, '2026-10-04')).toMatchObject({ status: 'registered', picked: false, canPick: true })
    expect(pickState(MU10, T, { picked_by_name: 'Coach A' }, '2026-10-04')).toMatchObject({ status: 'picked', picked_by_name: 'Coach A' })
    expect(pickState(MU8, T, null, '2026-10-04')).toMatchObject({ status: 'none', canPick: true })
  })
  it('closed after the deadline or when Basketplan no longer offers sign-up', () => {
    expect(pickState(MU8, T, null, '2026-10-26').canPick).toBe(false)
    expect(pickState(MU8, { ...T, registration_open: false, list_status: 'Anmeldefrist abgelaufen' }, null, '2026-10-04').canPick).toBe(false)
  })
  it('a tournament listed but not open yet can be picked in advance', () => {
    expect(pickState(MU8, { ...T, registration_open: false, list_status: null }, null, '2026-10-04').canPick).toBe(true)
  })
  it('carries the latest worker attempt', () => {
    const rows = buildOverview([T], [MU8], [{ tournament: 438, team: 88 }], '2026-10-04', [
      { tournament: 438, team: 88, result: 'not_offered', message: 'x', attempted_at: '2026-10-04T10:00:00Z' },
      { tournament: 438, team: 88, result: 'dry_run', message: 'y', attempted_at: '2026-10-04T09:00:00Z' },
    ])
    expect(rows[0].teams[0].attempt).toEqual({ result: 'not_offered', message: 'x', at: '2026-10-04T10:00:00Z' })
  })
  it('lists only tournaments with a fitting team, each with only its fitting teams', () => {
    const other = { ...T, id: 440, date: '2026-10-31', leagues: ['MixU14M'] }
    const rows = buildOverview([T, other], [DU12, MU10, HU14], [{ tournament: 438, team: 87, picked_by_name: 'Coach A', note: null }], '2026-10-04')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 438, date: '2026-11-01', time_from: '08:00', time_to: '18:00', deadline: '2026-10-25' })
    expect(rows[0].teams.map((t) => [t.team, t.status])).toEqual([[70, 'registered'], [87, 'picked']])
  })
  it('reads roles from json or array', () => {
    expect(parseRoles('["bb_admin"]')).toEqual(['bb_admin'])
    expect(parseRoles(['admin'])).toEqual(['admin'])
    expect(parseRoles('nope')).toEqual([])
    expect(parseRoles(null)).toEqual([])
  })
})
