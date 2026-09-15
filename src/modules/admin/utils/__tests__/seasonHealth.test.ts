import { describe, it, expect } from 'vitest'
import {
  ageDays, checkFixedTab, checksForTab, classifyCell, columnsOf, exportColumnsOf, filterPlayers,
  findingRowKey, groupBySection, humanize, isStale, isUmbrella, licenceTone, loginState, playerName,
  rowBucket, rowInTab, rowLinks, rowsForTab, sportKpis, tabCount, tabTotals, num, bool,
  EMPTY_PLAYER_FILTERS, SECTIONS,
  type HealthCheck, type PlayerStatusRow, type TeamSummaryRow,
} from '../seasonHealth'

function check(over: Partial<HealthCheck>): HealthCheck {
  return {
    key: 'k', section: 'players', sport: 'both', severity: 'warn', grain: 'player',
    title: 'T', description: 'D', count: 0, rows: [], truncated: false,
    ...over,
  }
}

describe('coercion', () => {
  it('num reads bigint strings and ignores junk', () => {
    expect(num('12')).toBe(12)
    expect(num(3)).toBe(3)
    expect(num('')).toBe(0)
    expect(num(null)).toBe(0)
    expect(num('abc')).toBe(0)
  })
  it('bool reads postgres-ish truthiness', () => {
    expect(bool(true)).toBe(true)
    expect(bool('t')).toBe(true)
    expect(bool('false')).toBe(false)
    expect(bool(1)).toBe(true)
    expect(bool(null)).toBe(false)
  })
})

describe('sport tabs', () => {
  it('buckets rows by their sport column; NULL/unknown → club', () => {
    expect(rowBucket({ sport: 'volleyball' })).toBe('volleyball')
    expect(rowBucket({ sport: 'Basketball' })).toBe('basketball')
    expect(rowBucket({ sport: 'both' })).toBe('both')
    expect(rowBucket({ sport: 'volleyball, basketball' })).toBe('both')
    expect(rowBucket({ sport: null })).toBe('club')
    expect(rowBucket({})).toBe('club')
    expect(rowBucket({ sport: 'volleyball', sport_source: 'unknown' })).toBe('club')
  })

  it("'both' shows under both sport tabs, never club", () => {
    const row = { sport: 'both' }
    expect(rowInTab(row, 'volleyball')).toBe(true)
    expect(rowInTab(row, 'basketball')).toBe(true)
    expect(rowInTab(row, 'club')).toBe(false)
    expect(rowInTab({ sport: null }, 'club')).toBe(true)
    expect(rowInTab({ sport: null }, 'volleyball')).toBe(false)
  })

  it('club-grain and single-sport checks pin their tab', () => {
    expect(checkFixedTab({ sport: 'both', grain: 'club' })).toBe('club')
    expect(checkFixedTab({ sport: 'vb', grain: 'club' })).toBe('club')
    expect(checkFixedTab({ sport: 'vb', grain: 'player' })).toBe('volleyball')
    expect(checkFixedTab({ sport: 'bb', grain: 'game' })).toBe('basketball')
    expect(checkFixedTab({ sport: 'both', grain: 'player' })).toBeNull()
  })

  it('rowsForTab ignores the sport column of a single-sport check', () => {
    const rows = [{ sport: null, member_id: 1 }, { sport: 'basketball', member_id: 2 }]
    expect(rowsForTab({ sport: 'vb', grain: 'player' }, rows, 'volleyball')).toHaveLength(2)
    expect(rowsForTab({ sport: 'vb', grain: 'player' }, rows, 'basketball')).toHaveLength(0)
    expect(rowsForTab({ sport: 'both', grain: 'player' }, rows, 'basketball')).toHaveLength(1)
    expect(rowsForTab({ sport: 'both', grain: 'player' }, rows, 'club')).toHaveLength(1)
  })

  it('tabCount prefers by_sport and falls back to the rows', () => {
    const c = check({
      count: 150, truncated: true,
      by_sport: { volleyball: 120, basketball: 30, club: 0 },
      rows: [{ sport: 'volleyball' }, { sport: 'basketball' }],
    })
    expect(tabCount(c, 'volleyball')).toBe(120)
    expect(tabCount(c, 'basketball')).toBe(30)
    expect(tabCount(c, 'club')).toBe(0)
    const noBySport = check({ count: 2, rows: [{ sport: 'volleyball' }, { sport: null }] })
    expect(tabCount(noBySport, 'volleyball')).toBe(1)
    expect(tabCount(noBySport, 'club')).toBe(1)
    const vb = check({ sport: 'vb', count: 7, by_sport: { volleyball: 0, basketball: 0, club: 7 } })
    expect(tabCount(vb, 'volleyball')).toBe(7)
    expect(tabCount(vb, 'club')).toBe(0)
    expect(tabCount(check({ error: 'check_failed', count: null }), 'volleyball')).toBe(0)
  })
})

