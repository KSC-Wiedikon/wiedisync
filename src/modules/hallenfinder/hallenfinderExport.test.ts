// The export is only useful if the file OPENS and the numbers are numbers, so
// these tests build a real workbook and read it back with exceljs rather than
// asserting on the builder's inputs.
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildHallenfinderXlsx, type HallenfinderXlsxLabels, type HallenfinderXlsxMeta } from './hallenfinderExport'
import type { HallResult } from './useHallenfinder'

const L: HallenfinderXlsxLabels = {
  sheetHalls: 'Halls', sheetCourts: 'Courts', sheetSearch: 'Search',
  day: 'Day', hall: 'Hall', type: 'Type', window: 'Free window',
  weeksFree: 'Weeks free', weeksTotal: 'Weeks total', everyWeek: 'Every week',
  size: 'Size (L × W × H)', lengthM: 'Length (m)', widthM: 'Width (m)', heightM: 'Height (m)',
  courts: 'Courts', district: 'District', quarter: 'Quarter', schoolDistrict: 'School district',
  address: 'Address', plz: 'Postcode', contact: 'Contact', calendar: 'Calendar', booking: 'Request',
  court: 'Court', segment: 'Segment', criterion: 'Criterion', value: 'Value',
  weekdays: 'Weekdays', startFrom: 'From', minDuration: 'Min. duration', hallType: 'Hall type',
  onlyEveryWeek: 'Only halls free every week', season: 'Season', dataUpdated: 'Availability data from',
  exported: 'Exported', resultCount: 'Halls in this export',
  any: 'Any', yes: 'Yes', no: 'No',
  weekdayNames: { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' },
  typeNames: { sporthalle: 'Sport hall', dreifachhalle: 'Triple hall' },
}

const meta: HallenfinderXlsxMeta = {
  filters: {
    weekdays: [1, 3], startFrom: '18:00', minMinutes: 90,
    district: '3', hallType: null, freeAllNonHolidayWeeks: true,
  },
  season: { start: '2026-10-19', end: '2027-04-11' },
  lastUpdated: '2026-08-05T04:12:00.000Z',
  exportedAt: '05.08.2026 12:40',
  formatDate: (iso) => {
    const d = new Date(iso)
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
  },
}

const hall = (over: Partial<HallResult> = {}): HallResult => ({
  einrichtungId: 1, name: 'Sporthalle Musterweg', hallType: 'dreifachhalle',
  address: 'Musterweg 1', plz: '8003', stadtkreis: '3', stadtquartier: 'Sihlfeld',
  schulkreis: 'Uto', hallTypeLabel: null, sizeLabel: '45,00 x 27,00 x 7,00 m',
  lengthM: 45, widthM: 27, heightM: 7, partitions: [],
  photoUrl: null, photoThumbUrl: null, contactEmail: 'hauswart@example.ch',
  weekday: 1, weeksTotal: 20, weeksFree: 20, freeAllNonHolidayWeeks: true,
  sampleWindow: '18:00–20:00', detailsUrl: 'https://example.ch/d',
  belegungsplanUrl: 'https://example.ch/plan', reservationUrl: 'https://example.ch/book',
  ...over,
})

const read = async (bytes: Uint8Array) => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes.buffer as ArrayBuffer)
  return wb
}

