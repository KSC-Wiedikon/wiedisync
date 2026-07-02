/**
 * Pure utility functions for exporting SQL query results
 * in various formats (TSV, CSV, JSON, text, Excel).
 */

function serializeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'object') return JSON.stringify(value)
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
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
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

// A full ISO date or timestamp Postgres serialises into JSON (date, timestamp,
// timestamptz). Anchored so partial matches like "2026 budget" don't qualify.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
// A plain integer/decimal. Used together with an exact round-trip check below.
const SAFE_NUMERIC_RE = /^-?\d+(\.\d+)?$/

/**
 * Map a raw SQL cell to a NATIVE Excel value so numbers sort/sum and dates
 * format as dates, instead of everything landing as text (`serializeCell`).
 * Conservative on string→number: only values that round-trip exactly become
 * numbers, so ids like "007", IBANs, phone numbers and >15-digit bigints
 * (which lose precision as JS numbers) keep their text form.
 */
function xlsxCell(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value
  if (typeof value === 'object') return JSON.stringify(value)
  const s = String(value)
  if (ISO_DATE_RE.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (SAFE_NUMERIC_RE.test(s) && String(Number(s)) === s) return Number(s)
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
  for (const row of rows) {
    const added = ws.addRow(row.map(xlsxCell))
    // Date cells: give them a Swiss number format (date-only vs datetime by
    // whether the source string carried a time component).
    row.forEach((raw, i) => {
      const cell = added.getCell(i + 1)
      if (cell.value instanceof Date) {
        cell.numFmt = /[T ]\d{2}:\d{2}/.test(String(raw)) ? 'dd.mm.yyyy hh:mm' : 'dd.mm.yyyy'
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
