import { downloadBytes, exportFilename } from './scheduleExport'
import {
  probasketConfigForSeason,
  probasketCandidateDates,
  timeToExcelFraction,
  parseYmd,
  HALL_A,
  HALL_B,
  HALL_C,
} from '../utils/probasketSeason'
import {
  dayHallAvailability,
  availabilityWindows,
  MAX_AVAILABILITY_WINDOWS,
  EMPTY_HALL_BLOCKERS,
  type HallBlockers,
} from '../utils/hallOccupancy'
import { KSCW_TEAM_GROUP, BB_GROUPS } from '../data/basketballGroups'
import type { Team, GameSchedulingSeason } from '../../../types'

// Generates the ProBasket "Angabe Verfügbarkeiten" workbook — one worksheet per team,
// mirroring the official template (Klub / Team / Kategorie header, Halle 1/2/3, then a
// row per candidate date with either "x" under Nicht verfügbar or up to three hall
// availability windows). Drop-in for the 17-Aug submission to info@probasket.ch.
//
// ⚠ Two rules that were wrong before and matter to the association:
//  1. The date grid is PER LEAGUE, not per season. A 1.-Liga sheet runs
//     Fr 25.09.2026 → So 09.05.2027 (93 rows); a junior sheet stops on 13.12.2026
//     (38 rows). One workbook can legitimately hold both, so the grid is resolved
//     inside the per-team loop from `teams.bb_source_id`.
//  2. Free times are grouped into MAXIMAL CONTIGUOUS runs. Emitting
//     `from = first free … to = end(last free)` declares the blocked middle as
//     available and gets us a fixture we cannot host.
//
// TODO: **DU18 B** ("KSC Wiedikon DU18 B", registered in group "DU18/U20 Rookie") has
// no `teams` row and no known Basketplan / bb_source_id, so this workbook cannot carry
// a sheet for it — ProBasket expects one Verfügbarkeiten sheet per REGISTERED team.
// Whoever files the 17-Aug submission must either add the team row first (then it
// appears here automatically) or hand-add the sheet. Do NOT reuse 7182: that id is
// DU16. See `utils/probasketSeason.ts → BB_SOURCE_LEAGUE_OVERRIDES`.

const DOW_LABEL: Record<number, string> = { 5: 'FR', 6: 'SA', 0: 'SO' }
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

export interface BasketballExportArgs {
  season: GameSchedulingSeason | null
  /** Teams to export (one sheet each). Each gets its own league date grid. */
  teams: Team[]
  /** Season-wide closures / club blocks / booked volleyball slots (`useBasketballPlan`). */
  blockers?: HallBlockers
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
  const blockers = args.blockers ?? EMPTY_HALL_BLOCKERS
  // The three halls the template's "Halle 1/2/3" header names.
  const HALLS = [HALL_A, HALL_B, HALL_C]

  const teams = args.teams.length ? args.teams : []
  for (const team of teams) {
    // Per-league window: 1. Liga gets the 93-row senior grid, juniors the 38-row one.
    const config = probasketConfigForSeason(args.season?.season, { bbSourceId: team.bb_source_id })
    const candidateDates = config ? probasketCandidateDates(config) : []

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
    for (const cd of candidateDates) {
      const d = parseYmd(cd.date)
      const mo = d.getMonth()
      if (mo !== lastMonth) {
        const mcell = ws.getCell(`A${r}`)
        mcell.value = MONTHS[mo]
        mcell.font = { bold: true, italic: true }
        r += 1
        lastMonth = mo
      }
      const teamOverride = args.availability.get(args.availKey(team.id, cd.date))?.unavailable === true
      const day = dayHallAvailability(cd.date, cd.dow, blockers, !!cd.blackout)
      const row = ws.getRow(r)
      row.getCell(1).value = DOW_LABEL[cd.dow] ?? ''
      row.getCell(2).value =
        `${String(d.getDate()).padStart(2, '0')}.${String(mo + 1).padStart(2, '0')}.${d.getFullYear()}`

      if (day.noneFree || teamOverride) {
        row.getCell(3).value = 'x'
      } else {
        const windows = availabilityWindows(
          day.times,
          day.freeByHall.filter((h) => HALLS.includes(h.hall)),
          MAX_AVAILABILITY_WINDOWS,
        )
        let col = 4
        for (const w of windows) {
          const vFrom = row.getCell(col)
          vFrom.value = timeToExcelFraction(w.from)
          vFrom.numFmt = 'hh:mm'
          const vTo = row.getCell(col + 1)
          vTo.value = timeToExcelFraction(w.to)
          vTo.numFmt = 'hh:mm'
          row.getCell(col + 2).value = w.hall
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
