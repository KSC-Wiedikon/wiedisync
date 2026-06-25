import { fetchAllItems, kscwApi } from '../../../lib/api'
import type { Derby, GameSchedulingBooking, GameSchedulingOpponent, GameSchedulingSeason, GameSchedulingSlot, Team } from '../../../types'
import { fetchTeamAbsences } from '../../../hooks/teamAbsencesFetch'
import { buildAbsencesByDate, type AbsentMember } from '../../spielplanung/utils/absencesByDate'

// Shared schedule-export engine. Used by:
//  - the all-teams export bar (ExcelExportButton, no teamId)
//  - per-team export buttons (ExcelExportButton with teamId)
//  - the "Notify coaches" email, which attaches the team-filtered Excel + PDF
// Keeping the row-building + file generation here means the downloaded file and
// the emailed attachment are byte-identical and never drift.
//
// The all-teams export is split into SECTIONS: a first "All games" section, then
// one per team. Excel renders each section as its own sheet; the PDF renders each
// as its own page. Per-team exports carry a single section.

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
  // Game-spacing warning: another game for the SAME KSCW team within <5 days
  // (e.g. "Another game in 3 days", "Another game 2 days before"). Empty if none.
  alert: string
  // Players (incl. coaches/TR) of this game's team absent on the game date,
  // comma-separated. Empty if nobody is absent.
  absences: string
}

/** One named group of rows → one Excel sheet / one PDF page. */
export interface ScheduleSection {
  /** Excel sheet name (sanitised + truncated on write). */
  name: string
  /** PDF page heading. */
  title: string
  rows: ExportRow[]
}

