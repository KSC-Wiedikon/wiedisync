/**
 * Temporal cells in SQL-workspace / table-browser results.
 *
 * Three string shapes reach the grid and the exporters, and they mean
 * different things:
 *
 *   · `2026-09-15`                 a `date` — a calendar day, no zone
 *   · `2026-09-15 20:00:00`        a `timestamp` without zone (e.g. `g.date + g.time`)
 *                                  — wall-clock text, no zone
 *   · `2026-09-10T12:32:00.000Z`   a `timestamptz` — an instant, shown in Europe/Zurich
 *
 * The first two must never go through `new Date()`: the browser pins a bare
 * date to UTC midnight and a space-separated timestamp to its own zone, and the
 * value shifts on display (a `date` rendered as "15.09.2026 02:00"). So they are
 * read field-by-field, and only the zoned form is parsed as an instant.
 */

export interface SqlTemporal {
  kind: 'date' | 'wallclock' | 'instant'
  y: number
  m: number
  d: number
  hh: number
  mi: number
  ss: number
}

// Anchored, so "2026 budget" or a Swiss "15.09.2026" never qualify. The time
// part is optional (date), the zone is optional (wallclock vs instant).
const TEMPORAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/

const ZURICH_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zurich',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
})

function zurichParts(instant: Date): Omit<SqlTemporal, 'kind'> {
  const p: Record<string, number> = {}
  for (const { type, value } of ZURICH_PARTS.formatToParts(instant)) {
    if (type !== 'literal') p[type] = Number(value)
  }
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mi: p.minute, ss: p.second }
}

/** Classify a cell. `null` for anything that is not a temporal string. */
export function parseSqlTemporal(value: unknown): SqlTemporal | null {
  if (typeof value !== 'string') return null
  const m = TEMPORAL_RE.exec(value)
  if (!m) return null
  const [, y, mo, d, hh, mi, ss, zone] = m
  if (hh === undefined) {
    return { kind: 'date', y: +y, m: +mo, d: +d, hh: 0, mi: 0, ss: 0 }
  }
  if (!zone) {
    return { kind: 'wallclock', y: +y, m: +mo, d: +d, hh: +hh, mi: +mi!, ss: +(ss ?? 0) }
  }
  // Normalise to strict ISO 8601 (`T`, `+hh:mm`) so every engine parses the
  // same — Postgres's own text form is `2026-09-10 12:32:00+00`.
  const iso = value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return null
  return { kind: 'instant', ...zurichParts(instant) }
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** Swiss text: `dd.mm.yyyy` for a date, `dd.mm.yyyy HH:MM` (+`:SS` on request) otherwise. */
export function formatSqlTemporal(t: SqlTemporal, opts: { seconds?: boolean } = {}): string {
  const date = `${p2(t.d)}.${p2(t.m)}.${t.y}`
  if (t.kind === 'date') return date
  return `${date} ${p2(t.hh)}:${p2(t.mi)}${opts.seconds ? `:${p2(t.ss)}` : ''}`
}

/** exceljs reads a Date's UTC fields as the cell's wall-clock (`dateToExcel`
 *  is `25569 + getTime()/86400000`), so build one from the parts and the sheet
 *  shows exactly the Zurich time the grid shows — not the UTC instant. */
export function sqlTemporalToExcelDate(t: SqlTemporal): Date {
  return new Date(Date.UTC(t.y, t.m - 1, t.d, t.hh, t.mi, t.ss))
}
