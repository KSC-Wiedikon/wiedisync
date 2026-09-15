// src/modules/admin/utils/seasonHealth.ts
//
// Types + pure helpers for the Season health page (`/admin/season-health`).
// The response contract is `GET /kscw/admin/season-health` (see
// .planning/season-health-spec.md and season-health-checks.js). Everything
// here is framework-free so it can be unit-tested; the components under
// components/seasonHealth/ only render what these helpers decide.

import { formatDateZurich, formatTimeZurich } from '../../../utils/dateHelpers'

// ── Contract ─────────────────────────────────────────────────────

export type Sport = 'volleyball' | 'basketball'
/** The three page tabs. */
export type SeasonTab = Sport | 'club'
export type Severity = 'error' | 'warn' | 'info'
export type Grain = 'player' | 'team' | 'game' | 'training' | 'event' | 'club'
export type CheckSport = 'vb' | 'bb' | 'both'
export type Section = 'teams' | 'players' | 'finance' | 'games' | 'duties' | 'rsvp' | 'trainings' | 'events'

/** Display order of the registry sections (not the registry's own order). */
export const SECTIONS: readonly Section[] = [
  'teams', 'players', 'finance', 'games', 'duties', 'rsvp', 'trainings', 'events',
] as const

export const SEASON_TABS: readonly SeasonTab[] = ['volleyball', 'basketball', 'club'] as const

/** A finding row. Free-form; `*_id` columns are link targets, `sport` picks the tab. */
export type CheckRow = Record<string, unknown>

export interface HealthCheck {
  key: string
  section: Section
  sport: CheckSport
  severity: Severity
  grain: Grain
  /** English, sentence case — the i18n fallback. */
  title: string
  description: string
  /** null when the check failed. */
  count: number | null
  by_sport?: { volleyball: number; basketball: number; club: number }
  rows: CheckRow[]
  /** Rows capped at the runner's ROW_LIMIT (100). */
  truncated: boolean
  ms?: number
  error?: string
}

/** One row of TEAM_SUMMARY_SQL — every active team. Counts may arrive as bigint strings. */
export interface TeamSummaryRow {
  team_id: number
  team: string
  sport: string | null
  league?: string | null
  /** League umbrella (clubdesk_group = ''), not a real squad. */
  umbrella?: boolean | string | number | null
  gender?: string | null
  players?: number | string | null
  guests?: number | string | null
  players_with_login?: number | string | null
  /** VB: validated in Volleymanager; BB: licensed in Basketplan this season. */
  licence_ok?: number | string | null
  /** VB only (activated, validated or not); null for BB. */
  licence_activated?: number | string | null
  dues_paid?: number | string | null
  coaches?: number | string | null
  team_responsibles?: number | string | null
  has_captain?: boolean | string | number | null
  games_total?: number | string | null
  games_home?: number | string | null
  games_played?: number | string | null
  games_upcoming?: number | string | null
  trainings_total?: number | string | null
  trainings_next_4w?: number | string | null
  hall_slots?: number | string | null
  licensed_officials?: number | string | null
  [extra: string]: unknown
}

export type LicenceState =
  | 'validated' | 'licensed' | 'activated_not_validated' | 'in_vm_not_activated' | 'none'

/** One row of ROSTER_SQL — every core roster player with licence/dues/login state. */
export interface PlayerStatusRow {
  member_id: number
  first_name: string | null
  last_name: string | null
  team: string
  team_id?: number
  sport: string | null
  guest_level?: number | string | null
  license_nr?: string | null
  licence_state?: LicenceState | string | null
  /** Club-side status (members.licence_status). */
  licence_status?: string | null
  dues_paid?: boolean | string | number | null
  has_login?: boolean | string | number | null
  shell?: boolean | string | number | null
  register_status?: string | null
  [extra: string]: unknown
}

export interface SeasonHealthReport {
  season: string
  generated_at: string
  anchors?: { rollover: string; season_start: string; season_end: string; today: string }
  registers?: {
    vm_synced_at?: string | null
    basketplan_scraped_at?: string | null
    clubdesk_imported_at?: string | null
    finance_synced_at?: string | null
  }
  teams: TeamSummaryRow[]
  players: PlayerStatusRow[]
  checks: HealthCheck[]
  ms?: number
}

