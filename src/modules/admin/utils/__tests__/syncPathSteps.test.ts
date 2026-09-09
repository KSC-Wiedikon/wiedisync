import { describe, expect, it } from 'vitest'
import { resolveStep, stepAfter, type PathGates } from '../syncPathSteps'

/** Nothing pending anywhere — the shape every case starts from. */
const EMPTY: PathGates = {
  pendingProposals: 0, pendingPush: 0, fixable: 0, groupsCommitted: false, pushed: false,
}
const gates = (o: Partial<PathGates> = {}): PathGates => ({ ...EMPTY, ...o })

describe('resolveStep', () => {
  it('holds on decide while proposals are open', () => {
    expect(resolveStep('decide', gates({ pendingProposals: 3 }))).toBe('decide')
  })

  it('falls through an empty decide onto the push', () => {
    expect(resolveStep('decide', gates({ pendingPush: 6 }))).toBe('up')
  })

  // ⚠ 'down2' is NOT the answer here: nothing was pushed, so there is nothing to
  // read back and the export step 1 loaded is still current. The second down is
  // required after a push and is a duplicate ClubDesk scrape without one.
  it('falls through an empty decide, an empty push AND an unearned second down', () => {
    expect(resolveStep('decide', gates({ fixable: 9 }))).toBe('groups')
  })

  it('holds the second down once a push has landed behind it', () => {
    expect(resolveStep('down2', gates({ pushed: true }))).toBe('down2')
  })

  it('runs a path with nothing to do anywhere straight to done', () => {
    expect(resolveStep('decide', gates())).toBe('done')
  })

  it('ends the path when there are no group findings', () => {
    expect(resolveStep('groups', gates())).toBe('done')
  })

  it('ends the path once a group fix has been committed, findings or not', () => {
    expect(resolveStep('groups', gates({ fixable: 9, groupsCommitted: true }))).toBe('done')
  })
})

describe('stepAfter', () => {
  // ⚠ The regression this module exists for (09.09.2026): the first sync-down
  // advances the marker to 'decide' itself, and with no proposals `resolve`
  // reads that as 'up'. Advancing from the RESOLVED marker skipped the push
  // entirely and still finished green.
  it('sends a finished first down to the push, not past it', () => {
    expect(stepAfter('down1', gates({ pendingPush: 6 }))).toBe('up')
  })

  it('sends a finished decide to the push', () => {
    expect(stepAfter('decide', gates({ pendingPush: 1 }))).toBe('up')
  })

  it('steps over the push only when it would carry nothing', () => {
    expect(stepAfter('down1', gates({ fixable: 9 }))).toBe('groups')
    expect(stepAfter('decide', gates({ fixable: 9 }))).toBe('groups')
  })

  // ⚠ `pushed` is what earns step 4 here, not `pendingPush`: a landed push has
  // already cleared the queue, so reading the count alone would step over the
  // one sync-down that links the creates back.
  it('sends a finished push to the second down — a create only links back there', () => {
    expect(stepAfter('up', gates({ pushed: true }))).toBe('down2')
  })

  // Same defect, other end of the path: the second down advances the marker to
  // 'groups', so advancing from the marker again finished the path with the
  // group fix unrun.
  it('sends a finished second down to the group fix when there is something to fix', () => {
    expect(stepAfter('down2', gates({ pushed: true, fixable: 9 }))).toBe('groups')
  })

  it('finishes after the second down when there is nothing to fix', () => {
    expect(stepAfter('down2', gates({ pushed: true }))).toBe('done')
  })

  it('finishes after the group fix', () => {
    expect(stepAfter('groups', gates({ fixable: 9 }))).toBe('done')
  })
})