describe('checksForTab', () => {
  const checks: HealthCheck[] = [
    check({ key: 'info_vb', severity: 'info', sport: 'vb', count: 1, rows: [{ member_id: 1 }] }),
    check({ key: 'err_both', severity: 'error', count: 2, by_sport: { volleyball: 1, basketball: 1, club: 0 }, rows: [{ sport: 'volleyball' }, { sport: 'basketball' }] }),
    check({ key: 'warn_club', severity: 'warn', grain: 'club', count: 3, rows: [{ x: 1 }, { x: 2 }, { x: 3 }] }),
    check({ key: 'clean_bb', severity: 'error', sport: 'bb', count: 0, rows: [] }),
    check({ key: 'failed', severity: 'warn', error: 'check_failed', count: null, rows: [] }),
  ]

  it('orders error → warn → info and drops clean checks by default', () => {
    const vb = checksForTab(checks, 'volleyball')
    expect(vb.map((i) => i.check.key)).toEqual(['err_both', 'failed', 'info_vb'])
    expect(vb[0].rows).toHaveLength(1)
    expect(vb[0].count).toBe(1)
    expect(vb[1].failed).toBe(true)
  })

  it('shows clean checks only in their own sport tab when asked', () => {
    const bb = checksForTab(checks, 'basketball', true).map((i) => i.check.key)
    expect(bb).toEqual(['err_both', 'clean_bb', 'failed'])
    const vb = checksForTab(checks, 'volleyball', true).map((i) => i.check.key)
    expect(vb).not.toContain('clean_bb')
  })

  it('club tab holds club-grain checks and sport-less rows only', () => {
    const club = checksForTab(checks, 'club').map((i) => i.check.key)
    expect(club).toEqual(['warn_club', 'failed'])
  })

  it('tabTotals counts rows per severity and failed checks', () => {
    expect(tabTotals(checks, 'volleyball')).toEqual({ errors: 1, warnings: 0, info: 1, failed: 1 })
    expect(tabTotals(checks, 'club')).toEqual({ errors: 0, warnings: 3, info: 0, failed: 1 })
  })

  it('groupBySection follows display order and drops empty sections', () => {
    const items = checksForTab([
      check({ key: 'a', section: 'events', count: 1, rows: [{ sport: 'volleyball' }] }),
      check({ key: 'b', section: 'teams', count: 1, rows: [{ sport: 'volleyball' }] }),
      check({ key: 'c', section: 'games', count: 1, rows: [{ sport: 'volleyball' }] }),
    ], 'volleyball')
    expect(groupBySection(items).map((g) => g.section)).toEqual(['teams', 'games', 'events'])
    expect(SECTIONS[0]).toBe('teams')
  })
})

