/**
 * Schulferien sync — keeps the school-holiday hall_closures topped up from the
 * City of Zürich school calendar.
 *
 *   POST /kscw/admin/schulferien-sync   — manual trigger (admin only)
 *   Also registered as a monthly cron in the kscw-hooks extension.
 *
 * Source: City of Zürich Open Data (Volksschule), the authoritative + complete
 * calendar for the city the club's gyms sit in. Unlike the canton-level
 * OpenHolidays feed it includes the February Sportferien.
 *   https://data.stadt-zuerich.ch/dataset/ssd_schulferien
 * CSV columns: start_date, end_date, summary, created_date.
 * NOTE: end_date is EXCLUSIVE (single-day Neujahrstag is 01.01→02.01), so a
 * closure covers [start_date, end_date − 1 day].
 *
 * DESIGN — additive & non-destructive. The existing school_holidays closures
 * are the source of truth: they have been hand-curated (adjacent holidays
 * merged, e.g. "Ostern/Frühlingsferien"; weekend-only days like Pfingstsonntag
 * trimmed). This job therefore NEVER updates or deletes a school_holidays row.
 * For each Stadt-Zürich school-closure period in the CSV it inserts a closure
 * per hall ONLY IF that hall has no school_holidays closure overlapping the
 * period — so re-runs against the curated set are a perfect no-op, and the job
 * only ever fills genuine gaps (e.g. when a new school year is published).
 *
 * Reusing hall_closures (source='school_holidays') means the closure machinery
 * applies for free: the slot generator skips holiday dates, and the closure
 * create hook auto-cancels trainings on those dates. New rows are written via
 * ItemsService so that hook fires (raw knex inserts would bypass it).
 *
 * Excluded CSV rows: the non-closure admin entries ("Schulschluss um 12 Uhr",
 * "1. Schultag", "Schuljahresbeginn", "Schuljahresende") — school is open.
 */

const SCHULFERIEN_CSV_URL =
  'https://data.stadt-zuerich.ch/dataset/ssd_schulferien/download/schulferien.csv'

// City school-closure rows are prefixed "Schulen Stadt Zürich". These variants
// are NOT gym closures (school open / early dismissal / first/last day).
const EXCLUDE_SUMMARY = ['Schulschluss', '1. Schultag', 'Schuljahresbeginn', 'Schuljahresende']

// Canonical short labels for naming brand-new inserts (only used for gaps the
// curated set doesn't already cover; matched case-insensitively in the summary).
const LABEL_KEYWORDS = [
  'Sportferien', 'Frühlingsferien', 'Sommerferien', 'Herbstferien', 'Weihnachtsferien',
  'Ostern', 'Pfingsten', 'Auffahrt', 'Knabenschiessen', 'Sechseläuten', 'Tag der Arbeit',
]

function isoDay(d) {
  return d.toISOString().slice(0, 10)
}

