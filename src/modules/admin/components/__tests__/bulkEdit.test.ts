// The value logic behind the Data Explorer's multi-member edit.
//
// This is the part of bulk editing that can be wrong quietly: a no-op write is
// indistinguishable from a real one in the UI but is a false line in the club's
// audit trail (and, for a register column, a ClubDesk push flag carrying
// nothing), and an `add` that silently replaces the list wipes roles nobody
// asked it to touch. Both are pinned here.

import { describe, it, expect } from 'vitest'
import {
  computeMemberPatch, computeRosterDelta, parseStringList, runBulk, valuesEqual,
} from '../bulkEdit'
import { TEAMS_VIRTUAL_KEY } from '../memberFieldSchema'

describe('parseStringList', () => {
  it('reads an array, a JSON string and a bare legacy string', () => {
    expect(parseStringList(['user', 'admin'])).toEqual(['user', 'admin'])
    expect(parseStringList('["user","admin"]')).toEqual(['user', 'admin'])
    expect(parseStringList('user')).toEqual(['user'])
  })

  it('is empty for null, blank and malformed JSON', () => {
    expect(parseStringList(null)).toEqual([])
    expect(parseStringList('')).toEqual([])
    expect(parseStringList('[not json')).toEqual([])
    expect(parseStringList(42)).toEqual([])
  })
})

