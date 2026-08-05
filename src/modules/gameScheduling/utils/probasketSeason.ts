/**
 * ProBasket (Nord-Ostschweizer BV) season windows — the candidate home-date
 * calendar for the Basketball prep view.
 *
 * Basketball scheduling is NOT the volleyball bilateral engine: the association owns
 * the schedule (physical Spielplansitzung + Basketplan). KSCW's job is to know/declare
 * which home dates it can host. Basketball plays **Fri/Sat/Sun**; weekday training
 * slots are a last resort.
 *
 * ── Source documents (season 2026/27) ───────────────────────────────────────────
 *  A) "Spiel- und Sperrdaten 2026/2027 (Provisorisch)"  — per-league windows, Ferien,
 *     Sperrdaten, key dates.
 *  B) "Vorlage_Senior_innen.xlsx" → sheet "Verfügbarkeiten" — the availability grid the
 *     club fills in for the SENIOR automatic-scheduling leagues. 93 date rows,
 *     Fr 25.09.2026 → So 09.05.2027.
 *  C) "Vorlage_Jugend_allgemein.xlsx" → sheet "Verfügbarkeiten" — the JUNIOR grid.
 *     38 date rows, Sa 19.09.2026 → So 13.12.2026.
 *  D) "Anleitung Spielplanung Vorrunde 2026" — who has to file, and by when.
 *
 * ── Why the window is per LEAGUE, not per season ────────────────────────────────
 * Document (A) prints a different window for every league. The junior 1. Phase
 * (19.09.26 – 13.12.26) is a byte-perfect match for grid (C) — 38 rows — but the two
 * KSCW teams that actually have to file by 17.08.2026 (Lions D1 / bb_source_id 4445 and
 * Herren 1 / 1348, both 1. Liga Interregional) file grid (B), which is 93 rows and runs
 * into May. Applying one season-wide window shipped 38 of 93 required rows for them.
 *
 * ── Which leagues have to file (document D) ─────────────────────────────────────
 *   "In folgenden Ligen wird dieser Prozess angewandt:
 *      − Herren 1. Liga  − Damen 1. Liga  − Alle interregionalen U14 bis U22 Ligen
 *    Die Klubs liefern bis zum 17. August 2026 dem Verband an info@probasket.ch alle
 *    verfügbaren Hallenslots."
 * KSCW has no interregional junior team in 26/27, so only 4445 + 1348 must file.
 *
 * PROVISIONAL: the association can still shift Sperrdaten until the Spielplansitzung.
 */

import { KSCW_TEAM_GROUP } from '../data/basketballGroups'

// ── Key dates ────────────────────────────────────────────────────────────────
/** Where the filled-in availability workbook goes (document D). */
export const PROBASKET_CONTACT_EMAIL = 'info@probasket.ch'

/**
 * Season milestones, so the UI can surface a countdown / warning banner.
 * Sources are noted per entry — `spielplansitzung` (the physical one) is the only
 * date NOT printed in documents A–D; it comes from the club's ProBasket calendar.
 */
export const PROBASKET_KEY_DATES = {
  /** (D) "Die Klubs liefern bis zum 17. August 2026 … alle verfügbaren Hallenslots." */
  availabilityDue: '2026-08-17',
  /** (D) "dieser Spielplan wird durch den Verband bis zum 31. August 2026 erstellt." */
  planPublished: '2026-08-31',
  /** (A) "Pre-Season-Clinic Trainer (virtuell): 01. September 2026". */
  preSeasonClinic: '2026-09-01',
  /** Physical Spielplansitzung — not in documents A–D; club calendar. */
  spielplansitzung: '2026-09-05',
  /** (A) "Mittwoch, 16.12.26 — Spielplansitzung (online)" (2. Phase juniors). */
  onlineSpielplansitzung: '2026-12-16',
} as const

/** The two KSCW teams covered by the automatic-scheduling process — by `teams.bb_source_id`. */
export const AUTOMATIC_SCHEDULING_BB_SOURCE_IDS = ['4445', '1348'] as const

// ── Blackouts ────────────────────────────────────────────────────────────────

/**
 * Document (A), "Ferien (provisorisch)" paragraph, verbatim:
 *   "In folgenden Zeitfenster werden in allen interregionalen Ligen, sowie in der
 *    1. / 2. Seniorenligen keine Spiele durch den Verband angesetzt. In allen anderen
 *    Ferien gilt eine grundsätzliche Spielpflicht:"
 * → 'ferien' = no games for interregional + 1./2. Seniorenliga only.
 * Document (A), "Sperrdaten für alle" → 'sperr' = blocked for every league.
 */
