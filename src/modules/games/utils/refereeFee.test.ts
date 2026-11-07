import { describe, expect, it } from 'vitest'
import {
  countReferees,
  formatAmountInput,
  gboFeePerReferee,
  gboRefereeFee,
  planRefereeExpenseSave,
  splitEvenly,
  sumChf,
  type RefereeRowRef,
  type RefereeShare,
} from './refereeFee'

describe('gboFeePerReferee', () => {
  it.each([
    ['Männer 2. Liga', 60],
    ['Frauen 2. Liga', 60],
    ['Herren 2. Liga', 60],
    ['Frauen 3. Liga Gruppe A', 50],
    ['Herren 3. Liga Gruppe B', 50],
    ['Herren 4. Liga Gruppe A', 40],
    ['Männer 4. Liga Gruppe C', 40],
    ['Frauen 5. Liga Gruppe D', 40],
    ['2L', 60],
    ['3L', 50],
    ['4L', 40],
    ['5L', 40],
    ['Frauen U23 1. Liga', 50],
    ['Männer U23 1. Stärkeklasse', 50],
    ['Frauen U23 2. Liga', 40],
    ['Frauen U23 3. Stärkeklasse', 40],
  ])('%s → CHF %i', (league, fee) => {
    expect(gboFeePerReferee(league)).toBe(fee)
  })

  it.each([
    'Frauen 1. Liga',
    '1L',
    'NLA',
    'NLB',
    'Männer U20',
    'U20 Ligamodus',
    'Frauen U18 2. Liga',
    'Männer U23 Gruppe A',
    'U23 Gruppe A',
    'U23',
    'Züri Cup — Runde 2, Spiel 3',
    'Mobiliar Volley Cup — Tour 3, Spiel 15',
    '',
  ])('%s has no price', (league) => {
    expect(gboFeePerReferee(league)).toBeNull()
  })

  it('handles a game with no league', () => {
    expect(gboFeePerReferee(null)).toBeNull()
    expect(gboFeePerReferee(undefined)).toBeNull()
  })
})

describe('countReferees', () => {
  it('counts the listed referees', () => {
    expect(countReferees([{ name: 'A' }, { name: 'B' }])).toBe(2)
    expect(countReferees([{ name: 'A' }])).toBe(1)
    expect(countReferees([])).toBe(0)
  })

  it('reads anything that is not a list as none', () => {
    expect(countReferees(null)).toBe(0)
    expect(countReferees(undefined)).toBe(0)
    expect(countReferees('[]')).toBe(0)
  })
})

describe('gboRefereeFee', () => {
  it.each([
    ['Männer 2. Liga', 2, 160],
    ['Frauen 3. Liga Gruppe A', 2, 140],
    ['Herren 3. Liga Gruppe B', 1, 70],
    ['Männer 4. Liga Gruppe C', 1, 60],
    ['Frauen 5. Liga Gruppe B', 1, 60],
    ['Frauen U23 1. Liga', 1, 70],
    ['Frauen U23 3. Stärkeklasse', 1, 60],
  ])('%s with %i referee(s) = CHF %i, fee + travel', (league, referees, total) => {
    expect(gboRefereeFee(league, referees)?.total).toBe(total)
  })

  it.each([[0], [null], [undefined]])('assumes two referees when the game lists %s', (referees) => {
    expect(gboRefereeFee('Frauen 5. Liga Gruppe B', referees)).toMatchObject({ referees: 2, total: 120 })
  })

  it('names the parts of the sum', () => {
    expect(gboRefereeFee('Männer 2. Liga', 2)).toEqual({
      referees: 2,
      feePerReferee: 60,
      travelPerReferee: 20,
      total: 160,
    })
  })

  it('is null when the table has no price', () => {
    expect(gboRefereeFee('Züri Cup — Runde 2, Spiel 3', 1)).toBeNull()
  })
})

