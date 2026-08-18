/**
 * What a `TableMode` renders — the SINGLE source `TransferGroupTable`,
 * `TransferRow` and `TransferRowDetail` all read, so a header list and a body
 * row can never disagree about how many cells exist.
 *
 * Pure: no React, no i18n. It answers "which columns", never "what do they say".
 */

import type { TableColumns, TableMode } from '../types'

/**
 * `mode` decides what a group IS, and everything else follows from it:
 *
 *  - `needs`   — the actionable worklist. Licence validation, VIS presence,
 *                the transfer status toggle, the federation contact and the
 *                one consolidated letter.
 *  - `clarify` — grouped by NATIONALITY, not by a federation answer. No status
 *                (there is no transfer to have one about — the note is where
 *                "asked on …" goes), no VIS (never checked), and no federation
 *                bar: a nationality must not be addressed as though it were a
 *                federation-of-origin answer.
 *  - `swiss`   — Swiss Volley's own players. VIS presence, the Swiss Volley
 *                contact, the status control (every row deriving "not needed"
 *                until somebody says otherwise), and COLLAPSED.
 *  - `notNeeded` — taken off the worklist by an override. Reads exactly like
 *                `needs`, including the licence cross-check, so the decision
 *                can be re-checked against the same evidence that informed it.
 *                Collapsed: it is a record, not a queue.
 *
 * ⚠ `note: false` for `swiss` is a DELIBERATE CHANGE from the original, which
 * gave every mode a note column. The note moves into the row detail there, so
 * the ~483 controlled text inputs of the Swiss cohort are never mounted even
 * when the group is expanded. Nothing is lost — the same input, saving the same
 * way, is one tap away.
 *
 * ⚠ The licence cross-check stays off the Swiss reference list: its two
 * call-outs ("not eligible", "probably done") are both about a transfer, and it
 * would add a column to 483 rows that have none.
 */
export function columnsForMode(mode: TableMode): TableColumns {
  switch (mode) {
    case 'needs':
      return { licence: true, vis: true, status: true, note: true, collapsible: false }
    case 'clarify':
      return { licence: false, vis: false, status: false, note: true, collapsible: false }
    case 'swiss':
      return { licence: false, vis: true, status: true, note: false, collapsible: true }
    case 'notNeeded':
      return { licence: true, vis: true, status: true, note: true, collapsible: true }
  }
}

/**
 * How many `<TableHead>`s a mode emits — the `colSpan` the detail row must span
 * to sit under the whole table.
 *
 * ⚠ Keep this in step with the header list in `TransferGroupTable` and the cell
 * list in `TransferRow`. The order both render, and the rule for each:
 *
 *   1. State     — every mode EXCEPT `clarify`: those rows have no federation
 *                  answer yet, so there is no derived state to label.
 *   2. Member    — always.
 *   3. Evidence  — always (`hidden sm:table-cell`). In `clarify` it carries the
 *                  nationality flags alone, which IS that cohort's evidence and
 *                  its grouping key; elsewhere the in-VIS and licence pills join
 *                  them.
 *   4. Status    — when `columns.status`. In `notNeeded` the same slot holds
 *                  "Ruled out by" + `Reopen` instead of the three toggles.
 *   5. Note      — when `columns.note` (`hidden lg:table-cell`).
 *   6. Details   — always; an `sr-only` head over the 44x44 disclosure button.
 *                  It is not optional: below `sm` the Evidence cell is hidden
 *                  and below `lg` the note is too, so on a phone the detail row
 *                  is the ONLY place several of these facts exist.
 */
export function visibleColumnCount(mode: TableMode): number {
  const columns = columnsForMode(mode)
  const state = mode === 'clarify' ? 0 : 1
  const evidence = 1
  const member = 1
  const details = 1
  return state + member + evidence + (columns.status ? 1 : 0) + (columns.note ? 1 : 0) + details
}

/** The group header strip. `min-h-[44px]` because the whole strip is the
 *  collapse target on a touch screen. */
export const GROUP_HEADER_CLASS = 'flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5'
