// J+S (Jugend+Sport) NDS export — client helpers.
//
// The row DATA is assembled server-side by the coach-gated /kscw/js-export
// endpoint (the J+S Personennummer never crosses the items API). This module
// owns the CSV MECHANICS: the exact BASPO NDS format — semicolon-delimited,
// UTF-8 + BOM, CRLF line endings, and the mandated German column headers.
//
// Format verified against the official templates (jugendundsport.ch/datenimport,
// updated 28.01.2026). Note the type column is spelled AKTIVITAETSTYP in the
// activities file but AKTIVITÄTSTYP (with ä) in the attendance file — both are
// reproduced verbatim; the header must match exactly or the import rejects it.

import { kscwApi } from '../../lib/api'

export interface JsActivityRow {
  type: string
  datum: string
  zeit: string
  dauer: number | string
  ort: string
}

export interface JsAttendanceRow {
  personennummer: string
  funktion: string
  datum: string
  type: string
  zeit: string
  dauer: number | string
  ort: string
}

export interface JsExportData {
  team: { id: string | number; name: string; sport: 'volleyball' | 'basketball' | string }
  season: string
  seasonStart: string
  seasonEnd: string
  activities: JsActivityRow[]
  attendance: JsAttendanceRow[]
  counts: { trainings: number; games: number; events: number; players: number; leaders: number; activities: number }
  warnings: { participantsMissingJsId: string[]; leadersMissingJsId: string[] }
}

// Exact NDS header rows (order + spelling are mandated — do NOT localise these).
export const JS_ACTIVITY_HEADERS = ['AKTIVITAETSTYP', 'DATUM', 'ZEIT', 'DAUER', 'ORT', 'FOKUS'] as const
export const JS_ATTENDANCE_HEADERS = ['PERSONENNUMMER', 'FUNKTION', 'DATUM', 'AKTIVITÄTSTYP', 'ZEIT', 'DAUER', 'ORT'] as const

export async function fetchJsExport(teamId: string | number, season: string): Promise<JsExportData> {
  const resp = await kscwApi<{ data: JsExportData }>(
    `/js-export/team/${teamId}?season=${encodeURIComponent(season)}`,
  )
  return resp.data
}

export function activityCsvRows(activities: JsActivityRow[]): (string | number)[][] {
  // FOKUS is left blank (only meaningful for Training/Trainingstag; not exported).
  return activities.map((a) => [a.type, a.datum, a.zeit, a.dauer, a.ort, ''])
}

export function attendanceCsvRows(rows: JsAttendanceRow[]): (string | number)[][] {
  return rows.map((r) => [r.personennummer, r.funktion, r.datum, r.type, r.zeit, r.dauer, r.ort])
}

/**
 * Trigger a browser download of an NDS CSV: semicolon-delimited, UTF-8 with BOM,
 * CRLF line endings. Fields containing a delimiter/quote/newline are quoted;
 * spreadsheet-formula injection is neutralised (a location could start with =).
 */
export function downloadJsCsv(filename: string, headers: readonly string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    let s = String(v ?? '')
    if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d/.test(s)) s = `'${s}`
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = [headers as readonly (string | number)[], ...rows]
    .map((r) => r.map(esc).join(';'))
    .join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** English filename slug (per the exports-are-English convention). */
export function jsExportFilename(kind: 'activities' | 'attendance', teamName: string, season: string): string {
  const slug = (teamName || 'team').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'team'
  return `kscw_js_${kind}_${slug}_${season.replace('/', '-')}.csv`
}

// ── Season options ────────────────────────────────────────────────────────────
// The season STRING ("YYYY/YY") is shared with member_teams.season and
// getSeasonDateRange, so activity window (Sep 1 → Aug 31) and roster filter line
// up. Default to the Sep–Aug season containing today — in the off-season that is
// the season that just finished (the one you actually report to J+S).

export function jsSeasonForDate(d: Date): string {
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 8 ? y : y - 1 // Sep(8)..Dec → this year; Jan..Aug → last year
  return `${startYear}/${String(startYear + 1).slice(2)}`
}

export function jsSeasonOptions(today: Date = new Date()): string[] {
  const base = Number(jsSeasonForDate(today).slice(0, 4))
  return [base + 1, base, base - 1, base - 2].map((y) => `${y}/${String(y + 1).slice(2)}`)
}