// ── Coercion (Postgres counts arrive as strings) ─────────────────

export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string' && v.trim() !== '') return Number(v) || 0
  return 0
}

export function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return ['true', 't', '1', 'yes', 'y'].includes(v.trim().toLowerCase())
  return false
}

// ── Sport tabs ───────────────────────────────────────────────────

export type RowBucket = Sport | 'both' | 'club'

/** Which bucket a single row belongs to, from its own `sport` column. */
export function rowBucket(row: CheckRow): RowBucket {
  if (row.sport_source === 'unknown') return 'club'
  const s = typeof row.sport === 'string' ? row.sport.trim().toLowerCase() : ''
  if (s === 'volleyball' || s === 'basketball') return s
  if (s === 'both') return 'both'
  // 'volleyball, basketball' (comma-joined list) also means both.
  const tokens = s.split(',').map((t) => t.trim()).filter(Boolean)
  const vb = tokens.includes('volleyball')
  const bb = tokens.includes('basketball')
  if (vb && bb) return 'both'
  if (vb) return 'volleyball'
  if (bb) return 'basketball'
  return 'club'
}

/** Does a row show under a tab? 'both' shows under BOTH sport tabs; club only under club. */
export function rowInTab(row: CheckRow, tab: SeasonTab): boolean {
  const b = rowBucket(row)
  if (tab === 'club') return b === 'club'
  return b === tab || b === 'both'
}

/**
 * Which tab(s) a whole check belongs to when its rows do not decide it:
 * club-grain checks are always club-wide, and a single-sport check's rows all
 * belong to that sport whether or not they carry a `sport` column.
 * Returns null when the rows decide (sport 'both', non-club grain).
 */
export function checkFixedTab(check: Pick<HealthCheck, 'sport' | 'grain'>): SeasonTab | null {
  if (check.grain === 'club') return 'club'
  if (check.sport === 'vb') return 'volleyball'
  if (check.sport === 'bb') return 'basketball'
  return null
}

/** The rows of a check that show under a tab. */
export function rowsForTab(check: Pick<HealthCheck, 'sport' | 'grain'>, rows: CheckRow[], tab: SeasonTab): CheckRow[] {
  const fixed = checkFixedTab(check)
  if (fixed) return fixed === tab ? rows : []
  return rows.filter((r) => rowInTab(r, tab))
}

/** Total finding count of a check under a tab (uses the server's by_sport when it can). */
export function tabCount(check: HealthCheck, tab: SeasonTab): number {
  if (check.error || check.count === null || check.count === undefined) return 0
  const fixed = checkFixedTab(check)
  if (fixed) return fixed === tab ? num(check.count) : 0
  if (check.by_sport && typeof check.by_sport[tab] === 'number') return num(check.by_sport[tab])
  return rowsForTab(check, check.rows ?? [], tab).length
}

export interface TabCheck {
  check: HealthCheck
  /** Rows of this tab, capped by the runner. */
  rows: CheckRow[]
  /** Total findings in this tab (may exceed rows.length). */
  count: number
  failed: boolean
}

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 }

export function severityRank(s: string | undefined): number {
  return s && s in SEVERITY_ORDER ? SEVERITY_ORDER[s as Severity] : 3
}

/**
 * The checks of a tab, ordered error → warn → info (registry order within a
 * severity). Clean checks (count 0) are included only when `showClean`; failed
 * checks are always included so the failure is visible.
 */
export function checksForTab(checks: HealthCheck[], tab: SeasonTab, showClean = false): TabCheck[] {
  const out: TabCheck[] = []
  for (const check of checks) {
    const failed = Boolean(check.error)
    // A failed check has no rows to bucket: show it in its fixed tab, or under
    // every tab when the rows would have decided.
    if (failed) {
      const fixed = checkFixedTab(check)
      if (fixed && fixed !== tab) continue
      out.push({ check, rows: [], count: 0, failed: true })
      continue
    }
    const rows = rowsForTab(check, check.rows ?? [], tab)
    const count = tabCount(check, tab)
    const fixed = checkFixedTab(check)
    // A clean single-sport check belongs to its sport tab only.
    if (count === 0 && !showClean) continue
    if (count === 0 && fixed && fixed !== tab) continue
    out.push({ check, rows, count, failed: false })
  }
  return out.sort((a, b) => severityRank(a.check.severity) - severityRank(b.check.severity))
}

