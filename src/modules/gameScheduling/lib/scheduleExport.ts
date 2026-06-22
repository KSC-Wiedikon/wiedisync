import { fetchAllItems, kscwApi } from '../../../lib/api'
import type { Derby, GameSchedulingBooking, GameSchedulingOpponent, GameSchedulingSeason, GameSchedulingSlot, Team } from '../../../types'

// Shared schedule-export engine. Used by:
//  - the all-teams export bar (ExcelExportButton, no teamId)
//  - per-team export buttons (ExcelExportButton with teamId)
//  - the "Notify coaches" email, which attaches the team-filtered Excel + PDF
// Keeping the row-building + file generation here means the downloaded file and
// the emailed attachment are byte-identical and never drift.

export interface ExportRow {
  date: string
  time: string
  team: string
  homeTeam: string
  guestTeam: string
  hall: string
  type: string
  status: string
  vm: string
}

// Contact columns (Spielplaner / Team responsibles) were intentionally dropped
// from the export — the schedule report is shared with teams/coaches who don't
// need the scheduler/TR contact details.
const COLUMNS: { header: string; key: keyof ExportRow; xlsxWidth: number; pdfWidth: number }[] = [
  { header: 'Date', key: 'date', xlsxWidth: 12, pdfWidth: 18 },
  { header: 'Time', key: 'time', xlsxWidth: 10, pdfWidth: 13 },
  { header: 'KSCW team', key: 'team', xlsxWidth: 12, pdfWidth: 16 },
  { header: 'Home team', key: 'homeTeam', xlsxWidth: 26, pdfWidth: 44 },
  { header: 'Guest team', key: 'guestTeam', xlsxWidth: 26, pdfWidth: 44 },
  { header: 'Hall / venue', key: 'hall', xlsxWidth: 22, pdfWidth: 40 },
  { header: 'Type', key: 'type', xlsxWidth: 8, pdfWidth: 14 },
  { header: 'Status', key: 'status', xlsxWidth: 11, pdfWidth: 18 },
  { header: 'VM status', key: 'vm', xlsxWidth: 14, pdfWidth: 22 },
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

interface BuildArgs {
  bookings: GameSchedulingBooking[]
  opponents: GameSchedulingOpponent[]
  slots: GameSchedulingSlot[]
  teams: Team[]
  season: GameSchedulingSeason | null
  // When set, only this KSCW team's games are exported (per-team report).
  teamId?: number | string | null
}

// Resolve confirmed + pending bookings to flat, sorted schedule rows. Shared by
// every exporter so Excel, PDF and the email attachment stay identical.
export async function buildScheduleRows({ bookings, opponents, slots, teams, season, teamId }: BuildArgs): Promise<ExportRow[]> {
  const teamFilter = teamId != null && teamId !== '' ? String(teamId) : null
  const halls = await fetchAllItems<{ id: number; name: string }>('halls', { fields: ['id', 'name'] }).catch(() => [])
  // Intra-club derbies (Art. 27 SVRZ) live ONLY as anchored leg dates in
  // game_scheduling_derbies — they never become a booking or an opponent, so the
  // booking→opponent projection below can't see them. Pull them in separately and
  // synthesise a row per fixed leg, otherwise H1/H3-style head-to-heads are
  // silently missing from the export.
  let derbies: Derby[] = []
  if (season?.id) {
    try {
      const resp = await kscwApi<{ derbies: Derby[] }>(`/admin/terminplanung/derbies?season=${season.id}`)
      derbies = resp.derbies || []
    } catch { /* feed unavailable — derbies simply absent from the export */ }
  }
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

  const bookingRows = bookings
    .filter(b => b.status === 'confirmed' || b.status === 'pending')
    .map((b): (ExportRow & { _sort: string }) | null => {
      const opp = resolveOpp(b)
      // Per-team report: drop everything not belonging to the requested team.
      if (teamFilter && (!opp || String(opp.kscw_team) !== teamFilter)) return null
      const team = opp ? (teamName.get(String(opp.kscw_team)) || '') : ''
      // Fixture sides: the KSCW team renders as "KSC Wiedikon <name>"; which side
      // it sits on (home vs guest) flips with the game type.
      const kscwLabel = team ? `KSC Wiedikon ${team}` : 'KSC Wiedikon'
      const opponentName = opp ? (opp.team_name || opp.club_name || '') : ''
      const status = statusLabel(b.status)

      if (b.type === 'home_slot_pick') {
        const slot = slotOf(b)
        if (!slot?.date) return null
        return {
          _sort: slot.date,
          date: fmtDate(slot.date),
          time: homeGameTime(slot.date, slot.start_time),
          team, homeTeam: kscwLabel, guestTeam: opponentName,
          hall: hallName.get(String(slot.hall)) || '',
          type: 'Home', status, vm: vmLabel(b.vm_push_status as unknown as string),
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
        team, homeTeam: opponentName, guestTeam: kscwLabel,
        hall: place,
        type: 'Away', status, vm: '—',
      }
    })
    .filter((r): r is ExportRow & { _sort: string } => r !== null)

  // Derby legs → export rows. A leg surfaces once the spielplaner has fixed its
  // date. In a per-team report it shows for BOTH KSCW sides (the team appears
  // whether it's the home or the away side); in the all-teams report it lists
  // once under the host. No booking/opponent exists for these, so hall is unknown.
  const derbyRows: (ExportRow & { _sort: string })[] = []
  for (const d of derbies) {
    for (const leg of d.legs) {
      const ymd = leg.date ? String(leg.date).slice(0, 10) : ''
      if (!ymd) continue
      const homeId = String(leg.home_team.id)
      const awayId = String(leg.away_team.id)
      let sideId: string
      if (teamFilter) {
        if (teamFilter !== homeId && teamFilter !== awayId) continue
        sideId = teamFilter
      } else {
        sideId = homeId
      }
      derbyRows.push({
        _sort: ymd,
        date: fmtDate(ymd),
        // Weekday home games start at 20:00; weekends fall back to the feed time.
        time: homeGameTime(ymd, dtTime(leg.feed_datetime)),
        team: teamName.get(sideId) || (sideId === awayId ? leg.away_team.name : leg.home_team.name),
        homeTeam: `KSC Wiedikon ${leg.home_team.name}`,
        guestTeam: `KSC Wiedikon ${leg.away_team.name}`,
        hall: '',
        type: 'Derby', status: d.confirmed ? 'Confirmed' : 'Pending', vm: '—',
      })
    }
  }

  return [...bookingRows, ...derbyRows]
    .sort((a, b) => a._sort.localeCompare(b._sort))
    .map(({ _sort, ...row }) => row)
}

// Excel workbook (single "Schedule" sheet) → bytes.
export async function buildScheduleXlsx(rows: ExportRow[]): Promise<Uint8Array> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Schedule')
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.xlsxWidth }))
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  rows.forEach(r => ws.addRow(r))
  const buffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}

