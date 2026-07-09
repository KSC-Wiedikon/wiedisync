import type { MemberPosition, Team } from '../types'
import { flattenMemberIds } from './relations'

// `staff_only` replaces `other` in the pickers — a member with no player
// position is non-playing staff, not "other". `other` is kept below as a valid
// legacy/default value (renders + round-trips) but is no longer offered.
const VB_POSITIONS: MemberPosition[] = ['setter', 'outside', 'middle', 'opposite', 'libero', 'guest', 'staff_only']
const BB_POSITIONS: MemberPosition[] = ['point_guard', 'shooting_guard', 'small_forward', 'power_forward', 'center', 'guest', 'staff_only']

const POSITION_I18N_KEYS: Record<MemberPosition, string> = {
  setter: 'positionSetter',
  outside: 'positionOutside',
  middle: 'positionMiddle',
  opposite: 'positionOpposite',
  libero: 'positionLibero',
  point_guard: 'positionPointGuard',
  shooting_guard: 'positionShootingGuard',
  small_forward: 'positionSmallForward',
  power_forward: 'positionPowerForward',
  center: 'positionCenter',
  guest: 'positionGuest',
  staff_only: 'positionStaffOnly',
  other: 'positionOther',
}

const POSITION_INITIALS: Record<MemberPosition, string> = {
  setter: 'S',
  outside: 'O',
  middle: 'M',
  opposite: 'D',
  libero: 'L',
  point_guard: 'PG',
  shooting_guard: 'SG',
  small_forward: 'SF',
  power_forward: 'PF',
  center: 'C',
  guest: 'G',
  staff_only: 'St',
  other: '·',
}

export function getPositionInitial(position?: string | null): string {
  if (!position) return '·'
  return POSITION_INITIALS[position as MemberPosition] ?? position.slice(0, 1).toUpperCase()
}

export function getPositionI18nKey(position?: string | null): string | null {
  if (!position) return null
  return POSITION_I18N_KEYS[position as MemberPosition] ?? null
}

export function coercePositions(input: unknown): MemberPosition[] {
  if (Array.isArray(input)) {
    return input.filter((p): p is MemberPosition => typeof p === 'string' && p in POSITION_I18N_KEYS)
  }
  if (typeof input === 'string' && input in POSITION_I18N_KEYS) {
    return [input as MemberPosition]
  }
  return []
}

export function getPositionsForSport(sport?: Team['sport']): MemberPosition[] {
  if (sport === 'basketball') return BB_POSITIONS
  if (sport === 'volleyball') return VB_POSITIONS
  return [...VB_POSITIONS, ...BB_POSITIONS.filter((p) => !VB_POSITIONS.includes(p))]
}

export function getSelectablePositions(sport?: Team['sport'], current?: unknown): MemberPosition[] {
  const base = getPositionsForSport(sport)
  const currentPositions = coercePositions(current)
  const missing = currentPositions.filter((p) => !base.includes(p))
  if (missing.length > 0) {
    return [...missing, ...base]
  }
  return base
}

/**
 * A member is "non-playing staff" if they are in team.coach or team.team_responsible
 * AND have no player positions (only 'staff_only' / 'other' / empty).
 */
export function isNonPlayingStaff(
  memberId: string,
  team: { coach?: string[]; team_responsible?: string[] } | null | undefined,
  positions: MemberPosition[],
): boolean {
  if (!team) return false
  const isStaff = flattenMemberIds(team.coach).includes(memberId) || flattenMemberIds(team.team_responsible).includes(memberId)
  if (!isStaff) return false
  const playerPositions = positions.filter((p) => p !== 'other' && p !== 'staff_only')
  return playerPositions.length === 0
}

export function isPositionValidForSport(position: string | null | undefined, sport?: Team['sport']): boolean {
  if (!position) return true
  return getPositionsForSport(sport).includes(position as MemberPosition)
}

export function normalizePositionForSport(position: string | null | undefined, sport?: Team['sport']): MemberPosition {
  if (position && isPositionValidForSport(position, sport)) return position as MemberPosition
  return 'other'
}

export function normalizePositionsForSport(positions: unknown, sport?: Team['sport']): MemberPosition[] {
  const allowed = new Set(getPositionsForSport(sport))
  const normalized = coercePositions(positions).filter((p) => allowed.has(p))
  if (normalized.length === 0) return ['other']
  return Array.from(new Set(normalized))
}
