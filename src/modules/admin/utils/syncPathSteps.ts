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
  const i = STEPS.indexOf(from)
  const next: PathStep = i < 0 || i + 1 >= STEPS.length ? 'done' : STEPS[i + 1]
  return resolveStep(next, g)
}