export interface TabTotals { errors: number; warnings: number; info: number; failed: number }

/** Finding totals of a tab (rows, not checks) for pills and KPI tiles. */
export function tabTotals(checks: HealthCheck[], tab: SeasonTab): TabTotals {
  const t: TabTotals = { errors: 0, warnings: 0, info: 0, failed: 0 }
  for (const c of checks) {
    if (c.error) {
      const fixed = checkFixedTab(c)
      if (!fixed || fixed === tab) t.failed += 1
      continue
    }
    const n = tabCount(c, tab)
    if (n === 0) continue
    if (c.severity === 'error') t.errors += n
    else if (c.severity === 'warn') t.warnings += n
    else t.info += n
  }
  return t
}

/** Group a tab's checks by section in display order; empty sections are dropped. */
export function groupBySection(items: TabCheck[]): { section: Section; items: TabCheck[] }[] {
  const out: { section: Section; items: TabCheck[] }[] = []
  for (const section of SECTIONS) {
    const inSection = items.filter((i) => i.check.section === section)
    if (inSection.length) out.push({ section, items: inSection })
  }
  // Unknown sections (a registry newer than this build) go last, unsorted.
  const known = new Set<string>(SECTIONS)
  const rest = items.filter((i) => !known.has(i.check.section))
  if (rest.length) {
    const bySection = new Map<string, TabCheck[]>()
    for (const i of rest) bySection.set(i.check.section, [...(bySection.get(i.check.section) ?? []), i])
    for (const [section, list] of bySection) out.push({ section: section as Section, items: list })
  }
  return out
}

// ── Team / player rows per sport ─────────────────────────────────

function rowSport(v: unknown): Sport | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return s === 'volleyball' || s === 'basketball' ? s : null
}

export function teamsForSport<T extends { sport: string | null }>(rows: T[], sport: Sport): T[] {
  return rows.filter((r) => rowSport(r.sport) === sport)
}

export function playersForSport<T extends { sport: string | null }>(rows: T[], sport: Sport): T[] {
  return rows.filter((r) => rowSport(r.sport) === sport)
}

export function isUmbrella(row: TeamSummaryRow): boolean {
  return bool(row.umbrella ?? row.is_umbrella)
}

export interface SportKpis {
  teams: number
  umbrellas: number
  players: number
  guests: number
  licenceOk: number
  duesPaid: number
  teamsWithCoach: number
  games: number
  gamesPlayed: number
  gamesUpcoming: number
  trainings: number
}

/** KPI numbers for one sport, summed over its real squads (umbrellas excluded). */
export function sportKpis(teams: TeamSummaryRow[]): SportKpis {
  const k: SportKpis = {
    teams: 0, umbrellas: 0, players: 0, guests: 0, licenceOk: 0, duesPaid: 0,
    teamsWithCoach: 0, games: 0, gamesPlayed: 0, gamesUpcoming: 0, trainings: 0,
  }
  for (const t of teams) {
    if (isUmbrella(t)) { k.umbrellas += 1; continue }
    k.teams += 1
    k.players += num(t.players)
    k.guests += num(t.guests)
    k.licenceOk += num(t.licence_ok)
    k.duesPaid += num(t.dues_paid)
    if (num(t.coaches) > 0) k.teamsWithCoach += 1
    k.games += num(t.games_total)
    k.gamesPlayed += num(t.games_played)
    k.gamesUpcoming += num(t.games_upcoming)
    k.trainings += num(t.trainings_next_4w)
  }
  return k
}

// ── Licence state ────────────────────────────────────────────────

export type LicenceTone = 'success' | 'warning' | 'danger' | 'neutral'

export const LICENCE_STATES: readonly LicenceState[] = [
  'validated', 'licensed', 'activated_not_validated', 'in_vm_not_activated', 'none',
] as const