describe('columns and cells', () => {
  it('columnsOf hides ids and sport, merges first/last into name', () => {
    const rows = [
      { member_id: 1, first_name: 'A', last_name: 'B', team: 'D1', sport: 'volleyball', sport_source: 'teams', days: 3 },
      { member_id: 2, first_name: 'C', last_name: 'D', team: 'D1', sport: 'volleyball', sport_source: 'teams', days: 4, extra: 'x' },
    ]
    expect(columnsOf(rows)).toEqual(['name', 'team', 'days', 'extra'])
    expect(columnsOf([{ id: 5, game_id: 9, date: '2026-09-15' }])).toEqual(['date'])
    expect(columnsOf([])).toEqual([])
  })

  it('exportColumnsOf keeps ids and names, drops sport_source', () => {
    expect(exportColumnsOf([{ member_id: 1, first_name: 'A', sport: 'volleyball', sport_source: 'teams' }]))
      .toEqual(['member_id', 'first_name', 'sport'])
  })

  it('humanize turns snake_case into a sentence-case label', () => {
    expect(humanize('home_away')).toBe('Home away')
    expect(humanize('license_nr')).toBe('License nr')
    expect(humanize('name')).toBe('Name')
  })

  it('classifies dates, times, timestamps, booleans and numbers', () => {
    expect(classifyCell('date', '2026-09-15')).toEqual({ kind: 'date', text: '15.09.2026' })
    expect(classifyCell('time', '19:30')).toEqual({ kind: 'time', text: '19:30' })
    expect(classifyCell('time', '19:30:00')).toEqual({ kind: 'time', text: '19:30' })
    expect(classifyCell('last_run_at', '2026-09-14 03:00')).toEqual({ kind: 'timestamp', text: '14.09.2026 03:00' })
    expect(classifyCell('x', true)).toEqual({ kind: 'boolean', text: '✓', value: true })
    expect(classifyCell('x', false)).toEqual({ kind: 'boolean', text: '✗', value: false })
    expect(classifyCell('count', 3)).toEqual({ kind: 'number', text: '3' })
    expect(classifyCell('count', '12')).toEqual({ kind: 'number', text: '12' })
    expect(classifyCell('amount', '440.50')).toEqual({ kind: 'number', text: '440.50' })
    expect(classifyCell('license_nr', '015964')).toEqual({ kind: 'text', text: '015964' })
    expect(classifyCell('team', 'D1')).toEqual({ kind: 'team', text: 'D1' })
    expect(classifyCell('name', 'B A')).toEqual({ kind: 'name', text: 'B A' })
    expect(classifyCell('reason', null)).toEqual({ kind: 'empty', text: '' })
    expect(classifyCell('reason', 'No coach')).toEqual({ kind: 'text', text: 'No coach' })
  })

  it('classifies an ISO instant in Zurich time', () => {
    const c = classifyCell('synced_at', '2026-01-10T23:30:00Z')
    expect(c.kind).toBe('timestamp')
    expect(c.text).toBe('11.01.2026 00:30')
  })

  it('rowLinks builds the row link targets', () => {
    expect(rowLinks({ member_id: 7, team: 'Herren 1', game_id: 12 })).toEqual({
      member: '/teams/player/7', team: '/teams/Herren 1', game: '/admin/explore?t=games&id=12',
    })
    expect(rowLinks({ event_id: 'a b' })).toEqual({})
    expect(rowLinks({})).toEqual({})
  })

  it('findingRowKey uses the grain identity, not the index — stable across reorders', () => {
    expect(findingRowKey({ member_id: 7, first_name: 'A', last_name: 'B' }, 0)).toBe('m:7:A:B')
    expect(findingRowKey({ team_id: 3, team: 'D1' }, 0)).toBe('t:3:D1')
    expect(findingRowKey({ game_id: 9, date: '2026-09-15', time: '19:30', home_team: 'D1', away_team: 'D2', home_away: 'home' }, 0))
      .toBe('g:9:2026-09-15:19:30:D1:D2:home')
    expect(findingRowKey({ training_id: 4, date: '2026-09-15', time: '18:00', team: 'D1' }, 0)).toBe('tr:4:2026-09-15:18:00:D1')
    expect(findingRowKey({ event_id: 12, title: 'AGM', date: '2026-10-01' }, 0)).toBe('e:12:AGM:2026-10-01')
    // Club-grain rows with no id column fall back to the index.
    expect(findingRowKey({ x: 1 }, 2)).toBe('row:2')
    // Same entity, different position → same key (the point of the exercise).
    const row = { team_id: 5, team: 'H1' }
    expect(findingRowKey(row, 0)).toBe(findingRowKey(row, 4))
  })
})

