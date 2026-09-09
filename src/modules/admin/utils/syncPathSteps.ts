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
}

/**
 * Slide the marker over steps with nothing to do.
 *
 * Chained on purpose so a run whose middle is empty still reaches the end:
 * decide with no proposals falls through to the push, a push with nothing queued
 * falls through to the second down, and no group findings means done.
 *
 * ⚠ Deliberately NOT symmetrical: there is no rule sending 'done' back to 'up'
 * when a push is outstanding. Some rows are pending forever by design (/up
 * refuses a would-duplicate create), and a path that cannot be finished is the
 * bug step 5 already had.
 */
export function resolveStep(step: PathStep, g: PathGates): PathStep {
  let c = step
  if (c === 'decide' && g.pendingProposals === 0) c = 'up'
  if (c === 'up' && g.pendingPush === 0) c = 'down2'
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
  const i = STEPS.indexOf(from)
  const next: PathStep = i < 0 || i + 1 >= STEPS.length ? 'done' : STEPS[i + 1]
  return resolveStep(next, g)
}
