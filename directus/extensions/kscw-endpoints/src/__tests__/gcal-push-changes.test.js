/**
 * The home-game push names the fixtures it created / updated / deleted — the hall
 * source switch reports what happened to its game, and a dev dry run shows which
 * entries it would have touched instead of bare counts.
 */
import { describe, it, expect } from 'vitest'
import { describeChanges } from '../gcal-push.js'

describe('describeChanges', () => {
  it('names the keys behind the counts', () => {
    expect(describeChanges({ created: ['vb_1'], updated: ['vb_2', 'bb_3'], deleted: [] }))
      .toBe(' — created vb_1; updated vb_2, bb_3')
  })

  it('is empty when nothing moved', () => {
    expect(describeChanges({ created: [], updated: [], deleted: [] })).toBe('')
    expect(describeChanges(undefined)).toBe('')
  })

  it('caps a long list', () => {
    const many = Array.from({ length: 13 }, (_, i) => `vb_${i}`)
    expect(describeChanges({ deleted: many }, 10)).toBe(` — deleted ${many.slice(0, 10).join(', ')} (+3 more)`)
  })
})
