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
  status: string
  vm: string
  contact: string
}

const COLUMNS: { header: string; key: keyof ExportRow; xlsxWidth: number; pdfWidth: number }[] = [
  { header: 'Date', key: 'date', xlsxWidth: 12, pdfWidth: 20 },
  { header: 'Time', key: 'time', xlsxWidth: 10, pdfWidth: 16 },
  { header: 'KSCW team', key: 'team', xlsxWidth: 12, pdfWidth: 22 },
  { header: 'Opponent', key: 'opponent', xlsxWidth: 26, pdfWidth: 46 },
  { header: 'Hall / venue', key: 'hall', xlsxWidth: 22, pdfWidth: 42 },
  { header: 'Type', key: 'type', xlsxWidth: 8, pdfWidth: 14 },
  { header: 'Status', key: 'status', xlsxWidth: 11, pdfWidth: 20 },
  { header: 'VM status', key: 'vm', xlsxWidth: 14, pdfWidth: 26 },
  { header: 'Contact', key: 'contact', xlsxWidth: 32, pdfWidth: 60 },
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
// Weekday (Mon-Fri) home games always start at 20:00 — the slot is just the hall
// window (e.g. 19:30-21:30). Weekend slots keep their actual start time.
const homeGameTime = (dateYmd: string | null | undefined, slotStart: string | null | undefined): string => {
  if (!dateYmd) return ''
  const dow = new Date(`${String(dateYmd).slice(0, 10)}T00:00:00Z`).getUTCDay() // 0=Sun..6=Sat
  return dow >= 1 && dow <= 5 ? '20:00' : hhmm(slotStart)
}
const VM_LABEL: Record<string, string> = {
  pushed: 'Pushed', pushed_no_hall: 'Pushed (no hall)', queued: 'Queued',
  failed: 'Failed', no_fixture: 'No fixture', needs_pick: 'Needs pick',
}
const vmLabel = (s: string | null | undefined): string => (s ? (VM_LABEL[s] || s) : 'Not pushed')
const statusLabel = (s: string | null | undefined): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

export default function ExcelExportButton({ bookings, opponents, slots, teams }: Props) {
  const { t } = useTranslation('gameScheduling')

  // Resolve confirmed + pending bookings to flat, sorted schedule rows. Shared by
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
    const slotOf = (b: GameSchedulingBooking): GameSchedulingSlot | undefined => {
      // Confirmed home uses the booked slot; pending home uses the 1st proposal.
      const ref = (b.status === 'confirmed' ? b.slot : (b as unknown as Record<string, unknown>).proposed_slot_1) as unknown
      return ref && typeof ref === 'object' ? (ref as GameSchedulingSlot) : slotById.get(String(ref))
    }

    return bookings
      .filter(b => b.status === 'confirmed' || b.status === 'pending')
      .map((b): (ExportRow & { _sort: string }) | null => {
        const opp = resolveOpp(b)
        const team = opp ? (teamName.get(String(opp.kscw_team)) || '') : ''
        const opponent = opp ? (opp.team_name || opp.club_name || '') : ''
        const contact = opp?.contact_email || ''
        const status = statusLabel(b.status)

        if (b.type === 'home_slot_pick') {
          const slot = slotOf(b)
          if (!slot?.date) return null
          return {
            _sort: slot.date,
            date: fmtDate(slot.date),
            time: homeGameTime(slot.date, slot.start_time),
            team, opponent,
            hall: hallName.get(String(slot.hall)) || '',
            type: 'Home', status, vm: vmLabel(b.vm_push_status as unknown as string), contact,
          }
        }
        // Away — confirmed uses the chosen proposal, pending shows the 1st.
        const n = b.status === 'confirmed' ? b.confirmed_proposal : 1
        const rec = b as unknown as Record<string, string>
        const dt = rec[`proposed_datetime_${n}`] || ''
        const place = rec[`proposed_place_${n}`] || ''
        if (!dtDate(dt)) return null
        return {
          _sort: dtDate(dt),
          date: fmtDate(dtDate(dt)),
          time: dtTime(dt),
          team, opponent,
          hall: place,
          type: 'Away', status, vm: '—', contact,
        }
      })
      .filter((r): r is ExportRow & { _sort: string } => r !== null)
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
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportFilename('xlsx'))
  }

  const handlePdf = async () => {
    const { jsPDF } = await import('jspdf')
    const rows = await buildRows()
    const doc = new jsPDF('l', 'mm', 'a4') // landscape — many columns
    const margin = 8
    const tableW = COLUMNS.reduce((a, c) => a + c.pdfWidth, 0)
    const pageH = doc.internal.pageSize.getHeight()
    const rowH = 6

    doc.setFontSize(14)
    doc.text('KSCW game schedule', margin, 13)
    let y = 22

    const drawHeader = () => {
      doc.setFontSize(8.5)
      doc.setFont('helvetica', 'bold')
      doc.setFillColor(235, 235, 235)
      doc.rect(margin, y - 4.2, tableW, rowH, 'F')
      let x = margin
      for (const c of COLUMNS) { doc.text(c.header, x + 1, y); x += c.pdfWidth }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      y += rowH
    }
    drawHeader()

    for (const r of rows) {
      if (y > pageH - margin) { doc.addPage(); y = 14; drawHeader() }
      let x = margin
      for (const c of COLUMNS) {
        const line = doc.splitTextToSize(String(r[c.key] ?? ''), c.pdfWidth - 2)[0] ?? ''
        doc.text(line, x + 1, y)
        x += c.pdfWidth
      }
      doc.setDrawColor(225)
      doc.line(margin, y + 1.2, margin + tableW, y + 1.2)
      y += rowH
    }
    doc.save(exportFilename('pdf'))
  }

  const disabled = bookings.filter(b => b.status === 'confirmed' || b.status === 'pending').length === 0

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

// Export filename: kscw_spielplanung_vb_<ddmmyy>_<HHMM>.<ext> in Zurich time.
function exportFilename(ext: string): string {
  const parts = new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `kscw_spielplanung_vb_${g('day')}${g('month')}${g('year')}_${g('hour')}${g('minute')}.${ext}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
