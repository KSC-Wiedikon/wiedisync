/**
 * Pure utility functions for exporting SQL query results
 * in various formats (TSV, CSV, JSON, text, Excel).
 */

import { parseSqlTemporal, formatSqlTemporal, sqlTemporalToExcelDate } from './sqlCellDates'

/** Text form of a cell. Temporal strings come out Swiss (`dd.mm.yyyy`,
 *  `dd.mm.yyyy HH:MM:SS`, instants in Europe/Zurich) so the file says what
 *  the grid says — a `date` used to export as `…T00:00:00.000Z`. */
function serializeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'object') return JSON.stringify(value)
  const temporal = parseSqlTemporal(value)
  if (temporal) return formatSqlTemporal(temporal, { seconds: true })
  return String(value)
}

/** Tab-separated values with header row (for clipboard → spreadsheet paste) */
export function toTSV(columns: string[], rows: unknown[][]): string {
  const header = columns.join('\t')
  const body = rows.map((row) => row.map(serializeCell).join('\t')).join('\n')
  return `${header}\n${body}`
}

/** RFC 4180 CSV — quotes fields containing commas, quotes, or newlines */
export function toCSV(columns: string[], rows: unknown[][]): string {
  const escape = (s: string) => {
    // Neutralise spreadsheet formula injection (leading = + - @ / tab / CR).
    // Don't mangle legit signed numbers / phones (-50, +41…) — only real formulas.
    if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d/.test(s)) s = `'${s}`
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const header = columns.map(escape).join(',')
  const body = rows
    .map((row) => row.map((cell) => escape(serializeCell(cell))).join(','))
    .join('\n')
  return `${header}\n${body}`
}

/** JSON array of objects, pretty-printed */
export function toJSON(columns: string[], rows: unknown[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return obj
  })
  return JSON.stringify(objects, null, 2)
}

/** Fixed-width aligned text columns */
export function toAlignedText(columns: string[], rows: unknown[][]): string {
  const allRows = [columns, ...rows.map((r) => r.map(serializeCell))]
  const widths = columns.map((col, i) =>
    Math.min(
      60,
      Math.max(col.length, ...allRows.map((row) => String(row[i] ?? '').length)),
    ),
  )
  const formatRow = (row: (string | unknown)[]) =>
    row.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ')
  const header = formatRow(columns)
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')
  const body = allRows.slice(1).map(formatRow).join('\n')
  return `${header}\n${separator}\n${body}`
}

// A plain integer/decimal. Used together with the leading-zero + precision
// checks in xlsxNumericColumns below.
const SAFE_NUMERIC_RE = /^-?\d+(\.\d+)?$/

/**
 * Can this string become an Excel number without lying? No leading zero
 * ("015964" is an identifier — Excel would show 15964), and at most 15
 * significant digits (a JS double loses precision above that, so a bigint id
 * would come back changed). Trailing decimal zeros ("440.50") ARE fine: the
 * value survives, and the column format below keeps the two places visible.
 */
function isSafeNumericString(s: string): boolean {
  if (!SAFE_NUMERIC_RE.test(s)) return false
  const [int, frac = ''] = s.replace(/^-/, '').split('.')
  if (int.length > 1 && int.startsWith('0')) return false
  return int.length + frac.length <= 15
}

/**
 * Decide PER COLUMN whether string cells become numbers, and with how many
 * decimals. Per-cell was the bug (2026-09-13): `String(Number(s)) === s`
 * turned "380" and "333084" into numbers while "440.50" and "015964" stayed
 * text — the same column half numeric, half text, so Excel could not sum a
 * fee column or sort licence numbers. A column is numeric only if EVERY
 * non-null string in it is safely numeric (real JS numbers count as yes,
 * temporal strings and anything else as no); one identifier with a leading
 * zero keeps the whole column text, which is the consistent answer.
 *
 * @returns per column: null (text) or { decimals } for a numeric column,
 *   where decimals is the widest fraction seen so "440.50" renders as 440.50.
 */