describe('buildHallenfinderXlsx', () => {
  it('writes one row per hall with dimensions as real numbers, not text', async () => {
    const wb = await read(await buildHallenfinderXlsx([hall()], meta, L))
    const ws = wb.getWorksheet('Halls')!
    expect(ws.rowCount).toBe(2) // header + 1

    const header = ws.getRow(1).values as unknown[]
    expect(header).toContain('Hall')
    expect(header).toContain('Length (m)')

    const row = ws.getRow(2)
    const col = (name: string) => (ws.getRow(1).values as unknown[]).indexOf(name)
    expect(row.getCell(col('Hall')).value).toBe('Sporthalle Musterweg')
    expect(row.getCell(col('Day')).value).toBe('Monday')
    // The whole reason the parsed columns exist: sortable/filterable numbers.
    expect(row.getCell(col('Length (m)')).value).toBe(45)
    expect(typeof row.getCell(col('Width (m)')).value).toBe('number')
    // …alongside the city's own string, kept verbatim, comma and all.
    expect(row.getCell(col('Size (L × W × H)')).value).toBe('45,00 x 27,00 x 7,00 m')
    expect(row.getCell(col('Type')).value).toBe('Triple hall')
  })

  it('leaves unmeasured halls blank rather than writing 0', async () => {
    // A 0 would sort as "smallest hall" and quietly assert a measurement the
    // city has not published yet (the detail pass fills these in monthly).
    const wb = await read(await buildHallenfinderXlsx(
      [hall({ lengthM: null, widthM: null, heightM: null, sizeLabel: null })], meta, L,
    ))
    const ws = wb.getWorksheet('Halls')!
    const col = (name: string) => (ws.getRow(1).values as unknown[]).indexOf(name)
    const v = ws.getRow(2).getCell(col('Length (m)')).value
    expect(v == null || v === '').toBe(true)
    expect(v).not.toBe(0)
  })

  it('writes the booking links as hyperlinks, not bare text', async () => {
    const wb = await read(await buildHallenfinderXlsx([hall()], meta, L))
    const ws = wb.getWorksheet('Halls')!
    const col = (name: string) => (ws.getRow(1).values as unknown[]).indexOf(name)
    const cell = ws.getRow(2).getCell(col('Request')).value as { text: string; hyperlink: string }
    expect(cell.hyperlink).toBe('https://example.ch/book')
    expect(cell.text).toBe('Request')
  })

  it('omits the courts sheet when no hall is partitioned', async () => {
    const wb = await read(await buildHallenfinderXlsx([hall()], meta, L))
    expect(wb.getWorksheet('Courts')).toBeUndefined()
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Halls', 'Search'])
  })

  it('gives each sub-court its own row, keyed back to the hall', async () => {
    const withCourts = hall({
      partitions: [
        { label: 'A', sizeLabel: '15 x 27 m', length: 15, width: 27, height: 7, segment: '1' },
        { label: 'B', sizeLabel: '15 x 27 m', length: 15, width: 27, height: 7, segment: '2' },
      ],
    })
    const wb = await read(await buildHallenfinderXlsx([withCourts], meta, L))
    const cs = wb.getWorksheet('Courts')!
    expect(cs.rowCount).toBe(3) // header + 2
    const col = (name: string) => (cs.getRow(1).values as unknown[]).indexOf(name)
    expect(cs.getRow(2).getCell(col('Hall')).value).toBe('Sporthalle Musterweg')
    expect(cs.getRow(2).getCell(col('Court')).value).toBe('A')
    expect(cs.getRow(3).getCell(col('Court')).value).toBe('B')
    // The hall sheet still reports how many, so the two sheets agree.
    const hs = wb.getWorksheet('Halls')!
    const hcol = (name: string) => (hs.getRow(1).values as unknown[]).indexOf(name)
    expect(hs.getRow(2).getCell(hcol('Courts')).value).toBe(2)
  })

  it('records the filters, season and data date so the file stays interpretable', async () => {
    const wb = await read(await buildHallenfinderXlsx([hall()], meta, L))
    const ss = wb.getWorksheet('Search')!
    const pairs = new Map<string, unknown>()
    ss.eachRow((r, i) => { if (i > 1) pairs.set(String(r.getCell(1).value), r.getCell(2).value) })
    expect(pairs.get('Weekdays')).toBe('Monday, Wednesday')
    expect(pairs.get('From')).toBe('18:00')
    expect(pairs.get('Min. duration')).toBe('90 min')
    expect(pairs.get('District')).toBe('Kreis 3')
    expect(pairs.get('Hall type')).toBe('Any')       // null filter → "Any", never blank
    expect(pairs.get('Only halls free every week')).toBe('Yes')
    expect(pairs.get('Season')).toBe('19.10.2026 – 11.04.2027') // Swiss, not ISO
    expect(pairs.get('Availability data from')).toBe('05.08.2026')
    expect(pairs.get('Halls in this export')).toBe('1')
  })

  it('produces a workbook for an empty result set instead of throwing', async () => {
    const wb = await read(await buildHallenfinderXlsx([], meta, L))
    expect(wb.getWorksheet('Halls')!.rowCount).toBe(1) // header only
    expect(wb.getWorksheet('Search')).toBeDefined()
  })
})
