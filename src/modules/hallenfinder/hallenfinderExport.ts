// Excel export of the hall-finder result set.
//
// The point of the export is NOT to reproduce the table — the page already
// shows that. It is to hand someone a file they can sort, filter and mail on:
//
//   • Everything the table hides behind a breakpoint (address, PLZ, district,
//     quarter, school district, contact) is a column here. On a phone the page
//     shows four of nineteen fields.
//   • Dimensions ship BOTH ways: the city's own `sizeLabel` string verbatim
//     ("23,00 x 10,90 x 5,40 m", Swiss decimal comma) *and* the parsed metres as
//     real numbers, so Excel can actually filter "length ≥ 36".
//   • Sub-courts get their own sheet — a hall with three partitions is one row
//     on the page but three bookable spaces in reality.
//   • A "Search" sheet records the filters, the season and the data date.
//     Availability is a claim about a moment; a spreadsheet of "free halls" with
//     no filter and no date is a spreadsheet nobody can act on two weeks later.
//
// English-only, per the app-wide export convention (see the `exports always
// English` rule): these files get forwarded to people whose UI language is not
// the exporter's. Dates stay Swiss dd.mm.yyyy regardless — CLAUDE.md.

import type { HallResult, HallenfinderFilters } from './useHallenfinder'

export { downloadBytes } from '../gameScheduling/lib/scheduleExport'
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const HEADER_FILL = 'FF1E3A8A'  // brand blue, same as the other exports
const ALL_WEEKS_FILL = 'FFDCFCE7' // light green — free every non-holiday week

export interface HallenfinderXlsxMeta {
  filters: HallenfinderFilters
  season: { start: string; end: string } | null
  lastUpdated: string | null
  /** Swiss-formatted export timestamp, passed in so this module stays pure. */
  exportedAt: string
  /** dd.mm.yyyy formatter — injected rather than imported, same reason. */
  formatDate: (iso: string) => string
}

export interface HallenfinderXlsxLabels {
  sheetHalls: string
  sheetCourts: string
  sheetSearch: string
  day: string
  hall: string
  type: string
  window: string
  weeksFree: string
  weeksTotal: string
  everyWeek: string
  size: string
  lengthM: string
  widthM: string
  heightM: string
  courts: string
  district: string
  quarter: string
  schoolDistrict: string
  address: string
  plz: string
  contact: string
  calendar: string
  booking: string
  court: string
  segment: string
  criterion: string
  value: string
  weekdays: string
  startFrom: string
  minDuration: string
  hallType: string
  onlyEveryWeek: string
  season: string
  dataUpdated: string
  exported: string
  resultCount: string
  any: string
  yes: string
  no: string
  weekdayNames: Record<number, string>
  typeNames: Record<string, string>
}

/** `[1,3,5]` → "Monday, Wednesday, Friday"; empty → "Any". */
const weekdayList = (days: number[], L: HallenfinderXlsxLabels) =>
  days.length ? days.map((d) => L.weekdayNames[d] ?? String(d)).join(', ') : L.any

