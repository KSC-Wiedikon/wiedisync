import { describe, it, expect } from 'vitest'
import {
  FERIEN_HARD_LEAGUES,
  HALL_PRESET_RULES,
  defaultRulePayload,
  guessCategory,
  hallPresetOf,
  normalizeRule,
  type BasketballHallRule,
} from '../basketballRules'
import type { Team } from '../../../../types'

/**
 * The hall presets are a UI vocabulary over json that migration 278 seeds directly into
 * `basketball_team_rules.halls`. If the two ever drift, the settings editor renders every
 * seeded team as "Custom" and the first edit silently rewrites the club's real hall rules —
 * so the seeded shapes are pinned here verbatim, exactly as the migration writes them.
 */
const SEEDED_HALLS = {
  // Lions D1 / Herren 1 — "A+B (hard)"
  abHard: '{"hard": true, "tiers": [{"rank": 1, "options": ["KWI A+B"]}]}',
  // Rhinos / Herren 2 / Herren 3 / HU18 / HU16 — "A+B (soft) otherwise A or B"
  abThenHalves:
    '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}]}',
  // DU14 / HU14 — "…can play in C if really necessary"
  abHalvesC:
    '{"hard": false, "tiers": [{"rank": 1, "options": ["KWI A+B"]}, {"rank": 2, "options": ["KWI A", "KWI B"]}, {"rank": 3, "options": ["KWI C"], "last_resort": true}]}',
}

const parse = (json: string) => JSON.parse(json) as BasketballHallRule

describe('hallPresetOf', () => {
  it('round-trips every preset it can produce', () => {
    expect(hallPresetOf(HALL_PRESET_RULES.ab_hard)).toBe('ab_hard')
    expect(hallPresetOf(HALL_PRESET_RULES.ab_then_halves)).toBe('ab_then_halves')
    expect(hallPresetOf(HALL_PRESET_RULES.ab_halves_c)).toBe('ab_halves_c')
    expect(hallPresetOf(HALL_PRESET_RULES.any)).toBe('any')
  })

  it('recognises the json migration 278 seeds', () => {
    expect(hallPresetOf(parse(SEEDED_HALLS.abHard))).toBe('ab_hard')
    expect(hallPresetOf(parse(SEEDED_HALLS.abThenHalves))).toBe('ab_then_halves')
    expect(hallPresetOf(parse(SEEDED_HALLS.abHalvesC))).toBe('ab_halves_c')
  })

  it('is insensitive to tier order and option order, but not to the halls themselves', () => {
    expect(
      hallPresetOf({
        hard: false,
        tiers: [
          { rank: 2, options: ['KWI B', 'KWI A'] },
          { rank: 1, options: ['KWI A+B'] },
        ],
      }),
    ).toBe('ab_then_halves')
    expect(
      hallPresetOf({
        hard: false,
        tiers: [
          { rank: 1, options: ['KWI A+B'] },
          { rank: 2, options: ['KWI A'] },
        ],
      }),
    ).toBe('custom')
  })

  it('treats an empty or missing rule as "any hall" and anything unknown as custom', () => {
    expect(hallPresetOf(null)).toBe('any')
    expect(hallPresetOf(undefined)).toBe('any')
    expect(hallPresetOf({ hard: false, tiers: [] })).toBe('any')
    // hard=true with something other than the single A+B tier is not a preset we can edit.
    expect(hallPresetOf({ hard: true, tiers: [{ rank: 1, options: ['KWI C'] }] })).toBe('custom')
  })

  it('does not confuse the last-resort C tier with a plain third tier', () => {
    const noLastResort = parse(SEEDED_HALLS.abHalvesC)
    noLastResort.tiers[2].last_resort = false
    expect(hallPresetOf(noLastResort)).toBe('custom')
  })
})

