/**
 * Everything the page derives from `vis_transfers` — FIVB's own answer to the
 * question `/admin/transfers` is about.
 *
 * Pure: no React, no i18n, no data fetching. `visPhaseI18nKey()` returns a KEY
 * so the caller translates; nothing here produces user-facing text.
 *
 * ⚠⚠ Every numeric read goes through `Number()`. `fetchItems` pipes results
 * through `stringifyIds` (src/lib/api.ts), so these columns arrive as STRINGS:
 * `percent_complete === 100` is false for a completed transfer and `'60' > '100'`
 * is TRUE, which picks the LEAST advanced row. Both were live bugs. The types in
 * `../types` are deliberately `number | string` so the next reader cannot skip it.
 */

import { VIS_DEAD_STATUS, VIS_ENDED_STATUS, VIS_PHASE_KEY } from '../constants'
import type { VisTransfer, VisTransferState } from '../types'

/**
 * Where a transfer row sits, derived from its status code and percentage —
 * never read off `status_label`.
 *
 * ⚠⚠ MIRRORS `directus/scripts/vis-transfer-sync.mjs` (`visStateOf`), whose
 * status sets live next to ours in `../constants`. The script decides what to
 * WRITE and this decides what to SHOW — if they drift, the page contradicts the
 * column it is rendering. Change both in the same commit.
 *
 * "Complete" is 100% OR an ended code, not "ended" alone: an ITC finishes its
 * tasks weeks before VIS moves the row to 200, which only happens once the
 * season starts.
 */
export function visTransferState(t: VisTransfer): VisTransferState {
  if (VIS_DEAD_STATUS.has(Number(t.status_code))) return 'dead'
  if (Number(t.percent_complete) === 100 || VIS_ENDED_STATUS.has(Number(t.status_code))) return 'complete'
  return 'in_progress'
}

/**
 * The season the club is working NOW, taken as the highest one staged.
 *
 * ⚠ The sync stages the current season AND the one before it, so a straight
 * "all rows for this player" lookup would let LAST season's completed ITC
 * describe this season's. Ivo Teixeira is exactly that case on prod today:
 * 2025/26 ended at 100%, 2026/27 at 20%. Reading the max rather than encoding
 * a number keeps this in step with the script, which derives it from VIS.
 */
export function latestVisSeason(rows: readonly VisTransfer[] | undefined): number | null {
  let max: number | null = null
  for (const t of rows ?? []) {
    const n = Number(t.season_no)
    if (Number.isFinite(n) && (max === null || n > max)) max = n
  }
  return max
}

/**
 * VIS player number → this season's transfers. Matching to a member is by
 * player number ONLY, `vis_player_no_manual` ahead of `vis_player_no` — the
 * same rule the sync writes by, and for the same reason: a name collision
 * here would attribute a transfer to the wrong person's eligibility.
 */
export function indexVisTransfersByPlayer(
  rows: readonly VisTransfer[] | undefined,
  season: number | null,
): Map<number, VisTransfer[]> {
  const map = new Map<number, VisTransfer[]>()
  for (const t of rows ?? []) {
    if (t.player_no == null || t.deleted_at) continue
    if (season !== null && Number(t.season_no) !== season) continue
    const list = map.get(Number(t.player_no))
    if (list) list.push(t)
    else map.set(Number(t.player_no), [t])
  }
  return map
}

/**
 * The one transfer worth showing for a member: the most advanced live row,
 * falling back to a cancelled/refused one when that is all there is — a
 * refusal is the answer to "why has nothing happened", so hiding it would
 * leave the row looking untouched.
 *
 * ⚠ The `Number()` in the reduce is load-bearing, not defensive: these values
 * are strings at runtime and `'60' > '100'` is true.
 */
export function pickVisTransfer(rows: readonly VisTransfer[] | undefined): VisTransfer | null {
  if (!rows?.length) return null
  const live = rows.filter((t) => visTransferState(t) !== 'dead')
  if (!live.length) return rows[0]
  return live.find((t) => visTransferState(t) === 'complete')
    ?? live.reduce((a, b) => (Number(b.percent_complete ?? 0) > Number(a.percent_complete ?? 0) ? b : a))
}

/**
 * i18n key for the VIS phase name, or `null` when no phase should be printed.
 *
 * ⚠ `status_label` is the sync's own English string ('in progress',
 * 'submitted'). Rendering it raw would print lowercase English into all five
 * locales — CLAUDE.md's capitalisation rule covers values that come straight
 * out of Postgres too. Translated off the CODE instead; an unmapped code
 * shows nothing rather than inventing a phase.
 *
 * ⚠ A finished ITC sits at code 130 ("in progress") with 100% of its tasks
 * done, and only becomes 200 ("ended") once the season starts. Printing VIS's
 * literal phase there gives "Transfer complete · In progress", which reads as
 * a contradiction and invites somebody to re-open a settled case. So the phase
 * is shown only when it AGREES with the badge: while genuinely in progress, or
 * once VIS itself says ended. The start date carries the rest.
 */
export function visPhaseI18nKey(t: VisTransfer, state: VisTransferState): string | null {
  const code = Number(t.status_code)
  if (state !== 'in_progress' && !VIS_ENDED_STATUS.has(code)) return null
  return VIS_PHASE_KEY[code] ?? null
}

/**
 * The one way to read a VIS player number off a `members` row.
 *
 * ⚠⚠ `vis_player_no` / `vis_player_no_manual` are NOT in `KEEP_AS_NUMBER`
 * (src/lib/api.ts), so they arrive as STRINGS. Comparing one bare against a
 * `Number()` result is never equal: `linkVisPlayer`'s no-op guard did exactly
 * that, so re-saving an unchanged link always wrote — replacing the sweep's
 * green "VIS: MUELLER, Anna" confirmation with the amber "unconfirmed" warning
 * while toasting success and writing a revision. Both the guard and the
 * transfers-by-player lookup go through here.
 *
 * A blank, non-numeric or non-positive value is `null`: VIS player numbers are
 * positive integers and a 0 would silently index the map at key 0.
 */
export function normaliseVisPlayerNo(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}
