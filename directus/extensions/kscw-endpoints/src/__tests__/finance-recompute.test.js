import { describe, it, expect } from 'vitest'
import { deriveSettlement } from '../finance-recompute.js'

const pay = (amount, entry_type) => ({ amount, entry_type })

/** Every result must satisfy these, no matter the entry mix. */
function invariants(s, amount) {
  expect(s.amount_paid).toBeGreaterThanOrEqual(0)               // never negative cash
  expect(s.open_amount).toBeGreaterThanOrEqual(0)
  expect(s.open_amount).toBeLessThanOrEqual(Math.max(0, amount) + 1e-9) // never exceeds the bill
  expect(s.overpaid_amount).toBeGreaterThanOrEqual(0)
  if (s.settled) expect(s.status).toBe('paid')
}
const check = (entries, amount, status = 'open') => {
  const s = deriveSettlement(entries, amount, status)
  invariants(s, amount)
  return s
}

describe('deriveSettlement — single-axis', () => {
  it('open invoice with no payments stays open', () => {
    expect(check([], 100)).toMatchObject({ status: 'open', amount_paid: 0, open_amount: 100, overpaid_amount: 0 })
  })
  it('no payments keeps pending_confirmation', () => {
    expect(check([], 100, 'pending_confirmation').status).toBe('pending_confirmation')
  })
  it('full payment settles to paid', () => {
    expect(check([pay(100, 'payment')], 100)).toMatchObject({ status: 'paid', amount_paid: 100, open_amount: 0, settled: true })
  })
  it('partial payment → partial with remaining open', () => {
    expect(check([pay(40, 'payment')], 100)).toMatchObject({ status: 'partial', amount_paid: 40, open_amount: 60 })
  })
  it('two partials settle', () => {
    expect(check([pay(40), pay(60)], 100)).toMatchObject({ status: 'paid', open_amount: 0 })
  })
  it('overpayment records overpaid_amount', () => {
    expect(check([pay(120, 'payment')], 100)).toMatchObject({ status: 'paid', open_amount: 0, overpaid_amount: 20 })
  })
  it('credit note settles non-cash (cash paid stays 0)', () => {
    expect(check([pay(100, 'credit_note')], 100)).toMatchObject({ status: 'paid', amount_paid: 0, open_amount: 0 })
  })
  it('partial payment + credit note for the rest settles', () => {
    expect(check([pay(30, 'payment'), pay(70, 'credit_note')], 100)).toMatchObject({ status: 'paid', amount_paid: 30, open_amount: 0 })
  })
  it('write-off settles and records written_off_amount', () => {
    expect(check([pay(100, 'writeoff')], 100)).toMatchObject({ status: 'paid', written_off_amount: 100, open_amount: 0 })
  })
  it('legacy/camt rows with no entry_type count as payment', () => {
    expect(check([pay(100)], 100, 'pending_confirmation').status).toBe('paid')
  })
})

describe('deriveSettlement — refunds', () => {
  it('full refund reopens a previously-paid invoice', () => {
    expect(check([pay(100, 'payment'), pay(100, 'refund')], 100, 'paid')).toMatchObject({ status: 'open', amount_paid: 0, open_amount: 100 })
  })
  it('partial refund leaves a partial balance', () => {
    expect(check([pay(100, 'payment'), pay(40, 'refund')], 100, 'paid')).toMatchObject({ status: 'partial', amount_paid: 60, open_amount: 40 })
  })
})

describe('deriveSettlement — multi-entry combinations (the review regressions)', () => {
  it('refund + write-off that exceed the bill must NOT false-settle to paid (net cash negative)', () => {
    const s = check([pay(50, 'refund'), pay(200, 'writeoff')], 100)
    expect(s.status).not.toBe('paid')
    expect(s.settled).toBe(false)
    expect(s.amount_paid).toBe(0)
  })
  it('refund exceeding payments never makes amount_paid negative or open > total', () => {
    const s = check([pay(40, 'payment'), pay(100, 'refund')], 100)
    expect(s.amount_paid).toBe(0)
    expect(s.open_amount).toBe(100)
    expect(s.status).toBe('open')
  })
  it('only a refund, no payment, leaves amount_paid 0 and open ≤ total', () => {
    const s = check([pay(50, 'refund')], 100)
    expect(s).toMatchObject({ status: 'open', amount_paid: 0, open_amount: 100 })
  })
  it('refund + credit note with negative cash is NOT "partial"', () => {
    const s = check([pay(100, 'refund'), pay(100, 'credit_note')], 100)
    expect(s.status).not.toBe('partial')
    expect(s.amount_paid).toBe(0)
  })
  it('credit + write-off covering the bill settles with zero cash', () => {
    expect(check([pay(80, 'credit_note'), pay(80, 'writeoff')], 100).status).toBe('paid')
  })
  it('overpayment + credit note records the cash overpaid', () => {
    expect(check([pay(120, 'payment'), pay(50, 'credit_note')], 100)).toMatchObject({ status: 'paid', overpaid_amount: 70 })
  })
})

describe('deriveSettlement — rounding & zero', () => {
  it('a fair 3-way split (3×33.33) settles within one rappen', () => {
    expect(check([pay(33.33), pay(33.33), pay(33.33)], 100)).toMatchObject({ status: 'paid', open_amount: 0 })
  })
  it('a zero-amount invoice is already settled (waiver / 0 CHF line)', () => {
    expect(check([], 0)).toMatchObject({ status: 'paid', settled: true, open_amount: 0 })
  })
})
