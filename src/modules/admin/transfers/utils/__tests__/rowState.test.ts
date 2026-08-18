// The `State` column is a LABEL over four separate authorities — `in_vis`,
// `licence_validated`, `transfer_status` and the `vis_transfers` row — and the
// property defended here is that it never becomes a MERGE of them.
//
// Two ways that would fail silently, both tested below:
//   • a VIS transfer overwriting a stored decision, so a row reads "done" about
//     a player whose certificate has not arrived and who may not be fielded;
//   • a 'not_needed' row losing its disagreement with FIVB, which is the one
//     disagreement the nightly sync deliberately refuses to resolve and can
//     therefore persist forever.

import { describe, it, expect } from 'vitest'
import {
  rowStateOf,
  isDisputed,
  visTransferPercent,
  countByState,
  matchesSearch,
  applyWorklistFilters,
  ROW_STATE_ORDER,
  ROW_STATE_LABEL_KEY,
  ROW_STATE_HINT_KEY,
  ROW_STATE_BADGE_VARIANT,
  type RowState,
} from '../rowState'
import type { TransferMember, VisTransfer } from '../../types'

const member = (over: Partial<TransferMember> = {}): TransferMember => ({
  id: '1',
  first_name: 'Anna',
  last_name: 'Mueller',
  ...over,
})

// Percentages as STRINGS, which is what `fetchItems` actually returns.
const open = (percent = '40'): VisTransfer =>
  ({ vis_no: '1', season_no: '17', status_code: '130', percent_complete: percent })
const complete = (): VisTransfer =>
  ({ vis_no: '2', season_no: '17', status_code: '130', percent_complete: '100' })
const dead = (): VisTransfer =>
  ({ vis_no: '3', season_no: '17', status_code: '255', percent_complete: '10' })

describe('rowStateOf — one branch at a time', () => {
  it('ruledOut: a hand-set not_needed, whatever else is true', () => {
    expect(rowStateOf(member({ transfer_status: 'not_needed' }), null, 'unknown')).toBe('ruledOut')
  })

  // The player may not be fielded — FIVB Disciplinary Regulations Art. 11.4.
  it('blocked: marked done while the licence is not validated', () => {
    expect(rowStateOf(member({ transfer_status: 'done' }), null, 'not_validated')).toBe('blocked')
    expect(rowStateOf(member({ transfer_status: 'done' }), null, 'unknown')).toBe('blocked')
  })

  it('done: marked done and validated', () => {
    expect(rowStateOf(member({ transfer_status: 'done' }), null, 'validated')).toBe('done')
  })

  it('awaitingConfirmation: still pending, but Swiss Volley validated the licence', () => {
    expect(rowStateOf(member({ transfer_status: 'pending' }), null, 'validated'))
      .toBe('awaitingConfirmation')
  })

  it('inProgress: pending with an open ITC at VIS', () => {
    expect(rowStateOf(member({ transfer_status: 'pending' }), open(), 'unknown')).toBe('inProgress')
  })

  it('chasing: pending and nothing else is known', () => {
    expect(rowStateOf(member({ transfer_status: 'pending' }), null, 'unknown')).toBe('chasing')
    expect(rowStateOf(member({ transfer_status: 'pending' }), dead(), 'unknown')).toBe('chasing')
  })

  it('inProgress: nothing stored, but VIS reports an open ITC', () => {
    expect(rowStateOf(member(), open(), 'unknown')).toBe('inProgress')
  })

  it('canRequest: nothing stored, found in the VIS player index', () => {
    expect(rowStateOf(member({ in_vis: true }), null, 'unknown')).toBe('canRequest')
  })

  // Evidence, not a verdict: `in_vis === false` is a name-match miss against a
  // federation of origin that was usually only seeded from nationality, and a
  // never-checked member sits in exactly the same state.
  it('waitingFederation: not found in the index, or never checked', () => {
    expect(rowStateOf(member({ in_vis: false }), null, 'unknown')).toBe('waitingFederation')
    expect(rowStateOf(member({ in_vis: null }), null, 'unknown')).toBe('waitingFederation')
    expect(rowStateOf(member(), null, 'unknown')).toBe('waitingFederation')
  })
})

describe('rowStateOf — a stored decision outranks every derivation', () => {
  // 'done' means the certificate landed AND Swiss Volley validated the licence.
  // VIS reporting 100% is FIVB's side of that and arrives first, so letting it
  // write the label would say "done" about a player who is not yet eligible.
  it('never promotes a pending row to done off a completed VIS transfer', () => {
    expect(rowStateOf(member({ transfer_status: 'pending' }), complete(), 'validated'))
      .toBe('awaitingConfirmation')
    expect(rowStateOf(member({ transfer_status: 'pending' }), complete(), 'unknown'))
      .toBe('chasing')
    expect(rowStateOf(member({ in_vis: true }), complete(), 'unknown')).not.toBe('done')
  })

  it('keeps a not_needed row ruled out whatever validation or VIS say', () => {
    for (const validation of ['validated', 'not_validated', 'unknown'] as const) {
      for (const tr of [null, open(), complete(), dead()]) {
        expect(rowStateOf(member({ transfer_status: 'not_needed', in_vis: true }), tr, validation))
          .toBe('ruledOut')
      }
    }
  })
})

