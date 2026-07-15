import { downloadBytes, exportFilename } from './scheduleExport'
import {
  slotsForDate,
  slotEndTime,
  timeToExcelFraction,
  parseYmd,
  HALL_A,
  HALL_B,
  HALL_C,
  type CandidateDate,
} from '../utils/probasketSeason'
import { KSCW_TEAM_GROUP, BB_GROUPS } from '../data/basketballGroups'
import type { Team, GameSchedulingSeason } from '../../../types'
import type { DateInfo } from '../hooks/useBasketballPlan'

// Generates the ProBasket "Angabe Verfügbarkeiten" workbook — one worksheet per team,
// mirroring the official template (Klub / Team / Kategorie header, Halle 1/2/3, then a
// row per candidate date with either "x" under Nicht verfügbar or up to three hall
// availability windows). Drop-in for the 17-Aug submission to info@probasket.ch.

const DOW_LABEL: Record<number, string> = { 5: 'FR', 6: 'SA', 0: 'SO' }
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

export interface BasketballExportArgs {
  season: GameSchedulingSeason | null
  /** Teams to export (one sheet each). */
  teams: Team[]
  candidateDates: CandidateDate[]
  dateInfoByDate: Map<string, DateInfo>
  vbHallsByDate: Map<string, Set<string>>
  /** Per-team date `unavailable` overrides, keyed via availKey. */
  availability: Map<string, { unavailable?: boolean }>
  availKey: (teamId: string | number, date: string) => string
}

/** ProBasket "Kategorie" for a team — the group label (falls back to the team's league). */
function kategorieFor(team: Team): string {
  const code = team.bb_source_id ? KSCW_TEAM_GROUP[String(team.bb_source_id)] : undefined
  return (code ? BB_GROUPS[code]?.label : undefined) ?? team.league ?? ''
}

function sheetName(name: string, used: Set<string>): string {
  const base = (name || 'Team').replace(/[\\/*?:[\]]/g, '').slice(0, 28) || 'Team'
  let n = base
  let i = 2
  while (used.has(n)) n = `${base} ${i++}`.slice(0, 31)
  used.add(n)
  return n
}

export async function exportBasketballAvailability(args: BasketballExportArgs): Promise<void> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const used = new Set<string>()
  const HALLS = [HALL_A, HALL_B, HALL_C]

  const teams = args.teams.length ? args.teams : []
  for (const team of teams) {
    const ws = wb.addWorksheet(sheetName(team.name, used))
    ws.columns = [
      { width: 6 }, { width: 12 }, { width: 14 },
      { width: 9 }, { width: 9 }, { width: 9 },
      { width: 9 }, { width: 9 }, { width: 9 },
      { width: 9 }, { width: 9 }, { width: 9 },
    ]

    ws.getCell('A1').value = 'Angabe Verfügbarkeiten ProBasket'
    ws.getCell('A1').font = { bold: true, size: 14 }
    ws.getCell('A4').value = 'Klub:'
    ws.getCell('B4').value = 'KSC Wiedikon'
    ws.getCell('A5').value = 'Team:'
    ws.getCell('B5').value = team.name
    ws.getCell('A6').value = 'Kategorie:'
    ws.getCell('B6').value = kategorieFor(team)
    ws.getCell('E4').value = 'Halle 1:'
    ws.getCell('F4').value = HALL_A
    ws.getCell('E5').value = 'Halle 2:'
    ws.getCell('F5').value = HALL_B
    ws.getCell('E6').value = 'Halle 3:'
    ws.getCell('F6').value = HALL_C

    const hdr = ws.getRow(8)
    hdr.values = [
      'Tag', 'Datum', 'Nicht verfügbar',
      'Zeit von', 'Zeit bis', 'Halle',
      'Zeit von', 'Zeit bis', 'Halle',
      'Zeit von', 'Zeit bis', 'Halle',
    ]
    hdr.font = { bold: true }

    let r = 9
    let lastMonth = -1
    for (const cd of args.candidateDates) {
      const d = parseYmd(cd.date)
      const mo = d.getMonth()
      if (mo !== lastMonth) {
        const mcell = ws.getCell(`A${r}`)
        mcell.value = MONTHS[mo]
        mcell.font = { bold: true, italic: true }
        r += 1
        lastMonth = mo
      }
      const info = args.dateInfoByDate.get(cd.date)
      const teamOverride = args.availability.get(args.availKey(team.id, cd.date))?.unavailable === true
      const row = ws.getRow(r)
      row.getCell(1).value = DOW_LABEL[cd.dow] ?? ''
      row.getCell(2).value =
        `${String(d.getDate()).padStart(2, '0')}.${String(mo + 1).padStart(2, '0')}.${d.getFullYear()}`

      if (info?.fullyBlocked || teamOverride) {
        row.getCell(3).value = 'x'
      } else {
        const { times, halls } = slotsForDate(cd.dow)
        const vb = args.vbHallsByDate.get(cd.date) ?? new Set<string>()
        const from = timeToExcelFraction(times[0])
        const to = timeToExcelFraction(slotEndTime(times[times.length - 1]))
        let col = 4
        for (const hall of halls) {
          if (!HALLS.includes(hall)) continue
          if (vb.has(hall) || info?.closedHalls.has(hall) || info?.closedHalls.has('*')) continue
          if (col > 10) break // template holds up to three hall windows
          const vFrom = row.getCell(col)
          vFrom.value = from
          vFrom.numFmt = 'hh:mm'
          const vTo = row.getCell(col + 1)
          vTo.value = to
          vTo.numFmt = 'hh:mm'
          row.getCell(col + 2).value = hall
          col += 3
        }
      }
      r += 1
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const filename = exportFilename('xlsx', teams.length === 1 ? teams[0].name : 'Basketball-Verfuegbarkeit')
  downloadBytes(
    new Uint8Array(buffer as ArrayBuffer),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename,
  )
}