export interface ProbasketBlackout {
  /** 'YYYY-MM-DD', inclusive. */
  start: string
  /** 'YYYY-MM-DD', inclusive. */
  end: string
  label: string
  /** 'ferien' = no games for interregional + 1./2. Senior; 'sperr' = blocked for all leagues. */
  kind: 'ferien' | 'sperr'
  /** Applies ONLY in these cantons (undefined = every canton). */
  cantons?: readonly string[]
  /** Applies everywhere EXCEPT these cantons (undefined = no exception). */
  exceptCantons?: readonly string[]
  /** The association still prints this one as provisional. */
  provisional?: boolean
}

/** KSCW plays in Zurich, so ZH is the canton the club resolves Ferien windows against. */
export const KSCW_CANTON = 'ZH'

/**
 * Every blackout printed for 2026/27, canton-scoped where the document scopes it.
 *
 * ⚠ The two Osterferien entries are mutually exclusive by canton: the association
 * schedules the ZH/ZG break two weeks later than the rest of Switzerland. Never block
 * both — resolve with `probasketBlackoutsForCanton()` (KSCW → the ZH/ZG one).
 */
export const PROBASKET_BLACKOUTS_2026_27: readonly ProbasketBlackout[] = [
  // ── Ferien (interregional + 1./2. Seniorenliga only) ──
  { start: '2026-10-05', end: '2026-10-11', label: 'Herbstferien', kind: 'ferien' },
  { start: '2027-01-30', end: '2027-02-14', label: 'Sport / Fasnachtsferien', kind: 'ferien' },
  {
    start: '2027-04-03',
    end: '2027-04-18',
    label: 'Osterferien (ausser ZH/ZG)',
    kind: 'ferien',
    exceptCantons: ['ZH', 'ZG'],
  },
  {
    start: '2027-04-24',
    end: '2027-05-02',
    label: 'Osterferien (ZH/ZG)',
    kind: 'ferien',
    cantons: ['ZH', 'ZG'],
  },
  // ── Sperrdaten für alle ──
  { start: '2026-12-21', end: '2027-01-04', label: 'Weihnachtsferien', kind: 'sperr' },
  { start: '2027-04-17', end: '2027-04-18', label: 'Final Four ProBasket Jugend', kind: 'sperr' },
  { start: '2027-04-25', end: '2027-04-25', label: 'ProBasket Classics Final', kind: 'sperr', provisional: true },
  { start: '2027-04-26', end: '2027-04-30', label: 'Ostern', kind: 'sperr' },
]

/** True when `blackout` is in force for a club in `canton`. */
export function blackoutAppliesInCanton(blackout: ProbasketBlackout, canton: string): boolean {
  if (blackout.cantons && !blackout.cantons.includes(canton)) return false
  if (blackout.exceptCantons && blackout.exceptCantons.includes(canton)) return false
  return true
}

/** The blackouts in force for one canton — drops the Osterferien window of the other bloc. */
export function probasketBlackoutsForCanton(
  blackouts: readonly ProbasketBlackout[],
  canton: string = KSCW_CANTON,
): ProbasketBlackout[] {
  return blackouts.filter((b) => blackoutAppliesInCanton(b, canton))
}

// ── Leagues ──────────────────────────────────────────────────────────────────

export type ProbasketLeagueCode =
  | 'H4LR'
  | 'D3LR'
  | 'H3LR'
  | 'D2LR'
  | 'H2LR'
  | 'D1LI'
  | 'H1LI'
  | 'BLS'
  | 'MIXED'
  | 'JUN_REG'
  | 'JUN_INTER'
  | 'HU14_INTER'
  | 'KIDS_MINIS'

export interface ProbasketDateRange {
  /** 'YYYY-MM-DD', inclusive. */
  start: string
  /** 'YYYY-MM-DD', inclusive. */
  end: string
}

export interface ProbasketPhase {
  key: 'hin_rueck' | 'phase1' | 'phase2' | 'vorrunde' | 'rueckrunde' | 'aufstiegsrunde' | 'turnierbetrieb'
  label: string
  start: string
  /** null when the source document prints a start but no end. */
  end: string | null
  /** Only played if needed (Aufstiegsrunde ProBasket). */
  conditional?: boolean
}

