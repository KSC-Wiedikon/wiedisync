/**
 * Hallenfinder — read the cached City of Zürich hall availability (migration 242).
 *
 *   GET /kscw/hallenfinder/search
 *     ?weekday=1,2,3,4,5        (default Mon–Fri)
 *     &startFrom=18:00          (slot must start at/after this)
 *     &minMinutes=90            (required free duration)
 *     &district=3               (optional Stadtkreis)
 *     &hallType=sporthalle      (optional)
 *     &freeAllNonHolidayWeeks=1 (default 1 — free EVERY non-Schulferien week)
 *
 * Returns one row per (hall, weekday) that qualifies, with week counts, a
 * representative free window, and deep links back to the city tool. All the
 * per-week logic is derived here from the cached `dates` jsonb so the same
 * nightly snapshot answers any start/duration/weekday filter.
 *
 * The city tool has no API; the nightly scrape (hallenfinder-scrape.mjs) fills
 * the cache. Tables are private (migration 242) — read via this endpoint only.
 *
 * Permission: any authenticated Member (public, non-sensitive data). Nav
 * visibility (admins + leaders/coaches) is the real gate, set on the frontend.
 */

const CITY_BASE = 'https://www.ssd-sporthallen.stadt-zuerich.ch'

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Parse a window string ("18:00-22:00" or "18:00-20:00 / 20:30-22:00") to [[a,b],…] minutes. */
function parseWindow(win) {
  if (!win) return []
  const out = []
  for (const part of String(win).split('/')) {
    const m = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(part)
    if (!m) continue
    const a = toMin(m[1]), b = toMin(m[2])
    if (a !== null && b !== null && b > a) out.push([a, b])
  }
  return out
}

/** Does the free window contain a ≥minMinutes block starting at/after startFromMin? */
function windowSatisfies(win, startFromMin, minMinutes) {
  return parseWindow(win).some(([a, b]) => {
    const start = Math.max(a, startFromMin)
    return b - start >= minMinutes
  })
}

