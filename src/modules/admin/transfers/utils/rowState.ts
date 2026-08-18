/**
 * The derived `State` column of `/admin/transfers`, plus the search and filter
 * helpers the toolbar drives.
 *
 * Pure: no React, no i18n. Everything user-facing leaves here as an i18n KEY,
 * so the label on the chip, the label in the `State` column and the label of a
 * "group by state" heading can never drift apart — they are the same key.
 *
 * ⚠⚠ `rowStateOf` produces a LABEL over four authorities, never a merge of
 * them and never a boolean. The four facts are deliberately different questions:
 * `members.in_vis` is presence in a federation's player index,
 * `members.licence_validated` is Swiss Volley's downstream confirmation,
 * `members.transfer_status` is what the club decided, and the `vis_transfers`
 * row is FIVB itself saying whether the ITC exists. Conflating them is exactly
 * how a stale toggle hides an incomplete transfer, so all four stay separately
 * readable in the Evidence column and the row detail — this label only decides
 * which of them to say FIRST.
 */

import type { TransferMember, ValidationState, VisTransfer } from '../types'
import { visTransferState } from './visTransfer'

/**
 * The one-word answer to "where is this person". Derived per row; nothing is
 * stored under any of these names.
 *
 *  - `canRequest`         — in the VIS index, nothing open yet: file the request.
 *  - `waitingFederation`  — not found in VIS (or never checked). The prepared
 *                           letter asks the federation about them.
 *  - `inProgress`         — FIVB reports an open transfer.
 *  - `chasing`            — somebody marked it pending and nothing else is known.
 *  - `awaitingConfirmation` — Swiss Volley validated the licence while the row
 *                           still says pending.
 *  - `done`               — marked done AND validated.
 *  - `blocked`            — marked done, NOT validated: not eligible to play.
 *  - `ruledOut`           — taken off the worklist by hand.
 */
export type RowState =
  | 'ruledOut'
  | 'blocked'
  | 'done'
  | 'awaitingConfirmation'
  | 'inProgress'
  | 'chasing'
  | 'canRequest'
  | 'waitingFederation'

/**
 * Chip order in the numbers bar: the work to do first, then the work in flight,
 * then the outcomes. `ruledOut` is last and is zero on the worklist by
 * construction (`bucketOf` moves those rows to the `notNeeded` cohort) — it is
 * in the list because the same labels are reused by the "Ruled out" tab.
 */
export const ROW_STATE_ORDER: readonly RowState[] = [
  'canRequest',
  'waitingFederation',
  'inProgress',
  'chasing',
  'awaitingConfirmation',
  'done',
  'blocked',
  'ruledOut',
]

/** One label key per state. `trStateInProgress` carries a `{{percent}}`
 *  interpolation — pass `visTransferPercent()` into it. */
export const ROW_STATE_LABEL_KEY: Record<RowState, string> = {
  canRequest: 'trStateCanRequest',
  waitingFederation: 'trStateWaitingFederation',
  inProgress: 'trStateInProgress',
  chasing: 'trStateChasing',
  awaitingConfirmation: 'trStateAwaitingConfirmation',
  done: 'trStateDone',
  blocked: 'trStateBlocked',
  ruledOut: 'trStateRuledOut',
}

/**
 * The sentence behind each label, shown in the `HintPopover` on the chip and in
 * the row detail.
 *
 * ⚠ Every one of these is worded as EVIDENCE, not a verdict — "no player of
 * this name was found in the VIS index" and never "does not exist". The check
 * matches on a normalised name against a `federation_of_origin` that was seeded
 * from nationality for most members, so the label is a lead, not a finding.
 */
export const ROW_STATE_HINT_KEY: Record<RowState, string> = {
  canRequest: 'trStateCanRequestHint',
  waitingFederation: 'trStateWaitingFederationHint',
  inProgress: 'trStateInProgressHint',
  chasing: 'trStateChasingHint',
  awaitingConfirmation: 'trStateAwaitingConfirmationHint',
  done: 'trStateDoneHint',
  blocked: 'trStateBlockedHint',
  ruledOut: 'trStateRuledOutHint',
}

/**
 * Badge colour per state. `blocked` is the only `danger`: it is the one state
 * that means a player may not be fielded (FIVB Disciplinary Regulations
 * Art. 11.4). `ruledOut` is `neutral` and deliberately not green — a conclusion
 * must not look like evidence.
 */
export const ROW_STATE_BADGE_VARIANT: Record<
  RowState,
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  canRequest: 'warning',
  waitingFederation: 'warning',
  inProgress: 'info',
  chasing: 'warning',
  awaitingConfirmation: 'info',
  done: 'success',
  blocked: 'danger',
  ruledOut: 'neutral',
}