describe('teams and players', () => {
  const teams: TeamSummaryRow[] = [
    { team_id: 1, team: 'D1', sport: 'volleyball', players: '12', guests: '2', coaches: '1', licence_ok: '10', dues_paid: '11', games_total: '20', games_played: '4', games_upcoming: '16', trainings_next_4w: '8', hall_slots: '2' },
    { team_id: 2, team: 'D2', sport: 'volleyball', players: '9', guests: '0', coaches: '0', licence_ok: '9', dues_paid: '5', games_total: '18', games_played: '2', games_upcoming: '16', trainings_next_4w: '6', hall_slots: '0' },
    { team_id: 3, team: 'H-Classics 1LR', sport: 'basketball', umbrella: true, players: '40', coaches: '0' },
  ]

  it('sportKpis sums squads and skips umbrellas', () => {
    const k = sportKpis(teams.filter((t) => t.sport === 'volleyball'))
    expect(k).toEqual({
      teams: 2, umbrellas: 0, players: 21, guests: 2, licenceOk: 19, duesPaid: 16,
      teamsWithCoach: 1, games: 38, gamesPlayed: 6, gamesUpcoming: 32, trainings: 14,
    })
    const bb = sportKpis(teams.filter((t) => t.sport === 'basketball'))
    expect(bb.teams).toBe(0)
    expect(bb.umbrellas).toBe(1)
    expect(isUmbrella(teams[2])).toBe(true)
    expect(isUmbrella(teams[0])).toBe(false)
  })

  it('licence states map to tones', () => {
    expect(licenceTone('validated')).toBe('success')
    expect(licenceTone('licensed')).toBe('success')
    expect(licenceTone('activated_not_validated')).toBe('warning')
    expect(licenceTone('in_vm_not_activated')).toBe('danger')
    expect(licenceTone('none')).toBe('danger')
    expect(licenceTone(null)).toBe('neutral')
  })

  const players: PlayerStatusRow[] = [
    { member_id: 1, first_name: 'Anna', last_name: 'Meier', team: 'D1', sport: 'volleyball', licence_state: 'validated', dues_paid: true, has_login: true, shell: false, license_nr: '015964' },
    { member_id: 2, first_name: 'Bea', last_name: 'Keller', team: 'D1', sport: 'volleyball', licence_state: 'none', dues_paid: 'f', has_login: false, shell: true },
    { member_id: 3, first_name: 'Cla', last_name: 'Ruf', team: 'D2', sport: 'volleyball', licence_state: 'activated_not_validated', dues_paid: 't', has_login: false, shell: false },
  ]

  it('playerName and loginState', () => {
    expect(playerName(players[0])).toBe('Meier Anna')
    expect(playerName({ first_name: null, last_name: 'X' })).toBe('X')
    expect(loginState(players[0])).toBe('login')
    expect(loginState(players[1])).toBe('shell')
    expect(loginState(players[2])).toBe('none')
  })

  it('filterPlayers applies every filter', () => {
    expect(filterPlayers(players, EMPTY_PLAYER_FILTERS)).toHaveLength(3)
    expect(filterPlayers(players, { ...EMPTY_PLAYER_FILTERS, team: 'D2' }).map((p) => p.member_id)).toEqual([3])
    expect(filterPlayers(players, { ...EMPTY_PLAYER_FILTERS, licence: 'none' }).map((p) => p.member_id)).toEqual([2])
    expect(filterPlayers(players, { ...EMPTY_PLAYER_FILTERS, dues: 'unpaid' }).map((p) => p.member_id)).toEqual([2])
    expect(filterPlayers(players, { ...EMPTY_PLAYER_FILTERS, dues: 'paid' }).map((p) => p.member_id)).toEqual([1, 3])
    expect(filterPlayers(players, { ...EMPTY_PLAYER_FILTERS, login: 'shell' }).map((p) => p.member_id)).toEqual([2])
    expect(filterPlayers(players, { ...EMPTY_PLAYER_FILTERS, search: 'kel' }).map((p) => p.member_id)).toEqual([2])
    expect(filterPlayers(players, { ...EMPTY_PLAYER_FILTERS, search: '0159' }).map((p) => p.member_id)).toEqual([1])
  })
})

describe('register freshness', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0)
  it('ageDays and isStale', () => {
    expect(ageDays('2026-09-14T12:00:00Z', now)).toBe(1)
    expect(ageDays('2026-09-01T12:00:00Z', now)).toBe(14)
    expect(ageDays(null, now)).toBeNull()
    expect(ageDays('nope', now)).toBeNull()
    expect(isStale('2026-09-10T12:00:00Z', now)).toBe(false)
    expect(isStale('2026-09-07T11:00:00Z', now)).toBe(false)
    expect(isStale('2026-09-06T12:00:00Z', now)).toBe(true)
    expect(isStale(null, now)).toBe(true)
  })
})
