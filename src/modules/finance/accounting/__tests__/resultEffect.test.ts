import { describe, it, expect } from 'vitest'
import { resultEffect } from '../useClubBook'
import type { AccountType, FinanceTransaction } from '../../types'

const types = new Map<string, AccountType | null>([
  ['1000', 'asset'], ['1010', 'asset'], ['3230', 'income'], ['4230', 'expense'], ['9100', 'close'],
])
const tx = (debit: string, credit: string, amount: number | string | null, entryType = 'standard'): FinanceTransaction => ({
  id: 'x', clubdesk_id: null, entry_type: entryType, voucher_no: null, booking_date: '2026-10-08', text: null,
  debit_account_number: debit, debit_account_name: null, credit_account_number: credit, credit_account_name: null,
  amount_chf: amount,
})

describe('resultEffect — what a booking does to the year result', () => {
  it('money in to an income account is +', () => {
    expect(resultEffect(tx('1000', '3230', '25.00'), types)).toBe(25)
  })
  it('money out to an expense account is −', () => {
    expect(resultEffect(tx('4230', '1000', 10410), types)).toBe(-10410)
  })
  it('a refund flips the sign', () => {
    expect(resultEffect(tx('3230', '1000', 5), types)).toBe(-5)
    expect(resultEffect(tx('1000', '4230', 5), types)).toBe(5)
  })
  it('a transfer between the club\'s own accounts is 0', () => {
    expect(resultEffect(tx('1010', '1000', 500), types)).toBe(0)
  })
  it('closing and opening entries are 0', () => {
    expect(resultEffect(tx('3230', '9100', 25, 'closing'), types)).toBe(0)
    expect(resultEffect(tx('1000', '9100', 25, 'opening'), types)).toBe(0)
  })
  it('a compound-booking header without an amount is 0', () => {
    expect(resultEffect(tx('1000', '', null, 'invoice_collective'), types)).toBe(0)
  })
})