export function xlsxNumericColumns(rows: unknown[][]): ({ decimals: number } | null)[] {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  const out: ({ decimals: number } | null)[] = []
  for (let c = 0; c < width; c++) {
    let numeric = true
    let decimals = 0
    let seen = false
    for (const row of rows) {
      const v = row[c]
      if (v === null || v === undefined) continue
      seen = true
      if (typeof v === 'number') { continue }
      if (typeof v !== 'string') { numeric = false; break }
      if (parseSqlTemporal(v) || !isSafeNumericString(v)) { numeric = false; break }
      const frac = v.split('.')[1]
      if (frac) decimals = Math.max(decimals, frac.length)
    }
    out.push(seen && numeric ? { decimals } : null)
  }
  return out
}

/**
 * Map a raw SQL cell to a NATIVE Excel value so numbers sort/sum and dates
 * format as dates, instead of everything landing as text (`serializeCell`).
 * Temporal strings become a Date carrying the wall-clock the grid shows — a
 * `date` stays a date, an instant is converted to Europe/Zurich (exceljs
 * writes UTC fields, so a raw instant would show the UTC time in the sheet).
 * String→number only when the COLUMN was judged numeric (xlsxNumericColumns),
 * so ids like "007", IBANs, phone numbers and >15-digit bigints keep their
 * text form — and so does every other value in their column.
 */
function xlsxCell(value: unknown, numericColumn: boolean): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value
  if (typeof value === 'object') return JSON.stringify(value)
  const s = String(value)
  const temporal = parseSqlTemporal(s)
  if (temporal) return sqlTemporalToExcelDate(temporal)
  if (numericColumn && isSafeNumericString(s)) return Number(s)
  return s
}

/** Excel .xlsx via dynamic import of exceljs — returns Blob */
export async function toXlsx(
  columns: string[],
  rows: unknown[][],
): Promise<Blob> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Results')
  ws.addRow(columns)
  ws.getRow(1).font = { bold: true }
  const numericCols = xlsxNumericColumns(rows)
  for (const row of rows) {
    const added = ws.addRow(row.map((v, i) => xlsxCell(v, numericCols[i] !== null)))
    row.forEach((raw, i) => {
      const cell = added.getCell(i + 1)
      // Date cells: give them a Swiss number format — date-only for a `date`,
      // datetime for a wall-clock timestamp or an instant.
      if (cell.value instanceof Date) {
        cell.numFmt = parseSqlTemporal(raw)?.kind === 'date' ? 'dd.mm.yyyy' : 'dd.mm.yyyy hh:mm'
        return
      }
      // Numeric column with decimals: pin the places so "440.50" reads 440.50,
      // not 440.5, and every row in the column lines up.
      const nc = numericCols[i]
      if (typeof cell.value === 'number' && nc && nc.decimals > 0) {
        cell.numFmt = `0.${'0'.repeat(nc.decimals)}`
      }
    })
  }
  const buffer = await wb.xlsx.writeBuffer()
  // Normalise exceljs's writeBuffer() output to a native Uint8Array before
  // wrapping it in a Blob. In the browser build writeBuffer() can hand back a
  // Buffer-polyfill object that the Blob constructor stringifies instead of
  // treating as binary → a corrupt .xlsx that won't open. new Uint8Array(...)
  // forces a real typed array (this is what the working scheduleExport path
  // does). Use the official spreadsheet MIME so the OS opens it in Excel rather
  // than as a generic octet-stream download.
  return new Blob([new Uint8Array(buffer as ArrayBuffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer the revoke: tearing down the object URL synchronously can abort the
  // download of a larger binary blob in some browsers before it has started.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadText(
  content: string,
  filename: string,
  mime: string,
): void {
  downloadBlob(new Blob([content], { type: mime }), filename)
}

/** HTML <table> escaped for clipboard write. */
export function toHtmlTable(columns: string[], rows: unknown[][]): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  const thead = `<thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${esc(serializeCell(cell))}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody>`
  return `<table border="1" cellspacing="0" cellpadding="4">${thead}${tbody}</table>`
}

/** Write both HTML <table> and plain TSV to the clipboard. Lets the target
 *  app pick the richer representation it supports — Gmail/Slack/Docs render
 *  the HTML table; terminal/editor falls back to TSV; Excel/Sheets use TSV
 *  cell-paste. Falls back to a plain TSV writeText when ClipboardItem isn't
 *  available (older browsers, insecure contexts). */
export async function copyAsTable(
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  const html = toHtmlTable(columns, rows)
  const tsv = toTSV(columns, rows)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([tsv], { type: 'text/plain' }),
    })
    await navigator.clipboard.write([item])
    return
  }
  await navigator.clipboard.writeText(tsv)
}
