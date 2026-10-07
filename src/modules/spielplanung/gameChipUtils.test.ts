import { describe, it, expect } from 'vitest'
import { detectCupMatch, opponentName } from './gameChipUtils'

describe('detectCupMatch', () => {
  it('matches Swiss Volley Cup as gold', () => {
    expect(detectCupMatch('Swiss Volley Cup — Herren 1')).toBe('gold')
  })
  it('matches Schweizer Cup as gold', () => {
    expect(detectCupMatch('Schweizer Cup')).toBe('gold')
  })
  it('matches Mobiliar Volley Cup (the synced name) as gold', () => {
    expect(detectCupMatch('Mobiliar Volley Cup — Runde 1, Spiel 28')).toBe('gold')
  })
  it('matches Züri Cup variants as silver', () => {
    expect(detectCupMatch('Züri Cup')).toBe('silver')
    expect(detectCupMatch('Zueri Cup Viertelfinale')).toBe('silver')
    expect(detectCupMatch('zuri cup')).toBe('silver')
  })
  it('returns null for regular leagues', () => {
    expect(detectCupMatch('1. Liga Herren')).toBeNull()
    expect(detectCupMatch('Regionalliga Damen')).toBeNull()
  })
  it('handles null and empty input', () => {
    expect(detectCupMatch(null)).toBeNull()
    expect(detectCupMatch(undefined)).toBeNull()
    expect(detectCupMatch('')).toBeNull()
  })
})

describe('opponentName', () => {
  it('returns away_team for home games', () => {
    expect(opponentName({ type: 'home', home_team: 'Rhinos', away_team: 'Goldcoast' })).toBe('Goldcoast')
  })
  it('returns home_team for away games', () => {
    expect(opponentName({ type: 'away', home_team: 'BZO', away_team: 'Rhinos' })).toBe('BZO')
  })
})
