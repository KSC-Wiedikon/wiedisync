// ProBasket table-officials requirements (Weisungen Sport 2026/27, Tabelle I).
//
// Tabelle I says, per league, how many table officials a home game needs and
// which licence each seat requires. That is the whole reason this file exists:
// the duty engine used to assume every basketball game needs exactly two
// officials, which is wrong for the top leagues (three seats, one of them
// OTR2) and wrong for U8/U6 (no table at all, just a referee).
//
// The table is reproduced in full — not just the rows KSCW currently plays —
// so a promotion or a new youth league is a config lookup, not a code change.
// Source PDF + a render of the table (it is an embedded image, so pdftotext
// returns nothing) live in `.planning/specs/2026-09-22-*`.

import type { Member } from '../../../types'

/** Minimum licence a single seat at the table requires. */
export type SeatLicence = 'otr2' | 'otr1' | 'none'

export interface BbLeagueRequirement {
  /** The Tabelle I row this came from, e.g. 'H2LR' — shown in the UI. */
  row: string
  /** One entry per seat, in fill order (scorer, timekeeper, 24s). */
  seats: SeatLicence[]
  /** U8/U6 need a referee, not a table crew — never assign duty. */
  refereeOnly?: boolean
}

// ── Licence ranking ──────────────────────────────────────────────────────────
//
// OTN (Swiss Basketball) > OTR2 (+ Wurfuhr/24s) > OTR1 (Anschreiber +
// Zeitnehmer) > unlicensed. A higher licence may always fill a lower seat.

export const LICENCE_RANK = { none: 0, otr1: 1, otr2: 2, otn: 3 } as const

/** Highest licence rank this member holds. */
export function licenceRank(m: Member): number {
  if (m.otn1_bb || m.otn2_bb) return LICENCE_RANK.otn
  if (m.otr2_bb) return LICENCE_RANK.otr2
  if (m.otr1_bb) return LICENCE_RANK.otr1
  return LICENCE_RANK.none
}

/** Rank a seat demands. */
export function seatRank(seat: SeatLicence): number {
  return seat === 'otr2' ? LICENCE_RANK.otr2 : seat === 'otr1' ? LICENCE_RANK.otr1 : LICENCE_RANK.none
}

// ── Tabelle I ────────────────────────────────────────────────────────────────
//
// Note the two shapes of three-seat league: most are 1 OTR2 + 2 OTR1, but
// DU14I / HU14I are 1 OTR2 + 1 OTR1 + 1 unlicensed. Seats carry their own
// minimum licence rather than the row carrying a count, so both fit.

const R3_OTR2_2OTR1: SeatLicence[] = ['otr2', 'otr1', 'otr1']
const R3_OTR2_OTR1_NONE: SeatLicence[] = ['otr2', 'otr1', 'none']
const R2_OTR1: SeatLicence[] = ['otr1', 'otr1']
const R2_OTR1_NONE: SeatLicence[] = ['otr1', 'none']
const R2_NONE: SeatLicence[] = ['none', 'none']

export const TABELLE_I: Record<string, BbLeagueRequirement> = {
  // Damen / Herren Liga Regional
  D1LR: { row: 'D1LR', seats: R3_OTR2_2OTR1 },
  D2LR: { row: 'D2LR', seats: R2_OTR1 },
  D3LR: { row: 'D3LR', seats: R2_OTR1_NONE },
  H1LR: { row: 'H1LR', seats: R3_OTR2_2OTR1 },
  H2LR: { row: 'H2LR', seats: R3_OTR2_2OTR1 },
  H3LR: { row: 'H3LR', seats: R2_OTR1 },
  H4LR: { row: 'H4LR', seats: R2_OTR1_NONE },
  Plausch: { row: 'Plausch', seats: R2_NONE },
  'BLS': { row: 'BLS (Ü40)', seats: R2_NONE },

  // Interregional youth
  DU22I: { row: 'DU22I', seats: R3_OTR2_2OTR1 },
  DU18I: { row: 'DU18I', seats: R3_OTR2_2OTR1 },
  DU16I: { row: 'DU16I', seats: R3_OTR2_2OTR1 },
  DU14I: { row: 'DU14I', seats: R3_OTR2_OTR1_NONE },
  HU22I: { row: 'HU22I', seats: R3_OTR2_2OTR1 },
  HU18I: { row: 'HU18I', seats: R3_OTR2_2OTR1 },
  HU16I: { row: 'HU16I', seats: R3_OTR2_2OTR1 },
  HU14I: { row: 'HU14I', seats: R3_OTR2_OTR1_NONE },

  // Promotion
  HU18PR: { row: 'HU18PR', seats: R2_OTR1_NONE },
  HU16PR: { row: 'HU16PR', seats: R2_OTR1_NONE },

  // Regional youth
  DU22R: { row: 'DU22R', seats: R2_OTR1 },
  DU18R: { row: 'DU18R', seats: R2_OTR1_NONE },
  DU16R: { row: 'DU16R', seats: R2_OTR1_NONE },
  DU14R: { row: 'DU14R', seats: R2_OTR1_NONE },
  HU22R: { row: 'HU22R', seats: R2_OTR1 },
  HU18R: { row: 'HU18R', seats: R2_OTR1_NONE },
  HU16R: { row: 'HU16R', seats: R2_OTR1_NONE },
  HU14R: { row: 'HU14R', seats: R2_OTR1_NONE },

  // Mini
  U12I: { row: 'U12I', seats: R2_OTR1_NONE },
  U12R: { row: 'U12R', seats: R2_NONE },
  U10: { row: 'U10', seats: R2_NONE },
  U8: { row: 'U8 / U6', seats: [], refereeOnly: true },
}

