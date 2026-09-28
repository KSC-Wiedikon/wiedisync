import { apiErrorCode } from '../../lib/apiErrorCode'

/**
 * i18n key (teams namespace) for a refused `member_teams` create, or null when
 * the refusal is not one of the roster-add guards in kscw-hooks
 * (`member_teams.items.create`, security audit 2026-09-28 F24):
 *  - 429 ROSTER_ADD_RATE_LIMITED — the per-coach hourly cap
 *  - 403 MEMBER_INACTIVE — the person left the club
 */
export function rosterAddErrorKey(err: unknown): string | null {
  switch (apiErrorCode(err)) {
    case 'ROSTER_ADD_RATE_LIMITED': return 'teams:rosterAddRateLimited'
    case 'MEMBER_INACTIVE': return 'teams:rosterAddMemberInactive'
    default: return null
  }
}
