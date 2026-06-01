/**
 * Schulferien sync — imports the City of Zürich school-holiday calendar and
 * materializes it as hall_closures rows (source='school_holidays') for every hall.
 *
 *   POST /kscw/admin/schulferien-sync   — manual trigger (admin only)
 *   Also registered as a daily cron in the kscw-hooks extension.
 *
 * Source: City of Zürich Open Data (Volksschule), the authoritative + complete
 * calendar for the city the club's gyms sit in. Unlike the OpenHolidays API it
 * includes the February Sportferien (which varies by municipality and is omitted
 * from the canton-level feed).
 *   https://data.stadt-zuerich.ch/dataset/ssd_schulferien
 * CSV columns: start_date, end_date, summary, created_date.
 * NOTE: end_date is EXCLUSIVE (single-day Neujahrstag is 01.01→02.01), so a
 * holiday covers [start_date, end_date − 1 day].
 *
 * We import only the multi-week Ferien blocks (Sport / Frühlings / Sommer /
 * Herbst / Weihnachts) when the school gyms are genuinely shut — not the
 * single-day public holidays, half-days ("Schulschluss um 12 Uhr") or first
 * school day. Extend FERIEN_KEYWORDS to widen the scope.
 *
 * Why hall_closures (not a separate table): reusing closures means everything
 * already built applies for free — the slot generator skips holiday dates, and
 * the hall_closures create/update/delete hook auto-cancels (and reverses)
 * trainings on those dates. Writes go through ItemsService so those hooks fire
 * (raw knex inserts would bypass them).
 *
 * Idempotency: source='school_holidays' rows are importer-owned and keyed by
 * (hall, reason). Each run upserts the desired set for a forward window and
 * deletes future school-holiday rows that no longer match any imported Ferien.
 * Manual ad-hoc closures should therefore use source 'admin' / 'hauswart'.
 */

const SCHULFERIEN_CSV_URL =
  'https://data.stadt-zuerich.ch/dataset/ssd_schulferien/download/schulferien.csv'

// Canonical Ferien names matched against the CSV `summary` (case-insensitive).
// Each appears in several summary variants ("Schulen Stadt Zürich: Sportferien",
// "… schulfrei: Frühlingsferien (inkl. …)"), so we key off the bare keyword.
const FERIEN_KEYWORDS = [
  'Sportferien',
  'Frühlingsferien',
  'Sommerferien',
  'Herbstferien',
  'Weihnachtsferien',
]

const FORWARD_MONTHS = 18 // how far ahead to materialize closures

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

/**
 * Fetch + parse the CSV into Ferien periods within [fromIso, toIso].
 * Returns [{ name, year, start, end }] with end already made inclusive.
 */
async function fetchFerien(fromIso, toIso) {
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
    const keyword = FERIEN_KEYWORDS.find((k) =>
      summary.toLowerCase().includes(k.toLowerCase()),
    )
    if (!keyword) continue

    const startRaw = (cols[iStart] ?? '').slice(0, 10)
    const endRaw = (cols[iEnd] ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) continue

    const end = minusOneDay(endRaw) // CSV end_date is exclusive
    if (end < startRaw) continue
    // Keep anything that overlaps our forward window.
    if (end < fromIso || startRaw > toIso) continue

    periods.push({ name: keyword, year: startRaw.slice(0, 4), start: startRaw, end })
  }
  return periods
}

export function registerSchulferienSync(router, { services, database, getSchema, logger }) {
  const log = logger.child({ endpoint: 'schulferien-sync' })
  const { ItemsService } = services

  async function runSync(db) {
    const now = new Date()
    const fromIso = isoDay(now)
    const toDate = new Date(now)
    toDate.setMonth(toDate.getMonth() + FORWARD_MONTHS)
    const toIso = isoDay(toDate)

    const periods = await fetchFerien(fromIso, toIso)
    const halls = await db('halls').select('id')
    if (halls.length === 0) {
      log.warn('schulferien-sync: no halls found, nothing to do')
      return { periods: periods.length, halls: 0, created: 0, updated: 0, deleted: 0 }
    }

    const schema = await getSchema()
    // System context (no accountability) so closure hooks fire (auto-cancel
    // trainings + slot-skip) and permissions are bypassed.
    const closures = new ItemsService('hall_closures', { schema, knex: db })

    // Existing importer-owned rows for the forward window, keyed by hall|reason.
    const existingRows = await db('hall_closures')
      .where('source', 'school_holidays')
      .andWhere('start_date', '>=', fromIso)
      .select('id', 'hall', 'reason', 'start_date', 'end_date')
    const existingByKey = new Map(
      existingRows.map((row) => [`${row.hall}|${row.reason}`, row]),
    )

    const desiredKeys = new Set()
    let created = 0, updated = 0, deleted = 0

    for (const p of periods) {
      const reason = `${p.name} ${p.year}` // e.g. "Sportferien 2026"
      for (const h of halls) {
        const key = `${h.id}|${reason}`
        desiredKeys.add(key)
        const existing = existingByKey.get(key)
        if (existing) {
          const exStart = String(existing.start_date).slice(0, 10)
          const exEnd = String(existing.end_date).slice(0, 10)
          if (exStart !== p.start || exEnd !== p.end) {
            await closures.updateOne(existing.id, { start_date: p.start, end_date: p.end })
            updated++
          }
        } else {
          await closures.createOne({
            hall: h.id,
            start_date: p.start,
            end_date: p.end,
            reason,
            source: 'school_holidays',
          })
          created++
        }
      }
    }

    // Reconcile: drop future importer rows that no longer match any Ferien
    // (e.g. a holiday shifted name/year, or a hall was removed). Deleting fires
    // the closure-delete hook, which un-cancels the trainings it had cancelled.
    for (const row of existingRows) {
      if (!desiredKeys.has(`${row.hall}|${row.reason}`)) {
        await closures.deleteOne(row.id)
        deleted++
      }
    }

    return { periods: periods.length, halls: halls.length, created, updated, deleted }
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