export function licenceTone(state: unknown): LicenceTone {
  switch (typeof state === 'string' ? state.trim().toLowerCase() : '') {
    case 'validated':
    case 'licensed':
      return 'success'
    case 'activated_not_validated':
      return 'warning'
    case 'none':
    case 'in_vm_not_activated':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function licenceOk(state: unknown): boolean {
  return licenceTone(state) === 'success'
}

// ── Player filters ───────────────────────────────────────────────

export type LoginFilter = 'all' | 'login' | 'shell' | 'none'
export type DuesFilter = 'all' | 'paid' | 'unpaid'

export interface PlayerFilters {
  team: string
  licence: string
  dues: DuesFilter
  login: LoginFilter
  search: string
}

export const EMPTY_PLAYER_FILTERS: PlayerFilters = {
  team: 'all', licence: 'all', dues: 'all', login: 'all', search: '',
}

export function loginState(row: PlayerStatusRow): 'login' | 'shell' | 'none' {
  if (bool(row.has_login)) return 'login'
  if (bool(row.shell)) return 'shell'
  return 'none'
}

export function playerName(row: { first_name?: unknown; last_name?: unknown }): string {
  const last = typeof row.last_name === 'string' ? row.last_name.trim() : ''
  const first = typeof row.first_name === 'string' ? row.first_name.trim() : ''
  return [last, first].filter(Boolean).join(' ')
}

export function filterPlayers(rows: PlayerStatusRow[], f: PlayerFilters): PlayerStatusRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.team !== 'all' && r.team !== f.team) return false
    if (f.licence !== 'all' && String(r.licence_state ?? 'none') !== f.licence) return false
    if (f.dues === 'paid' && !bool(r.dues_paid)) return false
    if (f.dues === 'unpaid' && bool(r.dues_paid)) return false
    if (f.login !== 'all' && loginState(r) !== f.login) return false
    if (q) {
      const hay = `${playerName(r)} ${r.license_nr ?? ''} ${r.team}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ── Generic finding tables ───────────────────────────────────────

const ID_KEY_RE = /(^|_)id$/
const HIDDEN_KEYS = new Set(['sport', 'sport_source'])

/**
 * Display columns of a row set: keys in first-seen order, minus `*_id`,
 * `sport` and `sport_source`; `first_name` + `last_name` merge into `name`
 * at the position of whichever came first.
 */
export function columnsOf(rows: CheckRow[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue
      seen.add(key)
      if (ID_KEY_RE.test(key) || HIDDEN_KEYS.has(key)) continue
      if (key === 'first_name' || key === 'last_name') {
        if (!out.includes('name')) out.push('name')
        continue
      }
      out.push(key)
    }
  }
  return out
}

/** Export columns: every raw key except `sport_source` (ids and names stay). */
export function exportColumnsOf(rows: CheckRow[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue
      seen.add(key)
      if (key === 'sport_source') continue
      out.push(key)
    }
  }
  return out
}

/** `home_away` → "Home away"; `license_nr` → "License nr". */
export function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim()
  if (!s) return key
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export type CellKind = 'empty' | 'name' | 'team' | 'date' | 'time' | 'timestamp' | 'boolean' | 'number' | 'text'

export interface CellView {
  kind: CellKind
  /** Display text for text-like kinds (dates already Swiss-formatted). */
  text: string
  /** Only for kind 'boolean'. */
  value?: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
const NUMERIC_RE = /^-?\d+(\.\d+)?$/

/** Classify one cell for rendering. `name` is synthesised from first/last by the caller. */
export function classifyCell(key: string, value: unknown): CellView {
  if (key === 'name') return { kind: 'name', text: typeof value === 'string' ? value : '' }
  if (value === null || value === undefined || value === '') return { kind: 'empty', text: '' }
  if (key === 'team' && typeof value === 'string') return { kind: 'team', text: value }
  if (typeof value === 'boolean') return { kind: 'boolean', text: value ? '✓' : '✗', value }
  if (typeof value === 'number') return { kind: 'number', text: String(value) }
  if (typeof value === 'string') {
    const s = value.trim()
    if (DATE_RE.test(s)) return { kind: 'date', text: formatDateZurich(s) }
    if (TIME_RE.test(s)) return { kind: 'time', text: s.slice(0, 5) }
    const m = STAMP_RE.exec(s)
    if (m && !ISO_RE.test(s)) {
      // Zurich wall-clock rendered by the SQL — reorder, never shift.
      return { kind: 'timestamp', text: `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` }
    }
    if (ISO_RE.test(s)) return { kind: 'timestamp', text: `${formatDateZurich(s)} ${formatTimeZurich(s)}` }
    // Numeric strings (bigint counts, money) render tabular; identifiers with
    // a leading zero (licence numbers) stay text.
    if (NUMERIC_RE.test(s) && !(s.length > 1 && /^0\d/.test(s.replace(/^-/, '')))) {
      return { kind: 'number', text: s }
    }
    return { kind: 'text', text: s }
  }
  if (typeof value === 'object') return { kind: 'text', text: JSON.stringify(value) }
  return { kind: 'text', text: String(value) }
}

/** The cell value of a display column (the merged `name` reads first/last). */
export function cellValue(row: CheckRow, key: string): unknown {
  if (key === 'name') return playerName(row)
  return row[key]
}

/**
 * Stable React key for one finding row — the runner's own grain identity
 * (see .planning/season-health-spec.md → "Identity by grain"), not the array
 * index: a rescan or a `showClean`/tab flip re-derives `rows` as a fresh
 * array, and an index key would let React reuse a row's DOM node (and any
 * transient state) for a completely different entity when order shifts.
 * Falls back to the index only for grains with no recognised id column
 * (club-grain rows carry no shared identity concept).
 */
export function findingRowKey(row: CheckRow, index: number): string {
  const get = (k: string) => {
    const v = row[k]
    return v === null || v === undefined ? '' : String(v)
  }
  if (row.member_id !== undefined) return `m:${get('member_id')}:${get('first_name')}:${get('last_name')}`
  if (row.team_id !== undefined) return `t:${get('team_id')}:${get('team')}`
  if (row.game_id !== undefined) {
    return `g:${get('game_id')}:${get('date')}:${get('time')}:${get('home_team')}:${get('away_team')}:${get('home_away')}`
  }
  if (row.training_id !== undefined) return `tr:${get('training_id')}:${get('date')}:${get('time')}:${get('team')}`
  if (row.event_id !== undefined) return `e:${get('event_id')}:${get('title')}:${get('date')}`
  return `row:${index}`
}

/** Link target of a row's identity column, if any. */
export function rowLinks(row: CheckRow): { member?: string; team?: string; game?: string; event?: string; training?: string } {
  const id = (k: string) => {
    const v = row[k]
    return v === null || v === undefined || v === '' ? null : String(v)
  }
  const out: { member?: string; team?: string; game?: string; event?: string; training?: string } = {}
  const member = id('member_id')
  if (member && /^[\w-]+$/.test(member)) out.member = `/teams/player/${member}`
  // Raw name, like TeamCard/PlayerProfile — react-router encodes the path itself.
  if (typeof row.team === 'string' && row.team) out.team = `/teams/${row.team}`
  const game = id('game_id')
  if (game && /^[\w-]+$/.test(game)) out.game = `/admin/explore?t=games&id=${game}`
  const event = id('event_id')
  if (event && /^[\w-]+$/.test(event)) out.event = `/admin/explore?t=events&id=${event}`
  const training = id('training_id')
  if (training && /^[\w-]+$/.test(training)) out.training = `/admin/explore?t=trainings&id=${training}`
  return out
}

// ── Register freshness ───────────────────────────────────────────

export const STALE_AFTER_DAYS = 8

/** Age of an ISO timestamp in whole days; null when unparseable. */
export function ageDays(iso: string | null | undefined, nowMs = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso.includes('T') || iso.includes(' ') ? iso : `${iso}T00:00:00Z`).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((nowMs - t) / 86_400_000)
}

export function isStale(iso: string | null | undefined, nowMs = Date.now(), days = STALE_AFTER_DAYS): boolean {
  const age = ageDays(iso, nowMs)
  return age === null ? true : age > days
}

/** `dd.mm.yyyy HH:MM` in Zurich, or '—' when missing. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = formatDateZurich(iso)
  const t = formatTimeZurich(iso)
  return d ? `${d} ${t}`.trim() : '—'
}