// ── Basketplan competition code → Tabelle I row ──────────────────────────────
//
// `games.league` holds the Basketplan *competition* code ('2LRM', 'U16M A'),
// which is NOT the same as `teams.league`, the Basketplan *team* code
// ('H3LS'). Always resolve from the game: a promoted team keeps its stale team
// code for a while. Herren 2 is the live example — teams.league says 'H3LS'
// while it plays '2LRM' this season, a two-seat row and a three-seat row.
//
// ⚠ The youth entries marked ASSUMED-R are inferred, not read. Basketplan's
// codes carry no I/R/PR marker, so the mapping onto Tabelle I's …I / …R / …PR
// rows is a judgement call pending confirmation with ProBasket. Getting one
// wrong changes a game from two seats to three: if HU16 ('U16M A') is really
// HU16I it needs an OTR2, and that team currently has none. See
// `.planning/specs/2026-09-22-bb-duty-rules.md` §7.

const COMPETITION_TO_ROW: Record<string, string> = {
  // Seniors — confirmed from the 2026/27 fixture list.
  '1LRAF': 'D1LR',
  '1LRBF': 'D1LR',
  '2LRF': 'D2LR',
  '3LRF': 'D3LR',
  '1LRAM': 'H1LR',
  '1LRBM': 'H1LR',
  '2LRM': 'H2LR',
  '3LSM': 'H3LR',
  '3LRM': 'H3LR',
  '4LZM': 'H4LR',
  '4LRM': 'H4LR',

  // Youth — ASSUMED-R (see warning above).
  'U14F A': 'DU14R',
  'U14F E': 'DU14R',
  'U16F B': 'DU16R',
  'U16F E': 'DU16R',
  'U 18F B': 'DU18R',
  'U 18F E': 'DU18R',
  'DU18-U20 Rookie A': 'DU18R',
  'U14M B': 'HU14R',
  'U14M C': 'HU14R',
  'U14M E': 'HU14R',
  'U16M A': 'HU16R',
  'U16M B': 'HU16R',
  'U16M PR': 'HU16PR',
  'U 18M B': 'HU18R',
  HU18A: 'HU18R',
  HU18F: 'HU18R',
  HU14B: 'HU14R',

  // Mini.
  'U12Mix M': 'U12R',
  'U12F Tu': 'U12R',
  DU12Tu: 'U12R',
  'U10Mix M': 'U10',
  'MixU 8M': 'U8',
  'U8Mix M': 'U8',
}

/** Two seats, both OTR1-free — what an unknown league falls back to. */
const FALLBACK: BbLeagueRequirement = { row: 'unknown', seats: R2_OTR1_NONE }

/**
 * Resolve a `games.league` competition code to its Tabelle I requirement.
 *
 * An unrecognised code falls back to a two-seat crew rather than throwing —
 * a league ProBasket adds mid-season must not blank the scorer page. The
 * caller can spot the fallback by `row === 'unknown'`.
 */
export function resolveBbRequirement(gameLeague: string | null | undefined): BbLeagueRequirement {
  if (!gameLeague) return FALLBACK
  const code = gameLeague.trim()
  const row = COMPETITION_TO_ROW[code]
  if (row && TABELLE_I[row]) return TABELLE_I[row]
  // Classics umbrellas ('-ClassicsF' / '-ClassicsM') and anything else unknown.
  return FALLBACK
}

/** How many table seats this game needs (0 for referee-only). */
export function seatCount(gameLeague: string | null | undefined): number {
  return resolveBbRequirement(gameLeague).seats.length
}
