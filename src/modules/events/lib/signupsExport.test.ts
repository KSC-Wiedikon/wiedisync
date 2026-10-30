import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { answerFields, buildSignupSections, exportBaseName, renderAnswer, signupsXlsx, type SignupsExportInput } from './signupsExport'

const input: SignupsExportInput = {
  eventTitle: 'Fondue-Abend 2026',
  eventStart: '2026-11-20T18:00:00Z',
  members: [{ name: 'Anna Müller', email: 'anna@example.com', status: 'confirmed', guest_count: 0, date_created: '2026-10-30T08:15:00Z' }],
  formFields: [
    { id: 'e', name: 'Email', type: 'email' },
    { id: 'txt', name: 'Intro', type: 'nf-text' },
    { id: 's', name: 'Section', type: 'text' },
    { id: 'f', name: 'Food preference', type: 'select' },
    { id: 'c', name: 'Check', type: 'checkbox' },
    { id: 'm', name: 'Extras', type: 'multi_select' },
  ],
  // The real OpnForm shape: answers nested under `data`.
  formRows: [{ id: 1, data: { e: 'anna@example.com', s: 'Volleyball', f: 'Fondue', c: true, m: ['Wine', 'Dessert'], created_at: '2026-10-30T08:15:00Z' } }],
  guests: [{ name: 'Max Gast', email: 'max@example.com', phone: '+41 79 000 00 00', guest_count: 1, note: '=HYPERLINK("x")', date_created: '2026-10-29T10:00:00Z' }],
}

describe('signups export', () => {
  it('formats answers', () => {
    expect(renderAnswer(['Wine', 'Dessert'])).toBe('Wine, Dessert')
    expect(renderAnswer(true)).toBe('Yes')
    expect(renderAnswer({ file_name: 'x.pdf' })).toBe('x.pdf')
    expect(renderAnswer(null)).toBe('')
  })

  it('lists every question except text blocks, hidden fields included', () => {
    expect(answerFields(input.formFields).map((f) => f.id)).toEqual(['e', 's', 'f', 'c', 'm'])
  })

  it('builds members, form replies and guests with Swiss dates', () => {
    const [members, replies, guests] = buildSignupSections(input)
    expect(members.rows[0]).toEqual(['Anna Müller', 'anna@example.com', 'Confirmed', '', '30.10.2026 09:15'])
    expect(replies.columns).toEqual(['Email', 'Section', 'Food preference', 'Check', 'Extras', 'Submitted'])
    expect(replies.rows[0]).toEqual(['anna@example.com', 'Volleyball', 'Fondue', 'Yes', 'Wine, Dessert', '30.10.2026 09:15'])
    expect(guests.rows[0][0]).toBe('Max Gast')
  })

  it('skips empty sections', () => {
    expect(buildSignupSections({ ...input, members: [], guests: [] }).map((s) => s.title)).toEqual(['Form replies'])
  })

  it('names the file after the event', () => {
    expect(exportBaseName('Fondue-Abend 2026 – Zürich!')).toBe('signups-fondue-abend-2026-zurich')
  })

  it('writes one sheet per section and neutralises formulas', async () => {
    const blob = await signupsXlsx(input)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Members (Wiedisync)', 'Form replies', 'Guests (signup page)'])
    const replies = wb.getWorksheet('Form replies')!
    expect(replies.getRow(2).getCell(3).value).toBe('Fondue')
    expect(wb.getWorksheet('Guests (signup page)')!.getRow(2).getCell(5).value).toBe(`'=HYPERLINK("x")`)
  })
})
