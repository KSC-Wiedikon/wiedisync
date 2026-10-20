/**
 * The ClubDesk sync path's step arithmetic — where the marker is, and where it
 * goes next — as a pure function the runner reads rather than re-derives.
 *
 * ⚠⚠ Extracted because the runner got it WRONG in a way nothing could see
 * (09.09.2026): the push was skipped on every run whose decide step was empty,
 * and the path still painted five green ticks and "Done". Two facts collided —
 *
 *   (a) a finished sync-down advances the marker ITSELF (`setStep('decide')`),
 *       so by the time its dialog offers "Next step" the marker is already on
 *       the step after the one you were looking at; and
 *   (b) `resolve` slides the marker forward over steps with nothing to do, so
 *       with no proposals to decide the marker reads 'up' — the push — the
 *       instant the down lands.
 *
 * The old "next" button advanced from the RESOLVED marker, i.e. from 'up', and
 * so opened step 4. The push it stepped over is the only thing on the path that
 * writes to the club's register, and its absence is invisible: step 4 is another
 * sync down, it succeeds, and the path ends green with six members still
 * unpushed. Two full runs on prod ended that way (5 unlinked creates + 1 flagged
 * update, still pending afterwards) before anyone asked why.
 *
 * So advancing is expressed as "what comes after the step I just FINISHED",
 * never "what comes after wherever the marker currently points".
 */
import { OK_STATUSES, summarizeGroupFixResult, type GroupFixResult } from './groupFixOutcome'

export type PathStep = 'down1' | 'decide' | 'up' | 'down2' | 'groups' | 'done'

export const STEPS: PathStep[] = ['down1', 'decide', 'up', 'down2', 'groups']

/** Live counts that decide whether a step has anything to do. */
export interface PathGates {
  /** Open proposals — step 2 cannot pass while this is non-zero. */
  pendingProposals: number
  /**
   * What the push would actually CARRY (`pending_push` off /clubdesk-needs-sync),
   * never the worklist row count — see the prop comment in ClubdeskSyncPath.
   */
  pendingPush: number
  /** Group findings the fix can act on. */
  fixable: number
  /**
   * A group-fix commit landed this session. ⚠ Step 5 cannot be gated on its
   * findings going away: they are read from the last sync down, so they survive
   * the very commit that fixes them.
   */
  groupsCommitted: boolean
  /**
   * A sync-up actually landed in this run.
   *
   * ⚠ This is what makes step 4 worth its two minutes. The second sync-down is
   * REQUIRED after a push — a CREATE only gets its ClubDesk [Id] read back there
   * — and is pure duplicated work after a run that pushed nothing: the export
   * step 1 loaded is still the current one, and the group checks read it. So a
   * run with nothing to push goes step 1 → step 5 rather than scraping ClubDesk
   * twice for the same answer.
   */
  pushed: boolean
}

/**
 * The three counts that come from the SERVER, as a step lands — what a refresh
 * can re-read. `groupsCommitted` and `pushed` are this run's own history and are
 * known only to the runner.
 *
 * ⚠⚠ The advance decision must be taken on these AS REFETCHED, never on the
 * props left over from before the step ran: the second sync-down is the very
 * job that creates the group findings step 5 acts on, so a path advancing on
 * pre-down counts reads `fixable: 0` and finishes green over work it never did.
 * That is the same "five ticks and Done over six unpushed members" the runner
 * showed on 09.09.2026, arrived at from the other end.
 */
export type GateCounts = Pick<PathGates, 'pendingProposals' | 'pendingPush' | 'fixable'>

/**
 * Slide the marker over steps with nothing to do.
 *
 * Chained on purpose so a run whose middle is empty still reaches the end:
 * decide with no proposals falls through to the push, a push with nothing queued
 * falls through to the second down, a second down with no push behind it falls
 * through to the group fix, and no group findings means done.
 *
 * ⚠ Deliberately NOT symmetrical: there is no rule sending 'done' back to 'up'
 * when a push is outstanding. Some rows are pending forever by design (/up
 * refuses a would-duplicate create), and a path that cannot be finished is the
 * bug step 5 already had.
 *
 * ⓘ The ONE backwards edge lives in `stepAfter`, not here: a finished second
 * sync-down that staged new decisions goes back to 'decide' (20.10.2026). That
 * is safe where 'done' → 'up' is not, because a pending proposal can ALWAYS be
 * cleared — accepted or refused, one click each — so that loop ends; a push row
 * can stay pending for reasons no click in the path removes. Kept out of
 * `resolveStep` on purpose: sliding over empty steps must stay forward-only, or
 * the marker could jump backwards on a mere count refresh.
 */
export function resolveStep(step: PathStep, g: PathGates): PathStep {
  let c = step
  if (c === 'decide' && g.pendingProposals === 0) c = 'up'
  if (c === 'up' && g.pendingPush === 0) c = 'down2'
  if (c === 'down2' && !g.pushed) c = 'groups'
  if (c === 'groups' && (g.fixable === 0 || g.groupsCommitted)) c = 'done'
  return c
}

/**
 * The step to open once `from` has been completed — resolved, so an empty next
 * step is stepped over rather than opened on an empty body.
 *
 * ⚠ `from` is the step whose dialog is calling, NOT the current marker. That
 * distinction IS the fix: they are the same only for the two steps that do not
 * advance the marker themselves.
 */
