// Small CSV export helper for finance tables. Semicolon-separated + UTF-8 BOM so
// Excel (de-CH) opens it cleanly; values with ; " or newlines are quoted.
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    let s = String(v ?? '')
    // Neutralise spreadsheet formula injection: a cell starting with = + - @
    // (or tab/CR) executes as a formula in Excel/Sheets. Prefix a single quote.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
