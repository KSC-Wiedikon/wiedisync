import { describe, expect, it } from 'vitest'
import {
  groupBacklogToShow, groupRowsNotWritten, nothingLeft, outstandingWork, resolveStep, stepAfter,
  type PathGates,
} from '../syncPathSteps'

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

  // ⚠ 20.10.2026: the read-back down staged 7 email disagreements and the path
  // went on to the group fix and "Done" over them — reaching them took a whole
  // second run. New decisions after the push send the path back to decide.
  it('goes back to decide when the second down staged new decisions', () => {
    expect(stepAfter('down2', gates({ pushed: true, pendingProposals: 7, fixable: 9 }))).toBe('decide')
    expect(stepAfter('down2', gates({ pushed: true, pendingProposals: 1 }))).toBe('decide')
  })

  it('goes on to the group fix or done when the second down staged nothing', () => {
    expect(stepAfter('down2', gates({ pushed: true, fixable: 9 }))).toBe('groups')
    expect(stepAfter('down2', gates({ pushed: true }))).toBe('done')
  })

  // The backwards edge belongs to the read-back only: proposals open after the
  // FIRST down are the ordinary decide step, and nothing else turns back.
  it('only the second down turns back', () => {
    expect(stepAfter('down1', gates({ pendingProposals: 2 }))).toBe('decide')
    expect(stepAfter('up', gates({ pushed: true, pendingProposals: 2 }))).toBe('down2')
    expect(stepAfter('groups', gates({ pendingProposals: 2 }))).toBe('done')
  })

  // After the loop: the runner clears `pushed`, so a decide that only ACCEPTS
  // (nothing queued) steps over the push and an unearned read-back alike.
  it('a looped decide that queued nothing goes straight on to the group fix', () => {
    expect(stepAfter('decide', gates({ fixable: 17 }))).toBe('groups')
  })

  it('a looped decide that refused something goes back through the push', () => {
    expect(stepAfter('decide', gates({ pendingPush: 7, fixable: 17 }))).toBe('up')
  })
})

describe('groupRowsNotWritten', () => {
  const rows = (...statuses: string[]) => ({ results: statuses.map((status) => ({ status })) })

  // ⚠ The 20.10.2026 shape: saved as `done`, 17 of 17 skipped.
  it('counts every skipped row of a "done" commit that wrote nothing', () => {
    const skipped = Array.from({ length: 16 }, () => 'skip_filter_failed')
    expect(groupRowsNotWritten({
      state: 'done', mode: 'commit',
      result: { add: rows(...skipped), remove: rows('skip_filter_failed') },
    })).toBe(17)
  })

  it('counts only the rows that did not go through on a partial commit', () => {
    expect(groupRowsNotWritten({
      state: 'done', mode: 'commit',
      result: { add: rows('assigned', 'assigned', 'skip_filter_failed'), remove: rows('removed') },
    })).toBe(1)
  })

  it('reads a failed commit that kept its rows', () => {
    expect(groupRowsNotWritten({
      state: 'failed', mode: 'commit', result: { add: rows('skip_filter_failed', 'skip_no_group') },
    })).toBe(2)
  })

  it('is zero for a commit that wrote every row', () => {
    expect(groupRowsNotWritten({
      state: 'done', mode: 'commit', result: { add: rows('assigned'), remove: rows('removed') },
    })).toBe(0)
  })

  it('cannot tell for a preview, a run in flight, a missing row or a failure with no rows', () => {
    expect(groupRowsNotWritten({ state: 'done', mode: 'preview', result: { add: rows('previewed') } })).toBeNull()
    expect(groupRowsNotWritten({ state: 'running', mode: 'commit', result: null })).toBeNull()
    expect(groupRowsNotWritten({ state: 'failed', mode: 'commit', result: null })).toBeNull()
    expect(groupRowsNotWritten(null)).toBeNull()
  })

  // ⚠ The dialog's banner and the path's Done card read the same definition now.
  it('counts rows a tool was given but never reached', () => {
    // add tool died after 5 of 16; 1 remove written → dialog: 6 written, 11 not.
    expect(groupRowsNotWritten({
      state: 'done', mode: 'commit',
      result: {
        add: { count: 16, results: Array.from({ length: 5 }, () => ({ status: 'assigned' })), fatal: 'died' },
        remove: { count: 1, results: [{ status: 'removed' }] },
      },
    })).toBe(11)
    // a tool that printed nothing — the dispatcher's stand-in summary
    expect(groupRowsNotWritten({
      state: 'done', mode: 'commit',
      result: {
        add: { count: 16, results: [], fatal: 'add tool produced no output — see group-fix.log' },
        remove: { count: 1, results: [{ status: 'removed' }] },
      },
    })).toBe(16)
  })

  it('counts rows the server held back from the commit (skipped in the preview)', () => {
    // 12 written of a 12-row commit, 5 held back → not "nothing left".
    expect(groupRowsNotWritten({
      state: 'done', mode: 'commit',
      result: { held_back: 5, add: rows(...Array.from({ length: 12 }, () => 'assigned')), remove: null },
    })).toBe(5)
  })

  it('survives a half that is missing or not an array', () => {
    expect(groupRowsNotWritten({
      state: 'done', mode: 'commit',
      // Deliberately malformed, as a dispatcher mid-change could write it.
      result: { add: { results: 'nope' as unknown as [] }, remove: null },
    })).toBe(0)
  })
})

describe('outstandingWork', () => {
  it('is clear only when all three are zero', () => {
    expect(nothingLeft(outstandingWork({ pendingProposals: 0, pendingPush: 0 }, 0))).toBe(true)
    expect(nothingLeft(outstandingWork({ pendingProposals: 0, pendingPush: 0 }, null))).toBe(true)
    expect(nothingLeft(outstandingWork({ pendingProposals: 7, pendingPush: 0 }, 0))).toBe(false)
    expect(nothingLeft(outstandingWork({ pendingProposals: 0, pendingPush: 1 }, 0))).toBe(false)
    expect(nothingLeft(outstandingWork({ pendingProposals: 0, pendingPush: 0 }, 17))).toBe(false)
  })

  it('lists each count as given', () => {
    expect(outstandingWork({ pendingProposals: 7, pendingPush: 1 }, 17))
      .toEqual({ decisions: 7, push: 1, groups: 17 })
  })
})

describe('groupBacklogToShow', () => {
  const idle = { idle: true, groupsCommitted: false }

  it('shows the server count while the path is idle', () => {
    expect(groupBacklogToShow({ ...idle, groupMissing: 16 })).toBe(16)
  })

  // ⚠ null is "not counted" — busy, failed, or an older backend. Rendering it as
  // a number (or as 0 = "all good") would be the silence this hint exists to end.
  it('hides an uncounted backlog', () => {
    expect(groupBacklogToShow({ ...idle, groupMissing: null })).toBe(0)
  })

  it('hides while a job runs or a dialog is open', () => {
    expect(groupBacklogToShow({ idle: false, groupsCommitted: false, groupMissing: 16 })).toBe(0)
  })

  it('hides after a group commit, whose effect the count cannot see yet', () => {
    expect(groupBacklogToShow({ idle: true, groupsCommitted: true, groupMissing: 16 })).toBe(0)
  })

  it('has nothing to say about an empty backlog', () => {
    expect(groupBacklogToShow({ ...idle, groupMissing: 0 })).toBe(0)
  })
})