describe('isDisputed — the one disagreement the nightly sync will not resolve', () => {
  it('is true exactly when a live VIS transfer sits under a hand-set not_needed', () => {
    expect(isDisputed(member({ transfer_status: 'not_needed' }), open())).toBe(true)
    expect(isDisputed(member({ transfer_status: 'not_needed' }), complete())).toBe(true)
    expect(isDisputed(member({ transfer_status: 'not_needed' }), dead())).toBe(false)
    expect(isDisputed(member({ transfer_status: 'not_needed' }), null)).toBe(false)
  })

  // The sync rewrites 'pending' and 'done' itself, so a divergence there is just
  // the nightly run not having caught up and is not worth alarming about.
  it('says nothing about the two statuses the sync corrects itself', () => {
    expect(isDisputed(member({ transfer_status: 'pending' }), open())).toBe(false)
    expect(isDisputed(member({ transfer_status: 'done' }), open())).toBe(false)
    expect(isDisputed(member(), open())).toBe(false)
  })
})

describe('visTransferPercent', () => {
  it('reads the string percentage as a number', () => {
    expect(visTransferPercent(open('60'))).toBe(60)
  })

  it('answers 0 for no transfer and for an unusable value', () => {
    expect(visTransferPercent(null)).toBe(0)
    expect(visTransferPercent({ vis_no: '1', season_no: '17' })).toBe(0)
    expect(visTransferPercent({ vis_no: '1', season_no: '17', percent_complete: 'n/a' })).toBe(0)
  })
})

describe('the three label tables stay in step with the state list', () => {
  it('covers every state exactly once, in chip order', () => {
    expect(new Set(ROW_STATE_ORDER).size).toBe(ROW_STATE_ORDER.length)
    for (const state of ROW_STATE_ORDER) {
      expect(ROW_STATE_LABEL_KEY[state]).toBeTruthy()
      expect(ROW_STATE_HINT_KEY[state]).toBeTruthy()
      expect(ROW_STATE_BADGE_VARIANT[state]).toBeTruthy()
    }
    expect(ROW_STATE_ORDER[0]).toBe('canRequest')
    // Only "not eligible" is the destructive colour.
    expect(ROW_STATE_BADGE_VARIANT.blocked).toBe('danger')
  })
})

describe('countByState — the numbers bar must add up', () => {
  const stateOf = (m: TransferMember): RowState => rowStateOf(m, null, 'unknown')

  it('sums to the cohort size and shows every state, including the empty ones', () => {
    const rows = [
      member({ id: '1', in_vis: true }),
      member({ id: '2', in_vis: false }),
      member({ id: '3', transfer_status: 'pending' }),
      member({ id: '4', transfer_status: 'done' }),
    ]
    const counts = countByState(rows, stateOf)
    expect(counts).toEqual({
      canRequest: 1,
      waitingFederation: 1,
      inProgress: 0,
      chasing: 1,
      awaitingConfirmation: 0,
      done: 0,
      blocked: 1,
      ruledOut: 0,
    })
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(rows.length)
  })
})

describe('matchesSearch — the identifiers an admin actually has in front of them', () => {
  const m = member({
    last_name: 'Berke-Wenger',
    first_name: 'Sofia',
    nickname: 'Sofi',
    email: 'sofia@example.ch',
    license_nr: '243602',
    vis_player_no: '4471',            // a STRING at runtime
    vis_player_no_manual: 998877,
  })

  it('finds by name, nickname and email, case-insensitively', () => {
    expect(matchesSearch(m, 'berke')).toBe(true)
    expect(matchesSearch(m, 'SOFI')).toBe(true)
    expect(matchesSearch(m, 'example.ch')).toBe(true)
  })

  it('finds by licence number and by either VIS player number', () => {
    expect(matchesSearch(m, '243602')).toBe(true)
    expect(matchesSearch(m, '4471')).toBe(true)
    expect(matchesSearch(m, '998877')).toBe(true)
  })

  it('matches everyone on an empty needle and nobody on a miss', () => {
    expect(matchesSearch(m, '')).toBe(true)
    expect(matchesSearch(m, '   ')).toBe(true)
    expect(matchesSearch(m, 'zzz')).toBe(false)
    expect(matchesSearch(member({ last_name: undefined, first_name: undefined }), 'zzz')).toBe(false)
  })
})

describe('applyWorklistFilters — pure, and the same function in three tabs', () => {
  const rows = [
    member({ id: '1', last_name: 'Alpha', in_vis: true }),                       // canRequest
    member({ id: '2', last_name: 'Beta', in_vis: false }),                       // waitingFederation
    member({ id: '3', last_name: 'Gamma', transfer_status: 'done' }),            // blocked
  ]
  const stateOf = (m: TransferMember): RowState => rowStateOf(m, null, 'unknown')

  it('returns the cohort untouched when nothing is filtered', () => {
    expect(applyWorklistFilters(rows, { search: '', state: null }, stateOf)).toEqual(rows)
    expect(applyWorklistFilters(rows, { search: '   ', state: null }, stateOf)).toEqual(rows)
  })

  it('does not mutate the input', () => {
    const copy = [...rows]
    applyWorklistFilters(rows, { search: 'alpha', state: 'canRequest' }, stateOf)
    expect(rows).toEqual(copy)
  })

  it('filters by state, by search, and by both together', () => {
    expect(applyWorklistFilters(rows, { search: '', state: 'blocked' }, stateOf).map((m) => m.id))
      .toEqual(['3'])
    expect(applyWorklistFilters(rows, { search: 'BET', state: null }, stateOf).map((m) => m.id))
      .toEqual(['2'])
    expect(applyWorklistFilters(rows, { search: 'alpha', state: 'blocked' }, stateOf))
      .toEqual([])
  })

  // The Ruled out and Swiss tabs pass `state: null` and search only — "is this
  // person in there?" is a real question against 483 Swiss rows.
  it('works with search alone, which is how the other two tabs call it', () => {
    expect(applyWorklistFilters(rows, { search: 'gamma', state: null }, stateOf).map((m) => m.id))
      .toEqual(['3'])
  })
})
