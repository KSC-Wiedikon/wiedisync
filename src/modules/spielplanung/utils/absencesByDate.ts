import type { Member } from '../../../types'
import type { AbsenceWithMember, MemberTeamRef } from '../../../hooks/useTeamAbsences'
import { absenceCoversActivity } from '../../../utils/absenceHelpers'
import { asObj, memberName } from '../../../utils/relations'
import { parseDate, toDateKey, eachDayOfInterval } from '../../../utils/dateUtils'

export interface AbsentMember {
  memberId: string
  name: string
  /** Team names (within the viewed scope) the member belongs to. */
  teams: string[]
}

/**
 * Expand a set of absences into a per-day map of who is unavailable for *games*.
 *
 * Only absences that affect games (`affects` includes `all`/`games`) on the
 * matching day count — weekly absences are checked against their `days_of_week`.
 * Each member is counted at most once per day even when several overlapping
 * absences apply. The scan window is clamped to each absence's own span ∩ the
 * season so indefinite rows (stored as `end_date: 2099-12-31`) don't blow up.
 */
export function buildAbsencesByDate(
  absences: AbsenceWithMember[],
  memberTeams: Record<string, MemberTeamRef[]>,
  seasonStart: string,
  seasonEnd: string,
): Map<string, AbsentMember[]> {
  const byDate = new Map<string, AbsentMember[]>()
  // date key -> member ids already recorded, so overlapping absences dedupe.
  const seen = new Map<string, Set<string>>()

  for (const a of absences) {
    const memberObj = asObj<Member>(a.member)
    const memberId = String(memberObj?.id ?? a.member ?? '')
    if (!memberId) continue
    const name = memberName(memberObj) || memberId
    const teams = (memberTeams[memberId] ?? []).map((tr) => tr.name).filter(Boolean)

    const startKey = (a.start_date ?? '').split(' ')[0]
    const endKey = (a.end_date ?? '').split(' ')[0]
    if (!startKey || !endKey) continue

    const scanStart = startKey > seasonStart ? startKey : seasonStart
    const scanEnd = endKey < seasonEnd ? endKey : seasonEnd
    if (scanStart > scanEnd) continue

    for (const day of eachDayOfInterval(parseDate(scanStart), parseDate(scanEnd))) {
      const key = toDateKey(day)
      if (!absenceCoversActivity(a, 'game', key)) continue

      let dayMembers = seen.get(key)
      if (!dayMembers) {
        dayMembers = new Set()
        seen.set(key, dayMembers)
      }
      if (dayMembers.has(memberId)) continue
      dayMembers.add(memberId)

      const arr = byDate.get(key) ?? []
      arr.push({ memberId, name, teams })
      byDate.set(key, arr)
    }
  }

  // Stable name order inside each day for a tidy popover.
  for (const arr of byDate.values()) {
    arr.sort((x, y) => x.name.localeCompare(y.name))
  }

  return byDate
}