export function stepAfter(from: PathStep, g: PathGates): PathStep {
  // ⚠⚠ The read-back down is the step that FINDS decisions the first down could
  // not: members with a queued push are kept out of proposals until that push
  // lands, and a push is only read back here. Going on to the group fix over
  // them ended a run green with 7 email disagreements open (20.10.2026,
  // proposals #502–508) — the operator got a toast, then "Done", and had to
  // start the whole path again, ClubDesk scrape included, to reach them.
  if (from === 'down2' && g.pendingProposals > 0) return 'decide'
  const i = STEPS.indexOf(from)
  const next: PathStep = i < 0 || i + 1 >= STEPS.length ? 'done' : STEPS[i + 1]
  return resolveStep(next, g)
}

/**
 * How many times one run may go back from the read-back down to 'decide' before
 * the runner stops looping and hands the rest to the operator.
 *
 * ⓘ Should never be reached: a refusal queues a push, the push is read back, and
 * the read-back only stages something new when ClubDesk or wiedisync changed in
 * between. Three rounds of that in one sitting means something is editing one
 * side while the path runs, and another lap will not out-run it.
 */
export const MAX_READBACK_LOOPS = 3

/**
 * Row statuses the group scrapers report for a row that DID what was asked.
 * ONE set for the UI: `OK_STATUSES` in groupFixOutcome.ts, kept in step with the
 * dispatcher's `GRP_OK_STATUSES` and the endpoint's `GROUP_FIX_OK_STATUSES`
 * (a test fails if they drift). Re-exported, never re-spelled.
 */
export const GROUP_OK_STATUSES = OK_STATUSES

/**
 * The slice of GET /clubdesk-group-fix this module reads. Every field optional:
 * the row is shared with a dispatcher that may write `failed` WITH a result
 * (nothing writable), a result missing one of its two halves, or no result.
 */
export interface GroupFixOutcome {
  state?: string | null
  mode?: string | null
  result?: Partial<GroupFixResult> | null
}

/**
 * Group rows the last COMMIT did not write, read off its per-row result.
 *
 * ⚠⚠ Counted from the rows, never from the job finishing: on 20.10.2026 four
 * runs skipped 17 of 17 rows (`skip_filter_failed`) and each was saved as
 * "done", so a path that trusted the state ended green over a commit that wrote
 * nothing. `null` means "cannot tell" (not a commit, still running, or no rows
 * kept) — the caller then lists nothing rather than claiming zero.
 *
 * ⚠ Delegates to summarizeGroupFixResult's `notWritten` — skipped rows, rows a
 * tool was given but never reached (`count − results.length`), and rows the
 * server held back from the commit. This used to count only the reported non-OK
 * rows, so a commit whose add tool died after 3 of 17 — amber "3 written, 14 not
 * written" in the dialog — turned the path's Done card green.
 */
export function groupRowsNotWritten(s: GroupFixOutcome | null | undefined): number | null {
  if (!s || s.mode !== 'commit') return null
  if (s.state !== 'done' && s.state !== 'failed') return null
  const o = summarizeGroupFixResult({
    add: s.result?.add ?? null,
    remove: s.result?.remove ?? null,
    held_back: s.result?.held_back,
  })
  // A failed run that kept no rows says nothing about them; a finished one with
  // an empty worklist genuinely left nothing unwritten.
  if (!o.rows.length && !o.notWritten) return s.state === 'failed' ? null : 0
  return o.notWritten
}

/** What is still open at the end of a run — the "Done" card's three lines. */
export interface OutstandingWork {
  /** Proposals nobody has accepted or refused yet. */
  decisions: number
  /** Members the push would still carry (`pending_push`). */
  push: number
  /** Group rows the last commit did not write; 0 when unknown or not committed. */
  groups: number
}

/**
 * The end-of-run summary, from the live counts.
 *
 * ⚠ The marker reaching 'done' says the operator walked every step — not that
 * the two registers agree. A bare green "Done" over open work is what sent the
 * operator round a second time on 20.10.2026; the card is green only when
 * `nothingLeft` says so.
 */
export function outstandingWork(
  g: Pick<PathGates, 'pendingProposals' | 'pendingPush'>,
  groupsUnwritten: number | null,
): OutstandingWork {
  return {
    decisions: Math.max(0, g.pendingProposals || 0),
    push: Math.max(0, g.pendingPush || 0),
    groups: Math.max(0, groupsUnwritten ?? 0),
  }
}

export function nothingLeft(o: OutstandingWork): boolean {
  return o.decisions === 0 && o.push === 0 && o.groups === 0
}

/**
 * How many contacts the idle path card says are missing their ClubDesk group
 * (20.10.2026); 0 hides the hint.
 *
 * ⚠ `groupMissing` is the server's count off GET /clubdesk-member-sync, and
 * null there means NOT COUNTED (a job held the lock, the query failed, or the
 * backend predates the field) — it must never surface as a number. Hidden while
 * anything runs (the card shows that job instead) and after a group commit in
 * this session (the count reads the register as of the last sync down, so it
 * still holds what the commit just wrote).
 */
export function groupBacklogToShow(o: {
  idle: boolean
  groupsCommitted: boolean
  groupMissing: number | null
}): number {
  if (!o.idle || o.groupsCommitted || o.groupMissing == null) return 0
  return o.groupMissing > 0 ? o.groupMissing : 0
}
