// The cohort rule for /admin/transfers.
//
// What is actually being defended here is one property: the two overrides
// (migration 320's stored `not_needed`, and the Volleymanager derivation) may
// only ever take a member OFF the worklist. An override that could put somebody
// on it would be a transfer invented out of a register disagreement; an override
// that reached past the worklist would empty the Swiss reference list or revive
// members who left the club. Both are silent failures — the page would simply
// show a different number and no error anywhere.

import { describe, it, expect } from 'vitest'
import { bucketOf, federationBucketOf, type TransferBucketInput } from '../transferBucket'

const member = (over: Partial<TransferBucketInput> = {}): TransferBucketInput => ({
  federation_of_origin: null,
  kscw_membership_active: true,
  nationalitaet_codes: null,
  transfer_status: null,
  ...over,
})

describe('federationBucketOf — the federation column alone', () => {
  it('reads a foreign age-14 licence as actionable', () => {
    expect(federationBucketOf(member({ federation_of_origin: 'DE' }))).toBe('needs')
  })

  it('splits Swiss Volley out of the settled tally', () => {
    expect(federationBucketOf(member({ federation_of_origin: 'CH' }))).toBe('swiss')
  })

  it('has no "never licensed anywhere" answer — a first licence issued here is CH', () => {
    // Migration 342 retired the 'NONE' sentinel; anything that is not a country
    // code the club recognises still reads as a foreign federation, i.e. work.
    expect(federationBucketOf(member({ federation_of_origin: 'NONE' }))).toBe('needs')
  })

  it('normalises case and whitespace before deciding', () => {
    expect(federationBucketOf(member({ federation_of_origin: ' ch ' }))).toBe('swiss')
    expect(federationBucketOf(member({ federation_of_origin: 'de' }))).toBe('needs')
  })

  it('asks only active members who hold a nationality we know is not Swiss', () => {
    expect(federationBucketOf(member({ nationalitaet_codes: 'IT' }))).toBe('clarify')
    expect(federationBucketOf(member({ nationalitaet_codes: 'IT,CH' }))).toBe('ignore')
    expect(federationBucketOf(member({ nationalitaet_codes: null }))).toBe('ignore')
    expect(federationBucketOf(member({ nationalitaet_codes: 'IT', kscw_membership_active: false })))
      .toBe('ignore')
  })
})

describe('bucketOf — the overrides', () => {
  it('takes an explicitly ruled-out member off the worklist', () => {
    const m = member({ federation_of_origin: 'DE', transfer_status: 'not_needed' })
    expect(federationBucketOf(m)).toBe('needs')
    expect(bucketOf(m)).toBe('settled')
  })

  it('takes a member Swiss Volley licences as Swiss off the worklist', () => {
    const m = member({ federation_of_origin: 'DE' })
    expect(bucketOf(m, false)).toBe('needs')
    expect(bucketOf(m, true)).toBe('settled')
  })

  it('clears an unanswered member out of the questions list too', () => {
    const m = member({ nationalitaet_codes: 'IT' })
    expect(bucketOf(m, false)).toBe('clarify')
    expect(bucketOf(m, true)).toBe('settled')
    expect(bucketOf(member({ nationalitaet_codes: 'IT', transfer_status: 'not_needed' })))
      .toBe('settled')
  })

  // The three that must NOT move. Each one is a way the page could lie: an
  // emptied Swiss list, a revived ex-member, or a settled member re-counted.
  it('never empties the Swiss reference list', () => {
    for (const status of ['not_needed', 'pending', 'done'] as const) {
      expect(bucketOf(member({ federation_of_origin: 'CH', transfer_status: status }), true))
        .toBe('swiss')
    }
  })

  it('never revives an inactive member', () => {
    expect(bucketOf(member({ kscw_membership_active: false, transfer_status: 'not_needed' }), true))
      .toBe('ignore')
  })

  it('leaves an already-settled member exactly where they were', () => {
    expect(bucketOf(member({ federation_of_origin: 'DE', transfer_status: 'not_needed' }), true))
      .toBe('settled')
  })

  it('records work in progress in place rather than moving it', () => {
    // 'pending' on a Swiss-origin member is the dangerous Volleymanager
    // direction being chased — it must show up in the Swiss table, not spawn a
    // second group under the same federation in the worklist.
    expect(bucketOf(member({ federation_of_origin: 'CH', transfer_status: 'pending' })))
      .toBe('swiss')
    expect(bucketOf(member({ federation_of_origin: 'DE', transfer_status: 'pending' })))
      .toBe('needs')
    expect(bucketOf(member({ federation_of_origin: 'DE', transfer_status: 'done' })))
      .toBe('needs')
  })

  /**
   * The property itself, over the whole input space the page can produce: an
   * override may change the answer only from a worklist cohort to `settled`.
   */
  it('only ever subtracts work, for every combination', () => {
    const feds = [null, '', 'CH', 'NONE', 'DE', 'it']
    const nats = [null, 'CH', 'IT', 'IT,CH']
    const statuses = [null, 'pending', 'done', 'not_needed'] as const
    for (const federation_of_origin of feds) {
      for (const nationalitaet_codes of nats) {
        for (const transfer_status of statuses) {
          for (const active of [true, false]) {
            for (const vmSaysSwiss of [true, false]) {
              const m = member({
                federation_of_origin, nationalitaet_codes, transfer_status,
                kscw_membership_active: active,
              })
              const base = federationBucketOf(m)
              const actual = bucketOf(m, vmSaysSwiss)
              if (actual === base) continue
              expect(['needs', 'clarify']).toContain(base)
              expect(actual).toBe('settled')
            }
          }
        }
      }
    }
  })
})