// Contact columns (Spielplaner / Team responsibles) were intentionally dropped
// from the export — the schedule report is shared with teams/coaches who don't
// need the scheduler/TR contact details.
const COLUMNS: { header: string; key: keyof ExportRow; xlsxWidth: number; pdfWidth: number; wrap?: boolean }[] = [
  { header: 'Date', key: 'date', xlsxWidth: 12, pdfWidth: 16 },
  { header: 'Time', key: 'time', xlsxWidth: 10, pdfWidth: 11 },
  { header: 'KSCW team', key: 'team', xlsxWidth: 12, pdfWidth: 13 },
  { header: 'Home team', key: 'homeTeam', xlsxWidth: 26, pdfWidth: 36 },
  { header: 'Guest team', key: 'guestTeam', xlsxWidth: 26, pdfWidth: 36 },
  { header: 'Hall / venue', key: 'hall', xlsxWidth: 22, pdfWidth: 28 },
  { header: 'Type', key: 'type', xlsxWidth: 8, pdfWidth: 12 },
  { header: 'Status', key: 'status', xlsxWidth: 11, pdfWidth: 15 },
  { header: 'VM status', key: 'vm', xlsxWidth: 14, pdfWidth: 20 },
  { header: 'Alerts', key: 'alert', xlsxWidth: 28, pdfWidth: 34, wrap: true },
  { header: 'Absences', key: 'absences', xlsxWidth: 30, pdfWidth: 50, wrap: true },
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
// VolleyManager date cross-check → one of three all-caps states for the VM
// column, used for BOTH home and away games: the agreed date matches
// VolleyManager (MATCH), differs (NO MATCH), or VM has no / only a placeholder
// date or the home game was never pushed, so it still has to be updated (TBU =
// to be updated — the default for anything not confirmed-and-matched).
const VM_MATCH_LABEL: Record<string, string> = {
  match: 'MATCH', mismatch: 'NO MATCH', no_vm: 'TBU', unset: 'TBU', not_pushed: 'TBU',
}
const vmMatchLabel = (s: string | null | undefined): string => VM_MATCH_LABEL[String(s ?? '')] || 'TBU'
const statusLabel = (s: string | null | undefined): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
// Whole-day difference between two YYYY-MM-DD dates (UTC midnight, so DST never
// shifts the count). `b` is assumed on/after `a`, so the result is ≥ 0.
const daysApart = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

// Season name ("2026/27") → a wide [Aug, Jul] absence-scan window. Absences are
// only ever looked up on actual game dates, so over-scanning is harmless and
// avoids clamping out late-spring games.
function seasonWindow(season: GameSchedulingSeason | null): { start: string; end: string } | null {
  const m = String(season?.season || '').match(/(\d{4})\D+(\d{2,4})/)
  if (!m) return null
  const y1 = parseInt(m[1], 10)
  let y2 = parseInt(m[2], 10)
  if (y2 < 100) y2 = 2000 + y2
  return { start: `${y1}-08-01`, end: `${y2}-07-31` }
}

interface BuildArgs {
  bookings: GameSchedulingBooking[]
  opponents: GameSchedulingOpponent[]
  slots: GameSchedulingSlot[]
  teams: Team[]
  season: GameSchedulingSeason | null
  // When set, only this KSCW team's games are exported (per-team report).
  teamId?: number | string | null
}

// Everything fetched ONCE per export and reused for the all-games table and every
// per-team section, so an all-teams export doesn't refetch halls / derbies / VM
// checks / absences for each team.
interface ExportContext {
  hallName: Map<string, string>
  derbies: Derby[]
  homeChecks: Record<string, { status?: string }>
  awayChecks: Record<string, { status?: string }>
  absByDate: Map<string, AbsentMember[]>
}

async function loadExportContext({ teams, season, teamId }: BuildArgs): Promise<ExportContext> {
  const teamFilter = teamId != null && teamId !== '' ? String(teamId) : null
  const halls = await fetchAllItems<{ id: number; name: string }>('halls', { fields: ['id', 'name'] }).catch(() => [])
  const hallName = new Map(halls.map(h => [String(h.id), h.name]))

  // Intra-club derbies (Art. 27 SVRZ) live ONLY as anchored leg dates in
  // game_scheduling_derbies — they never become a booking or an opponent, so the
  // booking→opponent projection below can't see them. Pull them in separately.
  let derbies: Derby[] = []
  // VM date cross-checks: our agreed date vs VolleyManager, keyed by booking id —
  // home (we push) and away (the opponent enters it) use separate endpoints.
  let homeChecks: Record<string, { status?: string }> = {}
  let awayChecks: Record<string, { status?: string }> = {}
  if (season?.id) {
    try {
      const resp = await kscwApi<{ derbies: Derby[] }>(`/admin/terminplanung/derbies?season=${season.id}`)
      derbies = resp.derbies || []
    } catch { /* feed unavailable — derbies simply absent from the export */ }
    try {
      const resp = await kscwApi<{ checks: Record<string, { status?: string }> }>(`/admin/terminplanung/home-vm-check?season=${season.id}`)
      homeChecks = resp.checks || {}
    } catch { /* VM check unavailable — home games fall back to TBU */ }
    try {
      const resp = await kscwApi<{ checks: Record<string, { status?: string }> }>(`/admin/terminplanung/away-vm-check?season=${season.id}`)
      awayChecks = resp.checks || {}
    } catch { /* VM check unavailable — away games fall back to TBU */ }
  }

  // Absent players per game date — fetched exactly like the calendar (players +
  // coaches + responsibles of the team). Best-effort.
  let absByDate = new Map<string, AbsentMember[]>()
  const absTeamIds = teamFilter ? [teamFilter] : teams.map(tm => String(tm.id))
  const win = seasonWindow(season)
  if (absTeamIds.length && win) {
    try {
      const { absences, memberTeams } = await fetchTeamAbsences(absTeamIds, win.start, win.end)
      absByDate = buildAbsencesByDate(absences, memberTeams, win.start, win.end)
    } catch { /* absences unavailable — column stays blank */ }
  }

  return { hallName, derbies, homeChecks, awayChecks, absByDate }
}

// Resolve confirmed + pending bookings (+ derby legs) for ONE team filter to flat,
// sorted, alert/absence-annotated rows — purely in memory from the shared context.
function buildRows({ bookings, opponents, slots, teams }: BuildArgs, ctx: ExportContext, teamFilter: string | null): ExportRow[] {
  const teamName = new Map(teams.map(tm => [String(tm.id), tm.name]))
  const oppById = new Map(opponents.map(o => [String(o.id), o]))
  const slotById = new Map(slots.map(s => [String(s.id), s]))
  const { hallName, derbies, homeChecks, awayChecks, absByDate } = ctx

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
          // Home games carry the VolleyManager match state (we push the date).
          type: 'Home', status, vm: vmMatchLabel(homeChecks[String(b.id)]?.status),
          alert: '', absences: '',
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
        // Away games carry the VolleyManager match state (the opponent enters it).
        type: 'Away', status, vm: vmMatchLabel(awayChecks[String(b.id)]?.status),
        alert: '', absences: '',
      }
    })
    .filter((r): r is ExportRow & { _sort: string } => r !== null)

  // Derby legs → export rows. A leg surfaces once the spielplaner has fixed its
  // date. In a per-team report it shows for BOTH KSCW sides; in the all-teams
  // report it lists once under the host. No booking/opponent exists, so hall is
  // unknown and there is no VM push.
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
        alert: '', absences: '',
      })
    }
  }

  const all = [...bookingRows, ...derbyRows].sort((a, b) => a._sort.localeCompare(b._sort))

  // Game-spacing alerts — for each game flag another game of the SAME KSCW team
  // within <5 days (before and/or after). Grouped per team so an H1 game near an
  // H3 game (different rosters) doesn't false-alarm. `all` is date-ascending, so
  // each team's slice stays ordered.
  const byTeam = new Map<string, (ExportRow & { _sort: string })[]>()
  for (const r of all) {
    if (!r.team) continue
    const arr = byTeam.get(r.team) ?? []
    arr.push(r)
    byTeam.set(r.team, arr)
  }
  for (const arr of byTeam.values()) {
    arr.forEach((r, i) => {
      const fragments: string[] = []
      const prev = arr[i - 1]
      const next = arr[i + 1]
      if (prev) {
        const d = daysApart(prev._sort, r._sort)
        if (d < 5) fragments.push(d === 0 ? 'Another game the same day' : `Another game ${d} day${d === 1 ? '' : 's'} before`)
      }
      if (next) {
        const d = daysApart(r._sort, next._sort)
        if (d < 5) fragments.push(d === 0 ? 'Another game the same day' : `Another game in ${d} day${d === 1 ? '' : 's'}`)
      }
      r.alert = [...new Set(fragments)].join(' · ')
    })
  }

  // Absent players: match by game date and the row's team name.
  if (absByDate.size) {
    for (const r of all) {
      const dayAbs = absByDate.get(r._sort)
      if (!dayAbs?.length) continue
      r.absences = dayAbs.filter(m => m.teams.includes(r.team)).map(m => m.name).join(', ')
    }
  }

  return all.map(({ _sort, ...row }) => row)
}