// Landscape A4 PDF (auto-paginated table) → bytes.
export async function buildSchedulePdf(rows: ExportRow[], title = 'KSCW game schedule'): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF('l', 'mm', 'a4') // landscape — many columns
  const margin = 8
  const tableW = COLUMNS.reduce((a, c) => a + c.pdfWidth, 0)
  const pageH = doc.internal.pageSize.getHeight()
  const rowH = 6

  doc.setFontSize(14)
  doc.text(title, margin, 13)
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
  return new Uint8Array(doc.output('arraybuffer'))
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const PDF_MIME = 'application/pdf'

// kscw_spielplanung_vb[_<team>]_<ddmmyy>_<HHMM>.<ext> in Zurich time.
export function exportFilename(ext: string, teamName?: string | null): string {
  const parts = new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const slug = teamName ? `_${String(teamName).trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` : ''
  return `kscw_spielplanung_vb${slug}_${g('day')}${g('month')}${g('year')}_${g('hour')}${g('minute')}.${ext}`
}

export function downloadBytes(bytes: Uint8Array, mime: string, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Bytes → base64 (chunked to stay clear of the argument-count limit on btoa).
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

// True when the team has at least one confirmed/pending game to export.
export function teamHasExportableGames(
  bookings: GameSchedulingBooking[],
  opponents: GameSchedulingOpponent[],
  teamId: number | string,
): boolean {
  const oppIds = new Set(opponents.filter(o => String(o.kscw_team) === String(teamId)).map(o => String(o.id)))
  return bookings.some(b => {
    if (b.status !== 'confirmed' && b.status !== 'pending') return false
    const o = b.opponent as unknown
    const id = o && typeof o === 'object' ? (o as GameSchedulingOpponent).id : o
    return oppIds.has(String(id))
  })
}
