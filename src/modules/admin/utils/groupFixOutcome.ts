// src/modules/admin/utils/groupFixOutcome.ts
//
// What a "Fix groups" run actually DID, read from the per-row result the two
// ClubDesk group tools report (clubdesk-scrape-groups.mjs = add,
// clubdesk-remove-group.mjs = remove).
//
// ⚠⚠ JUDGE A RUN BY ITS ROWS, NOT BY IT FINISHING (20.10.2026). Two previews and
// two commits in which all 17 rows came back `skip_filter_failed` were each shown
// as done: the commit was offered on a preview that could write nothing, and after
// it the dialog said "Done — 0 group allocations written to ClubDesk. Nothing else
// to do here." in green. The operator ran the whole sync path again. Everything
// the dialog decides — whether to offer the commit, which banner to show, whether
// the sync path's step 5 is complete — goes through this summary now.

/**
 * ⚠⚠ The per-row statuses that mean a tool DID what was asked:
 *   assigned  — add tool, commit (ClubDesk accepted the dialog's OK)
 *   previewed — either tool, preview (every step worked, cancelled at the end)
 *   removed   — remove tool, commit (chip gone, re-read, saved)
 * Everything else (skip_*, error) did not. The same set is spelled out once in each
 * of the other two layers — keep all three identical (a test compares them):
 *   directus/scripts/clubdesk-group-fix-outcome.sh                 → GRP_OK_STATUSES
 *   directus/extensions/kscw-endpoints/src/clubdesk-update.js      → GROUP_FIX_OK_STATUSES
 * (`preview_ok` used to be listed here too. No tool has ever reported it.)
 */
export const OK_STATUSES = new Set(['assigned', 'previewed', 'removed'])

export const isOkStatus = (s: string | undefined | null) => OK_STATUSES.has(s || '')

export interface ScrapeRow {
  name?: string
  group?: string
  funktion?: string
  group_label?: string
  status?: string
  detail?: string
}
export interface ScrapeSummary {
  mode?: string
  count?: number
  tally?: Record<string, number>
  results?: ScrapeRow[]
  /** The tool died before finishing its worklist (no grid column, login refused…). */
  fatal?: string
}
export interface GroupFixResult {
  mode?: string
  /**
   * Rows the endpoint cut out of a COMMIT because its preview skipped them
   * (planGroupFixCommit), copied in by the dispatcher. They were never in either
   * tool's worklist, so nothing else in the result mentions them (20.10.2026:
   * "12 of 12 written" in green with 5 allocations never made).
   */
  held_back?: number
  add: ScrapeSummary | null
  remove: ScrapeSummary | null
}

export type ResultRow = ScrapeRow & { kind: 'add' | 'remove' }

/** Pseudo-status for rows a tool was given but never reported (it died first). */
export const NOT_ATTEMPTED = 'not_attempted'
/** Pseudo-status for rows the server held back from a commit (the preview skipped them). */
export const HELD_BACK = 'held_back'

export interface GroupFixOutcome {
  /** Both tools' rows in one reviewable list, removals first (they run first). */
  rows: ResultRow[]
  /** Rows that did what was asked. */
  ok: number
  /** Rows reported with a non-OK status. */
  skipped: number
  /** Rows a tool was given but never reported, because it stopped early. */
  notAttempted: number
  /** Rows the server kept out of a commit because the preview skipped them. */
  heldBack: number
  /**
   * ⚠ THE one definition of "not written" (skipped + not attempted + held back).
   * The dialog's banner and the sync path's Done card both read this, so the two
   * can never disagree about the same run again.
   */
  notWritten: number
  /** Non-OK statuses, most frequent first; `not_attempted` included when > 0. */
  byStatus: { status: string; count: number }[]
  /** The most frequent reason nothing / not everything was written, or null. */
  dominant: string | null
  /** The tools' own fatal messages, joined. Raw English tool text. */
  fatal: string | null
}

export function summarizeGroupFixResult(result: GroupFixResult | null | undefined): GroupFixOutcome {
  const summaries = [
    ['remove', result?.remove ?? null] as const,
    ['add', result?.add ?? null] as const,
  ]
  const rows: ResultRow[] = []
  let notAttempted = 0
  const fatals: string[] = []
  for (const [kind, s] of summaries) {
    if (!s) continue
    const rs = Array.isArray(s.results) ? s.results : []
    for (const r of rs) rows.push({ ...r, kind })
    if (typeof s.count === 'number' && s.count > rs.length) notAttempted += s.count - rs.length
    if (s.fatal && s.fatal.trim()) fatals.push(s.fatal.trim())
  }
  const ok = rows.filter((r) => isOkStatus(r.status)).length
  const tally = new Map<string, number>()
  for (const r of rows) {
    if (isOkStatus(r.status)) continue
    const s = r.status || 'error'
    tally.set(s, (tally.get(s) || 0) + 1)
  }
  if (notAttempted > 0) tally.set(NOT_ATTEMPTED, notAttempted)
  const heldRaw = Number(result?.held_back)
  const heldBack = Number.isFinite(heldRaw) && heldRaw > 0 ? Math.floor(heldRaw) : 0
  if (heldBack > 0) tally.set(HELD_BACK, heldBack)
  const byStatus = [...tally.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status))
  const skipped = rows.length - ok
  return {
    rows,
    ok,
    skipped,
    notAttempted,
    heldBack,
    notWritten: skipped + notAttempted + heldBack,
    byStatus,
    dominant: byStatus[0]?.status ?? null,
    fatal: fatals.length ? fatals.join('; ') : null,
  }
}

/** Statuses with their own one-line explanation in the admin namespace. */
export const EXPLAINED_STATUSES = [
  'skip_filter_failed', 'skip_identity_unconfirmed', 'skip_not_in_group',
  'skip_ambiguous', 'skip_no_contact', 'skip_no_selection', 'skip_ok_disabled',
  'skip_group_not_found', 'skip_funktion_not_found', 'error', NOT_ATTEMPTED, HELD_BACK,
] as const

/** i18n key for a status's one-line explanation, or null for an unknown status. */
export function statusReasonKey(status: string): string | null {
  return (EXPLAINED_STATUSES as readonly string[]).includes(status) ? `cdFixReason_${status}` : null
}
