import { describe, it, expect } from 'vitest'
import { ACCOUNTING_PAGES, legacyFinanceTarget, pageForPath, pagesFor, searchScore } from '../nav'

describe('legacyFinanceTarget — old /admin/finance links land on the page that replaced the tab', () => {
  it('maps every old tab', () => {
    expect(legacyFinanceTarget('')).toBe('/')
    expect(legacyFinanceTarget('?tab=overview')).toBe('/')
    expect(legacyFinanceTarget('?tab=bank')).toBe('/bank')
    expect(legacyFinanceTarget('?tab=dunning')).toBe('/reminders')
    expect(legacyFinanceTarget('?tab=ledger')).toBe('/journal')
    expect(legacyFinanceTarget('?tab=income')).toBe('/income-statement')
    expect(legacyFinanceTarget('?tab=balance')).toBe('/balance-sheet')
    expect(legacyFinanceTarget('?tab=year')).toBe('/year-end')
  })
  it('keeps the other parameters (the selected member)', () => {
    expect(legacyFinanceTarget('?tab=members&m=42')).toBe('/members?m=42')
  })
  it('an unknown tab goes to the dashboard', () => {
    expect(legacyFinanceTarget('?tab=nope')).toBe('/')
  })
  it('every mapped target is a real page', () => {
    for (const tab of ['overview', 'income', 'balance', 'budget', 'ledger', 'accounts', 'invoices', 'dues', 'dunning', 'expenses', 'members', 'teams', 'sync', 'bank', 'year', 'parallel', 'switch']) {
      const path = legacyFinanceTarget(`?tab=${tab}`)
      expect(ACCOUNTING_PAGES.some((p) => p.path === path), `${tab} -> ${path}`).toBe(true)
    }
  })
})

describe('pageForPath', () => {
  it('finds the most specific page, and "/" only exactly', () => {
    expect(pageForPath('/')?.key).toBe('dashboard')
    expect(pageForPath('/bank')?.key).toBe('bank')
    expect(pageForPath('/settings/accounts')?.key).toBe('chartOfAccounts')
    expect(pageForPath('/nothing-here')).toBeUndefined()
  })
})

describe('pagesFor', () => {
  it('auditors do not get the member register or the sync trigger', () => {
    const keys = pagesFor(true).map((p) => p.key)
    expect(keys).not.toContain('members')
    expect(keys).not.toContain('sync')
    expect(keys).toContain('journal')
  })
  it('paths and keys are unique', () => {
    expect(new Set(ACCOUNTING_PAGES.map((p) => p.path)).size).toBe(ACCOUNTING_PAGES.length)
    expect(new Set(ACCOUNTING_PAGES.map((p) => p.key)).size).toBe(ACCOUNTING_PAGES.length)
  })
})

describe('searchScore', () => {
  const hits = (q: string) => ACCOUNTING_PAGES.filter((p) => searchScore('', q, [p.keywords]) > 0).map((p) => p.key)
  it('finds a page by a German or English word, and nothing else', () => {
    expect(hits('mahnung')).toEqual(['reminders'])
    expect(hits('dunning')).toEqual(['reminders'])
    expect(hits('camt')).toEqual(['bank'])
  })
  it('ignores case and accents, and needs every word', () => {
    expect(searchScore('', 'ÜBERSICHT', ['Übersicht'])).toBeGreaterThan(0)
    expect(searchScore('', 'eroffnung', ['Eröffnungsbilanz'])).toBeGreaterThan(0)
    expect(searchScore('', 'bank nothing', ['bank'])).toBe(0)
  })
  it('ranks a hit in the label above one in the synonyms', () => {
    expect(searchScore('', 'bank', ['Bank', 'x'])).toBeGreaterThan(searchScore('', 'bank', ['Konten', 'bank']))
  })
})
