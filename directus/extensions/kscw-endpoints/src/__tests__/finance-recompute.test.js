import { describe, it, expect } from 'vitest'
import { deriveSettlement } from '../finance-recompute.js'

const pay = (amount, entry_type) => ({ amount, entry_type })

describe('deriveSettlement', () => {
  it('open invoice with no payments stays open', () => {
    expect(deriveSettlement([], 100, 'open')).toMatchObject({ status: 'open', amount_paid: 0, open_amount: 100, overpaid_amount: 0 })
  })
  it('no payments keeps pending_confirmation', () => {
    expect(deriveSettlement([], 100, 'pending_confirmation').status).toBe('pending_confirmation')
  })
  it('full payment settles to paid', () => {
    expect(deriveSettlement([pay(100, 'payment')], 100, 'open')).toMatchObject({ status: 'paid', amount_paid: 100, open_amount: 0, settled: true })
  })
  it('partial payment → partial with remaining open', () => {
    expect(deriveSettlement([pay(40, 'payment')], 100, 'open')).toMatchObject({ status: 'partial', amount_paid: 40, open_amount: 60 })
  })
  it('two partials settle', () => {
    const s = deriveSettlement([pay(40), pay(60)], 100, 'open') // default entry_type = payment
    expect(s.status).toBe('paid'); expect(s.open_amount).toBe(0)
  })
  it('overpayment records overpaid_amount', () => {
    expect(deriveSettlement([pay(120, 'payment')], 100, 'open')).toMatchObject({ status: 'paid', open_amount: 0, overpaid_amount: 20 })
  })
  it('credit note settles non-cash (cash paid stays 0)', () => {
    expect(deriveSettlement([pay(100, 'credit_note')], 100, 'open')).toMatchObject({ status: 'paid', amount_paid: 0, open_amount: 0 })
  })
  it('partial payment + credit note for the rest settles', () => {
    const s = deriveSettlement([pay(30, 'payment'), pay(70, 'credit_note')], 100, 'open')
    expect(s).toMatchObject({ status: 'paid', amount_paid: 30, open_amount: 0 })
  })
  it('write-off settles and records written_off_amount', () => {
    expect(deriveSettlement([pay(100, 'writeoff')], 100, 'open')).toMatchObject({ status: 'paid', written_off_amount: 100, open_amount: 0 })
  })
  it('full refund reopens a previously-paid invoice', () => {
    expect(deriveSettlement([pay(100, 'payment'), pay(100, 'refund')], 100, 'paid')).toMatchObject({ status: 'open', amount_paid: 0, open_amount: 100 })
  })
  it('partial refund leaves a partial balance', () => {
    expect(deriveSettlement([pay(100, 'payment'), pay(40, 'refund')], 100, 'paid')).toMatchObject({ status: 'partial', amount_paid: 60, open_amount: 40 })
  })
  it('legacy/camt rows with no entry_type count as payment', () => {
    expect(deriveSettlement([pay(100)], 100, 'pending_confirmation').status).toBe('paid')
  })
  it('zero-amount invoice is not falsely settled', () => {
    expect(deriveSettlement([], 0, 'open').settled).toBe(false)
  })
})
