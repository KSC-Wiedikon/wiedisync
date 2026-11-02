import { describe, expect, it } from 'vitest'
import { matchGameByTeams, normaliseTeamName, refereeNames } from './liveGame'

describe('normaliseTeamName', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normaliseTeamName('VBC RÄMI D1')).toBe('vbc rami d1')
    expect(normaliseTeamName('  KSC  Wiedikon-D1 ')).toBe('ksc wiedikon d1')
    expect(normaliseTeamName(null)).toBe('')
  })
})

describe('matchGameByTeams', () => {
  const games = [
    { id: 429, home_team: 'KSC Wiedikon D1', away_team: 'VBC Rämi D1' },
    { id: 690, home_team: 'KSC Wiedikon Lions D1', away_team: 'Zug Basket D1' },
  ]
  it('finds the game in either order', () => {
    expect(matchGameByTeams(games, 'KSC WIEDIKON D1', 'VBC RÄMI D1')?.id).toBe(429)
    expect(matchGameByTeams(games, 'VBC Rämi D1', 'KSC Wiedikon D1')?.id).toBe(429)
  })
  it('returns null without a match, on blank names, or when two games match', () => {
    expect(matchGameByTeams(games, 'KSCW D1', 'RÄMI D1')).toBeNull()
    expect(matchGameByTeams(games, '', 'VBC Rämi D1')).toBeNull()
    expect(matchGameByTeams([...games, { id: 1, home_team: 'VBC Rämi D1', away_team: 'KSC Wiedikon D1' }], 'KSC Wiedikon D1', 'VBC Rämi D1')).toBeNull()
  })
})

describe('refereeNames', () => {
  it('reads the names in order and skips blanks', () => {
    expect(refereeNames([{ name: 'Anna Muster' }, { name: ' ' }, { name: 'Ben Beispiel' }])).toEqual(['Anna Muster', 'Ben Beispiel'])
  })
  it('accepts a JSON string and survives junk', () => {
    expect(refereeNames('[{"name":"Anna Muster","id":1}]')).toEqual(['Anna Muster'])
    expect(refereeNames('not json')).toEqual([])
    expect(refereeNames(null)).toEqual([])
  })
})
