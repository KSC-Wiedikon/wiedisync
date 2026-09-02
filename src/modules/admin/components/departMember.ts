// src/modules/admin/components/departMember.ts
//
// "This person has left the club" — the one write path behind BOTH departure
// surfaces: the single-member button in the danger zone (MemberDepartModal) and
// the grid's bulk "Mark as departed" (ExplorerBulkDepartModal).
//
// Its own .ts module rather than a chunk of either modal, for the reason
// bulkEdit.ts gives: a component file that also exports helpers breaks React
// Fast Refresh (react-refresh/only-export-components is an ESLint *error*
// here) — and because two copies of "what departing means" is exactly how the
// two surfaces drift apart.
//
// Departing is never one column. Five things move together:
//
//   register_status        → the departed status the operator picked
//   austritt               → the exit date. The CHECK constraint
//                            `members_austritt_needs_departed_status`
//                            (migration 302) REFUSES one without a departed
//                            status, which is why the pair cannot be composed
//                            as two field writes.
//   kscw_membership_active → false
//   wiedisync_active       → false
//   member_teams           → the rows on ACTIVE teams are deleted
//
// ⚠ The roster drop is the half that used to be missing. `/clubdesk-deactivate`
// (clubdesk-update.js → deactivateMemberRow) has always dropped active-team
// rosters when the departure came FROM ClubDesk, while a departure entered by
// hand left the member sitting on every roster. Same event, two outcomes. It is
// one function now.
//
// ⚠ Deleted by TEAM ACTIVITY, never by `member_teams.season` — the season
// column is a label, `teams.active` is the truth (CLAUDE.md → member_teams
// season derivation). Rows on inactive/past teams are HISTORY and are kept: the
// match sheets and the "who played for D2 in 2024/25" answer live there.
//
// ⚠ `register_status` and `austritt` are pushed into the club's LEGAL member
// register by the next approved sync-up (they are in CD_PUSH_HEADERS). ClubDesk
// contacts are only ever marked DEPARTED this way — nothing in wiedisync ever
// deletes one, see DeleteImpactModal's ClubDesk notice.

import { fetchItems, deleteRecord, updateRecord } from '../../../lib/api'
import { logActivity } from '../../../utils/logActivity'
import { DEPARTED_REGISTER_STATUSES } from './memberFieldOptions'

/**
 * The departed statuses, in the club register's own order.
 *
 * ⚠ Values are ClubDesk's picklist verbatim and are NOT translated — the column
 * is pushed straight into the register's Status cell, where a re-spelling is a
 * brand-new picklist entry rather than a synonym. `Zwischenjahr` is deliberately
 * absent: a gap year is a member taking a season off, and the register keeps
 * billing them.
 */
export const DEPARTED_ORDERED: readonly string[] =
  ['Ehemaliges Mitglied', 'Kein Mitglied', 'Verstorben']
    .filter((v) => DEPARTED_REGISTER_STATUSES.has(v))

/** The four `members` columns a departure writes. */
export interface DepartPatch extends Record<string, unknown> {
  register_status: string
  austritt: string
  kscw_membership_active: false
  wiedisync_active: false
}

export function buildDepartPatch(status: string, exitDate: string): DepartPatch {
  return {
    register_status: status,
    austritt: exitDate,
    kscw_membership_active: false,
    wiedisync_active: false,
  }
}

/**
 * Directus hands the two boolean flags back as `true`, `'true'` or `1` depending
 * on which path served the row, so a bare `=== true` reads a still-active member
 * as inactive. Mirrors `asBool` in MemberDangerZone, which reads the same two
 * columns two components away.
 */
function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1
}

/**
 * True when this member would actually change — used to skip no-op writes.
 *
 * Every write here is audit-logged and `register_status` flags the member for a
 * ClubDesk push, so a write that changes nothing is a false entry in the club's
 * change history (the rule bulkEdit.ts holds for field edits).
 *
 * ⚠ Roster rows are NOT part of this test: they are counted per member at apply
 * time, and a member already switched off can still be sitting on a roster.
 * That is what `alreadyDeparted` is for — it answers "the four columns match",
 * not "there is nothing left to do".
 */
export function alreadyDeparted(record: Record<string, unknown>, patch: DepartPatch): boolean {
  return record.register_status === patch.register_status
    && String(record.austritt ?? '').slice(0, 10) === patch.austritt
    && !asBool(record.kscw_membership_active)
    && !asBool(record.wiedisync_active)
}

/**
 * The ids of every team that is still being played.
 *
 * Fetched ONCE by the caller and handed to `departMember` per member — a bulk
 * run over 120 people must not re-read the team list 120 times.
 *
 * ⚠ `fetchItems` stringifies integer ids (see `KEEP_AS_NUMBER` in lib/api.ts),
 * so these are strings and the roster filter below compares them as such.
 */
export async function fetchActiveTeamIds(): Promise<string[]> {
  const teams = await fetchItems<{ id: string }>('teams', {
    filter: { active: { _eq: true } },
    fields: ['id'],
    limit: -1,
  })
  return teams.map((t) => String(t.id))
}

/**
 * Delete the member's roster rows on the given (active) teams. Returns how many
 * went.
 *
 * Two steps rather than one filter walking `team.active` — the pattern CLAUDE.md
 * mandates for anything crossing a relation, and it mirrors `deactivateMemberRow`
 * on the server so the two paths cannot answer differently.
 *
 * ⚠ Best-effort per row: a single roster row that refuses to delete must not
 * abort a departure whose four member columns are already written. The count
 * that comes back is what actually went.
 */
export async function dropRostersOnTeams(memberId: string, activeTeamIds: string[]): Promise<number> {
  if (activeTeamIds.length === 0) return 0
  const rows = await fetchItems<{ id: string }>('member_teams', {
    filter: { member: { _eq: memberId }, team: { _in: activeTeamIds } },
    fields: ['id'],
    limit: -1,
  })
  let dropped = 0
  for (const row of rows) {
    try {
      await deleteRecord('member_teams', String(row.id))
      dropped += 1
    } catch {
      // Swallowed on purpose — see above. The caller reports the real count.
    }
  }
  return dropped
}

export interface DepartResult {
  /** The member row as the server returned it, for the caller's cache. */
  updated: Record<string, unknown>
  /** How many active-team roster rows were removed. */
  rostersDropped: number
}

/**
 * Depart one member: the four columns, then the rosters.
 *
 * ⚠ ORDER MATTERS. The member PATCH goes first: if it fails (a rejected CHECK,
 * a 403) the person keeps their teams, and a half-applied departure that took
 * the rosters but left the membership on is the worst of the three outcomes.
 *
 * The write goes through the items API, so Directus files its own
 * activity/revision trail against the real actor; `logActivity` adds the
 * user_logs entry the superadmin audit page reads.
 */
export async function departMember(
  memberId: string,
  patch: DepartPatch,
  activeTeamIds: string[],
): Promise<DepartResult> {
  // fields: ['*'] — without it Directus answers with its default field set and
  // the caller's record would silently change shape after a save.
  const updated = await updateRecord<Record<string, unknown>>(
    'members', memberId, patch, { fields: ['*'] },
  )
  const rostersDropped = await dropRostersOnTeams(memberId, activeTeamIds)
  logActivity('update', 'members', memberId, { ...patch, rosters_dropped: rostersDropped })
  return { updated, rostersDropped }
}
