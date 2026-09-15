/**
 * teamTotals — the one place a team's income / expense / net is defined.
 *
 * The invariant worth a test: referee fees are club-reimbursed and must NEVER
 * move `net`. The rest guards the numeric-string reality of knex rows and the
 * cancelled-invoice exclusion.
 */
import { describe, it, expect } from 'vitest'
import { teamTotals } from '../finance-team-summary.js'

describe('teamTotals', () => {
  it('returns all-zero totals for empty input', () => {
    expect(teamTotals({})).toEqual({
      income: 0, expense: 0, net: 0, invoice_total: 0, invoice_open: 0, referee_total: 0, team_fines_open: 0,
    })
    expect(teamTotals()).toEqual(teamTotals({}))
  })

  it('sponsoring and income entries are income, expense entries are expense, net is the difference', () => {
    const t = teamTotals({
      entries: [
        { kind: 'sponsoring', amount: '500.00' },
        { kind: 'income', amount: '120.50' },
        { kind: 'expense', amount: '80.25' },
      ],
    })
    expect(t.income).toBe(620.5)
    expect(t.expense).toBe(80.25)
    expect(t.net).toBe(540.25)
  })

  it('coerces numeric strings, nulls and garbage via Number(x) || 0', () => {
    const t = teamTotals({
      entries: [{ kind: 'income', amount: null }, { kind: 'income', amount: 'abc' }, { kind: 'expense', amount: '10' }],
      invoices: [{ status: 'open', amount: undefined, open_amount: '5.5' }],
      refereeExpenses: [{ amount: null }, { amount: '60' }],
      teamFinesOpen: '12.345',
    })
    expect(t.income).toBe(0)
    expect(t.expense).toBe(10)
    expect(t.net).toBe(-10)
    expect(t.invoice_total).toBe(0)
    expect(t.invoice_open).toBe(5.5)
    expect(t.referee_total).toBe(60)
    expect(t.team_fines_open).toBe(12.35)
  })

  it('invoice totals skip cancelled invoices but count every other status', () => {
    const t = teamTotals({
      invoices: [
        { status: 'open', amount: '100', open_amount: '100' },
        { status: 'pending_confirmation', amount: '50', open_amount: '50' },
        { status: 'paid', amount: '30', open_amount: '0' },
        { status: 'cancelled', amount: '999', open_amount: '999' },
      ],
    })
    expect(t.invoice_total).toBe(180)
    expect(t.invoice_open).toBe(150)
  })

  it('referee_total is summed but NEVER enters net', () => {
    const base = { entries: [{ kind: 'sponsoring', amount: '300' }, { kind: 'expense', amount: '100' }] }
    const without = teamTotals(base)
    const withRef = teamTotals({ ...base, refereeExpenses: [{ amount: '60' }, { amount: '60.00' }, { amount: '45.5' }] })
    expect(withRef.referee_total).toBe(165.5)
    expect(withRef.net).toBe(without.net)
    expect(withRef.income).toBe(without.income)
    expect(withRef.expense).toBe(without.expense)
    expect(withRef.net).toBe(200)
  })

  it('rounds to two decimals (no floating-point tails)', () => {
    const t = teamTotals({
      entries: [{ kind: 'income', amount: 0.1 }, { kind: 'income', amount: 0.2 }],
      refereeExpenses: [{ amount: 1.005 }],
    })
    expect(t.income).toBe(0.3)
    expect(t.net).toBe(0.3)
    expect(Number.isInteger(t.referee_total * 100)).toBe(true)
  })

  it('team_fines_open is passed through, not derived from the other inputs', () => {
    expect(teamTotals({ teamFinesOpen: 40 }).team_fines_open).toBe(40)
    expect(teamTotals({ teamFinesOpen: 40 }).net).toBe(0)
  })
})
