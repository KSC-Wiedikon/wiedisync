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

/** Excel .xlsx via dynamic import of exceljs — returns Blob */
export async function toXlsx(
  columns: string[],
  rows: unknown[][],
): Promise<Blob> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Results')
  ws.addRow(columns)
  for (const row of rows) {
    ws.addRow(row.map(serializeCell))
  }
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/octet-stream' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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
