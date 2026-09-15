// src/modules/admin/components/memberFilters.ts
/**
 * Member-filter model: the filter state shape, its field catalogues and the pure
 * filtering logic used by the Data Explorer.
 *
 * Lives apart from `ExplorerMemberFilters.tsx` so that file only exports
 * components — react-refresh/only-export-components (Fast Refresh) requires a
 * module to export either components or non-components, not both.
 */

import type { Member, MemberPosition, Team } from '../../../types'
import type { CacheShape } from './explorerHelpers'
import type { GroupTeam } from './memberGroups'
import { parseTrainerLicences, type TrainerLicence } from '../../../utils/trainerLicences'
import { LICENCE_STATUSES, effectiveLicenceStatus, type LicenceStatus } from '../../../utils/licenceStatus'
import { REGISTER_STATUS_VALUES, type RegisterStatus } from './memberFieldOptions'

export type Tri = 'any' | 'yes' | 'no'
export type SportKey = 'volleyball' | 'basketball' | 'other'
export type SexKey = 'm' | 'f' | 'other'

export const BOOL_FIELDS = [
  'kscw_membership_active',
  'wiedisync_active',
  'shell',
  'shell_reminder_sent',
  'coach_approved_team',
  'is_spielplaner',
  'licence_activated',
  'licence_validated',
  'hide_phone',
  'hide_email',
  'website_visible',
  // Season dues paid (migration 360) — trigger-derived from finance_invoices.
  // "Which volleyball players have paid?" was a hand-written SQL question until
  // this row; now it is Sport = Volleyball + Dues paid = yes.
  'dues_paid',
] as const
export type BoolField = (typeof BOOL_FIELDS)[number]

/**
 * Roster guest status — a property of the member_teams row, not the member:
 * `guest_level` 0 is a regular player, 1–3 a guest with falling priority when
 * trainings are full (see [[member-teams-role-model]]). Only rows on ACTIVE
 * teams count, so a guest row from a closed season cannot label somebody a
 * guest today. A player-guest (player on one team, guest on another) matches
 * both 'player' and 'guest' — OR semantics, like every other chip row here.
 * Members with no roster row at all (staff-only, passive) match neither.
 */
export const GUEST_KEYS = ['player', 'guest', '1', '2', '3'] as const
export type GuestKey = (typeof GUEST_KEYS)[number]

export const PRESENCE_FIELDS = [
  'email', 'phone', 'license_nr', 'number', 'photo', 'birthdate',
  'user', 'requested_team',
  'adresse', 'plz', 'ort',
  // Coded nationality (migration 223) replaces the free-text `nationalitaet` as
  // the presence probe — the latter is trigger-derived from it, so filtering on
  // the codes is the same question asked of the authoritative column.
  'nationalitaet_codes', 'federation_of_origin',
  'vm_email', 'ahv_nummer',
  'licence_category', 'beitragskategorie',
  'shell_expires',
  // licence_activation_date / licence_validation_date intentionally omitted —
  // restricted field perms 403 the explorer cache fetch (see useExplorerCache).
  'last_online_at',
] as const
export type PresenceField = (typeof PRESENCE_FIELDS)[number]

// The two OTN levels (migration 228) replaced the coarse `otn_bb`, dropped by
// migration 303 — filter on both to catch every OTN holder.
export const LICENCE_TYPES = ['scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb', 'referee_bb'] as const
export type LicenceKey = (typeof LICENCE_TYPES)[number]

// Coaching education (migration 274). Its own filter dimension rather than more
// entries in LICENCE_TYPES: those are booleans on the row, this is one
// comma-separated column, so the match below reads it differently.
export type TrainerLicenceKey = TrainerLicence

export const ROLE_TYPES = ['superuser', 'admin', 'vorstand', 'vb_admin', 'bb_admin', 'user'] as const
export type RoleKey = (typeof ROLE_TYPES)[number]

export const POSITIONS: MemberPosition[] = [
  'setter', 'outside', 'middle', 'opposite', 'libero',
  'point_guard', 'shooting_guard', 'small_forward', 'power_forward', 'center',
  'guest', 'other',
]

export const LANGUAGES = ['english', 'german', 'swiss_german', 'french', 'italian'] as const
export type LanguageKey = (typeof LANGUAGES)[number] | 'unset'

export const BIRTHDATE_VIS = ['full', 'year_only', 'hidden'] as const
export type BirthdateVisKey = (typeof BIRTHDATE_VIS)[number]


