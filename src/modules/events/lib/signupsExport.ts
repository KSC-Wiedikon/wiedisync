import { formatDateTimeCompactZurich } from '../../../utils/dateHelpers'

/**
 * Excel / PDF export of an event's signups (EventSignupsModal, admins only): the members
 * signed in on Wiedisync, every reply to the linked OpnForm (all questions, hidden fields
 * such as section and teams included), and the guests of the native signup page.
 *
 * Exports are English whatever the UI language — they are shared outside the app.
 */

export interface SignupFormField { id: string; name: string; type: string }

export interface SignupsExportInput {
  eventTitle: string
  eventStart?: string | null
  members: { name: string; email: string | null; status: string; guest_count: number; date_created: string | null }[]
  formFields: SignupFormField[]
  formRows: Record<string, unknown>[]
  guests: { name: string; email?: string | null; phone?: string | null; guest_count?: number | null; note?: string | null; date_created?: string | null }[]
}

export interface ExportSection { title: string; columns: string[]; rows: string[][] }

/** OpnForm answers can be scalars, arrays (multi-select) or objects (files). */
export function renderAnswer(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(renderAnswer).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return String(o.name ?? o.file_name ?? o.label ?? JSON.stringify(o))
  }
  return String(v)
}

const when = (iso: string | null | undefined) => (iso ? formatDateTimeCompactZurich(iso) : '')
const STATUS: Record<string, string> = { confirmed: 'Confirmed', tentative: 'Maybe', declined: 'Declined', waitlisted: 'Waitlist' }

/**
 * An OpnForm submission row carries its answers in `row.data`, keyed by field id (the row
 * itself is { id, data, form_id, … }); tolerate a flat row too, as admin.astro does.
 */
export function answersOf(row: Record<string, unknown>): Record<string, unknown> {
  const data = row?.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : row ?? {}
}

/** When it was submitted — on the row or inside its answers, depending on the API shape. */
export function submittedAt(row: Record<string, unknown>): string | null {
  const v = row?.created_at ?? answersOf(row).created_at
  return typeof v === 'string' ? v : null
}

/** Questions of the form, in form order; text blocks / page breaks (`nf-*`) are not answers. */
export function answerFields(fields: SignupFormField[]): SignupFormField[] {
  return fields.filter((f) => f?.id && !String(f.type ?? '').startsWith('nf-'))
}

export function buildSignupSections(input: SignupsExportInput): ExportSection[] {
  const sections: ExportSection[] = []
  if (input.members.length) {
    sections.push({
      title: 'Members (Wiedisync)',
      columns: ['Name', 'Email', 'Status', 'Guests', 'Signed up'],
      rows: input.members.map((m) => [m.name, m.email ?? '', STATUS[m.status] ?? m.status, m.guest_count ? String(m.guest_count) : '', when(m.date_created)]),
    })
  }
  const fields = answerFields(input.formFields)
  if (input.formRows.length && fields.length) {
    sections.push({
      title: 'Form replies',
      columns: [...fields.map((f) => f.name || f.id), 'Submitted'],
      rows: input.formRows.map((r) => [...fields.map((f) => renderAnswer(answersOf(r)[f.id])), when(submittedAt(r))]),
    })
  }
  if (input.guests.length) {
    sections.push({
      title: 'Guests (signup page)',
      columns: ['Name', 'Email', 'Phone', 'Guests', 'Note', 'Signed up'],
      rows: input.guests.map((g) => [g.name, g.email ?? '', g.phone ?? '', g.guest_count ? String(g.guest_count) : '', g.note ?? '', when(g.date_created)]),
    })
  }
  return sections
}

export function exportBaseName(title: string): string {
  const slug = (title || 'event').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `signups-${slug || 'event'}`
}

/** Neutralise spreadsheet formulas in free text ("=HYPERLINK(…)" typed into a form). */
const safeCell = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d/.test(s) ? `'${s}` : s)

export async function signupsXlsx(input: SignupsExportInput): Promise<Blob> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const sections = buildSignupSections(input)
  for (const s of sections.length ? sections : [{ title: 'Signups', columns: ['Name'], rows: [] }]) {
    const ws = wb.addWorksheet(s.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31))
    ws.addRow(s.columns)
    const head = ws.getRow(1)
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A55A2' } }
    s.rows.forEach((r) => ws.addRow(r.map(safeCell)))
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.columns.forEach((col, i) => {
      const longest = Math.max(s.columns[i]?.length ?? 0, ...s.rows.map((r) => (r[i] ?? '').length))
      col.width = Math.min(50, Math.max(10, longest + 2))
      col.alignment = { vertical: 'top', wrapText: true }
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

const BRAND: [number, number, number] = [74, 85, 162] // #4A55A2

export async function signupsPdf(input: SignupsExportInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' }) // forms have many questions
  const M = 36
  const ph = doc.internal.pageSize.getHeight()
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  const sections = buildSignupSections(input)
  const counts = sections.map((s) => `${s.title}: ${s.rows.length}`).join(' · ')

  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('KSC Wiedikon', M, 44)
  doc.setFontSize(12); doc.setFont('helvetica', 'normal'); doc.text(`Signups — ${input.eventTitle}`, M, 62)
  doc.setFontSize(9); doc.setTextColor(120)
  doc.text([input.eventStart ? `Event: ${when(input.eventStart)}` : '', `Exported ${when(new Date().toISOString())}`, counts].filter(Boolean).join(' · '), M, 78)
  doc.setTextColor(0)
  let y = 100
  if (!sections.length) { doc.setFontSize(10); doc.text('No signups yet.', M, y) }
  for (const s of sections) {
    if (y > ph - 90) { doc.addPage(); y = 44 }
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(s.title, M, y); doc.setFont('helvetica', 'normal'); y += 6
    autoTable(doc, {
      startY: y,
      head: [s.columns],
      body: s.rows,
      styles: { fontSize: s.columns.length > 8 ? 7 : 8.5, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: BRAND, textColor: 255 },
      margin: { left: M, right: M },
    })
    y = lastY() + 22
  }
  return doc.output('blob')
}
