import { describe, it, expect } from 'vitest'
import type { Team } from '../../../types'
import {
  CURRENT_SEASON_KEY, DEFAULT_FILTERS, EMPTY_FILTERS,
  countActiveFilters, seasonChoices, teamsForSeasons,
} from './memberFilters'

const team = (id: number, name: string, sport: string, season: string, active: boolean): Team =>
  ({ id, name, sport, season, active } as unknown as Team)

// Prod's own shape after the 2026/27 rollover: every squad has an archived
// 2025/26 row and a new active one, plus an inactive row carrying the CURRENT
// label (MiniVB, sat out this season).
const ALL = [
  team(5, 'D2', 'volleyball', '2025/26', false),
  team(94, 'D2', 'volleyball', '2026/27', true),
  team(90, 'MiniVB', 'volleyball', '2026/27', false),
  team(21, 'Herren 2 H3', 'basketball', '2025/26', false),
  team(76, 'Herren 2', 'basketball', '2026/27', true),
]
const lookup = new Map(ALL.map((t) => [String(t.id), t]))
const cacheAll = { teams: ALL.filter((t) => t.active), teamLookup: lookup }
// A VB admin's cache: the scoped fetch drops basketball entirely.
const cacheVb = { teams: ALL.filter((t) => t.active && t.sport === 'volleyball'), teamLookup: lookup }

const ids = (teams: ReadonlyArray<{ id: string | number }>) => teams.map((t) => Number(t.id)).sort((a, b) => a - b)

describe('roster-season filter', () => {
  it('starts on the current season, counted as a visible filter', () => {
    expect(DEFAULT_FILTERS.seasons).toEqual([CURRENT_SEASON_KEY])
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(2)
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0)
  })

  it('offers the active teams\' season as current and every other label as a pill', () => {
    expect(seasonChoices(cacheAll)).toEqual({ current: '2026/27', others: ['2025/26'] })
  })

  it('keeps the pills inside the viewer\'s sport scope', () => {
    const bbOnly = {
      teams: [team(76, 'Herren 2', 'basketball', '2026/27', true)],
      teamLookup: new Map([
        ['76', team(76, 'Herren 2', 'basketball', '2026/27', true)],
        ['5', team(5, 'D2', 'volleyball', '2024/25', false)],
      ]),
    }
    expect(seasonChoices(bbOnly).others).toEqual([])
  })

  /** ⚠ The default must be exactly what the page always showed: active teams, nothing else. */
  it('"current" is the active teams — an inactive row with this season\'s label stays out', () => {
    expect(ids(teamsForSeasons([CURRENT_SEASON_KEY], cacheAll))).toEqual([76, 94])
  })

  it('a season label adds that season\'s archived rows next to the active ones', () => {
    expect(ids(teamsForSeasons([CURRENT_SEASON_KEY, '2025/26'], cacheAll))).toEqual([5, 21, 76, 94])
    expect(ids(teamsForSeasons(['2025/26'], cacheAll))).toEqual([5, 21])
  })

  it('an empty selection is every season, like every other chip row', () => {
    expect(ids(teamsForSeasons([], cacheAll))).toEqual([5, 21, 76, 90, 94])
  })

  it('never widens past the viewer\'s sport scope', () => {
    expect(ids(teamsForSeasons(['2025/26'], cacheVb))).toEqual([5])
    expect(ids(teamsForSeasons([], cacheVb))).toEqual([5, 90, 94])
  })

  it('prefers the scoped row over the lookup copy of the same team', () => {
    const richer = { ...cacheAll.teams.find((t) => Number(t.id) === 94)!, league: '3L' } as Team
    const out = teamsForSeasons([CURRENT_SEASON_KEY], { teams: [richer], teamLookup: lookup })
    expect((out.find((t) => Number(t.id) === 94) as Team).league).toBe('3L')
  })
})
