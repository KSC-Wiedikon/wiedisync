/**
 * Pretty exports of finance reports (income statement, balance sheet, budget,
 * trial balance) to PDF, Excel and PowerPoint. One generic report model feeds all
 * three generators. The heavy libs (jspdf, exceljs, pptxgenjs) are dynamically
 * imported so they stay out of the main app bundle.
 */
export type ReportColType = 'text' | 'money'
export interface ReportColumn { label: string; type: ReportColType }
export interface ReportRow { cells: (string | number)[]; bold?: boolean }
export interface ReportSection { heading?: string; rows: ReportRow[] }
export interface FinanceReport {
  title: string   // "Income statement"
  org: string     // "KSC Wiedikon"
  period: string  // "2026/27"
  columns: ReportColumn[]
  sections: ReportSection[]
}
export type ExportFormat = 'pdf' | 'xlsx' | 'pptx'

const BRAND = '4F46E5' // brand-600 indigo
// Format a money cell. Empty/blank cells stay blank (e.g. the trial-balance total
// row's balance column); non-numeric values surface as-is rather than silently
// becoming 0.00; negative-zero is clamped to 0.00.
const money = (n: number | string) => {
  if (n === '' || n == null) return ''
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return String(n)
  return new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Object.is(x, -0) ? 0 : x)
}
const todayZ = () => new Date().toLocaleDateString('de-CH')

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

// ── Excel (exceljs) — real numeric cells with a currency format ──────────
async function exportXlsx(report: FinanceReport, filename: string) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'wiedisync'
  // exceljs forbids * ? : \ / [ ] in worksheet names (and caps at 31 chars).
  const ws = wb.addWorksheet(report.title.replace(/[\\/?*:[\]]/g, ' ').slice(0, 31) || 'Report')
  const n = report.columns.length
  ws.mergeCells(1, 1, 1, n); const t = ws.getCell(1, 1); t.value = report.org; t.font = { bold: true, size: 14 }
  ws.mergeCells(2, 1, 2, n); const s = ws.getCell(2, 1); s.value = `${report.title} — ${report.period}`; s.font = { size: 11, color: { argb: 'FF888888' } }
  let r = 4
  const hdr = ws.getRow(r)
  report.columns.forEach((c, i) => {
    const cell = hdr.getCell(i + 1)
    cell.value = c.label
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND } }
    cell.alignment = { horizontal: c.type === 'money' ? 'right' : 'left' }
  })
  r++
  for (const sec of report.sections) {
    if (sec.heading) { ws.mergeCells(r, 1, r, n); const h = ws.getCell(r, 1); h.value = sec.heading; h.font = { bold: true }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } }; r++ }
    for (const row of sec.rows) {
      const xr = ws.getRow(r)
      report.columns.forEach((c, i) => {
        const cell = xr.getCell(i + 1)
        const v = row.cells[i]
        if (c.type === 'money') {
          if (v === '' || v == null) cell.value = null
          else { cell.value = typeof v === 'number' ? v : Number(v) || 0; cell.numFmt = '#,##0.00' }
          cell.alignment = { horizontal: 'right' }
        } else cell.value = v ?? ''
        if (row.bold) cell.font = { bold: true }
      })
      r++
    }
  }
  report.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.type === 'money' ? 16 : 36 })
  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename + '.xlsx')
}

// ── PDF (jspdf + autotable) — one styled table per section ───────────────
async function exportPdf(report: FinanceReport, filename: string) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const M = 40
  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text(report.org, M, 50)
  doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(120); doc.text(`${report.title} — ${report.period}`, M, 68); doc.setTextColor(0)
  const ph = doc.internal.pageSize.getHeight()
  let y = 88
  for (const sec of report.sections) {
    if (sec.heading) {
      if (y > ph - 80) { doc.addPage(); y = 50 }  // keep the heading with its table
      doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(sec.heading, M, y); y += 6
    }
    autoTable(doc, {
      startY: y,
      head: [report.columns.map((c) => c.label)],
      body: sec.rows.map((row) => report.columns.map((c, i) => (c.type === 'money' ? money(row.cells[i]) : String(row.cells[i] ?? '')))),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
      columnStyles: Object.fromEntries(report.columns.map((c, i) => [i, { halign: c.type === 'money' ? 'right' : 'left' }])),
      didParseCell: (d: { section: string; row: { index: number }; cell: { styles: { fontStyle: string } } }) => {
        if (d.section === 'body' && sec.rows[d.row.index]?.bold) d.cell.styles.fontStyle = 'bold'
      },
      margin: { left: M, right: M },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18
  }
  doc.setFontSize(8); doc.setTextColor(150)
  doc.text(`wiedisync · ${todayZ()}`, M, doc.internal.pageSize.getHeight() - 22)
  doc.save(filename + '.pdf')
}

// ── PowerPoint (pptxgenjs) — title slide + table slide ───────────────────
async function exportPptx(report: FinanceReport, filename: string) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'W', width: 10, height: 5.63 }); pptx.layout = 'W'
  const title = pptx.addSlide()
  title.addText(report.org, { x: 0.6, y: 1.9, w: 8.8, h: 0.7, fontSize: 30, bold: true, color: '1F2937' })
  title.addText(`${report.title} — ${report.period}`, { x: 0.6, y: 2.7, w: 8.8, h: 0.5, fontSize: 18, color: '6B7280' })
  const slide = pptx.addSlide()
  slide.addText(`${report.title} — ${report.period}`, { x: 0.4, y: 0.25, w: 9.2, h: 0.4, fontSize: 16, bold: true, color: '1F2937' })
  type PCell = { text: string; options?: Record<string, unknown> }
  const rows: PCell[][] = []
  rows.push(report.columns.map((c) => ({ text: c.label, options: { bold: true, color: 'FFFFFF', fill: { color: BRAND }, align: c.type === 'money' ? 'right' : 'left' } })))
  for (const sec of report.sections) {
    if (sec.heading) rows.push([{ text: sec.heading, options: { bold: true, fill: { color: 'EEF2FF' }, colspan: report.columns.length } }])
    for (const row of sec.rows) rows.push(report.columns.map((c, i) => ({ text: c.type === 'money' ? money(row.cells[i]) : String(row.cells[i] ?? ''), options: { bold: !!row.bold, align: c.type === 'money' ? 'right' : 'left', fontSize: 10 } })))
  }
  slide.addTable(rows as never, { x: 0.4, y: 0.8, w: 9.2, fontSize: 10, border: { type: 'solid', color: 'E5E7EB', pt: 0.5 }, autoPage: true, autoPageRepeatHeader: true })
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob
  downloadBlob(blob, filename + '.pptx')
}

export function exportReport(format: ExportFormat, report: FinanceReport, filename: string) {
  // Fiscal-year labels like "2026/27" contain a slash — sanitise so it can't break
  // the download filename / path.
  const safe = filename.replace(/[/\\:*?"<>|]+/g, '-')
  if (format === 'xlsx') return exportXlsx(report, safe)
  if (format === 'pptx') return exportPptx(report, safe)
  return exportPdf(report, safe)
}