// Build the sections to render: a single team's section for a per-team report,
// or the "All games" section followed by one section per team for the all-teams
// report. All sections share one fetched context.
export async function buildScheduleSections(args: BuildArgs): Promise<ScheduleSection[]> {
  const ctx = await loadExportContext(args)
  const teamFilter = args.teamId != null && args.teamId !== '' ? String(args.teamId) : null

  if (teamFilter) {
    const tm = args.teams.find(t => String(t.id) === teamFilter)
    return [{ name: 'Schedule', title: tm ? `KSCW ${tm.name} schedule` : 'KSCW game schedule', rows: buildRows(args, ctx, teamFilter) }]
  }

  const sections: ScheduleSection[] = [
    { name: 'All games', title: 'KSCW game schedule — all teams', rows: buildRows(args, ctx, null) },
  ]
  for (const tm of args.teams) {
    const rows = buildRows(args, ctx, String(tm.id))
    if (rows.length) sections.push({ name: tm.name, title: `KSCW ${tm.name} schedule`, rows })
  }
  return sections
}

// Backward-compatible flat builder (single team filter, no sectioning).
export async function buildScheduleRows(args: BuildArgs): Promise<ExportRow[]> {
  const ctx = await loadExportContext(args)
  const teamFilter = args.teamId != null && args.teamId !== '' ? String(args.teamId) : null
  return buildRows(args, ctx, teamFilter)
}