export interface ProbasketLeague {
  code: ProbasketLeagueCode
  label: string
  /** The league's competition phases, verbatim from document (A). */
  phases: ProbasketPhase[]
  /**
   * The date ranges the availability grid covers, in order. More than one range when
   * the official template physically omits a block of weekends (the Weihnachtsferien).
   */
  grid: ProbasketDateRange[]
  /**
   * 'template' — the grid is a byte-match of an official Vorlage_*.xlsx sheet.
   * 'derived'  — no template published for this league; the grid is the phase window
   *              minus the Weihnachtsferien Sperrdatum.
   */
  gridSource: 'template' | 'derived'
}

/**
 * ⚠ Document (A) prints the Herren-4.-Liga end dates and the junior 2. Phase Regional
 * end date with the year 26 ("19.04.26", "26.04.26", "24.05.26", "30.05.26"). Those are
 * typos for 2027 — the sheet is titled "Spiel- und Sperrdaten 2026/2027", the season
 * starts 19.09.2026, and every neighbouring league prints the same spring dates as 27.
 * Encoded here as 2027.
 *
 * ⚠ Senior start date, 19.09 vs 25.09 — document (A) prints "19.09.26" for every senior
 * league, but grid (B), the sheet the 1.-Liga teams actually submit, has no rows before
 * "FR 25" September (first three rows: FR 25 / SA 26 / SO 27). The club's own constraint
 * matrix agrees ("Spielsamstage → Desired: 26/27.9"). Encoding: the *phase* keeps the
 * association's 19.09.26; the 1.-Liga *grid* starts 2026-09-25 because that is the form
 * we have to hand in and it is the only senior grid the association published. Every
 * other senior league keeps 19.09 (derived grid) — there is no published template that
 * would justify moving them.
 *
 * ⚠ The Weihnachtsferien gap (2026-12-21 → 2027-01-04) is the only blackout that grid (B)
 * omits outright: it has rows for 18/19/20 Dec, then jumps to 08 Jan. Every other
 * Sperrdatum (17./18.04, 25.04, 30.04) still has a row. So grids split around Christmas
 * only — 25.09→20.12 plus 05.01→09.05 is exactly 93 Fri/Sat/Sun rows.
 */