// Licence-ordering workflow (migration 301). Its own chip row rather than a
// PRESENCE_FIELDS entry: the column is NOT NULL, so "has a value" is true for
// everybody and would filter nothing — the useful question is which of the five
// states, which is what the licence officer's worklist ("show me everyone still
// To be ordered") is made of.
// Re-exported (not redefined) so ExplorerMemberFilters.tsx can pull every
// filter catalogue from this one module, the way it does for the other nine.
export { LICENCE_STATUSES }
export type { LicenceStatus }

export interface MemberFilterState {
  bools: Partial<Record<BoolField, Tri>>
  presence: Partial<Record<PresenceField, Tri>>
  licences: LicenceKey[]
  trainerLicences: TrainerLicenceKey[]
  roles: RoleKey[]
  sports: SportKey[]
  sex: SexKey[]
  positions: MemberPosition[]
  languages: LanguageKey[]
  birthdateVis: BirthdateVisKey[]
  licenceStatus: LicenceStatus[]
  /**
   * Club register status (migration 302). Includes 'unset' — the members whose
   * status wiedisync has never been told, which is a worklist in its own right
   * (every one of them is a member with no linked ClubDesk contact).
   */
  registerStatus: RegisterStatusKey[]
  /** Roster guest status — see GUEST_KEYS. */
  guest: GuestKey[]
  /**
   * Roster season (2026-09-15). Which seasons' teams the Teams groups of the
   * tree and the grid rail list: `CURRENT_SEASON_KEY` = the active teams, a
   * season label (`2025/26`) = that season's archived team rows. Empty = every
   * season. Not a member predicate — `applyMemberFilters` ignores it; it picks
   * the team universe via `teamsForSeasons`.
   *
   * Why it is a filter at all: a `teams` row belongs to exactly one season by
   * construction (the rollover clones squads into NEW ids), so "D2" in the
   * tree is only ever this season's D2 and last season's roster points at a
   * different, archived id. That was invisible — an operator had no way to see
   * that the list was season-scoped, or to look at last season's squad at all.
   */
  seasons: string[]
}

export type RegisterStatusKey = RegisterStatus | 'unset'
export const REGISTER_STATUS_KEYS: readonly RegisterStatusKey[] =
  [...REGISTER_STATUS_VALUES, 'unset']

/**
 * The "whatever season the club is in" key of the roster-season filter.
 *
 * ⚠ A sentinel, not a season label, on purpose: the current season is decided
 * by `teams.active`, which the rollover flips in the same transaction that
 * clones the rosters — NOT by the calendar. `getCurrentSeason()` moves on
 * 1 June, the rollover is a button an admin presses, and every reader that
 * compared the two has had an annual window matching nothing (see
 * [[member-teams-season-derivation]]). Keeping the default symbolic means the
 * page never has to know the label to be right.
 */
export const CURRENT_SEASON_KEY = 'current'

export const EMPTY_FILTERS: MemberFilterState = {
  bools: {},
  presence: {},
  licences: [],
  trainerLicences: [],
  roles: [],
  sports: [],
  sex: [],
  positions: [],
  languages: [],
  birthdateVis: [],
  licenceStatus: [],
  registerStatus: [],
  guest: [],
  seasons: [],
}

/**
 * What the page starts with: active club members only.
 *
 * ⚠ Distinct from `EMPTY_FILTERS`, which is what "Clear all" applies. The cache
 * used to hard-filter `kscw_membership_active` in the Directus query, so the
 * ~35 departed members were simply absent and no filter could bring them back.
 * They are fetched now, and this default keeps the working set identical to
 * what it has always been — the difference is that it is a filter the operator
 * can see the count of, and clear, rather than a silent query condition.
 */
export const DEFAULT_FILTERS: MemberFilterState = {
  ...EMPTY_FILTERS,
  bools: { kscw_membership_active: 'yes' },
  // Current-season rosters only — what the team groups have always shown, now
  // as a filter the operator can see the count of, and widen.
  seasons: [CURRENT_SEASON_KEY],
}

