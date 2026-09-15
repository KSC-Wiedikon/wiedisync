import { describe, it, expect } from 'vitest'
import { buildFinanceGroups, navItemActive, navPathMatches } from '../financeNav'

/**
 * The Finances nav, pinned. Both surfaces (TopNav dropdown, MoreSheet) render
 * exactly what this module returns, so the routes below ARE the contract the
 * guide's help buttons and deep links depend on — a renamed `to` here is a
 * broken link.
 */
const routesOf = (groups: ReturnType<typeof buildFinanceGroups>) =>
  Object.fromEntries(groups.map((g) => [g.labelKey, g.items.map((i) => i.to)]))

describe('buildFinanceGroups', () => {
  it('a plain member with no team gets Member finance only', () => {
    const groups = buildFinanceGroups({ hasTeam: false, isTk: false, canAccessFinance: false })
    expect(routesOf(groups)).toEqual({
      memberFinance: ['/finance/dues', '/fines?scope=mine', '/finance/expense'],
    })
  })

  it('a team member also gets Team finance, in the middle', () => {
    const groups = buildFinanceGroups({ hasTeam: true, isTk: false, canAccessFinance: false })
    expect(groups.map((g) => g.labelKey)).toEqual(['memberFinance', 'teamFinance'])
    expect(routesOf(groups).teamFinance).toEqual(['/finance/team', '/fines?scope=team'])
  })

  it('a section TK without finance access gets Club finance with only the confirmation queue', () => {
    const groups = buildFinanceGroups({ hasTeam: false, isTk: true, canAccessFinance: false })
    expect(routesOf(groups).clubFinance).toEqual(['/finance/tk-expenses'])
  })

  it('finance/board gets the full Club finance group', () => {
    // canAccessFinance implies isTk in useNavItems (isTk = vb || bb || canAccessFinance);
    // the builder does not re-derive it, so pass both like the caller does.
    const groups = buildFinanceGroups({ hasTeam: true, isTk: true, canAccessFinance: true })
    expect(groups.map((g) => g.labelKey)).toEqual(['memberFinance', 'teamFinance', 'clubFinance'])
    expect(routesOf(groups).clubFinance).toEqual(['/finance/tk-expenses', '/admin/finance'])
  })

  it('never emits an empty group', () => {
    const combos = [false, true]
    for (const hasTeam of combos) for (const isTk of combos) for (const canAccessFinance of combos) {
      for (const g of buildFinanceGroups({ hasTeam, isTk, canAccessFinance })) {
        expect(g.items.length).toBeGreaterThan(0)
      }
    }
  })

  it('label keys are what the nav/finance namespaces carry', () => {
    const groups = buildFinanceGroups({ hasTeam: true, isTk: true, canAccessFinance: true })
    expect(groups.map((g) => g.labelKey)).toEqual(['memberFinance', 'teamFinance', 'clubFinance'])
    expect(groups.flatMap((g) => g.items.map((i) => i.labelKey))).toEqual([
      'finance:myDuesTitle', 'myFines', 'uploadInvoice',
      'teamFinancePage', 'teamFines',
      'finance:tkExpensesNav', 'finance:title',
    ])
  })
})

describe('navPathMatches — section-level (query ignored)', () => {
  it('matches the pathname and its children, not siblings', () => {
    expect(navPathMatches('/fines', '/fines?scope=mine')).toBe(true)
    expect(navPathMatches('/fines/12', '/fines?scope=team')).toBe(true)
    expect(navPathMatches('/finance/dues', '/finance/dues')).toBe(true)
    expect(navPathMatches('/finance/duesx', '/finance/dues')).toBe(false)
    expect(navPathMatches('/finance', '/finance/team')).toBe(false)
  })

  it('home is exact', () => {
    expect(navPathMatches('/', '/')).toBe(true)
    expect(navPathMatches('/fines', '/')).toBe(false)
  })
})

describe('navItemActive — item-level (query must agree)', () => {
  it('only the item whose scope matches lights up', () => {
    const at = (search: string) => ({ pathname: '/fines', search })
    expect(navItemActive(at('?scope=mine'), '/fines?scope=mine')).toBe(true)
    expect(navItemActive(at('?scope=mine'), '/fines?scope=team')).toBe(false)
    expect(navItemActive(at('?scope=team'), '/fines?scope=team')).toBe(true)
    expect(navItemActive(at('?scope=team'), '/fines?scope=mine')).toBe(false)
  })

  it('bare /fines lights neither scoped item (the section trigger still does)', () => {
    const loc = { pathname: '/fines', search: '' }
    expect(navItemActive(loc, '/fines?scope=mine')).toBe(false)
    expect(navItemActive(loc, '/fines?scope=team')).toBe(false)
    expect(navPathMatches(loc.pathname, '/fines?scope=mine')).toBe(true)
  })

  it('items without a query behave like navPathMatches', () => {
    expect(navItemActive({ pathname: '/finance/team', search: '?season=2026%2F27' }, '/finance/team')).toBe(true)
    expect(navItemActive({ pathname: '/finance/dues', search: '' }, '/finance/team')).toBe(false)
  })

  it('a wrong pathname never matches, whatever the query says', () => {
    expect(navItemActive({ pathname: '/finance/dues', search: '?scope=mine' }, '/fines?scope=mine')).toBe(false)
  })
})
