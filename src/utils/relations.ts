/**
 * Directus relation helpers.
 *
 * When a relation field is expanded via `fields: ['*', 'relation.*']`,
 * the field value becomes the full object instead of the raw ID.
 * These helpers safely extract IDs or objects regardless of expansion state.
 */

/** Extract the string ID from a relation field (expanded object or raw ID). */
export function relId(val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  if (typeof val === 'object' && 'id' in val) return String((val as { id: unknown }).id)
  return ''
}

/** Safely extract an expanded relation object. Returns null if the value is a raw ID. */
export function asObj<T>(val: T | string | number | null | undefined): T | null {
  return val != null && typeof val === 'object' ? val as T : null
}

/** Build display name from first_name + last_name fields. */
export function memberName(m: { first_name?: string; last_name?: string } | null | undefined): string {
  if (!m) return ''
  return [m.first_name, m.last_name].filter(Boolean).join(' ')
}

/**
 * Build minimal unique display labels for a set of members so the reader can
 * tell apart people who share a first name.
 *   - First name alone when it's unique in the set ("Luca").
 *   - Else first name + the shortest last-name prefix that disambiguates
 *     ("Luca C.", extended to "Luca Ca." etc. — as many letters as needed).
 *   - If two members share an identical full name, both fall back to the full
 *     name (nothing more can distinguish them).
 *   - Members with no last name fall back to the bare first name.
 * Returns a Map keyed by String(id). Reference impl previously inline in
 * ParticipationRosterModal.
 */
export function disambiguateFirstNames(
  members: Array<{ id: string | number; first_name?: string; last_name?: string }>,
): Map<string, string> {
  const labels = new Map<string, string>()
  const byFirst = new Map<string, Array<{ id: string | number; first_name?: string; last_name?: string }>>()
  for (const m of members) {
    const key = (m.first_name ?? '').trim()
    const arr = byFirst.get(key)
    if (arr) arr.push(m)
    else byFirst.set(key, [m])
  }
  for (const [first, group] of byFirst) {
    if (group.length === 1) {
      labels.set(String(group[0].id), first || (group[0].last_name ?? '').trim())
      continue
    }
    for (const m of group) {
      const last = (m.last_name ?? '').trim()
      if (!last) {
        labels.set(String(m.id), first)
        continue
      }
      const others = group.filter((o) => String(o.id) !== String(m.id))
      let len = 1
      while (len < last.length) {
        const prefix = last.slice(0, len).toLowerCase()
        if (!others.some((o) => (o.last_name ?? '').trim().slice(0, len).toLowerCase() === prefix)) break
        len++
      }
      labels.set(String(m.id), len >= last.length ? `${first} ${last}` : `${first} ${last.slice(0, len)}.`)
    }
  }
  return labels
}

/**
 * Extract member IDs from a Directus M2M junction field (coach, team_responsible).
 *
 * DANGER: bare ID arrays like `[5, 10]` are interpreted as member IDs but in
 * practice Directus returns those for *unexpanded* M2M fields where the
 * integers are JUNCTION row IDs (`teams_coaches.id`), NOT member IDs. Using
 * this on an unexpanded M2M caused the 2026-05-12 "ghost roster" bug where
 * Aditya Dave (member 6) appeared in D1's absences because D1's
 * `teams_coaches.id` happened to be 6.
 *
 * RULE: always pass `coach.members_id` / `team_responsible.members_id` in
 * your Directus `fields:` array so the values arrive as
 * `[{members_id: 5}]` and the bare-number branch is never hit.
 *
 * For M2O fields like `captain` (single FK to members), use `relId()`
 * instead — bare-number values there ARE member IDs.
 */
export function flattenMemberIds(field: unknown): string[] {
  if (field == null) return []
  // Single value (Directus may return bare int/string for single-entry M2M)
  if (!Array.isArray(field)) {
    if (typeof field === 'object' && 'members_id' in field) return [String((field as { members_id: unknown }).members_id)]
    return [String(field)]
  }
  return field.map(item => {
    if (typeof item === 'object' && item !== null && 'members_id' in item) {
      return String((item as { members_id: unknown }).members_id)
    }
    return String(item)
  }).filter(Boolean)
}

/** Team's coach member IDs — used for "Coach present" detection. Excludes captain + team_responsible (they're not coaches). */
export function teamCoachIds(team: { coach?: unknown } | null | undefined): string[] {
  if (!team) return []
  return flattenMemberIds(team.coach)
}
