// src/modules/admin/components/explorerHelpers.ts
import type { Member, Team, Event as EventRec, Training, Game } from '../../../types'

export type BucketKey = 'members' | 'teams' | 'events' | 'trainings' | 'games'

export interface ExplorerEntity {
  type: BucketKey
  id: string
  /** Primary label used in tree + breadcrumb. */
  label: string
  /** Secondary label shown under the primary in search results. */
  sublabel?: string
}

/** One member_teams junction row — kept with its id so the grid can edit/delete it. */
export interface MemberTeamRow {
  id: string
  member: string
  team: string
  guest_level: number
  season: string | null
}

/** One coach / team-responsible junction row (teams_coaches / teams_responsibles). */
export interface StaffRow {
  id: string
  member: string
  team: string
}

/** Narrow ClubDesk-register info per member (keyed by members.clubdesk_id). */
export interface ClubdeskInfo {
  /** Bracketed group tokens, e.g. "[Ehrenmitglieder][VB Ehemalig]…". */
  gruppen: string
  /** ClubDesk "Offiziellen Lizenz" free text (e.g. "Volleyball Lizenz"). */
  offiziellenLizenz: string
}

/** Per-member ClubDesk sync verdict from GET /kscw/clubdesk-sync-status. */
export type ClubdeskSyncStatus =
  | 'in_sync' | 'drift' | 'pending' | 'not_linked' | 'stale' | 'departed' | 'excluded'

/** One retained registration document (post-approval) for the reg-files column. */
export interface RegFileDoc {
  /** Registration column, e.g. 'id_upload_front' / 'bb_doc_lizenz'. */
  field: string
  /** directus_files id — opened via the admin asset URL. */
  fileId: string
}

/** Registration files retained for a member (keyed by members.id). */
export interface RegFileInfo {
  referenceNumber: string | null
  status: string | null
  docs: RegFileDoc[]
}

export interface CacheShape {
  members: Member[]
  teams: Team[]
  events: EventRec[]
  trainings: Training[]
  games: Game[]
  /**
   * teamId → team, for EVERY team including past-season / inactive ones.
   *
   * `teams` above is the active, sport-scoped list the tree, the grid and the
   * team pickers work from. Roster rows outlive it: a `member_teams` row from a
   * closed season points at a team that is no longer active, and rendering that
   * chip as a raw `#412` is how a member's own history reads as corrupt data.
   * Label resolution only — never use this to populate a picker.
   */
  teamLookup: Map<string, Team>
  /** memberId → array of team ids (from member_teams junction — players) */
  memberTeams: Map<string, string[]>
  /** Raw member_teams junction rows (with ids) — the editable source the grid mutates. */
  memberTeamRows: MemberTeamRow[]
  /** memberId → array of team ids they coach (from teams_coaches junction) */
  memberCoachTeams: Map<string, string[]>
  /** memberId → array of team ids they are team responsible for (from teams_responsibles junction) */
  memberTrTeams: Map<string, string[]>
  /** Raw teams_coaches junction rows (with ids) — editable in the grid's team view. */
  coachRows: StaffRow[]
  /** Raw teams_responsibles junction rows (with ids) — editable in the grid's team view. */
  trRows: StaffRow[]
  /** members.clubdesk_id → narrow ClubDesk register info (groups, officials licence).
   *  Empty for viewers whose policy can't read clubdesk_export (fetch is caught). */
  clubdeskInfo: Map<string, ClubdeskInfo>
  /** members.id → ClubDesk sync verdict (from /kscw/clubdesk-sync-status).
   *  Empty for viewers the status endpoint 403s (fetch is caught). */
  clubdeskSync: Map<string, ClubdeskSyncStatus>
  /** members.id → retained registration files (post-approval).
   *  Empty for viewers who can't read `registrations` (fetch is caught). */
  regFiles: Map<string, RegFileInfo>
  loadedAt: number | null
}

/** Rebuild a memberId → teamIds map from staff junction rows. */
export function buildStaffMap(rows: StaffRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const r of rows) {
    const existing = map.get(r.member)
    if (existing) existing.push(r.team)
    else map.set(r.member, [r.team])
  }
  return map
}

/** Rebuild the memberId → teamIds map from junction rows (after a grid mutation). */
export function buildMemberTeamsMap(rows: MemberTeamRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const r of rows) {
    const existing = map.get(r.member)
    if (existing) existing.push(r.team)
    else map.set(r.member, [r.team])
  }
  return map
}

/**
 * Sport-admin scope: 'all' means no filter, else restrict to a single sport.
 * Users with both vb+bb but not global admin also get 'all'.
 */
export type ExplorerScope = 'all' | 'volleyball' | 'basketball'

export function getExplorerScope(auth: {
  isGlobalAdmin: boolean
  isVorstand: boolean
  isVbAdmin: boolean
  isBbAdmin: boolean
}): ExplorerScope {
  if (auth.isGlobalAdmin || auth.isVorstand) return 'all'
  if (auth.isVbAdmin && auth.isBbAdmin) return 'all'
  if (auth.isVbAdmin) return 'volleyball'
  if (auth.isBbAdmin) return 'basketball'
  return 'all'
}

/** Return segments: array of { text, match } so the caller can render `<mark>` on matches. */
export function highlightMatch(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query) return [{ text, match: false }]
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx === -1) return [{ text, match: false }]
  return [
    { text: text.slice(0, idx), match: false },
    { text: text.slice(idx, idx + q.length), match: true },
    { text: text.slice(idx + q.length), match: false },
  ].filter((s) => s.text.length > 0)
}

export function memberLabel(m: Member): string {
  // UI label — prefers the member's chosen nickname (falls back to first_name).
  const fn = m.nickname || m.first_name || ''
  const ln = m.last_name ?? ''
  return `${ln}, ${fn}`.trim().replace(/^,\s*/, '').trim() || `Member #${m.id}`
}

/** Short label (e.g. "H1") — used for tree rows and compact chips. */
export function teamLabel(t: Team): string {
  return t.name || t.full_name || `Team #${t.id}`
}

export function eventLabel(e: EventRec): string {
  return e.title || `Event #${e.id}`
}

export function trainingLabel(t: Training, teamLookup: (id: string) => string): string {
  const teamStr = t.team ? teamLookup(String(t.team)) : ''
  return [teamStr, formatShortDate(t.date)].filter(Boolean).join(' · ')
}

export function gameLabel(g: Game, teamLookup: (id: string) => string): string {
  const home = g.home_team ? teamLookup(String(g.home_team)) : '?'
  const away = g.away_team ? teamLookup(String(g.away_team)) : '?'
  return `${home} vs ${away} · ${formatShortDate(g.date)}`.trim()
}

/** Convert a YYYY-MM-DD or full ISO string to dd.mm.yy. Empty string if input is falsy. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [yyyy, mm, dd] = iso.slice(0, 10).split('-')
  if (!yyyy || !mm || !dd) return iso
  return `${dd}.${mm}.${yyyy.slice(2)}`
}

/** Convert a full ISO datetime to dd.mm.yy HH:mm. Empty string if input is falsy. */
export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yy} ${hh}:${mi}`
}
