/**
 * Jahresrechnung PDF (balance sheet + income statement) of one fiscal year, from a
 * trial balance. Pure: takes rows, returns a Buffer. Used by the yearly finance
 * archive (finance-books.js). German, like the club's accounts; Swiss number and
 * date format (1'234.56, dd.mm.yyyy).
 *
 * rows: [{ number, name, type: asset|liability|equity|income|expense|close, balance }]
 *   balance is natural-sign (assets/expenses debit-positive, the rest credit-positive)
 *   and, for income/expense, EXCLUDES the year-end Abschluss postings — otherwise a
 *   closed year shows a zero income statement.
 */
import PDFDocument from 'pdfkit'

const MM = 72 / 25.4
const LEFT = 20 * MM
const RIGHT = 190 * MM
const BOTTOM = 280 * MM

export const chf = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100
  const [int, dec] = Math.abs(v).toFixed(2).split('.')
  return `${v < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${dec}`
}
export const ddmmyyyy = (iso) => {
  const s = String(iso || '').slice(0, 10)
  const [y, m, d] = s.split('-')
  return y && m && d ? `${d}.${m}.${y}` : ''
}

/** Group rows into the two statements; zero rows are dropped. */
export function annualStatements(rows) {
  const nz = (r) => Math.abs(Number(r.balance) || 0) >= 0.005
  const by = (types) => rows.filter((r) => types.includes(r.type) && nz(r)).sort((a, b) => String(a.number).localeCompare(String(b.number)))
  const sum = (list) => Math.round(list.reduce((s, r) => s + Number(r.balance || 0), 0) * 100) / 100
  const assets = by(['asset'])
  const liabilities = by(['liability'])
  const equity = by(['equity'])
  const income = by(['income'])
  const expense = by(['expense'])
  const result = Math.round((sum(income) - sum(expense)) * 100) / 100
  const liabEq = Math.round((sum(liabilities) + sum(equity)) * 100) / 100
  // A year not closed yet has its result still on the income/expense accounts, so
  // the balance sheet only balances with that result shown as its own line.
  const unbookedResult = Math.abs(result) >= 0.005 && Math.abs(sum(assets) - liabEq - result) < 0.005 ? result : 0
  return {
    assets, liabilities, equity, income, expense, unbookedResult,
    totalAssets: sum(assets),
    totalLiabEquity: Math.round((liabEq + unbookedResult) * 100) / 100,
    totalIncome: sum(income), totalExpense: sum(expense), result,
  }
}

export function renderAnnualAccountsPdf({ org = 'KSC Wiedikon', fyLabel, startsOn, endsOn, book, rows, generatedAt = new Date(), note }) {
  const st = annualStatements(rows)
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Jahresrechnung ${fyLabel} — ${org}`, Author: org } })
      const chunks = []
      doc.on('data', (c) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      let y = 20 * MM
      const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 20 * MM } }
      const header = (title) => {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(org, LEFT, y)
        y += 6 * MM
        doc.font('Helvetica-Bold').fontSize(16).text(title, LEFT, y)
        y += 8 * MM
        doc.font('Helvetica').fontSize(9).fillColor('#555')
          .text(`Geschäftsjahr ${fyLabel} (${ddmmyyyy(startsOn)} – ${ddmmyyyy(endsOn)}) · Buchhaltung: ${book}`, LEFT, y)
        y += 10 * MM
      }
      const section = (title, list, totalLabel, total) => {
        ensure(14 * MM)
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000').text(title, LEFT, y)
        y += 6 * MM
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor('#bbb').stroke()
        y += 2.5 * MM
        doc.font('Helvetica').fontSize(9.5)
        for (const r of list) {
          ensure(6 * MM)
          doc.fillColor('#666').text(String(r.number), LEFT, y, { width: 16 * MM })
          doc.fillColor('#000').text(String(r.name || ''), LEFT + 17 * MM, y, { width: 120 * MM })
          doc.text(chf(r.balance), LEFT, y, { width: RIGHT - LEFT, align: 'right' })
          y += 5 * MM
        }
        ensure(8 * MM)
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor('#888').stroke()
        y += 2 * MM
        doc.font('Helvetica-Bold').fillColor('#000').text(totalLabel, LEFT, y)
        doc.text(chf(total), LEFT, y, { width: RIGHT - LEFT, align: 'right' })
        y += 9 * MM
      }

      header('Bilanz per ' + ddmmyyyy(endsOn))
      section('Aktiven', st.assets, 'Total Aktiven', st.totalAssets)
      section('Fremdkapital', st.liabilities, 'Total Fremdkapital', st.liabilities.reduce((s, r) => s + Number(r.balance), 0))
      section('Eigenkapital', st.equity, 'Total Eigenkapital', st.equity.reduce((s, r) => s + Number(r.balance), 0))
      if (st.unbookedResult) {
        ensure(8 * MM)
        doc.font('Helvetica').fontSize(9.5).fillColor('#000').text('Jahresergebnis (noch nicht verbucht)', LEFT, y)
        doc.text(chf(st.unbookedResult), LEFT, y, { width: RIGHT - LEFT, align: 'right' })
        y += 8 * MM
      }
      ensure(8 * MM)
      doc.font('Helvetica-Bold').fontSize(10).text('Total Passiven', LEFT, y)
      doc.text(chf(st.totalLiabEquity), LEFT, y, { width: RIGHT - LEFT, align: 'right' })
      y += 12 * MM

      doc.addPage(); y = 20 * MM
      header('Erfolgsrechnung')
      section('Ertrag', st.income, 'Total Ertrag', st.totalIncome)
      section('Aufwand', st.expense, 'Total Aufwand', st.totalExpense)
      ensure(10 * MM)
      doc.font('Helvetica-Bold').fontSize(11).fillColor(st.result >= 0 ? '#0a6b2b' : '#a11')
        .text(st.result >= 0 ? 'Jahresgewinn' : 'Jahresverlust', LEFT, y)
      doc.text(chf(st.result), LEFT, y, { width: RIGHT - LEFT, align: 'right' })
      y += 14 * MM

      ensure(16 * MM)
      doc.font('Helvetica').fontSize(8).fillColor('#666')
        .text(`Erstellt am ${ddmmyyyy(generatedAt.toISOString())} aus Wiedisync (accounting.wiedisync.kscw.ch).${note ? ` ${note}` : ''}`, LEFT, y, { width: RIGHT - LEFT })
      doc.end()
    } catch (e) { reject(e) }
  })
}
