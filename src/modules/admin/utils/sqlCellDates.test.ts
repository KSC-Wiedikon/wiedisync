/**
 * Pins the three temporal shapes a SQL-workspace cell can take and what each
 * must become in the grid, in CSV/TSV and in Excel.
 *
 * Why this exists. `games.date` (a plain `date`) rendered as "15.09.2026 02:00"
 * in the console and exported as a midnight datetime: the value arrived as an
 * ISO instant and was pushed through `new Date()`, so a calendar day picked up
 * the Zurich offset — 02:00 in summer, 01:00 in winter. A date and a zone-less
 * timestamp must be read field-by-field; only a zoned instant is converted.
 */
import { describe, it, expect } from 'vitest'
import { parseSqlTemporal, formatSqlTemporal, sqlTemporalToExcelDate } from './sqlCellDates'
import { toCSV, toTSV } from './exportResults'

describe('parseSqlTemporal', () => {
  it('reads a date as a calendar day, no zone', () => {
    expect(parseSqlTemporal('2026-09-15')).toEqual({ kind: 'date', y: 2026, m: 9, d: 15, hh: 0, mi: 0, ss: 0 })
  })

  it('reads a zone-less timestamp as wall-clock text, space- or T-separated', () => {
    expect(parseSqlTemporal('2026-09-15 20:00:00')).toEqual({ kind: 'wallclock', y: 2026, m: 9, d: 15, hh: 20, mi: 0, ss: 0 })
    expect(parseSqlTemporal('2026-09-15T20:15')).toMatchObject({ kind: 'wallclock', hh: 20, mi: 15, ss: 0 })
    expect(parseSqlTemporal('2026-09-15 20:00:00.123456')).toMatchObject({ kind: 'wallclock', ss: 0 })
  })

  it('converts an instant to Europe/Zurich, on both sides of DST', () => {
    // The symptom: a date that had been serialised as a UTC midnight instant.
    expect(parseSqlTemporal('2026-09-15T00:00:00.000Z')).toMatchObject({ kind: 'instant', d: 15, hh: 2 })
    expect(parseSqlTemporal('2026-12-01T00:00:00.000Z')).toMatchObject({ kind: 'instant', d: 1, hh: 1 })
    // Past midnight UTC on the previous day still lands on the right Zurich day.
    expect(parseSqlTemporal('2026-09-14T22:30:00Z')).toMatchObject({ kind: 'instant', m: 9, d: 15, hh: 0, mi: 30 })
  })

  it("accepts Postgres's own text zones (+00, +0200, +02:00)", () => {
    expect(parseSqlTemporal('2026-09-10 12:32:00+00')).toMatchObject({ kind: 'instant', hh: 14, mi: 32 })
    expect(parseSqlTemporal('2026-09-10 12:32:00+0200')).toMatchObject({ kind: 'instant', hh: 12, mi: 32 })
    expect(parseSqlTemporal('2026-09-10T12:32:00+02:00')).toMatchObject({ kind: 'instant', hh: 12, mi: 32 })
  })

  it('ignores everything that is not a temporal string', () => {
    for (const v of ['2026 budget', '2026-09', '15.09.2026', '20:00:00', '2026-09-15x', 42, null, undefined, true, {}]) {
      expect(parseSqlTemporal(v)).toBeNull()
    }
  })
})

describe('formatSqlTemporal', () => {
  it('is Swiss: dd.mm.yyyy, 24h, seconds only on request', () => {
    expect(formatSqlTemporal(parseSqlTemporal('2026-09-05')!)).toBe('05.09.2026')
    expect(formatSqlTemporal(parseSqlTemporal('2026-09-15 20:00:00')!)).toBe('15.09.2026 20:00')
    expect(formatSqlTemporal(parseSqlTemporal('2026-09-15 20:00:07')!, { seconds: true })).toBe('15.09.2026 20:00:07')
    expect(formatSqlTemporal(parseSqlTemporal('2026-09-15T00:00:00.000Z')!)).toBe('15.09.2026 02:00')
  })
})

describe('sqlTemporalToExcelDate', () => {
  it('carries the wall-clock in the UTC fields exceljs reads', () => {
    expect(sqlTemporalToExcelDate(parseSqlTemporal('2026-09-15')!).toISOString()).toBe('2026-09-15T00:00:00.000Z')
    expect(sqlTemporalToExcelDate(parseSqlTemporal('2026-09-15 20:00:00')!).toISOString()).toBe('2026-09-15T20:00:00.000Z')
    // An instant lands as its Zurich time, not its UTC time.
    expect(sqlTemporalToExcelDate(parseSqlTemporal('2026-09-10T12:32:00Z')!).toISOString()).toBe('2026-09-10T14:32:00.000Z')
  })
})

describe('text exports', () => {
  const columns = ['date', 'time', 'date_created', 'name']
  const rows = [['2026-09-15', '20:00:00', '2026-09-10T12:32:05.000Z', 'DU23-1']]

  it('CSV and TSV write Swiss dates and Zurich times, not ISO instants', () => {
    expect(toCSV(columns, rows).split('\n')[1]).toBe('15.09.2026,20:00:00,10.09.2026 14:32:05,DU23-1')
    expect(toTSV(columns, rows).split('\n')[1]).toBe('15.09.2026\t20:00:00\t10.09.2026 14:32:05\tDU23-1')
  })
})
