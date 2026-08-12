/**
 * Parity across every season implementation in the repo.
 *
 * The Jun 1 cutover has to exist twice — the frontend and the Directus
 * extensions are separate deploy units, and the extensions cannot import from
 * src/ (they are rsynced from directus/extensions/). kscw-hooks reuses the
 * kscw-endpoints module rather than keeping a third copy. Copies drift; these
 * are the two that did, both found on 2026-07-29:
 *
 *   • kscw_current_season_start() sat on a Sep 1 cutover for a year while every
 *     JS caller used Jun 1 (fixed by migration 268).
 *   • messaging-helpers.js shareTeam() sat on an Aug 1 cutover, so from Jun 1 to
 *     Jul 31 it read the previous season's rosters and downgraded teammates' DMs
 *     to approval-gated requests. 82 members were affected when it was found.
 *
 * So this file does not test "the logic is right" (the boundary cases below do
 * that once). It tests that the implementations CANNOT diverge: every day of a
 * four-year span is compared across both. Editing one without the other fails
 * here.
 *
 * The Postgres function is the third implementation and cannot be imported.
 * It is pinned instead by SEASON_START_YEAR_CASES, which is the same table its
 * migration was verified against — see 268-season-cutover-jun1.sql.
 */
import { describe, it, expect } from 'vitest'
import * as fe from '../season'
// @ts-expect-error — plain JS module outside the TS project, imported for parity
import * as endpoints from '../../../directus/extensions/kscw-endpoints/src/season.js'

const IMPLS = [
  ['frontend', fe],
  ['kscw-endpoints', endpoints],
] as const

const FNS = [
  'seasonStartYear', 'currentSeasonShort', 'currentSeasonLong',
  'seasonStartDate', 'seasonRolloverDate', 'seasonEndDate',
] as const

/** Same contract, but keyed on a YYYY-MM-DD string rather than a Date. */
const YMD_FNS = ['seasonForYmd'] as const

/** The two call shapes present in the season modules. */
type DateFns = Record<string, (d: Date) => unknown>
type YmdFns = Record<string, (ymd: string) => unknown>

/** Noon Zurich-ish, to stay clear of the DST/midnight edge when stepping days. */
const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe('season parity — the implementations cannot diverge', () => {
  it('exports the same surface', () => {
    for (const [name, impl] of IMPLS) {
      for (const fn of FNS) {
        expect(typeof (impl as Record<string, unknown>)[fn], `${name}.${fn}`).toBe('function')
      }
    }
  })

  it('agrees on every day from 2025-01-01 to 2028-12-31', () => {
    const mismatches: string[] = []
    const day = new Date(Date.UTC(2025, 0, 1, 12))
    const end = Date.UTC(2028, 11, 31, 12)
    while (day.getTime() <= end) {
      for (const fn of FNS) {
        const [, ref] = IMPLS[0]
        const expected = String((ref as unknown as DateFns)[fn](day))
        for (const [name, impl] of IMPLS.slice(1)) {
          const got = String((impl as unknown as DateFns)[fn](day))
          if (got !== expected) {
            mismatches.push(`${day.toISOString().slice(0, 10)} ${fn}: frontend=${expected} ${name}=${got}`)
          }
        }
      }
      day.setUTCDate(day.getUTCDate() + 1)
    }
    expect(mismatches.slice(0, 10)).toEqual([])
  })
})

describe('season boundaries (the Jun 1 cutover itself)', () => {
  // Same table migration 268 was verified against.
  const SEASON_START_YEAR_CASES: Array<[string, number]> = [
    ['2026-01-01', 2025], ['2026-05-01', 2025], ['2026-05-31', 2025],
    ['2026-06-01', 2026], ['2026-07-29', 2026], ['2026-08-31', 2026],
    ['2026-09-01', 2026], ['2026-12-31', 2026], ['2027-01-01', 2026],
    ['2027-05-31', 2026], ['2027-06-01', 2027],
  ]

  it.each(SEASON_START_YEAR_CASES)('%s → season starting %i', (iso, year) => {
    expect(fe.seasonStartYear(at(iso))).toBe(year)
  })

  it('flips on Jun 1, not Sep 1 and not Aug 1', () => {
    expect(fe.currentSeasonShort(at('2026-05-31'))).toBe('2025/26')
    expect(fe.currentSeasonShort(at('2026-06-01'))).toBe('2026/27')
    // The two cutovers that had actually drifted in this repo:
    expect(fe.currentSeasonShort(at('2026-07-15'))).toBe('2026/27') // was Aug 1 in messaging-helpers
    expect(fe.currentSeasonShort(at('2026-08-15'))).toBe('2026/27') // was Sep 1 in the PG function
  })

  it('renders both season forms consistently', () => {
    expect(fe.currentSeasonShort(at('2026-07-29'))).toBe('2026/27')
    expect(fe.currentSeasonLong(at('2026-07-29'))).toBe('2026/2027')
    expect(fe.currentSeasonShort(at('2099-07-01'))).toBe('2099/00')
    expect(fe.currentSeasonLong(at('2099-07-01'))).toBe('2099/2100')
  })

  it('rollover is always in the past; season start is not', () => {
    // The distinction the fines counter got wrong: Sep 1 is in the FUTURE for a
    // quarter of the year, so it cannot serve as a window start.
    expect(fe.seasonRolloverDate(at('2026-07-29'))).toBe('2026-06-01')
    expect(fe.seasonStartDate(at('2026-07-29'))).toBe('2026-09-01')
    for (const iso of ['2026-06-01', '2026-07-29', '2026-08-31', '2026-09-01', '2027-05-31']) {
      expect(fe.seasonRolloverDate(at(iso)) <= iso, `rollover must not be in the future on ${iso}`).toBe(true)
    }
  })

  it('season end is May 31 of the following year', () => {
    expect(fe.seasonEndDate(at('2026-07-29'))).toBe('2027-05-31')
    expect(fe.seasonEndDate(at('2027-01-15'))).toBe('2027-05-31')
  })

  it('boundaries are Europe/Zurich, not UTC', () => {
    // 2026-05-31T22:30Z is already Jun 1 in Zurich (CEST, +02:00). The copies
    // that used getUTCMonth() reported the old season for those two hours.
    expect(fe.seasonStartYear(new Date('2026-05-31T22:30:00Z'))).toBe(2026)
    expect(fe.seasonStartYear(new Date('2026-05-31T21:30:00Z'))).toBe(2025)
  })
})

describe('seasonForYmd parity + contract', () => {
  it('agrees across both implementations on every day of a four-year span', () => {
    const d = new Date(Date.UTC(2025, 0, 1, 12))
    for (let i = 0; i < 365 * 4; i++) {
      const ymd = d.toISOString().slice(0, 10)
      for (const fn of YMD_FNS) {
        const feOut = (fe as unknown as YmdFns)[fn](ymd)
        const epOut = (endpoints as unknown as YmdFns)[fn](ymd)
        expect(epOut, `${fn}(${ymd}) diverged`).toBe(feOut)
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }
  })

  it('puts the Jun-1 boundary in the same place as currentSeasonShort', () => {
    expect(fe.seasonForYmd('2026-05-31')).toBe('2025/26')
    expect(fe.seasonForYmd('2026-06-01')).toBe('2026/27')
    expect(fe.seasonForYmd('2026-12-31')).toBe('2026/27')
    expect(fe.seasonForYmd('2027-01-01')).toBe('2026/27')
  })
})