export function countActiveFilters(f: MemberFilterState): number {
  let n = 0
  for (const v of Object.values(f.bools)) if (v && v !== 'any') n++
  for (const v of Object.values(f.presence)) if (v && v !== 'any') n++
  n += f.licences.length
  n += f.trainerLicences.length
  n += f.roles.length
  n += f.sports.length
  n += f.sex.length
  n += f.positions.length
  n += f.languages.length
  n += f.birthdateVis.length
  n += f.licenceStatus.length
  n += f.registerStatus.length
  n += f.guest.length
  n += f.seasons.length
  return n
}

/** What the roster-season pills offer: the active teams' season, then every other season on record. */
export interface SeasonChoices {
  /** Season label the ACTIVE teams carry (null before any team exists). */
  current: string | null
  /** Every other season any team row carries, newest first. */
  others: string[]
}

/**
 * Season labels the page can offer, read off the teams themselves.
 *
 * "Current" is the season the active teams carry — the most recent one if a
 * stale active row from last season survived a rollover. Every other label on
 * ANY team row (`teamLookup` holds the archived ones) is an "other" season,
 * including a pre-created next season, so the list is whatever the data has,
 * not a calendar guess.
 */
export function seasonChoices(cache: Pick<CacheShape, 'teams' | 'teamLookup'>): SeasonChoices {
  const scopeSports = new Set(cache.teams.map((tm) => String(tm.sport ?? '')))
  let current: string | null = null
  for (const tm of cache.teams) {
    if (!tm.active || !tm.season) continue
    if (current === null || tm.season > current) current = tm.season
  }
  const others = new Set<string>()
  for (const tm of cache.teamLookup.values()) {
    if (!tm.season || tm.season === current) continue
    // Stay inside the viewer's sport scope: a VB admin's cache holds no BB
    // teams, so a BB-only season must not surface a pill that lists nothing.
    if (!scopeSports.has(String(tm.sport ?? ''))) continue
    others.add(tm.season)
  }
  return { current, others: [...others].sort().reverse() }
}

/**
 * The team universe the Teams groups list for a roster-season selection.
 *
 * `cache.teams` is the scoped, ACTIVE list every picker and the grid's editable
 * chips work from — it must stay that way, so the widened set is returned
 * separately rather than written back into the cache. Archived rows come from
 * `teamLookup` (label resolution, every season, both sports) and are kept to
 * the sports the scoped list covers, so a VB admin never sees a BB squad.
 *
 * Empty selection = no restriction = every season, like every other chip row.
 */
export function teamsForSeasons(
  seasons: readonly string[],
  cache: Pick<CacheShape, 'teams' | 'teamLookup'>,
): GroupTeam[] {
  const scopeSports = new Set(cache.teams.map((tm) => String(tm.sport ?? '')))
  const wantCurrent = seasons.includes(CURRENT_SEASON_KEY)
  // The active teams answer "current"; a season label matches the row's own
  // stamp whether or not it is still active (a stale active row from last
  // season is still last season's squad).
  const wanted = (tm: Team) =>
    seasons.length === 0 || (wantCurrent && tm.active) || (!!tm.season && seasons.includes(tm.season))

  const out = new Map<string, GroupTeam>()
  // Scoped rows first — they carry the richer field set (captain / league).
  for (const tm of cache.teams) if (wanted(tm)) out.set(String(tm.id), tm)
  for (const tm of cache.teamLookup.values()) {
    const id = String(tm.id)
    if (out.has(id) || !scopeSports.has(String(tm.sport ?? ''))) continue
    if (wanted(tm)) out.set(id, tm)
  }
  return [...out.values()]
}

/** Guest levels this member holds on ACTIVE team rosters (0 = regular player). */
function memberGuestLevels(memberId: string, cache: CacheShape): Set<number> {
  const levels = new Set<number>()
  for (const row of cache.memberTeamRows) {
    if (row.member !== memberId) continue
    const team = cache.teamLookup.get(row.team)
    if (!team || !(team as unknown as { active?: boolean }).active) continue
    levels.add(row.guest_level > 0 ? row.guest_level : 0)
  }
  return levels
}

/** Sport associated with this member via any team association. */
function memberSport(memberId: string, cache: CacheShape): SportKey {
  const allTeamIds = [
    ...(cache.memberTeams.get(memberId) ?? []),
    ...(cache.memberCoachTeams.get(memberId) ?? []),
    ...(cache.memberTrTeams.get(memberId) ?? []),
  ]
  for (const tm of cache.teams) {
    if (String((tm as unknown as { captain?: unknown }).captain) === memberId) {
      allTeamIds.push(String(tm.id))
    }
  }
  const sports = new Set<SportKey>()
  for (const tid of allTeamIds) {
    const team = cache.teams.find((tm) => String(tm.id) === tid)
    const s = (team as unknown as { sport?: string } | undefined)?.sport
    if (s === 'volleyball' || s === 'basketball') sports.add(s)
  }
  if (sports.size === 0) return 'other'
  if (sports.has('volleyball')) return 'volleyball'
  if (sports.has('basketball')) return 'basketball'
  return 'other'
}