describe('splitEvenly', () => {
  it('divides evenly when it can', () => {
    expect(splitEvenly(160, 2)).toEqual([80, 80])
    expect(splitEvenly(120, 3)).toEqual([40, 40, 40])
  })

  it('rounds to 5 Rappen and the first people carry the rest', () => {
    expect(splitEvenly(160, 3)).toEqual([53.35, 53.35, 53.3])
  })

  it.each([
    [160, 3],
    [140, 3],
    [120, 7],
    [100.05, 2],
    [100.01, 2],
    [0.05, 3],
  ])('%d between %i people adds back up exactly', (total, people) => {
    const shares = splitEvenly(total, people)
    expect(shares).toHaveLength(people)
    expect(sumChf(shares)).toBe(total)
  })

  it('returns nothing for nobody', () => {
    expect(splitEvenly(160, 0)).toEqual([])
  })
})

describe('sumChf', () => {
  it('does not drift', () => {
    expect(sumChf([0.1, 0.2])).toBe(0.3)
    expect(sumChf(['53.35', '53.35', '53.30'])).toBe(160)
  })

  it('reads anything empty as 0', () => {
    expect(sumChf(['', null, undefined, 'x', 10])).toBe(10)
  })
})

describe('formatAmountInput', () => {
  it('shows what the field should hold', () => {
    expect(formatAmountInput(0)).toBe('')
    expect(formatAmountInput(160)).toBe('160')
    expect(formatAmountInput(53.3)).toBe('53.30')
  })
})

describe('planRefereeExpenseSave', () => {
  const member = (id: string, amount: number): RefereeShare => ({ member: id, other: null, amount })
  const other = (name: string, amount: number): RefereeShare => ({ member: null, other: name, amount })
  const row = (id: string, m: string | null, o: string | null = null): RefereeRowRef => ({ id, member: m, other: o })

  it('creates every row on a first save', () => {
    const shares = [member('1', 80), member('2', 80)]
    expect(planRefereeExpenseSave([], shares)).toEqual({ update: [], create: shares, remove: [] })
  })

  it('splitting an existing fee keeps the first row and adds one', () => {
    expect(planRefereeExpenseSave([row('10', '1')], [member('1', 80), member('2', 80)])).toEqual({
      update: [{ id: '10', share: member('1', 80) }],
      create: [member('2', 80)],
      remove: [],
    })
  })

  it('undoing a split removes the row of whoever left', () => {
    expect(planRefereeExpenseSave([row('10', '1'), row('11', '2')], [member('2', 160)])).toEqual({
      update: [{ id: '11', share: member('2', 160) }],
      create: [],
      remove: ['10'],
    })
  })

  it('changing who paid stays an update on the same row', () => {
    expect(planRefereeExpenseSave([row('10', '1')], [member('2', 160)])).toEqual({
      update: [{ id: '10', share: member('2', 160) }],
      create: [],
      remove: [],
    })
  })

  it('swapping one of several payers reuses the freed row', () => {
    const plan = planRefereeExpenseSave([row('10', '1'), row('11', '2')], [member('2', 80), member('3', 80)])
    expect(plan.update).toEqual([
      { id: '11', share: member('2', 80) },
      { id: '10', share: member('3', 80) },
    ])
    expect(plan.create).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it('matches a free-text payer by name, ignoring case and spaces', () => {
    expect(planRefereeExpenseSave([row('10', null, 'Anna Muster')], [other(' anna muster ', 90)])).toEqual({
      update: [{ id: '10', share: other(' anna muster ', 90) }],
      create: [],
      remove: [],
    })
  })

  it('keeps a member and a free-text payer of the same id apart', () => {
    const plan = planRefereeExpenseSave([row('10', '1')], [member('1', 80), other('1', 80)])
    expect(plan.update).toEqual([{ id: '10', share: member('1', 80) }])
    expect(plan.create).toEqual([other('1', 80)])
  })
})
