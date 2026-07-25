/**
 * schulferien.mjs — Zürich school-holiday ranges from the City open data.
 *
 * Same authoritative source the in-repo schulferien-sync uses:
 *   https://data.stadt-zuerich.ch/dataset/ssd_schulferien/download/schulferien.csv
 * Columns: start_date, end_date (EXCLUSIVE), summary, created_date.
 *
 * Only "Schulen Stadt Zürich" closure rows count as gym closures; the admin
 * rows (Schulschluss / 1. Schultag / Schuljahresbeginn/-ende) are school-open.
 * Zero deps so it runs in the scrape script and under `node --test`.
 */

const CSV_URL =
  'https://data.stadt-zuerich.ch/dataset/ssd_schulferien/download/schulferien.csv'
const EXCLUDE = ['Schulschluss', '1. Schultag', 'Schuljahresbeginn', 'Schuljahresende']

/** CSV line splitter that respects double-quoted fields. */
export function splitCsvLine(line) {
  const out = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false }
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

function minusOneDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Parse CSV text → inclusive [{ start, end, summary }] school-closure ranges. */
export function parseHolidayRanges(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const header = splitCsvLine(lines[0]).map((h) => h.trim())
  const iS = header.indexOf('start_date'), iE = header.indexOf('end_date'), iSum = header.indexOf('summary')
  if (iS < 0 || iE < 0 || iSum < 0) throw new Error(`Unexpected schulferien CSV header: ${header.join(',')}`)

  const ranges = []
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r])
    const summary = (cols[iSum] ?? '').trim()
    if (!summary.startsWith('Schulen Stadt Zürich')) continue
    if (EXCLUDE.some((x) => summary.includes(x))) continue
    const start = (cols[iS] ?? '').slice(0, 10)
    const endRaw = (cols[iE] ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) continue
    const end = minusOneDay(endRaw) // CSV end_date is exclusive
    if (end < start) continue
    ranges.push({ start, end, summary })
  }
  return ranges
}

export async function fetchHolidayRanges(fetchImpl = fetch) {
  const resp = await fetchImpl(CSV_URL, { headers: { Accept: 'text/csv' } })
  if (!resp.ok) throw new Error(`schulferien CSV fetch failed: ${resp.status}`)
  return parseHolidayRanges(await resp.text())
}

/** Is an ISO 'YYYY-MM-DD' date inside any closure range (inclusive)? */
export function isHoliday(isoDate, ranges) {
  return ranges.some((r) => r.start <= isoDate && isoDate <= r.end)
}
