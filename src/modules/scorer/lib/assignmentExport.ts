// Coloured Excel export of the scorer-duty assignment overview.
// Two sheets: per-game assignments (duty-team cells tinted by team, unassigned
// games red) + the per-team summary. Reuses the schedule export's download helper.

export { downloadBytes } from '../../gameScheduling/lib/scheduleExport'
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const HEADER_FILL = 'FF1E3A8A'  // brand blue
const RED_FILL = 'FFFECACA'     // light red — a game with no assignment
const EXISTING_FILL = 'FFF3F4F6' // light grey — kept existing assignment
const CUP_FILL = 'FFDBEAFE'      // light blue — cup game, on-call/Pikett slot

// Distinct pastels so each team's cells are scannable at a glance.
const TEAM_PALETTE = [
  'FFBFDBFE', 'FFBBF7D0', 'FFFDE68A', 'FFFBCFE8', 'FFDDD6FE', 'FFA7F3D0',
  'FFFED7AA', 'FFC7D2FE', 'FFF5D0FE', 'FFFEF08A', 'FFBAE6FD', 'FFD9F99D',
]

export function buildTeamColors(teamNames: string[]): Map<string, string> {
  const m = new Map<string, string>()
  teamNames.filter(Boolean).sort().forEach((n, i) => m.set(n, TEAM_PALETTE[i % TEAM_PALETTE.length]))
  return m
}

export interface XlsxGameRow {
  gameNo: string // Swiss Volley / Basketplan game number (games.game_id) — the match key for the "upload corrected" round-trip
  weekday: string
  date: string; time: string; hall: string; home: string; away: string; league: string
  scorer: string; scoreboard: string; combined: string; referee: string; dutyTeam: string
  conflicts: string
  status: 'ok' | 'unassigned' | 'existing' | 'cup'
}

export interface XlsxSummaryRow {
  team: string; games: number; scorer: number; scoreboard: number
  combined: number; referee: number; duties: number; total: number
}

export interface XlsxLabels {
  sheetGames: string; sheetSummary: string
  gameNo: string; weekday: string
  date: string; time: string; hall: string; home: string; away: string; league: string
  scorer: string; scoreboard: string; combined: string; referee: string; dutyTeam: string; conflicts: string
  team: string; games: string; total: string
}

export async function buildAssignmentXlsx(
  sport: 'volleyball' | 'basketball',
  gameRows: XlsxGameRow[],
  summaryRows: XlsxSummaryRow[],
  teamColors: Map<string, string>,
  L: XlsxLabels,
): Promise<Uint8Array> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const isVb = sport === 'volleyball'

  const tint = (cell: import('exceljs').Cell, argb: string) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
  }
  const headerRow = (row: import('exceljs').Row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    row.alignment = { vertical: 'middle' }
  }

  // ── Sheet 1: games ──
  const ws = wb.addWorksheet(L.sheetGames.slice(0, 31))
  const gameCols = isVb
    ? [['gameNo', L.gameNo, 12], ['weekday', L.weekday, 6], ['date', L.date, 12], ['time', L.time, 8], ['hall', L.hall, 12], ['home', L.home, 26], ['away', L.away, 26], ['league', L.league, 22], ['scorer', L.scorer, 12], ['scoreboard', L.scoreboard, 12], ['combined', L.combined, 14], ['referee', L.referee, 14], ['conflicts', L.conflicts, 44]] as const
    : [['gameNo', L.gameNo, 12], ['weekday', L.weekday, 6], ['date', L.date, 12], ['time', L.time, 8], ['hall', L.hall, 12], ['home', L.home, 26], ['away', L.away, 26], ['league', L.league, 22], ['dutyTeam', L.dutyTeam, 14], ['conflicts', L.conflicts, 44]] as const
  ws.columns = gameCols.map(([key, header, width]) => ({ key, header, width }))
  headerRow(ws.getRow(1))
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const teamKeys = isVb ? ['scorer', 'scoreboard', 'combined', 'referee'] : ['dutyTeam']
  for (const r of gameRows) {
    const row = ws.addRow(r as unknown as Record<string, unknown>)
    if (r.status === 'unassigned') {
      row.eachCell((c) => tint(c, RED_FILL))
    } else if (r.status === 'existing') {
      row.eachCell((c) => tint(c, EXISTING_FILL))
    } else if (r.status === 'cup') {
      row.eachCell((c) => tint(c, CUP_FILL))
    }
    for (const k of teamKeys) {
      const name = (r as unknown as Record<string, string>)[k]
      if (name && teamColors.has(name)) tint(row.getCell(k), teamColors.get(name)!)
    }
  }

  // ── Sheet 2: team summary ──
  const ws2 = wb.addWorksheet(L.sheetSummary.slice(0, 31))
  const sumCols = isVb
    ? [['team', L.team, 14], ['games', L.games, 10], ['scorer', L.scorer, 10], ['scoreboard', L.scoreboard, 12], ['combined', L.combined, 14], ['referee', L.referee, 14], ['total', L.total, 10]] as const
    : [['team', L.team, 14], ['games', L.games, 10], ['duties', L.dutyTeam, 10]] as const
  ws2.columns = sumCols.map(([key, header, width]) => ({ key, header, width }))
  headerRow(ws2.getRow(1))
  ws2.views = [{ state: 'frozen', ySplit: 1 }]
  for (const s of summaryRows) {
    const row = ws2.addRow(s as unknown as Record<string, unknown>)
    if (teamColors.has(s.team)) tint(row.getCell('team'), teamColors.get(s.team)!)
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}