// Excel forbids []:*?/\ in sheet names and caps them at 31 chars; names must also
// be unique within a workbook.
function sheetName(name: string, used: Set<string>): string {
  const base = (String(name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31)) || 'Sheet'
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${i++}`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}

// Excel workbook — one sheet per section → bytes.
export async function buildScheduleXlsx(sections: ScheduleSection[]): Promise<Uint8Array> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const used = new Set<string>()
  const list = sections.length ? sections : [{ name: 'Schedule', title: '', rows: [] as ExportRow[] }]
  for (const section of list) {
    const ws = wb.addWorksheet(sheetName(section.name, used))
    ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.xlsxWidth }))
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    // Wrap the free-text columns (alerts, absences) so long entries stay readable
    // instead of bleeding across neighbouring cells.
    for (const c of COLUMNS) {
      if (c.wrap) ws.getColumn(c.key).alignment = { wrapText: true, vertical: 'top' }
    }
    section.rows.forEach(r => ws.addRow(r))
  }
  const buffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}

// Landscape A4 PDF — one page (heading + table) per section. Cells wrap to as many
// lines as needed (so absences / alerts aren't truncated) and rows grow to fit.
export async function buildSchedulePdf(sections: ScheduleSection[]): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF('l', 'mm', 'a4') // landscape — many columns
  const margin = 8
  const tableW = COLUMNS.reduce((a, c) => a + c.pdfWidth, 0)
  const pageH = doc.internal.pageSize.getHeight()
  const lineH = 3.4 // per wrapped text line
  const padY = 1.8 // extra vertical breathing room per row

  let y = 0
  const drawColumnHeader = () => {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    // Wrap each header to its own column width (like the body cells) so a long
    // header — e.g. "KSCW team" in a narrow column — stacks onto a second line
    // instead of bleeding into the neighbouring header.
    const cells = COLUMNS.map(c => doc.splitTextToSize(c.header, c.pdfWidth - 2) as string[])
    const lineCount = Math.max(1, ...cells.map(l => l.length))
    const headerH = lineCount * lineH + padY + 1
    doc.setFillColor(235, 235, 235)
    doc.rect(margin, y, tableW, headerH, 'F')
    let x = margin
    for (let i = 0; i < COLUMNS.length; i++) {
      let ty = y + lineH + 0.6
      for (const ln of cells[i]) { doc.text(ln, x + 1, ty); ty += lineH }
      x += COLUMNS[i].pdfWidth
    }
    y += headerH
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.2)
  }

  const list = sections.length ? sections : [{ name: 'Schedule', title: 'KSCW game schedule', rows: [] as ExportRow[] }]
  list.forEach((section, si) => {
    if (si > 0) doc.addPage()
    y = 13
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text(section.title, margin, y)
    doc.setFont('helvetica', 'normal')
    y += 7
    drawColumnHeader()

    if (section.rows.length === 0) {
      doc.setFontSize(9)
      doc.text('No games.', margin + 1, y + lineH)
      return
    }
    for (const r of section.rows) {
      // Wrap every cell first so the row height fits the tallest column.
      const cells = COLUMNS.map(c => doc.splitTextToSize(String(r[c.key] ?? ''), c.pdfWidth - 2) as string[])
      const lineCount = Math.max(1, ...cells.map(l => l.length))
      const rowH = lineCount * lineH + padY
      if (y + rowH > pageH - margin) { doc.addPage(); y = 12; drawColumnHeader() }
      let x = margin
      for (let i = 0; i < COLUMNS.length; i++) {
        let ty = y + lineH
        for (const ln of cells[i]) { doc.text(ln, x + 1, ty); ty += lineH }
        x += COLUMNS[i].pdfWidth
      }
      y += rowH
      doc.setDrawColor(225)
      doc.line(margin, y, margin + tableW, y)
    }
  })
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
