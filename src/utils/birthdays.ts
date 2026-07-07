import type { Member } from '../types'

/**
 * Birthday helpers — shared by the homepage "coming up" ticker and the team
 * calendar. Birthdays are a team-internal courtesy feature; privacy is governed
 * by the member's own `birthdate_visibility`:
 *
 *   • `full`      → day + month + year are visible → birthday is surfaced.
 *   • `year_only` → the roster shows only the year, i.e. the member has hidden
 *                   the day/month → a day-specific birthday marker MUST skip them.
 *   • `hidden`    → excluded outright.
 *
 * So only `full`-visibility members ever get a birthday entry. This mirrors the
 * existing roster gate (`MemberRow` / `PlayerProfile`).
 */

type BirthdayMember = Pick<Member, 'first_name' | 'last_name'> & {
  id?: string | number
  birthdate?: string | null
  birthdate_visibility?: string | null
}

/** True when the member has opted into full birthdate visibility and has one. */
export function isBirthdayVisible(
  member: { birthdate?: string | null; birthdate_visibility?: string | null } | null | undefined,
): boolean {
  return !!member && !!member.birthdate && member.birthdate_visibility === 'full'
}

/** Parse `{ year, month (1-12), day (1-31) }` out of a `YYYY-MM-DD` birthdate,
 *  ignoring any time part. Returns null for malformed input. */
export function birthMonthDay(
  birthdate: string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!birthdate) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate.slice(0, 10))
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/** The birthday's occurrence in `year` as a local-midnight Date. A Feb-29
 *  birthday falls back to Feb-28 in non-leap years (rather than rolling to
 *  Mar-1) so the marker stays in the right month. */
export function birthdayOccurrence(month: number, day: number, year: number): Date {
  const d = new Date(year, month - 1, day)
  // Overflow (e.g. Feb 29 in a non-leap year rolls to Mar 1) → clamp to the last
  // day of the intended month: `new Date(year, month, 0)` is day 0 of the next
  // month = the last day of `month`.
  if (d.getMonth() !== month - 1) return new Date(year, month, 0)
  return d
}

export interface UpcomingBirthday {
  member: BirthdayMember
  /** This year's (or next year's) occurrence, local midnight. */
  date: Date
  /** Age the member turns on that occurrence. */
  age: number
  /** Whole days from `from` to the occurrence (0 = today). */
  daysUntil: number
  isToday: boolean
}

function toMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function fullName(m: BirthdayMember): string {
  return [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
}

/** Next upcoming birthday for a member relative to `from`. Today counts as
 *  upcoming (daysUntil 0). Returns null when the member's birthday isn't
 *  visible / parseable. */
export function nextBirthday(member: BirthdayMember, from: Date): UpcomingBirthday | null {
  if (!isBirthdayVisible(member)) return null
  const md = birthMonthDay(member.birthdate)
  if (!md) return null
  const base = toMidnight(from)
  let occ = birthdayOccurrence(md.month, md.day, base.getFullYear())
  if (occ.getTime() < base.getTime()) {
    occ = birthdayOccurrence(md.month, md.day, base.getFullYear() + 1)
  }
  const daysUntil = Math.round((occ.getTime() - base.getTime()) / 86_400_000)
  return {
    member,
    date: occ,
    age: occ.getFullYear() - md.year,
    daysUntil,
    isToday: daysUntil === 0,
  }
}

/** Upcoming birthdays within `withinDays` of `from` (inclusive of today),
 *  deduped by member id, sorted soonest-first then by name. */
export function upcomingBirthdays(
  members: BirthdayMember[],
  from: Date,
  withinDays: number,
): UpcomingBirthday[] {
  const seen = new Set<string>()
  const out: UpcomingBirthday[] = []
  for (const m of members) {
    const id = m.id != null ? String(m.id) : ''
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    const b = nextBirthday(m, from)
    if (b && b.daysUntil <= withinDays) out.push(b)
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil || fullName(a.member).localeCompare(fullName(b.member)))
  return out
}

/** Every birthday occurrence of a member that falls inside [rangeStart, rangeEnd]
 *  (inclusive, compared by day) — one per intersecting calendar year. Used by
 *  the calendar to place a marker in each visible year. */
export function birthdayOccurrencesInRange(
  member: BirthdayMember,
  rangeStart: Date,
  rangeEnd: Date,
): { date: Date; age: number }[] {
  if (!isBirthdayVisible(member)) return []
  const md = birthMonthDay(member.birthdate)
  if (!md) return []
  const start = toMidnight(rangeStart).getTime()
  const end = toMidnight(rangeEnd).getTime()
  const out: { date: Date; age: number }[] = []
  for (let y = rangeStart.getFullYear(); y <= rangeEnd.getFullYear(); y++) {
    const occ = birthdayOccurrence(md.month, md.day, y)
    const t = occ.getTime()
    if (t >= start && t <= end) out.push({ date: occ, age: y - md.year })
  }
  return out
}