function ddmmyyyy(iso) { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}` }

/**
 * Normalise a Postgres `date` column to "YYYY-MM-DD".
 *
 * node-pg hands `date` back as a JS Date at LOCAL midnight, so `String(d)` is
 * "Tue Sep 01 2026 00:00:00 GMT+0200 …" and slicing 10 chars off it yields
 * "Tue Sep 01", which Postgres then rejects (`invalid input syntax for type
 * date`) when it is fed straight back in as a bind parameter.
 *
 * Deliberately uses local components rather than toISOString(): the value is a
 * calendar date parsed at local midnight, and in UTC+1/+2 toISOString() rolls
 * it back to the PREVIOUS day. Strings pass through untouched, since Directus
 * can be configured to return date columns already stringified.
 */
function pgDate(v) {
  if (!(v instanceof Date)) return String(v).slice(0, 10)
  const mm = String(v.getMonth() + 1).padStart(2, '0')
  const dd = String(v.getDate()).padStart(2, '0')
  return `${v.getFullYear()}-${mm}-${dd}`
}
const WD_PARAM = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 } // our weekday == city wochentag

export function registerHallenfinder(router, { database, logger }) {
  const log = logger.child({ endpoint: 'hallenfinder' })

  router.get('/hallenfinder/search', async (req, res) => {
    if (!req.accountability?.user) return res.status(401).json({ error: 'Authentication required' })
    try {
      if (!(await database.schema.hasTable('city_hall_availability'))) {
        return res.json({ season: null, lastUpdated: null, results: [], note: 'not-yet-scraped' })
      }

      // ── filters ──
      const weekdays = String(req.query.weekday || '1,2,3,4,5')
        .split(',').map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 7)
      const startFrom = /^\d{1,2}:\d{2}$/.test(String(req.query.startFrom)) ? String(req.query.startFrom) : '18:00'
      const startFromMin = toMin(startFrom)
      const minMinutes = Number.isFinite(Number(req.query.minMinutes)) ? Number(req.query.minMinutes) : 90
      const district = req.query.district ? String(req.query.district) : null
      const hallType = req.query.hallType ? String(req.query.hallType) : null
      const freeAll = String(req.query.freeAllNonHolidayWeeks ?? '1') !== '0'

      // ── latest scraped season ──
      const seasonRow = await database('city_hall_availability')
        .select('season_start', 'season_end').orderBy('season_start', 'desc').first()
      if (!seasonRow) return res.json({ season: null, lastUpdated: null, results: [] })
      const season = {
        start: pgDate(seasonRow.season_start),
        end: pgDate(seasonRow.season_end),
      }

      const rows = await database('city_hall_availability as a')
        .join('city_halls as h', 'h.einrichtung_id', 'a.einrichtung_id')
        .where('a.season_start', season.start).andWhere('a.season_end', season.end)
        .whereIn('a.weekday', weekdays)
        .modify((q) => { if (district) q.andWhere('h.stadtkreis', district) })
        .modify((q) => { if (hallType) q.andWhere('h.hall_type', hallType) })
        .select(
          'a.einrichtung_id', 'a.weekday', 'a.dates', 'a.scrape_window_to', 'a.scraped_at',
          'h.name', 'h.hall_type', 'h.address', 'h.plz', 'h.stadtkreis', 'h.stadtquartier', 'h.schulkreis',
        )

      let lastUpdated = null
      const results = []
      for (const r of rows) {
        const dates = Array.isArray(r.dates) ? r.dates : JSON.parse(r.dates || '[]')
        const usable = dates.filter((d) => !d.holiday && !d.errored)
        if (usable.length === 0) continue
        const satisfied = usable.filter((d) => d.free && windowSatisfies(d.window, startFromMin, minMinutes))
        const allFree = satisfied.length === usable.length
        if (freeAll ? !allFree : satisfied.length === 0) continue

        // Representative window = most frequent among satisfied dates.
        const freq = {}
        for (const d of satisfied) if (d.window) freq[d.window] = (freq[d.window] || 0) + 1
        const sampleWindow = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || null

        const sa = r.scraped_at instanceof Date ? r.scraped_at.toISOString() : r.scraped_at
        if (!lastUpdated || sa > lastUpdated) lastUpdated = sa

        const scrapeTo = r.scrape_window_to || '22:00'
        results.push({
          einrichtungId: r.einrichtung_id,
          name: r.name,
          hallType: r.hall_type,
          address: r.address,
          plz: r.plz,
          stadtkreis: r.stadtkreis,
          stadtquartier: r.stadtquartier,
          schulkreis: r.schulkreis,
          weekday: r.weekday,
          weeksTotal: usable.length,
          weeksFree: satisfied.length,
          freeAllNonHolidayWeeks: allFree,
          sampleWindow,
          detailsUrl: `${CITY_BASE}/details.php?einrichtung=${r.einrichtung_id}`,
          belegungsplanUrl: `${CITY_BASE}/kalender.php?einrichtung=${r.einrichtung_id}`
            + `&wochentag=${WD_PARAM[r.weekday]}&tag_ab=${ddmmyyyy(season.start)}&tag_bis=${ddmmyyyy(season.end)}`
            + `&zeit_von=${encodeURIComponent(startFrom)}&zeit_bis=${encodeURIComponent(scrapeTo)}`,
          reservationUrl: `${CITY_BASE}/freieTermine.php?terminart=periodisch&switch=no&hallentyp=`
            + `&wochentag=${WD_PARAM[r.weekday]}&tag_ab=${ddmmyyyy(season.start)}&tag_bis=${ddmmyyyy(season.end)}`
            + `&zeit_von=${encodeURIComponent(startFrom)}&zeit_bis=${encodeURIComponent(scrapeTo)}`
            + `&mindestbelegungszeit=${(minMinutes / 60)}&hallenname=${encodeURIComponent(r.name)}&submitted=1`,
        })
      }

      results.sort((a, b) =>
        a.weekday - b.weekday
        || b.weeksFree - a.weeksFree
        || a.name.localeCompare(b.name, 'de'))

      res.json({
        season,
        lastUpdated,
        filters: { weekdays, startFrom, minMinutes, district, hallType, freeAllNonHolidayWeeks: freeAll },
        count: results.length,
        results,
      })
    } catch (err) {
      log.error({ msg: `hallenfinder-search: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