export async function buildHallenfinderXlsx(
  results: HallResult[],
  meta: HallenfinderXlsxMeta,
  L: HallenfinderXlsxLabels,
): Promise<Uint8Array> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()

  const headerRow = (row: import('exceljs').Row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    row.alignment = { vertical: 'middle' }
  }

  // ── Sheet 1: halls ────────────────────────────────────────────────
  const ws = wb.addWorksheet(L.sheetHalls.slice(0, 31))
  ws.columns = [
    { key: 'day', header: L.day, width: 11 },
    { key: 'hall', header: L.hall, width: 34 },
    { key: 'type', header: L.type, width: 18 },
    { key: 'window', header: L.window, width: 15 },
    { key: 'weeksFree', header: L.weeksFree, width: 11 },
    { key: 'weeksTotal', header: L.weeksTotal, width: 11 },
    { key: 'everyWeek', header: L.everyWeek, width: 11 },
    { key: 'size', header: L.size, width: 24 },
    { key: 'lengthM', header: L.lengthM, width: 10 },
    { key: 'widthM', header: L.widthM, width: 10 },
    { key: 'heightM', header: L.heightM, width: 10 },
    { key: 'courts', header: L.courts, width: 8 },
    { key: 'district', header: L.district, width: 10 },
    { key: 'quarter', header: L.quarter, width: 20 },
    { key: 'schoolDistrict', header: L.schoolDistrict, width: 16 },
    { key: 'address', header: L.address, width: 34 },
    { key: 'plz', header: L.plz, width: 8 },
    { key: 'contact', header: L.contact, width: 30 },
    { key: 'calendar', header: L.calendar, width: 12 },
    { key: 'booking', header: L.booking, width: 12 },
  ]
  headerRow(ws.getRow(1))
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of results) {
    const row = ws.addRow({
      day: L.weekdayNames[r.weekday] ?? String(r.weekday),
      hall: r.name,
      // The city's own label when it has one; our translated bucket otherwise.
      type: r.hallTypeLabel ?? (r.hallType ? L.typeNames[r.hallType] ?? r.hallType : ''),
      window: r.sampleWindow ?? '',
      weeksFree: r.weeksFree,
      weeksTotal: r.weeksTotal,
      everyWeek: r.freeAllNonHolidayWeeks ? L.yes : L.no,
      size: r.sizeLabel ?? '',
      // Real numbers, not the label — this is the whole reason the parsed
      // columns exist. Blank rather than 0 when the detail pass hasn't run:
      // a 0 would sort as "smallest hall" and quietly lie.
      lengthM: r.lengthM ?? null,
      widthM: r.widthM ?? null,
      heightM: r.heightM ?? null,
      courts: r.partitions?.length || null,
      district: r.stadtkreis ? `Kreis ${r.stadtkreis}` : '',
      quarter: r.stadtquartier ?? '',
      schoolDistrict: r.schulkreis ?? '',
      address: r.address ?? '',
      plz: r.plz ?? '',
      contact: r.contactEmail ?? '',
    })

    // Links as real hyperlinks — the URLs themselves are long city-tool query
    // strings nobody reads, so the cell shows a verb.
    for (const [key, url] of [['calendar', r.belegungsplanUrl], ['booking', r.reservationUrl]] as const) {
      if (!url) continue
      const cell = row.getCell(key)
      cell.value = { text: key === 'calendar' ? L.calendar : L.booking, hyperlink: url }
      cell.font = { color: { argb: 'FF1D4ED8' }, underline: true }
    }

    if (r.freeAllNonHolidayWeeks) {
      row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALL_WEEKS_FILL } } })
    }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } }

  // ── Sheet 2: sub-courts (only when some hall actually has them) ───
  const withCourts = results.filter((r) => r.partitions?.length > 0)
  if (withCourts.length) {
    const cs = wb.addWorksheet(L.sheetCourts.slice(0, 31))
    cs.columns = [
      { key: 'hall', header: L.hall, width: 34 },
      { key: 'court', header: L.court, width: 18 },
      { key: 'size', header: L.size, width: 24 },
      { key: 'lengthM', header: L.lengthM, width: 10 },
      { key: 'widthM', header: L.widthM, width: 10 },
      { key: 'heightM', header: L.heightM, width: 10 },
      { key: 'segment', header: L.segment, width: 14 },
    ]
    headerRow(cs.getRow(1))
    cs.views = [{ state: 'frozen', ySplit: 1 }]
    for (const r of withCourts) {
      for (const p of r.partitions) {
        cs.addRow({
          hall: r.name,
          court: p.label ?? '',
          size: p.sizeLabel ?? '',
          lengthM: p.length ?? null,
          widthM: p.width ?? null,
          heightM: p.height ?? null,
          segment: p.segment ?? '',
        })
      }
    }
    cs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cs.columns.length } }
  }

  // ── Sheet 3: what was searched, and when ─────────────────────────
  const ss = wb.addWorksheet(L.sheetSearch.slice(0, 31))
  ss.columns = [
    { key: 'criterion', header: L.criterion, width: 26 },
    { key: 'value', header: L.value, width: 52 },
  ]
  headerRow(ss.getRow(1))
  const f = meta.filters
  const rows: [string, string][] = [
    [L.weekdays, weekdayList(f.weekdays, L)],
    [L.startFrom, f.startFrom],
    [L.minDuration, `${f.minMinutes} min`],
    [L.district, f.district ? `Kreis ${f.district}` : L.any],
    [L.hallType, f.hallType ? L.typeNames[f.hallType] ?? f.hallType : L.any],
    [L.onlyEveryWeek, f.freeAllNonHolidayWeeks ? L.yes : L.no],
    [L.season, meta.season ? `${meta.formatDate(meta.season.start)} – ${meta.formatDate(meta.season.end)}` : '—'],
    [L.dataUpdated, meta.lastUpdated ? meta.formatDate(meta.lastUpdated) : '—'],
    [L.exported, meta.exportedAt],
    [L.resultCount, String(results.length)],
  ]
  for (const [criterion, value] of rows) ss.addRow({ criterion, value })
  ss.getColumn('criterion').font = { bold: true }

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}
