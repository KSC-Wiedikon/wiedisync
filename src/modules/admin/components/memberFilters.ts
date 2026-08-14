// src/modules/admin/components/memberFilters.ts
/**
 * Member-filter model: the filter state shape, its field catalogues and the pure
 * filtering logic used by the Data Explorer.
 *
 * Lives apart from `ExplorerMemberFilters.tsx` so that file only exports
 * components — react-refresh/only-export-components (Fast Refresh) requires a
 * module to export either components or non-components, not both.
 */

import type { Member, MemberPosition } from '../../../types'
import type { CacheShape } from './explorerHelpers'
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
  'communications_team_chat_enabled',
  'communications_dm_enabled',
  'communications_banned',
  'push_preview_content',
] as const
export type BoolField = (typeof BOOL_FIELDS)[number]

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
  'last_online_at', 'consent_prompted_at',
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

export const CONSENT_KEYS = ['accepted', 'declined', 'pending'] as const
export type ConsentKey = (typeof CONSENT_KEYS)[number]

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
  consent: ConsentKey[]
  licenceStatus: LicenceStatus[]
  /**
   * Club register status (migration 302). Includes 'unset' — the members whose
   * status wiedisync has never been told, which is a worklist in its own right
   * (every one of them is a member with no linked ClubDesk contact).
   */
  registerStatus: RegisterStatusKey[]
}

export type RegisterStatusKey = RegisterStatus | 'unset'
export const REGISTER_STATUS_KEYS: readonly RegisterStatusKey[] =
  [...REGISTER_STATUS_VALUES, 'unset']

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
  consent: [],
  licenceStatus: [],
  registerStatus: [],
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
  n += f.consent.length
  n += f.licenceStatus.length
  n += f.registerStatus.length
  return n
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

    if (filters.consent.length > 0) {
      const raw = String(mr.consent_decision ?? 'pending')
      if (!(CONSENT_KEYS as readonly string[]).includes(raw)) return false
      if (!filters.consent.includes(raw as ConsentKey)) return false
    }

    if (filters.licenceStatus.length > 0) {
      // Through effectiveLicenceStatus, not the raw column: between the 1 June
      // rollover and the sweep that follows it, the column still holds last
      // season's answer, and a worklist built on it would skip exactly the
      // people who need a licence ordered this season.
      const { status } = effectiveLicenceStatus(m)
      if (!filters.licenceStatus.includes(status)) return false
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