export function applyMemberFilters(
  members: Member[],
  filters: MemberFilterState,
  cache: CacheShape,
): Member[] {
  const hasAny = countActiveFilters(filters) > 0
  if (!hasAny) return members

  return members.filter((m) => {
    const mr = m as unknown as Record<string, unknown>

    for (const field of BOOL_FIELDS) {
      const want = filters.bools[field]
      if (!want || want === 'any') continue
      const value = !!mr[field]
      if (want === 'yes' && !value) return false
      if (want === 'no' && value) return false
    }

    for (const field of PRESENCE_FIELDS) {
      const want = filters.presence[field]
      if (!want || want === 'any') continue
      const raw = mr[field]
      const present = raw != null && String(raw).trim() !== ''
      if (want === 'yes' && !present) return false
      if (want === 'no' && present) return false
    }

    if (filters.licences.length > 0) {
      // Migration 067: licences are now per-flag booleans on the member row.
      if (!filters.licences.some((l) => mr[l] === true)) return false
    }

    if (filters.trainerLicences.length > 0) {
      // Migration 274: one comma-separated column, so parse before matching.
      // OR semantics, same as every other chip row here.
      const held = parseTrainerLicences(mr.trainer_licences as string | null | undefined)
      if (!filters.trainerLicences.some((c) => held.includes(c))) return false
    }

    if (filters.roles.length > 0) {
      const memRoles = Array.isArray(mr.role) ? (mr.role as string[]) : []
      if (!filters.roles.some((r) => memRoles.includes(r))) return false
    }

    if (filters.positions.length > 0) {
      const memPos = Array.isArray(mr.position) ? (mr.position as string[]) : []
      if (!filters.positions.some((p) => memPos.includes(p))) return false
    }

    if (filters.sports.length > 0) {
      if (!filters.sports.includes(memberSport(String(m.id), cache))) return false
    }

    if (filters.sex.length > 0) {
      const raw = String(mr.sex ?? '').toLowerCase()
      const s: SexKey = raw === 'm' ? 'm' : raw === 'f' ? 'f' : 'other'
      if (!filters.sex.includes(s)) return false
    }

    if (filters.languages.length > 0) {
      const raw = String(mr.language ?? '')
      const lang: LanguageKey = (LANGUAGES as readonly string[]).includes(raw) ? (raw as LanguageKey) : 'unset'
      if (!filters.languages.includes(lang)) return false
    }

    if (filters.birthdateVis.length > 0) {
      const raw = String(mr.birthdate_visibility ?? 'full')
      if (!(BIRTHDATE_VIS as readonly string[]).includes(raw)) return false
      if (!filters.birthdateVis.includes(raw as BirthdateVisKey)) return false
    }

    if (filters.licenceStatus.length > 0) {
      // Through effectiveLicenceStatus, not the raw column: between the 1 June
      // rollover and the sweep that follows it, the column still holds last
      // season's answer, and a worklist built on it would skip exactly the
      // people who need a licence ordered this season.
      const { status } = effectiveLicenceStatus(m)
      if (!filters.licenceStatus.includes(status)) return false
    }

    if (filters.guest.length > 0) {
      const levels = memberGuestLevels(String(m.id), cache)
      const hit = filters.guest.some((g) =>
        g === 'player' ? levels.has(0)
          : g === 'guest' ? [...levels].some((l) => l > 0)
            : levels.has(Number(g)),
      )
      if (!hit) return false
    }

    if (filters.registerStatus.length > 0) {
      // NULL is its own key rather than being lumped in with 'Kein Mitglied':
      // "the register has never told us" and "the register says they are not a
      // member" are opposite findings, and only the first is a data gap to fix.
      const raw = mr.register_status
      const key: RegisterStatusKey = typeof raw === 'string' && raw ? (raw as RegisterStatus) : 'unset'
      if (!filters.registerStatus.includes(key)) return false
    }

    return true
  })
}
