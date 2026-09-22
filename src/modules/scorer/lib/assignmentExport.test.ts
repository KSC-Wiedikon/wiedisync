import { describe, expect, it } from 'vitest'
import { buildAssignmentXlsx, type XlsxGameRow, type XlsxSummaryRow, type XlsxLabels } from './assignmentExport'
import { crewLabel, resolveBbRequirement, TABELLE_I } from './bbLeagueRequirements'

const L: XlsxLabels = {
  sheetGames: 'Games', sheetSummary: 'Team summary',
  gameNo: 'Game no', weekday: 'Day', date: 'Date', time: 'Time', hall: 'Hall',
  home: 'Home', away: 'Away', league: 'League',
  scorer: 'Scorer', scoreboard: 'Täfeler', combined: 'Combined', referee: 'Referee',
  dutyTeam: 'Duty team', conflicts: 'Notes',
  crewRequired: 'Crew required', anschreiber: 'Scorer (OTR1)',
  zeitnehmer: 'Timekeeper (OTR1)', official24s: '24" official (OTR2)', otr2Duties: 'Of which OTR2',
  team: 'Team', games: 'Games', total: 'Total',
}

const row = (o: Partial<XlsxGameRow>): XlsxGameRow => ({
  gameNo: '1', weekday: 'Wed', date: '21.10.2026', time: '18:00', hall: 'KWI A',
  home: 'Lions D1', away: 'Opfikon', league: '1LRAF',
  scorer: '', scoreboard: '', combined: '', referee: '', dutyTeam: '',
  crewRequired: '', anschreiber: '', zeitnehmer: '', official24s: '',
  conflicts: '', status: 'ok', ...o,
})

const summary = (o: Partial<XlsxSummaryRow>): XlsxSummaryRow => ({
  team: 'Herren 1', games: 16, scorer: 0, scoreboard: 0, combined: 0,
  referee: 0, duties: 5, total: 5, otr2Duties: 3, ...o,
})

/** Read a sheet back out of the generated workbook. */
async function readBack(bytes: Uint8Array) {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes as unknown as ArrayBuffer)
  const sheet = (name: string) => {
    const ws = wb.getWorksheet(name)!
    return (r: number) => (ws.getRow(r).values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v)))
  }
  return { games: sheet('Games'), summary: sheet('Team summary') }
}

describe('crewLabel', () => {
  it('reads like Tabelle I, highest licence first', () => {
    expect(crewLabel(TABELLE_I.D1LR)).toBe('3 — 1 OTR2, 2 OTR1')
    expect(crewLabel(TABELLE_I.HU14I)).toBe('3 — 1 OTR2, 1 OTR1, 1 free')
    expect(crewLabel(TABELLE_I.D3LR)).toBe('2 — 1 OTR1, 1 free')
    expect(crewLabel(TABELLE_I.U10)).toBe('2 — 2 free')
    expect(crewLabel(TABELLE_I.U8)).toBe('Referee only')
  })

  it('labels the live KSCW leagues', () => {
    expect(crewLabel(resolveBbRequirement('1LRAF'))).toBe('3 — 1 OTR2, 2 OTR1') // Lions D1
    expect(crewLabel(resolveBbRequirement('2LRM'))).toBe('3 — 1 OTR2, 2 OTR1')  // Herren 2
    expect(crewLabel(resolveBbRequirement('4LZM'))).toBe('2 — 1 OTR1, 1 free')  // Herren 3
  })
})

describe('basketball games sheet', () => {
  it('carries the duty team, the requirement and the three seats', async () => {
    const bytes = await buildAssignmentXlsx('basketball', [
      row({ dutyTeam: 'Herren 1', crewRequired: '3 — 1 OTR2, 2 OTR1', anschreiber: 'M. Huber', zeitnehmer: 'A. Meier', official24s: 'L. Graf' }),
    ], [summary({})], new Map(), L)
    const { games } = await readBack(bytes)
    expect(games(1)).toEqual(['Game no', 'Day', 'Date', 'Time', 'Hall', 'Home', 'Away', 'League',
      'Duty team', 'Crew required', 'Scorer (OTR1)', 'Timekeeper (OTR1)', '24" official (OTR2)', 'Notes'])
    expect(games(2).slice(8, 13)).toEqual(['Herren 1', '3 — 1 OTR2, 2 OTR1', 'M. Huber', 'A. Meier', 'L. Graf'])
  })

  it('marks a seat the league does not have as n/a, an unfilled one as a dash', async () => {
    const bytes = await buildAssignmentXlsx('basketball', [
      row({ league: '3LRF', dutyTeam: 'Herren 3', crewRequired: '2 — 1 OTR1, 1 free', anschreiber: '—', zeitnehmer: '—', official24s: 'n/a' }),
    ], [summary({})], new Map(), L)
    const { games } = await readBack(bytes)
    expect(games(2).slice(10, 13)).toEqual(['—', '—', 'n/a'])
  })

  it('summary reports duties and how many needed an OTR2', async () => {
    const bytes = await buildAssignmentXlsx('basketball', [row({})], [summary({ duties: 5, otr2Duties: 3 })], new Map(), L)
    const { summary: sum } = await readBack(bytes)
    expect(sum(1)).toEqual(['Team', 'Games', 'Duty team', 'Of which OTR2'])
    expect(sum(2)).toEqual(['Herren 1', '16', '5', '3'])
  })
})

describe('volleyball sheet is unchanged', () => {
  it('keeps its four role columns', async () => {
    const bytes = await buildAssignmentXlsx('volleyball', [
      row({ scorer: 'H1', scoreboard: 'D1', combined: '', referee: '' }),
    ], [summary({})], new Map(), L)
    const { games } = await readBack(bytes)
    expect(games(1)).toEqual(['Game no', 'Day', 'Date', 'Time', 'Hall', 'Home', 'Away', 'League',
      'Scorer', 'Täfeler', 'Combined', 'Referee', 'Notes'])
  })
})
