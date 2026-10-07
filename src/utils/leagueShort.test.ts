import { describe, it, expect } from 'vitest'
import { leagueRailLabel } from './leagueShort'

describe('leagueRailLabel', () => {
  it.each([
    ['Männer 3. Liga Gruppe A', '3L'],
    ['Frauen 2. Liga', '2L'],
    ['Frauen U23 1. Liga', 'U23 1L'],
    ['Männer U23 1. Stärkeklasse', 'U23 1SK'],
    ['Männer U20', 'U20'],
    ['Mobiliar Volley Cup — Runde 1, Spiel 28', 'SV Cup'],
    ['Züri Cup — Runde 3, Spiel 1', 'Züri Cup'],
    ['1LRAF', '1LRAF'],
    ['HU18A', 'HU18A'],
  ])('%s → %s', (league, label) => {
    expect(leagueRailLabel(league)).toBe(label)
  })
  it('is empty for no league', () => {
    expect(leagueRailLabel(null)).toBe('')
    expect(leagueRailLabel('')).toBe('')
  })
})
