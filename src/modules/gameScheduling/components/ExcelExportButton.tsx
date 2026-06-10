import { useTranslation } from 'react-i18next'
import { fetchAllItems } from '../../../lib/api'
import type { GameSchedulingBooking, GameSchedulingOpponent, GameSchedulingSlot, Team } from '../../../types'

interface Props {
  bookings: GameSchedulingBooking[]
  opponents: GameSchedulingOpponent[]
  slots: GameSchedulingSlot[]
  teams: Team[]
}

interface ExportRow {
  date: string
  time: string
  team: string
  opponent: string
  hall: string
  type: string
  contact: string
}

const COLUMNS: { header: string; key: keyof ExportRow; xlsxWidth: number; pdfWidth: number }[] = [
  { header: 'Date', key: 'date', xlsxWidth: 12, pdfWidth: 22 },
  { header: 'Time', key: 'time', xlsxWidth: 14, pdfWidth: 26 },
  { header: 'KSCW team', key: 'team', xlsxWidth: 12, pdfWidth: 24 },
  { header: 'Opponent', key: 'opponent', xlsxWidth: 28, pdfWidth: 52 },
  { header: 'Hall / venue', key: 'hall', xlsxWidth: 24, pdfWidth: 48 },
  { header: 'Type', key: 'type', xlsxWidth: 8, pdfWidth: 16 },
  { header: 'Contact', key: 'contact', xlsxWidth: 34, pdfWidth: 70 },
]

// YYYY-MM-DD → dd.mm.yyyy (Swiss). Empty if unparseable.
const fmtDate = (ymd: string | null | undefined): string => {
  const m = String(ymd ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}
const hhmm = (s: string | null | undefined): string => (s ? String(s).slice(0, 5) : '')
const dtDate = (dt: string | null | undefined): string => String(dt ?? '').slice(0, 10)
const dtTime = (dt: string | null | undefined): string => {
  const m = String(dt ?? '').match(/[T ](\d{2}:\d{2})/)
  return m ? m[1] : ''
}

export default function ExcelExportButton({ bookings, opponents, slots, teams }: Props) {
  const { t } = useTranslation('gameScheduling')

  // Resolve every confirmed booking to a flat, sorted schedule row. Shared by
  // both exporters so Excel and PDF stay identical.
  const buildRows = async (): Promise<ExportRow[]> => {
    const halls = await fetchAllItems<{ id: number; name: string }>('halls', { fields: ['id', 'name'] }).catch(() => [])
    const teamName = new Map(teams.map(tm => [String(tm.id), tm.name]))
    const oppById = new Map(opponents.map(o => [String(o.id), o]))
    const slotById = new Map(slots.map(s => [String(s.id), s]))
    const hallName = new Map(halls.map(h => [String(h.id), h.name]))

    // useAdminBookings expands opponent/slot to objects; fall back to id lookup.
    const resolveOpp = (b: GameSchedulingBooking): GameSchedulingOpponent | undefined => {
      const o = b.opponent as unknown
      return o && typeof o === 'object' ? (o as GameSchedulingOpponent) : oppById.get(String(o))
    }
    const resolveSlot = (b: GameSchedulingBooking): GameSchedulingSlot | undefined => {
      const s = b.slot as unknown
      return s && typeof s === 'object' ? (s as GameSchedulingSlot) : slotById.get(String(s))
    }

    return bookings
      .filter(b => b.status === 'confirmed')
      .map((b): ExportRow & { _sort: string } => {
        const opp = resolveOpp(b)
        const team = opp ? (teamName.get(String(opp.kscw_team)) || '') : ''
        const opponent = opp ? (opp.team_name || opp.club_name || '') : ''
        const contact = opp?.contact_email || ''

        if (b.type === 'home_slot_pick') {
          const slot = resolveSlot(b)
          return {
            _sort: slot?.date || '',
            date: fmtDate(slot?.date),
            time: slot ? `${hhmm(slot.start_time)}–${hhmm(slot.end_time)}` : '',
            team, opponent,
            hall: slot ? (hallName.get(String(slot.hall)) || '') : '',
            type: 'Home', contact,
          }
        }
        const n = b.confirmed_proposal
        const dt = (b as unknown as Record<string, string>)[`proposed_datetime_${n}`] || ''
        const place = (b as unknown as Record<string, string>)[`proposed_place_${n}`] || ''
        return {
          _sort: dtDate(dt),
          date: fmtDate(dtDate(dt)),
          time: dtTime(dt),
          team, opponent,
          hall: place,
          type: 'Away', contact,
        }
      })
      .sort((a, b) => a._sort.localeCompare(b._sort))
      .map(({ _sort, ...row }) => row)
  }

  const handleExcel = async () => {
    const ExcelJS = await import('exceljs')
    const rows = await buildRows()
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Schedule')
    ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.xlsxWidth }))
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    rows.forEach(r => ws.addRow(r))
    const buffer = await wb.xlsx.writeBuffer()
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'kscw_schedule.xlsx')
  }

  const handlePdf = async () => {
    const { jsPDF } = await import('jspdf')
    const rows = await buildRows()
    const doc = new jsPDF('l', 'mm', 'a4') // landscape — 7 columns
    const margin = 10
    const tableW = COLUMNS.reduce((a, c) => a + c.pdfWidth, 0)
    const pageH = doc.internal.pageSize.getHeight()
    const rowH = 6.5

    doc.setFontSize(14)
    doc.text('KSCW game schedule', margin, 14)
    let y = 24

    const drawHeader = () => {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setFillColor(235, 235, 235)
      doc.rect(margin, y - 4.5, tableW, rowH, 'F')
      let x = margin
      for (const c of COLUMNS) { doc.text(c.header, x + 1, y); x += c.pdfWidth }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      y += rowH
    }
    drawHeader()

    for (const r of rows) {
      if (y > pageH - margin) { doc.addPage(); y = 16; drawHeader() }
      let x = margin
      for (const c of COLUMNS) {
        const line = doc.splitTextToSize(String(r[c.key] ?? ''), c.pdfWidth - 2)[0] ?? ''
        doc.text(line, x + 1, y)
        x += c.pdfWidth
      }
      doc.setDrawColor(225)
      doc.line(margin, y + 1.3, margin + tableW, y + 1.3)
      y += rowH
    }
    doc.save('kscw_schedule.pdf')
  }

  const disabled = bookings.filter(b => b.status === 'confirmed').length === 0

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleExcel}
        disabled={disabled}
        className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {t('downloadExcel')}
      </button>
      <button
        onClick={handlePdf}
        disabled={disabled}
        className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
      >
        {t('downloadPdf')}
      </button>
    </div>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
