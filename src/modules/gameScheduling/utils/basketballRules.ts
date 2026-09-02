/**
 * Pure helpers for the per-team basketball constraint matrix (`basketball_team_rules`,
 * migration 278).
 *
 * Split out of `hooks/useBasketballTeamRules.ts` so the shapes can be unit-tested without
 * React: the hall presets below must round-trip the exact json migration 278 seeds, or the
 * settings editor would show every seeded team as "Custom" and the first edit would
 * silently rewrite the club's real hall rules.
 */

import {
  HALL_A, HALL_B, HALL_C, HALL_AB, parseYmd, toYmd,
  probasketLeagueForTeam, type ProbasketLeagueCode,
} from './probasketSeason'
import type { Team } from '../../../types'

export type BasketballRuleCategory = 'seniors' | 'youth' | 'u18'

export type BasketballBlockedRule =
  | { kind: 'before_date'; date: string; reason?: string }
  | { kind: 'date_range'; start: string; end: string; reason?: string }
  | { kind: 'school_holidays'; canton?: string; include_weekend_before?: boolean; reason?: string }

export interface BasketballHallTier {
  rank: number
  options: string[]
  last_resort?: boolean
}

export interface BasketballHallRule {
  /** true = only the rank-1 tier exists for this team (the sheet's "A+B (hard)"). */
  hard: boolean
  tiers: BasketballHallTier[]
}

export interface BasketballTeamRule {
  id: number
  season: string | number
  team: string | number
  enabled: boolean
  category: BasketballRuleCategory
  league: string
  ferien_hard: boolean
  /** HARD allow-list of JS getDay values (5=Fri, 6=Sat, 0=Sun). */
  allowed_dows: number[]
  /** SOFT weekday preference (scored, never filtered). */
  preferred_dows: number[]
  /** Earliest tip-off 'HH:MM', inclusive. */
  start_min: string | null
  /** Latest tip-off 'HH:MM', inclusive. */
  start_max: string | null
  start_hard: boolean
  halls: BasketballHallRule
  own_back_to_back: boolean
  blocked: BasketballBlockedRule[]
  note: string | null
}

/** Basketball plays Fri/Sat/Sun only — JS `getDay()` values, in calendar order. */
export const PLAY_DOWS = [5, 6, 0] as const

/**
 * The ProBasket Ferien windows bind "alle interregionalen Ligen, sowie die 1. / 2.
 * Seniorenligen" and nobody else (Spiel- und Sperrdaten 2026/2027). Used ONLY to seed a
 * brand-new rules row — never to re-derive `ferien_hard` on an existing one, which is an
 * explicit, hand-checkable column precisely so a stale league guess cannot flip it.
 */
export const FERIEN_HARD_LEAGUES: ReadonlySet<string> = new Set<ProbasketLeagueCode>([
  'D1LI',
  'H1LI',
  'D2LR',
  'H2LR',
  'JUN_INTER',
  'HU14_INTER',
])

export const EMPTY_HALL_RULE: BasketballHallRule = { hard: false, tiers: [] }

/**
 * The four hall shapes the constraint sheet actually uses, named. Editing raw tier json in
 * a table cell would be both unreadable and easy to corrupt; these presets cover every row
 * migration 278 seeds, and anything else round-trips untouched as `custom`.
 */
export type HallPreset = 'ab_hard' | 'ab_then_halves' | 'ab_halves_c' | 'any' | 'custom'

export const HALL_PRESET_RULES: Record<Exclude<HallPreset, 'custom'>, BasketballHallRule> = {
  // "A+B (hard)" — no fallback hall at all.
  ab_hard: { hard: true, tiers: [{ rank: 1, options: [HALL_AB] }] },
  // "A+B (soft) otherwise A or B"
  ab_then_halves: {
    hard: false,
    tiers: [
      { rank: 1, options: [HALL_AB] },
      { rank: 2, options: [HALL_A, HALL_B] },
    ],
  },
  // "A+B (soft), otherwise A or B, can play in C if really necessary"
  ab_halves_c: {
    hard: false,
    tiers: [
      { rank: 1, options: [HALL_AB] },
      { rank: 2, options: [HALL_A, HALL_B] },
      { rank: 3, options: [HALL_C], last_resort: true },
    ],
  },
  // No preference — every KWI court is equally fine.
  any: { hard: false, tiers: [] },
}

const sameOptions = (a: string[] | undefined, b: string[]): boolean =>
  Array.isArray(a) && a.length === b.length && b.every((o) => a.includes(o))