/**
 * The label for one row.
 *
 * The order of these branches is the whole rule: a STORED decision always
 * outranks a derivation. `transfer_status` is what a person concluded — an
 * explicit 'not_needed' is the way to clear somebody off the worklist WITHOUT
 * falsifying `federation_of_origin`, and a 'pending' is somebody saying they are
 * chasing it even where the derivation says otherwise. So VIS is consulted only
 * where nothing was stored, or where what was stored leaves the question open
 * ('pending' + an open ITC = in progress).
 *
 * ⚠ A completed VIS transfer NEVER promotes a row to 'done' on its own. 'done'
 * means the certificate landed and Swiss Volley validated the licence; VIS
 * reporting 100% is FIVB's side of that and arrives first. Letting it write the
 * label would say "done" about a player who is not yet eligible — which is the
 * exact failure `blocked` exists to make visible.
 */
export function rowStateOf(
  m: TransferMember,
  visTransfer: VisTransfer | null,
  validation: ValidationState,
): RowState {
  const status = m.transfer_status ?? null
  if (status === 'not_needed') return 'ruledOut'
  if (status === 'done' && validation !== 'validated') return 'blocked'
  if (status === 'done') return 'done'
  if (status === 'pending' && validation === 'validated') return 'awaitingConfirmation'
  if (status === 'pending') {
    return visTransfer && visTransferState(visTransfer) === 'in_progress' ? 'inProgress' : 'chasing'
  }
  // Nothing stored: the page derives, and says so with the pill in the status
  // cell. An empty control reads as "not done yet" whichever way the derivation
  // actually went, so the label has to carry the answer.
  if (visTransfer && visTransferState(visTransfer) === 'in_progress') return 'inProgress'
  if (m.in_vis === true) return 'canRequest'
  return 'waitingFederation'
}

/**
 * "Ruled out here, but FIVB has a live transfer."
 *
 * The nightly `vis-transfer-sync.mjs` writes `transfer_status` from VIS rows —
 * except 'not_needed', which it refuses to touch by design, because that is the
 * one way to overrule VIS permanently. So this is the ONLY disagreement that can
 * persist, and it has to be visible or it is invisible forever: it renders as a
 * second badge BESIDE the `Ruled out` state, never instead of it, and is not
 * dismissible.
 */
export function isDisputed(m: TransferMember, visTransfer: VisTransfer | null): boolean {
  return m.transfer_status === 'not_needed'
    && !!visTransfer
    && visTransferState(visTransfer) !== 'dead'
}

/**
 * VIS's own progress figure for the `inProgress` label and the progress bar.
 *
 * ⚠ `Number()` is load-bearing, not defensive: `percent_complete` arrives as a
 * STRING (`fetchItems` → `stringifyIds`, src/lib/api.ts), so the raw value would
 * interpolate fine but compare and sort wrong everywhere else.
 */
export function visTransferPercent(visTransfer: VisTransfer | null): number {
  if (!visTransfer) return 0
  const n = Number(visTransfer.percent_complete ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * How many rows sit in each state. Every state is present with a 0 so the chip
 * row has a stable shape, and the totals sum to `rows.length` exactly —
 * `rowStateOf` is total, so no row can fall out of the numbers bar unnoticed.
 */
export function countByState(
  rows: readonly TransferMember[],
  stateOf: (m: TransferMember) => RowState,
): Record<RowState, number> {
  const counts = Object.fromEntries(ROW_STATE_ORDER.map((s) => [s, 0])) as Record<RowState, number>
  for (const m of rows) counts[stateOf(m)] += 1
  return counts
}

/**
 * Lowercase substring match over the identifiers an admin actually has in front
 * of them: the name off a match sheet, the licence number out of Volleymanager,
 * and the VIS player number they just pasted into the VIS search (VIS has no
 * per-player URL, so that number is how a person is found there at all).
 *
 * ⚠ `vis_player_no` / `vis_player_no_manual` are `number | string` at runtime —
 * `String()` before joining, never a bare template of the raw value.
 */
export function matchesSearch(m: TransferMember, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    m.last_name,
    m.first_name,
    m.nickname,
    m.email,
    m.license_nr,
    m.vis_player_no,
    m.vis_player_no_manual,
  ]
    .map((v) => (v === null || v === undefined ? '' : String(v)))
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

/**
 * Search + state filter over any cohort.
 *
 * ⚠ Deliberately MODE-AGNOSTIC and pure: the Worklist, the "Ruled out" tab and
 * the 483-row Swiss reference list all render the same search box through this
 * one function, because "is this person in there?" is a real question against
 * all three. The state chips are a worklist-only control, so `state: null` is
 * the normal call from the other two tabs.
 *
 * `stateOf` is injected rather than computed here: the page memoises it over the
 * VIS-transfer index and the Volleymanager cross-check, and recomputing that per
 * keystroke would re-derive both for every row.
 */
export function applyWorklistFilters(
  rows: readonly TransferMember[],
  filters: { search: string; state: RowState | null },
  stateOf: (m: TransferMember) => RowState,
): TransferMember[] {
  const q = filters.search.trim().toLowerCase()
  const state = filters.state
  if (!q && !state) return [...rows]
  return rows.filter((m) => (!state || stateOf(m) === state) && matchesSearch(m, q))
}
