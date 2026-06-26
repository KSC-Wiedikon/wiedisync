import { describe, it, expect } from 'vitest'
import { planYearEndClose } from '../finance-close.js'

// Account chart: 1=Bank(asset) 2=Beiträge(income) 3=Miete(expense)
//                9=Vereinsvermögen(equity) 8=Eröffnungsbilanz(clearing, equity)
const ACCS = [
  { id: 1, type: 'asset' }, { id: 2, type: 'income' }, { id: 3, type: 'expense' },
  { id: 9, type: 'equity' }, { id: 8, type: 'equity' },
]
const tx = (d, c, amount_chf) => ({ debit_account: d, credit_account: c, amount_chf })
const opts = { equityId: 9, openingId: 8 }

describe('planYearEndClose', () => {
  it('surplus year: result, nominal close into equity, balanced carry-forward', () => {
    // dues 100 (Bank/Beiträge), rent 30 (Miete/Bank) → Bank 70, income 100, expense 30, net 70
    const p = planYearEndClose([tx(1, 2, 100), tx(3, 1, 30)], ACCS, opts)
    expect(p).toMatchObject({ income: 100, expense: 30, net: 70, balanced: true, clearingNet: 0 })
    // 2 closing entries: income→equity, equity→expense
    expect(p.closing).toContainEqual({ debit: 2, credit: 9, amount: 100 }) // close income
    expect(p.closing).toContainEqual({ debit: 9, credit: 3, amount: 30 })  // close expense
    // opening: Bank carried (debit Bank/credit clearing 70), equity carried (debit clearing/credit equity 70)
    expect(p.opening).toContainEqual({ debit: 1, credit: 8, amount: 70 })
    expect(p.opening).toContainEqual({ debit: 8, credit: 9, amount: 70 })
  })

  it('deficit year: net negative, equity reduced, still balanced', () => {
    // dues 40, rent 100, Bank started with 60 opening (debit clearing... simulate via equity)
    // opening equity 60 (debit Bank / credit equity) + dues 40 (Bank/income) + rent 100 (expense/Bank)
    const p = planYearEndClose([tx(1, 9, 60), tx(1, 2, 40), tx(3, 1, 100)], ACCS, opts)
    expect(p.income).toBe(40); expect(p.expense).toBe(100); expect(p.net).toBe(-60)
    expect(p.balanced).toBe(true)
    // Bank: dr 60+40, cr 100 → dr 0 → no carry. Equity: cr60 (opening) then -60 (deficit) → 0 → no carry.
    expect(p.opening.length).toBe(0)
  })

  it('empty year closes with no entries', () => {
    const p = planYearEndClose([], ACCS, opts)
    expect(p).toMatchObject({ income: 0, expense: 0, net: 0, balanced: true })
    expect(p.closing.length).toBe(0); expect(p.opening.length).toBe(0)
  })

  it('carries a multi-account balance sheet forward and the clearing nets to zero', () => {
    // assets: Bank 1; add a liability acct 4. equity opening 9.
    const accs = [...ACCS, { id: 4, type: 'liability' }]
    // Bank 200 financed by a 200 loan (liability): debit Bank/credit Loan 200; then dues 50 Bank/income
    const p = planYearEndClose([tx(1, 4, 200), tx(1, 2, 50)], accs, opts)
    expect(p.net).toBe(50)
    // Bank dr 250, Loan cr 200, equity cr 50 (from result). assets(250) = liab(200)+equity(50). clearing 0.
    expect(p.balanced).toBe(true)
    expect(p.opening).toContainEqual({ debit: 1, credit: 8, amount: 250 })  // Bank
    expect(p.opening).toContainEqual({ debit: 8, credit: 4, amount: 200 })  // Loan
    expect(p.opening).toContainEqual({ debit: 8, credit: 9, amount: 50 })   // equity result
  })
})