/** Which named preset a stored `halls` rule is, or 'custom' when it is none of them. */
export function hallPresetOf(halls: BasketballHallRule | null | undefined): HallPreset {
  const tiers = [...(halls?.tiers ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  if (tiers.length === 0) return 'any'
  if (halls?.hard) {
    return tiers.length === 1 && sameOptions(tiers[0].options, [HALL_AB]) ? 'ab_hard' : 'custom'
  }
  const shapes: [HallPreset, BasketballHallTier[]][] = [
    ['ab_then_halves', HALL_PRESET_RULES.ab_then_halves.tiers],
    ['ab_halves_c', HALL_PRESET_RULES.ab_halves_c.tiers],
  ]
  for (const [preset, want] of shapes) {
    if (tiers.length !== want.length) continue
    if (want.every((w, i) => sameOptions(tiers[i].options, w.options) && !!tiers[i].last_resort === !!w.last_resort)) {
      return preset
    }
  }
  return 'custom'
}

/** jsonb arrives parsed from Directus, but never trust a hand-edited text value. */
function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

/** Normalise one raw row so every consumer sees real arrays/objects, never strings. */
export function normalizeRule(row: Record<string, unknown>): BasketballTeamRule {
  return {
    id: Number(row.id),
    season: row.season as string | number,
    team: row.team as string | number,
    enabled: row.enabled !== false,
    category: (row.category as BasketballRuleCategory) || 'seniors',
    league: String(row.league || 'JUN_REG'),
    ferien_hard: row.ferien_hard === true,
    allowed_dows: parseJson<number[]>(row.allowed_dows, [5, 6, 0]).map(Number),
    preferred_dows: parseJson<number[]>(row.preferred_dows, []).map(Number),
    start_min: (row.start_min as string) || null,
    start_max: (row.start_max as string) || null,
    start_hard: row.start_hard !== false,
    halls: parseJson<BasketballHallRule>(row.halls, EMPTY_HALL_RULE),
    own_back_to_back: row.own_back_to_back !== false,
    blocked: parseJson<BasketballBlockedRule[]>(row.blocked, []),
    note: (row.note as string) || null,
  }
}

/**
 * REST GAP — how far either side of one of a team's own games stays un-suggested.
 *
 * Club rule 2026-09-02: "soft block one day before and one day after … so that a game can
 * be placed manually but the date gets not suggested". The generator drops those candidates
 * from `basketball_slots`; the prep grid applies the same window LIVE to suggestions that
 * were generated before the neighbouring game was placed, so the two never disagree.
 *
 * ⚠ Mirrored from kscw-endpoints/src/basketball-slots.js (REST_GAP_DAYS,
 * REST_GAP_CATEGORIES, restGapApplies). Change one, change the other in the SAME commit —
 * the same deliberate mirror as the pitch grid and the hall arithmetic.
 */
export const REST_GAP_DAYS = 1

/**
 * Junior teams are exempt: a short 1.-Phase window and a fixed fixture count make
 * back-to-back days at times unavoidable, and a rule that cannot be met is a rule that
 * gets worked around by hand. A team with no rules row ("open") is exempt too — open
 * drops the team's own preferences, never the club-wide hall facts.
 */
export const REST_GAP_CATEGORIES: ReadonlySet<BasketballRuleCategory> = new Set(['seniors'])

export function restGapApplies(category: BasketballRuleCategory | null | undefined): boolean {
  return !!category && REST_GAP_CATEGORIES.has(category)
}

/**
 * The team's own game sitting within REST_GAP_DAYS of `date`, or null. `gameDates` holds
 * every date that team already plays (placed home game or away fixture).
 *
 * ⚠ `date` itself is never a hit — a game ON the day is a different fact with a different
 * fix (an away fixture closes the date outright; a home placement holds its own pitch).
 * The nearer neighbour wins, so the message names the game the planner will actually see.
 */
export function adjacentGameDate(
  gameDates: ReadonlySet<string>,
  date: string,
  gap: number = REST_GAP_DAYS,
): string | null {
  for (let d = 1; d <= gap; d++) {
    for (const delta of [-d, d]) {
      const at = new Date(parseYmd(date))
      at.setDate(at.getDate() + delta)
      const ymd = toYmd(at)
      if (gameDates.has(ymd)) return ymd
    }
  }
  return null
}

/**
 * A first guess at a team's category, used ONLY as the starting value of a newly created
 * row (which is created disabled, so nothing is generated until a human confirms it).
 * The category is stored explicitly because team names lie — "Herren 2 H3" plays H2 — so
 * this must never be re-applied to an existing row.
 */
export function guessCategory(teamName: string): BasketballRuleCategory {
  const m = /U(\d{1,2})/i.exec(teamName || '')
  if (!m) return 'seniors'
  return Number(m[1]) >= 17 ? 'u18' : 'youth'
}

/** The payload for a fresh rules row: sensible defaults, disabled until reviewed. */
export function defaultRulePayload(team: Team): Record<string, unknown> {
  const { league } = probasketLeagueForTeam(team.bb_source_id ?? null)
  return {
    enabled: false,
    category: guessCategory(team.name || ''),
    league,
    ferien_hard: FERIEN_HARD_LEAGUES.has(league),
    allowed_dows: [5, 6, 0],
    preferred_dows: [],
    start_min: null,
    start_max: null,
    start_hard: true,
    halls: HALL_PRESET_RULES.ab_then_halves,
    own_back_to_back: true,
    blocked: [],
  }
}