export const PROBASKET_LEAGUES_2026_27: Record<ProbasketLeagueCode, ProbasketLeague> = {
  H4LR: {
    code: 'H4LR',
    label: 'Herren 4. Liga Regional',
    phases: [
      // Doc: "19.09.26 – 19.04.26  Hin- und Rückspiele" → 19.04.2027.
      { key: 'hin_rueck', label: 'Hin- und Rückspiele', start: '2026-09-19', end: '2027-04-19' },
      // Doc: "26.04.26 – 24.05.26  Aufstiegsrunde ProBasket (falls nötig)" → 2027.
      {
        key: 'aufstiegsrunde',
        label: 'Aufstiegsrunde ProBasket',
        start: '2027-04-26',
        end: '2027-05-24',
        conditional: true,
      },
    ],
    grid: [
      { start: '2026-09-19', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-04-19' },
    ],
    gridSource: 'derived',
  },
  D3LR: {
    code: 'D3LR',
    label: 'Damen 3. Liga Regional',
    phases: [
      { key: 'hin_rueck', label: 'Hin- und Rückspiele', start: '2026-09-19', end: '2027-04-18' },
      {
        key: 'aufstiegsrunde',
        label: 'Aufstiegsrunde ProBasket',
        start: '2027-04-24',
        end: '2027-05-23',
        conditional: true,
      },
    ],
    grid: [
      { start: '2026-09-19', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-04-18' },
    ],
    gridSource: 'derived',
  },
  H3LR: {
    code: 'H3LR',
    label: 'Herren 3. Liga Regional',
    phases: [
      { key: 'hin_rueck', label: 'Hin- und Rückspiele', start: '2026-09-19', end: '2027-04-18' },
      {
        key: 'aufstiegsrunde',
        label: 'Aufstiegsrunde ProBasket',
        start: '2027-04-24',
        end: '2027-05-23',
        conditional: true,
      },
    ],
    grid: [
      { start: '2026-09-19', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-04-18' },
    ],
    gridSource: 'derived',
  },
  D2LR: {
    code: 'D2LR',
    label: 'Damen 2. Liga Regional',
    phases: [{ key: 'hin_rueck', label: 'Hin- und Rückspiele', start: '2026-09-19', end: '2027-05-23' }],
    grid: [
      { start: '2026-09-19', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-05-23' },
    ],
    gridSource: 'derived',
  },
  H2LR: {
    code: 'H2LR',
    label: 'Herren 2. Liga Regional',
    phases: [{ key: 'hin_rueck', label: 'Hin- und Rückspiele', start: '2026-09-19', end: '2027-05-23' }],
    grid: [
      { start: '2026-09-19', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-05-23' },
    ],
    gridSource: 'derived',
  },
  D1LI: {
    code: 'D1LI',
    label: 'Damen 1. Liga Interregional',
    // Doc (A): "Damen/Herren: 22./23. Mai 2027 — Final Four Liga ProBasket" (not a
    // regular-season date, so it is not part of the grid).
    phases: [{ key: 'hin_rueck', label: 'Hin- und Rückspiele', start: '2026-09-19', end: '2027-05-09' }],
    grid: [
      { start: '2026-09-25', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-05-09' },
    ],
    gridSource: 'template',
  },
  H1LI: {
    code: 'H1LI',
    label: 'Herren 1. Liga Interregional',
    phases: [{ key: 'hin_rueck', label: 'Hin- und Rückspiele', start: '2026-09-19', end: '2027-05-09' }],
    grid: [
      { start: '2026-09-25', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-05-09' },
    ],
    gridSource: 'template',
  },
  BLS: {
    code: 'BLS',
    label: 'BLS (Ü40)',
    phases: [{ key: 'hin_rueck', label: 'Hin- und Rückspiele', start: '2026-09-19', end: '2027-05-23' }],
    grid: [
      { start: '2026-09-19', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-05-23' },
    ],
    gridSource: 'derived',
  },
  MIXED: {
    code: 'MIXED',
    label: 'Mixed Plauschliga',
    phases: [{ key: 'turnierbetrieb', label: 'Turnierbetrieb', start: '2026-09-19', end: '2027-05-30' }],
    grid: [
      { start: '2026-09-19', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-05-30' },
    ],
    gridSource: 'derived',
  },
  JUN_REG: {
    code: 'JUN_REG',
    label: 'Junior/innen U22 / U18 / U16 / U14 Regional',
    phases: [
      { key: 'phase1', label: '1. Phase', start: '2026-09-19', end: '2026-12-13' },
      // Doc: "09.01.27 – 30.05.26  2. Phase Regional" → 30.05.2027.
      { key: 'phase2', label: '2. Phase Regional', start: '2027-01-09', end: '2027-05-30' },
    ],
    // Grid (C) covers the 1. Phase only — the 2. Phase is planned at the online
    // Spielplansitzung on 16.12.2026, after a fresh availability round.
    grid: [{ start: '2026-09-19', end: '2026-12-13' }],
    gridSource: 'template',
  },
  JUN_INTER: {
    code: 'JUN_INTER',
    label: 'Junior/innen U22 / U18 / U16 / U14 & U12 Interregional',
    phases: [
      { key: 'phase1', label: '1. Phase', start: '2026-09-19', end: '2026-12-13' },
      { key: 'phase2', label: '2. Phase Interregional', start: '2027-01-09', end: '2027-04-11' },
    ],
    grid: [{ start: '2026-09-19', end: '2026-12-13' }],
    gridSource: 'template',
  },
  HU14_INTER: {
    code: 'HU14_INTER',
    label: 'HU14 Interregional',
    // Doc (A) footnote (*): "Die HU14 Interregionale Liga spielt ihre Vorrunde vom
    // 19.09.26 bis am 17.01.27. Die Rückrunde startet am 23.01.2027". No Rückrunde END
    // is printed anywhere — left null rather than invented.
    phases: [
      { key: 'vorrunde', label: 'Vorrunde', start: '2026-09-19', end: '2027-01-17' },
      { key: 'rueckrunde', label: 'Rückrunde', start: '2027-01-23', end: null },
    ],
    grid: [
      { start: '2026-09-19', end: '2026-12-20' },
      { start: '2027-01-05', end: '2027-01-17' },
    ],
    gridSource: 'derived',
  },
  KIDS_MINIS: {
    code: 'KIDS_MINIS',
    label: 'Kids / Minis (U12 Turnier, U10, U8)',
    // Document (A) prints NO window for the Kids/Mini tournament formats — only
    // "Kids und Mini-Abschlussturnier: 29./30. Mai 2027". Falling back to the junior
    // 1. Phase window is a deliberate, documented default, not a source fact.
    phases: [{ key: 'phase1', label: '1. Phase (default: junior window)', start: '2026-09-19', end: '2026-12-13' }],
    grid: [{ start: '2026-09-19', end: '2026-12-13' }],
    gridSource: 'derived',
  },
}

/**
 * Fallback league when a team has no `bb_source_id`, no group entry, and no override.
 * Junior regional 1. Phase = the widest-applicable KSCW window and the previous
 * season-wide default, so an unmapped team keeps today's behaviour. Callers can detect
 * it via `probasketLeagueForTeam().source === 'default'` and warn.
 *
 * Known `source: 'default'` hits today: the two ProBasket Classics squads (bb_source_id
 * 4934 / 4935). That competition is registered outside the Teamanmeldungen workbook and
 * the Spiel- und Sperrdaten sheet reserves only its final ("25. April 2027"), so there is
 * no published window to encode — do not invent one.
 */
export const DEFAULT_PROBASKET_LEAGUE: ProbasketLeagueCode = 'JUN_REG'

/**
 * ProBasket group code (from `data/basketballGroups.ts` → `BB_GROUPS`) → league window.
 * We resolve through the group, NOT through `teams.league`: prod proves `teams.league`
 * is stale (team 76 "Herren 2 H3" still carries league='H3LS' although it is registered
 * H2LRA for 26/27).
 */
export const GROUP_CODE_TO_LEAGUE: Record<string, ProbasketLeagueCode> = {
  D1LRA: 'D1LI',
  H1LRA: 'H1LI',
  H2LRA: 'H2LR',
  D3LRA: 'D3LR',
  H4LRA: 'H4LR',
  'DU14 Regional': 'JUN_REG',
  // The Gruppeneinteilung has printed this group as both 'DU16 Rookie' and
  // 'DU14/U16 Rookie'; accept either spelling so a refresh of BB_GROUPS cannot
  // silently drop the team back to the default window.
  'DU16 Rookie': 'JUN_REG',
  'DU14/U16 Rookie': 'JUN_REG',
  'DU18/U20 Rookie': 'JUN_REG',
  'HU14 Regional': 'JUN_REG',
  'HU16 Regional': 'JUN_REG',
  'HU18 Regional': 'JUN_REG',
  'DU12 TU': 'KIDS_MINIS',
  MixU12: 'KIDS_MINIS',
  MixU10: 'KIDS_MINIS',
  DU10: 'KIDS_MINIS',
  MixU8: 'KIDS_MINIS',
}

/**
 * Per-team corrections to `KSCW_TEAM_GROUP`, by `teams.bb_source_id`.
 *
 * 7182 is the **DU16** team (ProBasket "Übersicht Teamanmeldungen 26/27" → sheet
 * "Prov. Gruppeneinteilung": "KSC Wiedikon DU16 → DU16 Rookie"). The local "2xDU18"
 * label is a misnomer. Both DU16 and DU18/U20 Rookie are junior regional so the window
 * is identical either way, but the league is pinned here so a future window split (or a
 * group-code rename in `basketballGroups.ts`) cannot silently inherit the wrong one.
 *
 * TODO: **DU18 B** ("KSC Wiedikon DU18 B", group "DU20 Rookie") has no `teams` row and
 * no known Basketplan / bb_source_id yet. When it is created, add its id here (league
 * 'JUN_REG') and to `KSCW_TEAM_GROUP` in `data/basketballGroups.ts`. Do NOT reuse 7182.
 */
export const BB_SOURCE_LEAGUE_OVERRIDES: Record<string, ProbasketLeagueCode> = {
  '7182': 'JUN_REG', // DU16 (registered "DU16 Rookie"), not DU18
}

export interface ResolvedLeague {
  league: ProbasketLeagueCode
  /** 'override' = pinned above, 'group' = via BB_GROUPS, 'default' = nothing matched. */
  source: 'override' | 'group' | 'default'
}

/** Resolve a KSCW team's ProBasket league window from its `teams.bb_source_id`. */
export function probasketLeagueForTeam(bbSourceId: string | number | null | undefined): ResolvedLeague {
  const id = bbSourceId == null ? '' : String(bbSourceId)
  const override = BB_SOURCE_LEAGUE_OVERRIDES[id]
  if (override) return { league: override, source: 'override' }
  const groupCode = id ? KSCW_TEAM_GROUP[id] : undefined
  const viaGroup = groupCode ? GROUP_CODE_TO_LEAGUE[groupCode] : undefined
  if (viaGroup) return { league: viaGroup, source: 'group' }
  return { league: DEFAULT_PROBASKET_LEAGUE, source: 'default' }
}

// ── Season config ────────────────────────────────────────────────────────────

export interface ProbasketSeasonConfig {
  /** Matches game_scheduling_seasons.season, e.g. '2026/27'. */
  season: string
  /** The league window this config was resolved for. */
  league: ProbasketLeagueCode
  leagueLabel: string
  /** How the grid was obtained — 'derived' means no official template exists. */
  gridSource: 'template' | 'derived'
  /** Availability-grid ranges, in order (>1 when the template skips the Christmas break). */
  ranges: ProbasketDateRange[]
  /** The league's competition phases from the Spiel- und Sperrdaten sheet. */
  phases: ProbasketPhase[]
  /** First grid day — 'YYYY-MM-DD'. (Historically named after the junior Vorrunde.) */
  vorrundeStart: string
  /** Last grid day — 'YYYY-MM-DD'. */
  vorrundeEnd: string
  /** Blackouts already resolved for the club's canton. */
  blackouts: ProbasketBlackout[]
  /** Canton the Ferien windows were resolved against. */
  canton: string
}

interface ProbasketSeasonData {
  season: string
  leagues: Record<ProbasketLeagueCode, ProbasketLeague>
  blackouts: readonly ProbasketBlackout[]
}

const PROBASKET_SEASON_DATA: Record<string, ProbasketSeasonData> = {
  '2026/27': {
    season: '2026/27',
    leagues: PROBASKET_LEAGUES_2026_27,
    blackouts: PROBASKET_BLACKOUTS_2026_27,
  },
}

function buildConfig(data: ProbasketSeasonData, league: ProbasketLeagueCode, canton: string): ProbasketSeasonConfig {
  const lg = data.leagues[league] ?? data.leagues[DEFAULT_PROBASKET_LEAGUE]
  return {
    season: data.season,
    league: lg.code,
    leagueLabel: lg.label,
    gridSource: lg.gridSource,
    ranges: lg.grid.map((r) => ({ ...r })),
    phases: lg.phases.map((p) => ({ ...p })),
    vorrundeStart: lg.grid[0].start,
    vorrundeEnd: lg.grid[lg.grid.length - 1].end,
    blackouts: probasketBlackoutsForCanton(data.blackouts, canton),
    canton,
  }
}

/**
 * Season → default (junior regional) config, kept for callers that only need one window.
 * Prefer `probasketConfigForSeason(season, { bbSourceId })`.
 */
export const PROBASKET_SEASONS: Record<string, ProbasketSeasonConfig> = Object.fromEntries(
  Object.entries(PROBASKET_SEASON_DATA).map(([k, v]) => [k, buildConfig(v, DEFAULT_PROBASKET_LEAGUE, KSCW_CANTON)]),
)

export interface ProbasketConfigOptions {
  /** Resolve the window for this league directly. */
  league?: ProbasketLeagueCode
  /** …or resolve it from a KSCW team's `teams.bb_source_id` (ignored when `league` is set). */
  bbSourceId?: string | number | null
  /** Canton for the Ferien windows. Defaults to ZH (KSCW). */
  canton?: string
}

/**
 * The ProBasket config for a season name (e.g. '2026/27'), or null if unmapped.
 *
 * With no options this returns the junior-regional window — the documented default.
 * Pass `{ bbSourceId }` (preferred) or `{ league }` to get a team's real window; the
 * 1.-Liga teams get the 93-row senior grid instead of the 38-row junior one.
 */
export function probasketConfigForSeason(
  seasonName: string | undefined | null,
  opts: ProbasketConfigOptions = {},
): ProbasketSeasonConfig | null {
  if (!seasonName) return null
  const data = PROBASKET_SEASON_DATA[seasonName]
  if (!data) return null
  const league = opts.league ?? probasketLeagueForTeam(opts.bbSourceId).league
  return buildConfig(data, league, opts.canton ?? KSCW_CANTON)
}

// ── Candidate dates ──────────────────────────────────────────────────────────

/** Fri=5, Sat=6, Sun=0 in JS `Date.getDay()` — the days basketball plays home games. */
const PLAY_DOW = new Set([5, 6, 0])

/** Parse 'YYYY-MM-DD' at LOCAL midnight (avoids UTC drift on the day boundary). */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Convert a JS `Date.getDay()` (0=Sun…6=Sat) to the DB `hall_slots.day_of_week`
 * convention (0=Mon…6=Sun). See TrainingForm.tsx / TeamSlotConfigPanel.tsx.
 */
export function jsDayToDbDow(jsDay: number): number {
  return (jsDay + 6) % 7
}

export interface CandidateDate {
  /** 'YYYY-MM-DD'. */
  date: string
  /** JS `getDay()` — 0=Sun…6=Sat. */
  dow: number
  /** The strictest ProBasket blackout this date falls in, if any (else null). */
  blackout: ProbasketBlackout | null
  /** Every blackout covering this date — 'sperr' first (Ostern overlaps the ZH Osterferien). */
  blackouts: ProbasketBlackout[]
}

/**
 * Every blackout covering `ymd`, strictest first. Some dates carry two (e.g. 25.04.2027
 * is both the ZH/ZG Osterferien and the ProBasket Classics Final) — a 'sperr' blocks
 * every league, so it must win over a 'ferien' that only binds interregional + 1./2. Liga.
 */
function blackoutsOn(ymd: string, blackouts: readonly ProbasketBlackout[]): ProbasketBlackout[] {
  // ISO date strings compare lexicographically, so plain string range checks work.
  return blackouts
    .filter((b) => ymd >= b.start && ymd <= b.end)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'sperr' ? -1 : 1))
}

/** Every Fri/Sat/Sun in the league's grid, each annotated with any ProBasket blackout. */
export function probasketCandidateDates(cfg: ProbasketSeasonConfig): CandidateDate[] {
  const out: CandidateDate[] = []
  const seen = new Set<string>()
  for (const range of cfg.ranges) {
    const end = parseYmd(range.end)
    for (const d = parseYmd(range.start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay()
      if (!PLAY_DOW.has(dow)) continue
      const ymd = toYmd(d)
      if (seen.has(ymd)) continue
      seen.add(ymd)
      const hits = blackoutsOn(ymd, cfg.blackouts)
      out.push({ date: ymd, dow, blackout: hits[0] ?? null, blackouts: hits })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// ── Fixed hall slots ─────────────────────────────────────────────────────────
// Basketball plays Fri/Sat/Sun; the tip-off times differ per weekday.
export const FRIDAY_SLOTS = ['20:00'] as const
export const SATURDAY_SLOTS = ['11:00', '13:30', '16:00', '18:30'] as const
export const SUNDAY_SLOTS = ['10:00', '12:30', '15:00'] as const

/** KWI home halls. Friday offers A/B; the weekend adds C. 'KWI A+B' = the combined big court. */
export const HALL_A = 'KWI A'
export const HALL_B = 'KWI B'
export const HALL_C = 'KWI C'
export const HALL_AB = 'KWI A+B'
export const HALL_OPTIONS = [HALL_A, HALL_B, HALL_C, HALL_AB] as const

export interface DaySlots {
  times: string[]
  /** Individual halls offered that day (A+B is chosen per game in the modal, not a column). */
  halls: string[]
}

/** Fixed time slots + candidate halls for a candidate date's weekday (JS getDay: Sun=0..Sat=6). */
export function slotsForDate(dow: number): DaySlots {
  if (dow === 5) return { times: [...FRIDAY_SLOTS], halls: [HALL_A, HALL_B] } // Friday
  if (dow === 6) return { times: [...SATURDAY_SLOTS], halls: [HALL_A, HALL_B, HALL_C] } // Saturday
  if (dow === 0) return { times: [...SUNDAY_SLOTS], halls: [HALL_A, HALL_B, HALL_C] } // Sunday
  return { times: [], halls: [] }
}

/** 'HH:MM' → Excel time serial (fraction of a day), for the availability export. */
export function timeToExcelFraction(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h * 60 + m) / 1440
}

/** A game's default end time = start + 2h, as 'HH:MM' (24h clamp). */
export function slotEndTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const end = (h * 60 + m + 120) % (24 * 60)
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}