function minusOneDay(isoDayStr) {
  const d = new Date(`${isoDayStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return isoDay(d)
}

/** Minimal CSV row splitter that respects double-quoted fields. */
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** A human-readable reason for a freshly inserted period, e.g. "Sportferien 2031". */
function deriveReason(summary, start, end) {
  let label = summary.replace(/^Schulen Stadt Zürich(\s+schulfrei)?:\s*/i, '').trim()
  const kw = LABEL_KEYWORDS.find((k) => label.toLowerCase().includes(k.toLowerCase()))
  label = kw || label.split('(')[0].split(',')[0].trim()
  const sy = start.slice(0, 4)
  const ey = end.slice(0, 4)
  const year = sy === ey ? sy : `${sy}/${ey.slice(2)}` // cross-boundary → "2031/32"
  return `${label} ${year}`.trim()
}

/**
 * Fetch + parse the CSV into Stadt-Zürich school-closure periods that end on or
 * after `fromIso`. Returns [{ summary, start, end }] with end made inclusive.
 */
async function fetchClosurePeriods(fromIso) {
  const resp = await fetch(SCHULFERIEN_CSV_URL, { headers: { Accept: 'text/csv' } })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`Stadt Zürich CSV fetch failed: ${resp.status} ${body.slice(0, 200)}`)
  }
  const text = await resp.text()
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const header = splitCsvLine(lines[0]).map((h) => h.trim())
  const iStart = header.indexOf('start_date')
  const iEnd = header.indexOf('end_date')
  const iSummary = header.indexOf('summary')
  if (iStart < 0 || iEnd < 0 || iSummary < 0) {
    throw new Error(`Unexpected CSV header: ${header.join(',')}`)
  }

  const periods = []
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r])
    const summary = (cols[iSummary] ?? '').trim()
    if (!summary.startsWith('Schulen Stadt Zürich')) continue
    if (EXCLUDE_SUMMARY.some((x) => summary.includes(x))) continue

    const startRaw = (cols[iStart] ?? '').slice(0, 10)
    const endRaw = (cols[iEnd] ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) continue

    const end = minusOneDay(endRaw) // CSV end_date is exclusive
    if (end < startRaw || end < fromIso) continue

    periods.push({ summary, start: startRaw, end })
  }
  return periods
}

export function registerSchulferienSync(router, { services, database, getSchema, logger }) {
  const log = logger.child({ endpoint: 'schulferien-sync' })
  const { ItemsService } = services

  async function runSync(db) {
    const fromIso = isoDay(new Date())
    const periods = await fetchClosurePeriods(fromIso)
    const halls = await db('halls').select('id')
    if (halls.length === 0) {
      log.warn('schulferien-sync: no halls found, nothing to do')
      return { periods: periods.length, halls: 0, created: 0, skipped: 0 }
    }

    // Existing school_holidays closures (the curated source of truth) that
    // reach into the future, grouped by hall as [start, end] intervals.
    // Cast date columns to text — knex/pg otherwise returns `date` as a JS Date
    // (at server-local midnight), and toISOString()/String() on that shifts or
    // mangles the day. ::text yields a clean 'YYYY-MM-DD' that compares directly
    // against the CSV's ISO strings.
    const existing = await db('hall_closures')
      .where('source', 'school_holidays')
      .andWhere('end_date', '>=', fromIso)
      .select('hall', db.raw('start_date::text as start_date'), db.raw('end_date::text as end_date'))
    const byHall = new Map()
    for (const row of existing) {
      const list = byHall.get(row.hall) ?? []
      list.push([row.start_date.slice(0, 10), row.end_date.slice(0, 10)])
      byHall.set(row.hall, list)
    }

    const schema = await getSchema()
    // System context (no accountability) so the closure-create hook fires
    // (auto-cancel trainings + slot-skip) and permissions are bypassed.
    const closures = new ItemsService('hall_closures', { schema, knex: db })

    let created = 0, skipped = 0
    for (const p of periods) {
      const reason = deriveReason(p.summary, p.start, p.end)
      for (const h of halls) {
        const intervals = byHall.get(h.id) ?? []
        // Skip if any existing school_holidays closure for this hall overlaps the
        // period — never duplicate or override the curated set.
        const overlaps = intervals.some(([a, b]) => a <= p.end && p.start <= b)
        if (overlaps) { skipped++; continue }
        await closures.createOne({
          hall: h.id,
          start_date: p.start,
          end_date: p.end,
          reason,
          source: 'school_holidays',
        })
        intervals.push([p.start, p.end]) // guard against double-insert within a run
        byHall.set(h.id, intervals)
        created++
      }
    }

    return { periods: periods.length, halls: halls.length, created, skipped }
  }

  router.post('/admin/schulferien-sync', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin access required' })
    try {
      log.info('Manual Schulferien sync triggered')
      const result = await runSync(database)
      log.info(`schulferien-sync: ${JSON.stringify(result)}`)
      res.json({ status: 'ok', ...result })
    } catch (err) {
      log.error({ msg: `schulferien-sync: ${err.message}`, endpoint: 'schulferien-sync', userId: req?.accountability?.user || null, method: req?.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
