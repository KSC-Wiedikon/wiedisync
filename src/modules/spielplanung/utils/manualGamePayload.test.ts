import { describe, it, expect, vi } from 'vitest'
import { buildManualGamePayload } from './manualGamePayload'
import type { ManualGameInput } from '../../../types'

const baseInput: ManualGameInput = {
  kscw_team: 5,
  type: 'home',
  opponent: 'Goldcoast Wadenswil 1',
  date: '2026-05-09',
  time: '16:00',
  hall: 3,
  league: 'Testspiel',
  round: '',
}

describe('buildManualGamePayload', () => {
  it('generates a manual_<uuid> game_id', () => {
    const uuid = '964bbdf4-9215-40a6-9672-c4e499f5eb80'
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(uuid)
    const out = buildManualGamePayload(baseInput, 'D2')
    expect(out.game_id).toBe(`manual_${uuid}`)
    vi.restoreAllMocks()
  })

  it('home: puts KSCW team as home_team, opponent as away_team', () => {
    const out = buildManualGamePayload(baseInput, 'D2')
    expect(out.home_team).toBe('D2')
    expect(out.away_team).toBe('Goldcoast Wadenswil 1')
    expect(out.type).toBe('home')
  })

  it('away: puts opponent as home_team, KSCW team as away_team', () => {
    const out = buildManualGamePayload({ ...baseInput, type: 'away', hall: null }, 'D2')
    expect(out.home_team).toBe('Goldcoast Wadenswil 1')
    expect(out.away_team).toBe('D2')
    expect(out.type).toBe('away')
  })

  it('home: writes hall, nulls away_hall_json', () => {
    const out = buildManualGamePayload(baseInput, 'D2')
    expect(out.hall).toBe(3)
    expect(out.away_hall_json).toBeNull()
  })

  it('away: writes away_hall_json, nulls hall', () => {
    const out = buildManualGamePayload(
      {
        ...baseInput,
        type: 'away',
        hall: null,
        away_hall_json: { name: 'TH Grüze', address: 'Grüzefeldstr. 18', city: '8404 Winterthur' },
      },
      'D2',
    )
    expect(out.hall).toBeNull()
    expect(out.away_hall_json).toEqual({
      name: 'TH Grüze',
      address: 'Grüzefeldstr. 18',
      city: '8404 Winterthur',
    })
  })

  it('always stamps source=manual and svrz_push_status=null', () => {
    const out = buildManualGamePayload(baseInput, 'D2')
    expect(out.source).toBe('manual')
    expect(out.svrz_push_status).toBeNull()
  })

  it('always stamps status=scheduled and initializes scores to 0', () => {
    const out = buildManualGamePayload(baseInput, 'D2')
    expect(out.status).toBe('scheduled')
    expect(out.home_score).toBe(0)
    expect(out.away_score).toBe(0)
  })

  /**
   * ⚠ The season MUST be the short form the sync sources write ("2026/27").
   * Both callers used to hand-roll the SVRZ long form ("2026/2027"), which the
   * season-scoped views (home page, games list, website embed) match on exactly
   * — a long-form game saved fine and was invisible in all three. Regression
   * guard for the BB Herren 2 away game of 2026-08-14.
   */
  it('derives the season from the date, in short form', () => {
    expect(buildManualGamePayload(baseInput, 'D2').season).toBe('2025/26')
    expect(buildManualGamePayload({ ...baseInput, date: '2027-03-03' }, 'D2').season).toBe('2026/27')
  })

  it('rolls the season over on Jun 1, matching useEffectiveSeason', () => {
    expect(buildManualGamePayload({ ...baseInput, date: '2026-05-31' }, 'D2').season).toBe('2025/26')
    expect(buildManualGamePayload({ ...baseInput, date: '2026-06-01' }, 'D2').season).toBe('2026/27')
  })
})
