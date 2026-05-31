import { relId, asObj } from '../../utils/relations'
import type { Absence, Member } from '../../types'

export interface MemberFilterOption {
  id: string
  name: string
}

/**
 * Build the distinct list of members who appear in the given absences,
 * sorted by display name. Used to populate the member filter dropdown so
 * the options only ever show people who actually have at least one entry.
 */
export function buildMemberOptions(
  absences: Absence[],
  memberMap: Record<string, Member>,
  unknownLabel: string,
): MemberFilterOption[] {
  const byId = new Map<string, string>()
  for (const a of absences) {
    const id = relId(a.member)
    if (!id || byId.has(id)) continue
    const m = asObj<Member>(a.member) ?? memberMap[id]
    const name = [m?.first_name, m?.last_name].filter(Boolean).join(' ') || unknownLabel
    byId.set(id, name)
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