describe('valuesEqual', () => {
  it('treats empty string and null as the same emptiness', () => {
    // A `clear` composes to null. Without this rule every member holding '' —
    // which is most of them for a text column — takes a pointless write.
    expect(valuesEqual('', null)).toBe(true)
    expect(valuesEqual(null, undefined)).toBe(true)
  })

  it('compares arrays and objects by content', () => {
    expect(valuesEqual(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(valuesEqual(['a', 'b'], ['b', 'a'])).toBe(false)
  })

  it('does not conflate 0 or false with empty', () => {
    expect(valuesEqual(0, null)).toBe(false)
    expect(valuesEqual(false, null)).toBe(false)
  })
})

describe('computeMemberPatch', () => {
  it('omits a key the member already holds', () => {
    const patch = computeMemberPatch(
      { language: 'german', plz: '8003' },
      [{ key: 'language', mode: 'set', value: 'german' }],
    )
    expect(patch).toEqual({})
  })

  it('includes only the keys that actually change', () => {
    const patch = computeMemberPatch(
      { language: 'german', plz: '8003' },
      [
        { key: 'language', mode: 'set', value: 'german' },
        { key: 'plz', mode: 'set', value: '8004' },
      ],
    )
    expect(patch).toEqual({ plz: '8004' })
  })

  it('clears to null, and skips a member who is already empty', () => {
    expect(computeMemberPatch({ ort: 'Zürich' }, [{ key: 'ort', mode: 'clear', value: null }]))
      .toEqual({ ort: null })
    expect(computeMemberPatch({ ort: '' }, [{ key: 'ort', mode: 'clear', value: null }]))
      .toEqual({})
  })

  it('writes an empty text value as null, never as an empty string', () => {
    expect(computeMemberPatch({ ort: 'Zürich' }, [{ key: 'ort', mode: 'set', value: '' }]))
      .toEqual({ ort: null })
  })

  it('adds to each member’s OWN list instead of replacing it', () => {
    // The bug this exists to prevent: bulk "add the finance role" arriving as a
    // set and stripping every other role these members held.
    expect(computeMemberPatch(
      { role: ['user', 'vorstand'] },
      [{ key: 'role', mode: 'add', value: ['finance'] }],
    )).toEqual({ role: ['user', 'vorstand', 'finance'] })

    expect(computeMemberPatch(
      { role: ['user'] },
      [{ key: 'role', mode: 'add', value: ['finance'] }],
    )).toEqual({ role: ['user', 'finance'] })
  })

  it('skips a member who already has the added value', () => {
    expect(computeMemberPatch(
      { role: ['user', 'finance'] },
      [{ key: 'role', mode: 'add', value: ['finance'] }],
    )).toEqual({})
  })

  it('removes only what is there, keeping order', () => {
    expect(computeMemberPatch(
      { role: ['user', 'vorstand', 'finance'] },
      [{ key: 'role', mode: 'remove', value: ['vorstand'] }],
    )).toEqual({ role: ['user', 'finance'] })

    expect(computeMemberPatch(
      { role: ['user'] },
      [{ key: 'role', mode: 'remove', value: ['vorstand'] }],
    )).toEqual({})
  })

  it('reads a jsonb list that arrived as its JSON text', () => {
    expect(computeMemberPatch(
      { role: '["user"]' },
      [{ key: 'role', mode: 'add', value: ['finance'] }],
    )).toEqual({ role: ['user', 'finance'] })
  })

  it('never puts the roster virtual key in a PATCH body', () => {
    // It writes member_teams junction rows. In a `members` PATCH it would be a
    // relational write, which Directus would try to reconcile from whatever it
    // found there.
    expect(computeMemberPatch({}, [{ key: TEAMS_VIRTUAL_KEY, mode: 'add', value: ['3'] }]))
      .toEqual({})
  })

  it('treats a column missing from the record as unknown, not as empty', () => {
    // The explorer cache carries ~60 of the 111 columns, so this is the shape a
    // preview built from the cache would see. Conservative on purpose: the
    // member is reported as changing rather than silently skipped.
    expect(computeMemberPatch({}, [{ key: 'never_dun', mode: 'set', value: true }]))
      .toEqual({ never_dun: true })
  })
})

describe('computeRosterDelta', () => {
  it('adds only the teams the member is not already on', () => {
    expect(computeRosterDelta(['3', '9'], { key: TEAMS_VIRTUAL_KEY, mode: 'add', value: ['9', '12'] }))
      .toEqual({ add: ['12'], remove: [] })
  })

  it('removes only the teams the member actually holds', () => {
    expect(computeRosterDelta(['3', '9'], { key: TEAMS_VIRTUAL_KEY, mode: 'remove', value: ['9', '12'] }))
      .toEqual({ add: [], remove: ['9'] })
  })

  it('is a no-op when the member already matches', () => {
    expect(computeRosterDelta(['3'], { key: TEAMS_VIRTUAL_KEY, mode: 'add', value: ['3'] }))
      .toEqual({ add: [], remove: [] })
  })

  it('compares ids as strings, so a numeric team id still matches', () => {
    expect(computeRosterDelta([3 as unknown as string], { key: TEAMS_VIRTUAL_KEY, mode: 'add', value: ['3'] }))
      .toEqual({ add: [], remove: [] })
  })
})

describe('runBulk', () => {
  const opts = { idOf: (n: number) => String(n), labelOf: (n: number) => `member ${n}`, concurrency: 2 }

  it('separates changed, skipped and failed', async () => {
    const summary = await runBulk(
      [1, 2, 3, 4],
      async (n) => {
        if (n === 3) throw new Error('FORBIDDEN')
        return n % 2 === 0 ? 'skipped' : 'changed'
      },
      opts,
    )
    expect(summary.changed).toEqual(['1'])
    expect(summary.skipped.sort()).toEqual(['2', '4'])
    expect(summary.failed).toEqual([{ id: '3', label: 'member 3', error: 'FORBIDDEN' }])
  })

  it('does not reject when every worker throws', async () => {
    // A sport admin selecting only members outside their section. The run has to
    // come back with a report, not blow up the modal.
    const summary = await runBulk([1, 2], async () => { throw new Error('403') }, opts)
    expect(summary.failed).toHaveLength(2)
    expect(summary.changed).toEqual([])
  })

  it('reports progress once per settled item', async () => {
    const seen: number[] = []
    await runBulk([1, 2, 3], async () => 'changed', {
      ...opts,
      onProgress: (done) => seen.push(done),
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('never runs more than `concurrency` workers at once', async () => {
    let live = 0
    let peak = 0
    await runBulk(
      [1, 2, 3, 4, 5, 6],
      async () => {
        live += 1
        peak = Math.max(peak, live)
        await Promise.resolve()
        live -= 1
        return 'changed'
      },
      { ...opts, concurrency: 2 },
    )
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('stops starting new work once cancelled', async () => {
    let started = 0
    await runBulk(
      [1, 2, 3, 4, 5, 6],
      async () => { started += 1; return 'changed' },
      { ...opts, concurrency: 1, isCancelled: () => started >= 2 },
    )
    expect(started).toBe(2)
  })

  it('handles an empty selection without dividing by zero', async () => {
    const summary = await runBulk([], async () => 'changed', opts)
    expect(summary).toEqual({ changed: [], skipped: [], failed: [] })
  })
})