describe('guessCategory', () => {
  it('reads the U-number out of a junior team name', () => {
    expect(guessCategory('DU14')).toBe('youth')
    expect(guessCategory('HU16')).toBe('youth')
    expect(guessCategory('MU8')).toBe('youth')
    expect(guessCategory('1xDU18')).toBe('u18')
    expect(guessCategory('DU18 Spark')).toBe('u18')
    expect(guessCategory('HU20')).toBe('u18')
  })

  it('falls back to seniors when there is no U-number — including "Unicorns"', () => {
    expect(guessCategory('Lions D1')).toBe('seniors')
    expect(guessCategory('Rhinos D3')).toBe('seniors')
    expect(guessCategory('Herren 2 H3')).toBe('seniors')
    expect(guessCategory('Herren 3 (Unicorns) H4')).toBe('seniors')
    expect(guessCategory('')).toBe('seniors')
  })
})

describe('normalizeRule', () => {
  it('parses stringified jsonb columns', () => {
    const rule = normalizeRule({
      id: '7',
      season: 1,
      team: 86,
      category: 'seniors',
      league: 'D1LI',
      ferien_hard: true,
      allowed_dows: '[6,0]',
      preferred_dows: '[5]',
      halls: SEEDED_HALLS.abHard,
      blocked: '[{"kind":"before_date","date":"2026-10-01"}]',
      start_min: '13:30',
    })
    expect(rule.id).toBe(7)
    expect(rule.allowed_dows).toEqual([6, 0])
    expect(rule.preferred_dows).toEqual([5])
    expect(hallPresetOf(rule.halls)).toBe('ab_hard')
    expect(rule.blocked).toEqual([{ kind: 'before_date', date: '2026-10-01' }])
    expect(rule.start_min).toBe('13:30')
  })

  it('defaults the three boolean columns the way the DB does', () => {
    const rule = normalizeRule({ id: 1, season: 1, team: 2 })
    // enabled / start_hard / own_back_to_back default TRUE, ferien_hard FALSE.
    expect(rule.enabled).toBe(true)
    expect(rule.start_hard).toBe(true)
    expect(rule.own_back_to_back).toBe(true)
    expect(rule.ferien_hard).toBe(false)
    expect(rule.allowed_dows).toEqual([5, 6, 0])
    expect(rule.blocked).toEqual([])
    expect(rule.note).toBeNull()
  })

  it('never throws on corrupt json — it falls back', () => {
    const rule = normalizeRule({ id: 1, season: 1, team: 2, allowed_dows: 'not json', halls: '{' })
    expect(rule.allowed_dows).toEqual([5, 6, 0])
    expect(rule.halls).toEqual({ hard: false, tiers: [] })
  })
})

describe('defaultRulePayload', () => {
  const team = (id: number, name: string, bb: string | null): Team =>
    ({ id, name, bb_source_id: bb }) as unknown as Team

  it('resolves the league from bb_source_id and never from the team name', () => {
    // Team 76 is NAMED "Herren 2 H3" but is registered H2LRA → H2LR, a 2. Liga, so Ferien
    // windows are hard for it. Reading the name would have said 3rd league (soft).
    const h2 = defaultRulePayload(team(76, 'Herren 2 H3', '4829'))
    expect(h2.league).toBe('H2LR')
    expect(h2.ferien_hard).toBe(true)
    expect(h2.category).toBe('seniors')

    const lions = defaultRulePayload(team(86, 'Lions D1', '4445'))
    expect(lions.league).toBe('D1LI')
    expect(lions.ferien_hard).toBe(true)

    const du14 = defaultRulePayload(team(71, 'DU14', '5441'))
    expect(du14.league).toBe('JUN_REG')
    expect(du14.ferien_hard).toBe(false)
    expect(du14.category).toBe('youth')
  })

  it('starts disabled so nothing is generated before a human reviews it', () => {
    const fresh = defaultRulePayload(team(99, 'DU18 Fire', null))
    expect(fresh.enabled).toBe(false)
    expect(fresh.category).toBe('u18')
    // No bb_source_id → the documented junior-regional default window, Ferien soft.
    expect(fresh.league).toBe('JUN_REG')
    expect(FERIEN_HARD_LEAGUES.has(String(fresh.league))).toBe(false)
  })
})
