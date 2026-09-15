/**
 * buildFinesSummary — the numbers on the coach's printed ledger. The PDF
 * renderer is a thin autotable wrapper; what can go wrong is here: a waived
 * fine leaking into "open", a team fine landing on a person, a sort that puts
 * the team row in the middle of the alphabet.
 */
import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { buildFinesSummary } from './finesSummaryExport'
import type { Fine, FineRule } from '../../types'

const EN: Record<string, string> = {
  teamFineRow: 'Whole team', pdfTitle: 'Fines', pdfExported: 'Exported',
  statusOpen: 'Open', statusPaid: 'Paid', statusWaived: 'Waived',
  categoryLateSignin: 'Late sign-in', categoryNoShow: 'No-show', categoryCustom: 'Custom',
  settingsTypeGame: 'Games', settingsNoTiers: 'No tiers yet.', window30d: 'Rolling 30 days', windowSeason: 'Season (Sep–Aug)',
}
const t = ((key: string, opts?: { count?: number }) =>
  key === 'pdfFineCount' ? `${opts?.count} fines` : EN[key] ?? key) as unknown as TFunction

const fine = (over: Partial<Fine>): Fine => ({
  id: '1', member: '42', team: '7', category: 'late_signin', amount: 5, currency: 'CHF', status: 'open',
  activity_type: 'training', activity_id: null, activity_date: '2026-09-10', tier_offense: 1, reset_window_at_issue: 'never',
  reason: null, issued_by: null, issued_at: '2026-09-11T10:00:00Z', auto_issued: false,
  ...over,
} as Fine)
const rule = (over: Partial<FineRule>): FineRule => ({
  id: '1', team: '7', category: 'late_signin', activity_type: null, enabled: true,
  reset_window: 'rolling_30d', tiers: [{ offense: 1, amount: 5 }, { offense_min: 2, amount: 10 }], currency: 'CHF', ...over,
} as FineRule)

const members = [
  { id: 42, first_name: 'Luca', last_name: 'Canepa' },
  { id: 43, first_name: 'Anna', last_name: 'Müller', nickname: 'Anni' },
]

describe('buildFinesSummary', () => {
  const fines = [
    fine({ id: 'a', member: '43', amount: 5, status: 'open', issued_at: '2026-09-12T10:00:00Z' }),
    fine({ id: 'b', member: '42', amount: 5, status: 'paid', issued_at: '2026-09-01T10:00:00Z' }),
    fine({ id: 'c', member: '42', amount: 10, status: 'open', issued_at: '2026-09-11T10:00:00Z' }),
    fine({ id: 'd', member: '42', amount: 15, status: 'waived', issued_at: '2026-09-13T10:00:00Z' }),
    fine({ id: 'e', member: null, amount: 50, category: 'custom', activity_type: 'game', activity_date: null, reason: 'Forfait', status: 'open' }),
  ]
  const model = buildFinesSummary({ team: { name: 'H3', season: '2026/27' }, fines, members, rules: [], exportedAt: new Date('2026-09-15T10:30:00Z') }, t)

  it('splits each member into open / paid / waived and counts every fine', () => {
    const luca = model.perMember.find((r) => r.name === 'Canepa Luca')!
    expect(luca).toMatchObject({ count: 3, open: 10, paid: 5, waived: 15, isTeam: false })
  })
  it('prefers the nickname, sorts by name, and puts the team row last', () => {
    expect(model.perMember.map((r) => r.name)).toEqual(['Canepa Luca', 'Müller Anni', 'Whole team'])
    expect(model.perMember[2]).toMatchObject({ isTeam: true, open: 50 })
  })
  it('totals match the columns', () => {
    expect(model.totals).toEqual({ count: 5, open: 65, paid: 5, waived: 15 })
  })
  it('lists every fine oldest first, with activity + reason + status labels', () => {
    expect(model.detail.map((r) => r.date)).toEqual(['01.09.2026', '11.09.2026', '11.09.2026', '12.09.2026', '13.09.2026'])
    const team = model.detail.find((r) => r.reason === 'Forfait')!
    expect(team).toMatchObject({ member: 'Whole team', category: 'Custom', activity: 'Game', amount: 50, status: 'Open' })
    expect(model.detail[0].activity).toBe('Training 10.09.2026')
  })
  it('names the file after team, season and day', () => {
    expect(model.filename).toBe('fines-H3-2026-27-2026-09-15')
    expect(model.title).toBe('Fines — H3 · 2026/27')
  })
  it('an unknown member id still gets a row rather than crashing', () => {
    const m = buildFinesSummary({ team: { name: 'H3' }, fines: [fine({ member: '999' })], members: [], rules: [], exportedAt: new Date() }, t)
    expect(m.perMember[0].name).toBe('#999')
  })
})

describe('buildFinesSummary — rules', () => {
  it('one line per enabled rule, general before its overrides, disabled ones skipped', () => {
    const m = buildFinesSummary({
      team: { name: 'H3' }, fines: [], members: [], exportedAt: new Date(),
      rules: [
        rule({ id: 'o', activity_type: 'game', reset_window: 'season', tiers: [{ offense: 1, amount: 20 }] }),
        rule({ id: 'g' }),
        rule({ id: 'x', category: 'no_show', enabled: false }),
      ],
    }, t)
    expect(m.rules).toEqual([
      'Late sign-in: 1: CHF 5.00 · 2+: CHF 10.00 · rolling 30 days',
      'Late sign-in — Games: 1: CHF 20.00 · season (sep–aug)',
    ])
  })
})
