// src/modules/admin/components/bulkEdit.ts
//
// The value logic behind the Data Explorer's multi-member edit: given the
// changes an operator composed once and the record of one selected member, what
// PATCH does THAT member get — and does the member need one at all.
//
// Its own .ts module rather than a chunk of the modal, for two reasons:
//   • It is the part that can be wrong quietly. A bulk apply touches 40 rows at
//     once, so "add a role" silently REPLACING the role array, or a no-op write
//     flagging 40 members for a ClubDesk push that carries nothing, are bugs you
//     find in the register rather than on screen. It is unit-tested.
//   • A component file that also exports helpers breaks React Fast Refresh
//     (react-refresh/only-export-components, an ESLint *error* here) — the same
//     reason memberFieldSchema.ts and memberFieldOptions.ts are separate.
//
// Two rules it exists to hold:
//   • A member whose value already equals the target gets NO patch. Not a patch
//     that happens to change nothing — no request at all. Every write here is
//     audit-logged and several of these columns set clubdesk_push_pending, so a
//     write with no change is a false entry in the club's change history.
//   • `add` / `remove` are set operations on the CURRENT value of that member,
//     never a shared array computed once. Bulk "add the coach role" has to leave
//     each member's other roles alone, which is precisely what a `set` cannot do.

import { TEAM_LINK_KEYS } from './memberFieldSchema'

/**
 * What one composed change does to each selected member.
 *
 * `set` / `clear` apply to every kind. `add` / `remove` only to the list-valued
 * ones (multiselect and the teams roster) — see `BULK_LIST_MODES_KINDS` in the
 * modal, which decides what the mode switch offers.
 */
export type BulkMode = 'set' | 'clear' | 'add' | 'remove'

export interface BulkFieldChange {
  /** `members` column, or one of the three team-link virtual keys. */
  key: string
  mode: BulkMode
  /**
   * The composed value. For `set` it is written as-is; for `add` / `remove` it
   * is the delta applied to each member's own list; for `clear` it is ignored.
   */
  value: unknown
}

/**
 * `members.role` is a jsonb string array, but a legacy row can hold a bare
 * string — and Postgres hands back either an array or its JSON text depending
 * on the driver path. Mirrors parseRoleList() in ExplorerMemberFields.tsx.
 */
export function parseStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (s.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(s)
        return Array.isArray(parsed) ? parsed.map(String) : []
      } catch { return [] }
    }
    return s ? [s] : []
  }
  return []
}

/**
 * "Would this write change anything." Mirrors valueEquals() in
 * ExplorerMemberFields.tsx, plus one rule that only matters in bulk: an empty
 * string and NULL are the same emptiness. A `clear` composes to NULL, and
 * without this every member holding '' would take a pointless write.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  const na = a === '' ? null : a
  const nb = b === '' ? null : b
  if (na === nb) return true
  if (na == null && nb == null) return true
  if (na == null || nb == null) return false
  if (typeof na === 'object' && typeof nb === 'object') {
    try { return JSON.stringify(na) === JSON.stringify(nb) } catch { return false }
  }
  return false
}

/**
 * Apply a list delta to ONE member's current list.
 *
 * Order is the member's own, with additions appended in the order they were
 * picked — a bulk add must not reshuffle a list that already reads in a
 * meaningful order, and `role` is rendered in array order.
 */
function applyListDelta(current: unknown, delta: unknown, mode: 'add' | 'remove'): string[] {
  const cur = parseStringList(current)
  const change = parseStringList(delta)
  if (mode === 'remove') {
    const drop = new Set(change)
    return cur.filter((v) => !drop.has(v))
  }
  const out = [...cur]
  for (const v of change) if (!out.includes(v)) out.push(v)
  return out
}

/**
 * The PATCH body for one member — containing ONLY the keys that would actually
 * change on that member. An empty object means "skip this member entirely";
 * the caller must not send it.
 *
 * The three team-link keys are dropped here on purpose: they are junction
 * rows, not `members` columns, and putting one in a PATCH body would be a
 * relational write. `computeRosterDelta` is their counterpart.
 */
export function computeMemberPatch(
  record: Record<string, unknown>,
  changes: readonly BulkFieldChange[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const change of changes) {
    if (TEAM_LINK_KEYS.has(change.key)) continue
    const current = record[change.key]
    let next: unknown
    switch (change.mode) {
      case 'clear':
        next = null
        break
      case 'add':
      case 'remove':
        next = applyListDelta(current, change.value, change.mode)
        break
      case 'set':
      default:
        next = change.value === '' ? null : change.value
        break
    }
    if (!valuesEqual(current, next)) patch[change.key] = next
  }
  return patch
}

/**
 * Roster rows this member is missing / holding, for a teams change.
 *
 * `currentTeamIds` is every team the member already has a `member_teams` row
 * for, across every season — the same list the single-member editor shows. Add
 * returns only the genuinely missing ones and remove only the genuinely held
 * ones, so a member already on the target team is a no-op rather than a
 * duplicate junction row.
 */
export function computeRosterDelta(
  currentTeamIds: readonly string[],
  change: BulkFieldChange,
): { add: string[]; remove: string[] } {
  const held = new Set(currentTeamIds.map(String))
  const targets = parseStringList(change.value)
  if (change.mode === 'remove') {
    return { add: [], remove: targets.filter((id) => held.has(id)) }
  }
  return { add: targets.filter((id) => !held.has(id)), remove: [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkItemFailure {
  id: string
  /** Human name, so the failure list names people and not primary keys. */
  label: string
  error: string
}

export interface BulkRunSummary {
  /** Members that took a write and succeeded. */
  changed: string[]
  /** Members already holding every target value — no request was sent. */
  skipped: string[]
  failed: BulkItemFailure[]
}

/**
 * Run one worker per member with a small concurrency window.
 *
 * A pool rather than Promise.all or a Directus batch PATCH, deliberately:
 *   • A sport admin selecting a member outside their section gets a 403 for
 *     THAT member. One batch PATCH would roll the whole selection back over it;
 *     Promise.all would fire all 200 requests at Directus at once.
 *   • Partial success is the normal outcome and has to be reportable per member
 *     — "9 updated, 3 failed: permission denied" is the answer the operator
 *     needs, and it is only available if each write is its own request.
 *
 * Never rejects: a worker that throws lands in `failed` and the pool continues.
 * `onProgress` fires after every settled item, for the progress counter.
 */
export async function runBulk<T>(
  items: readonly T[],
  worker: (item: T) => Promise<'changed' | 'skipped'>,
  opts: {
    idOf: (item: T) => string
    labelOf: (item: T) => string
    concurrency?: number
    onProgress?: (done: number, total: number) => void
    /** Set by the modal's Cancel — stops starting new work, in-flight finishes. */
    isCancelled?: () => boolean
  },
): Promise<BulkRunSummary> {
  const summary: BulkRunSummary = { changed: [], skipped: [], failed: [] }
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, items.length || 1))
  let cursor = 0
  let done = 0

  const runOne = async (): Promise<void> => {
    for (;;) {
      if (opts.isCancelled?.()) return
      const index = cursor++
      if (index >= items.length) return
      const item = items[index]
      try {
        const outcome = await worker(item)
        if (outcome === 'changed') summary.changed.push(opts.idOf(item))
        else summary.skipped.push(opts.idOf(item))
      } catch (err) {
        summary.failed.push({
          id: opts.idOf(item),
          label: opts.labelOf(item),
          error: err instanceof Error ? err.message : String(err),
        })
      }
      done += 1
      opts.onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, runOne))
  return summary
}
