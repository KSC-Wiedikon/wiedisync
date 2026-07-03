import { describe, it, expect } from 'vitest'
import { planSettlementLegs } from '../finance-autopost.js'

// Account ids for the test chart.
const ACC = { debitoren: 1, bank: 2, income: 3, prepay: 4, badDebt: 5 }
// Normalize -0 → 0 so `.toBe(0)` (Object.is) doesn't trip on IEEE negative zero.
const round2 = (n) => { const r = Math.round((Number(n) || 0) * 100) / 100; return r === 0 ? 0 : r }
const pay = (id, amount, entry_type = 'payment') => ({ id, amount, entry_type, date: '2026-07-01' })

/**
 * Reconstruct account balances from the ISSUE leg (Debit Debitoren / Credit
 * Income for the full amount, posted separately by reconcileInvoiceLedger) plus
 * the settlement legs planSettlementLegs returns. Debit is +, credit is −, so a
 * positive balance is a net debit.
 */
function balances(total, legs, accounts = ACC) {
  const bal = {}
  const add = (acct, amt) => { if (acct != null) bal[acct] = round2((bal[acct] || 0) + amt) }
  add(accounts.debitoren, total)
  add(accounts.income, -total)
  for (const l of legs) { add(l.debit, l.amount); add(l.credit, -l.amount) }
  return bal
}
const sumAll = (bal) => round2(Object.values(bal).reduce((a, b) => a + b, 0))

/** The invariants the whole ledger must satisfy after any entry mix. */
function assertReconciled(total, payments, accounts = ACC) {
  const { legs, open, prepaid } = planSettlementLegs({ total, payments, invoiceId: 99, issueDate: '2026-06-01', accounts })
  const bal = balances(total, legs, accounts)
  // Double-entry always balances.
  expect(sumAll(bal)).toBe(0)
  // Debitoren (A/R control) == the residual open receivable — the core invariant
  // the 2026-07-02 audit found broken on the refund path.
  expect(round2(bal[accounts.debitoren] || 0)).toBe(round2(open))
  // Prepayment liability == the running prepaid excess (when a prepay account is set).
  if (accounts.prepay) expect(round2(-(bal[accounts.prepay] || 0))).toBe(round2(prepaid))
  return { legs, open, prepaid, bal }
}

describe('planSettlementLegs — ledger reconciles to the sub-ledger', () => {
  it('exact full payment clears the receivable', () => {
    const { open, bal } = assertReconciled(100, [pay(1, 100)])
    expect(open).toBe(0)
    expect(bal[ACC.bank]).toBe(100) // cash received
    expect(bal[ACC.debitoren]).toBeFalsy()
  })

  it('partial payment leaves the remainder open', () => {
    const { open, bal } = assertReconciled(100, [pay(1, 40)])
    expect(open).toBe(60)
    expect(bal[ACC.debitoren]).toBe(60)
    expect(bal[ACC.bank]).toBe(40)
  })

  it('overpayment parks the excess on the prepayment account', () => {
    const { open, prepaid, bal } = assertReconciled(100, [pay(1, 150)])
    expect(open).toBe(0)
    expect(prepaid).toBe(50)
    expect(round2(-(bal[ACC.prepay]))).toBe(50)
    expect(bal[ACC.bank]).toBe(150)
  })

  // #1 regression: refunding an overpayment must draw down the prepayment, NOT
  // re-open the receivable. Before the fix Debitoren carried a phantom +50.
  it('refund of an overpayment clears prepayment and leaves Debitoren at zero', () => {
    const { open, prepaid, bal } = assertReconciled(100, [pay(1, 150), pay(2, 50, 'refund')])
    expect(open).toBe(0)
    expect(prepaid).toBe(0)
    expect(bal[ACC.debitoren]).toBeFalsy() // NOT 50
    expect(round2(-(bal[ACC.prepay] || 0))).toBe(0)
    expect(bal[ACC.bank]).toBe(100) // 150 in − 50 out
  })

  // #1 with no prepay account: the excess was credited to Debitoren, so a refund
  // debiting Debitoren nets it back to zero — no drift either way.
  it('overpay+refund with no prepayment account still nets Debitoren to zero', () => {
    const acc = { ...ACC, prepay: null }
    const { open, bal } = assertReconciled(100, [pay(1, 150), pay(2, 50, 'refund')], acc)
    expect(open).toBe(0)
    expect(bal[ACC.debitoren]).toBeFalsy()
    expect(bal[ACC.bank]).toBe(100)
  })

  it('refund of an actual payment re-opens the receivable', () => {
    const { open, bal } = assertReconciled(100, [pay(1, 100), pay(2, 30, 'refund')])
    expect(open).toBe(30)
    expect(bal[ACC.debitoren]).toBe(30)
    expect(bal[ACC.bank]).toBe(70) // 100 in − 30 out
  })

  // 2026-07-03 review regression: an over-refund (refund > net cash received)
  // must book the FULL amount to Bank, not silently drop the excess.
  it('over-refund books the full amount to bank and records the club liability', () => {
    const { open, bal } = assertReconciled(100, [pay(1, 50), pay(2, 80, 'refund')])
    expect(open).toBe(100)          // receivable fully re-opened
    expect(bal[ACC.bank]).toBe(-30) // 50 in − 80 out = 30 net out (the whole 80 is booked)
    expect(round2(-(bal[ACC.prepay]))).toBe(-30) // negative prepayment = club owes the member 30
  })

  it('credit note and write-off both reduce the receivable without cash', () => {
    const cn = assertReconciled(100, [pay(1, 20, 'credit_note')])
    expect(cn.open).toBe(80)
    expect(cn.bal[ACC.bank]).toBeFalsy() // no cash moved
    const wo = assertReconciled(100, [pay(1, 100, 'writeoff')])
    expect(wo.open).toBe(0)
  })

  // #23: a ≤1-rappen short-pay is forgiven so Debitoren doesn't keep a residue.
  it('1-rappen short-pay is cleared via a rounding leg', () => {
    const { legs, open, bal } = assertReconciled(100, [pay(1, 99.99)])
    expect(open).toBe(0)
    expect(bal[ACC.debitoren]).toBeFalsy()
    expect(legs.some((l) => l.kind === 'round')).toBe(true)
  })

  it('a genuinely unpaid invoice gets no rounding leg', () => {
    const { legs, open } = assertReconciled(100, [])
    expect(open).toBe(100)
    expect(legs.some((l) => l.kind === 'round')).toBe(false)
  })
})
