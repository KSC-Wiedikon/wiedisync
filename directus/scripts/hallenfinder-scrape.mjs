#!/usr/bin/env node
/**
 * hallenfinder-scrape.mjs — scrape City of Zürich free hall slots into the
 * Hallenfinder cache (city_halls + city_hall_availability, migration 242).
 *
 * Zero npm deps (global fetch). Mirrors the clubdesk scrape pattern: emit SQL to
 * stdout and let the caller pipe it into psql on the Hetzner VPS.
 *
 * Strategy: the city tool has no API, so we scrape its RECURRING ("periodisch")
 * search — ONE query per weekday across the whole season, at the widest window
 * (18:00–22:00, min 1 h). That page lists exactly the halls with a slot free
 * EVERY week of the range, and — crucially — prints the free window per hall
 * ("18:00-22:00", "20:30-22:00", …). The /kscw/hallenfinder/search endpoint then
 * derives any narrower start-time / duration filter from that stored window.
 *
 * ⚠ Do NOT go back to `terminart=einmalig` (one query per concrete date), which
 * this script used until 2026-07-25. That page lists WHICH halls have a free
 * block but never WHEN — it contains no time range anywhere in its markup —
 * so every scraped week landed with `window: ''`, windowSatisfies() rejected
 * every row, and the endpoint returned zero results under every filter. The
 * per-date variant cannot answer "≥90 min from 19:00"; only this one can.
 *
 * ⚠ The city form REJECTS a start date fewer than 8 days ahead ("Datum muss
 * min. 7 Tage in der Zukunft liegen" — today+7 is still refused) and re-renders
 * the empty search form. Sending the season start unconditionally is what broke
 * every nightly run from 25.08.2026 (seven days before 01.09) to 16.10.2026, so
 * the query starts at max(season start, today+8). Rows keep the season's
 * start/end as their key, but their `dates` only cover the weeks actually
 * queried — past weeks are no longer the city's to vouch for.
 *
 * Usage:
 *   node hallenfinder-scrape.mjs [--emit-sql] [--season-start=YYYY-MM-DD]
 *        [--season-end=YYYY-MM-DD] [--weekdays=1,2,3,4,5] [--from=18:00]
 *        [--to=22:00] [--min-minutes=60] [--delay=350] [--limit=N] [--quiet]
 *   (--limit caps how many WEEKDAYS are queried — one query per weekday now.)
 *   (no --emit-sql → prints a JSON summary to stdout for dry-runs)
 */

import { parseSearchResult, parseFormErrors } from './hallenfinder/parse-result.mjs'
import { fetchHolidayRanges, isHoliday } from './hallenfinder/schulferien.mjs'

const BASE = 'https://www.ssd-sporthallen.stadt-zuerich.ch/freieTermine.php'
const UA = 'KSCW-Hallenfinder/1.0 (+https://wiedisync.kscw.ch; club training-hall availability sync)'

// ── args ──────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  return m ? [m[1], m[2] ?? true] : [a, true]
}))
const EMIT_SQL = !!args['emit-sql']
const QUIET = !!args.quiet || EMIT_SQL
const FROM = args.from || '18:00'
const TO = args.to || '22:00'
const MIN_MINUTES = Number(args['min-minutes'] || 60)
const MIN_PARAM = String(MIN_MINUTES / 60)           // 60→"1", 90→"1.5"
const DELAY = Number(args.delay || 350)
const LIMIT = args.limit ? Number(args.limit) : Infinity
const WEEKDAYS = (args.weekdays ? String(args.weekdays).split(',') : ['1', '2', '3', '4', '5']).map(Number)

function log(...a) { if (!QUIET) console.error(...a) }
// Failures go to stderr even with --emit-sql: stdout is the SQL, stderr is the
// cron log, and a quiet failure there hid this job's 7-week outage in 2026.
function warn(...a) { console.error(...a) }

// The city refuses a start date fewer than this many days ahead (see header).
const MIN_LEAD_DAYS = 8

/** Today in Zürich + MIN_LEAD_DAYS, as YYYY-MM-DD: the earliest date the city will search from. */
function earliestQueryable() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date())
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + MIN_LEAD_DAYS)
  return d.toISOString().slice(0, 10)
}

/**
 * Default season = upcoming/current winter (Sep 1 → Mar 31), judged from the
 * earliest queryable date, so the last week of March already rolls over to the
 * next winter instead of asking for a range that ends before it starts.
 */
function defaultSeason() {
  const now = new Date(`${earliestQueryable()}T00:00:00Z`)
  const y = now.getUTCFullYear(), m = now.getUTCMonth() // 0=Jan
  if (m >= 8) return { start: `${y}-09-01`, end: `${y + 1}-03-31` }       // Sep–Dec → this winter
  if (m <= 2) return { start: `${y - 1}-09-01`, end: `${y}-03-31` }        // Jan–Mar → mid winter
  return { start: `${y}-09-01`, end: `${y + 1}-03-31` }                    // Apr–Aug → next winter
}
const season = {
  start: args['season-start'] || defaultSeason().start,
  end: args['season-end'] || defaultSeason().end,
}
// First date actually sent as tag_ab (and the first week stored in `dates`).
const queryStart = season.start > earliestQueryable() ? season.start : earliestQueryable()

// ── date helpers ──────────────────────────────────────────────────
function isoToParts(iso) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d } }
function isoWeekday(iso) { // 1=Mon … 7=Sun
  const { y, m, d } = isoToParts(iso)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun
  return wd === 0 ? 7 : wd
}
function toDDMMYYYY(iso) { const { y, m, d } = isoToParts(iso); return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}` }
function* datesInRange(startIso, endIso) {
  const s = new Date(`${startIso}T00:00:00Z`), e = new Date(`${endIso}T00:00:00Z`)
  for (let t = s; t <= e; t.setUTCDate(t.getUTCDate() + 1)) yield t.toISOString().slice(0, 10)
}

// ── fetch with retry ──────────────────────────────────────────────
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

/**
 * One recurring-availability query for a weekday across the whole season.
 * Returns { count, halls: [{ facilityId, name, window, … }] } or null after
 * 3 failed attempts (the caller treats that weekday as unscraped).
 */
async function fetchWeekday(wd) {
  const url = `${BASE}?terminart=periodisch&switch=no&hallentyp=`
    + `&wochentag=${wd}&tag_ab=${toDDMMYYYY(queryStart)}&tag_bis=${toDDMMYYYY(season.end)}`
    + `&zeit_von=${encodeURIComponent(FROM)}&zeit_bis=${encodeURIComponent(TO)}`
    + `&mindestbelegungszeit=${MIN_PARAM}&hallenname=&submitted=1`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 30000)
      const resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: ctrl.signal })
      clearTimeout(to)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const html = await resp.text()
      const parsed = parseSearchResult(html)
      if (parsed.count === null) {
        // The city re-rendered the form with validation errors: the query itself
        // is wrong, so retrying the same URL cannot help.
        const formErrors = parseFormErrors(html)
        if (formErrors.length) {
          warn(`  ! weekday ${wd}: city rejected the query: ${formErrors.join(' | ')}`)
          return null
        }
        throw new Error('no result marker (unexpected HTML)')
      }
      if (parsed.count !== parsed.halls.length) {
        warn(`  ! weekday ${wd}: count ${parsed.count} != parsed ${parsed.halls.length} (parser drift?)`)
      }
      return parsed
    } catch (err) {
      warn(`  retry ${attempt}/3 for weekday ${wd}: ${err.message}`)
      if (attempt === 3) return null
      await sleep(DELAY * attempt * 2)
    }
  }
}

// city_halls.hall_type slugs (CHECK city_halls_hall_type_values, migration 421).
// Derived from the hall NAME; the city's own Hallentyp lands in hall_type_label.
function hallType(name) {
  const n = name.toLowerCase()
  if (n.includes('gymnastik')) return 'gym_room'
  if (n.includes('dreifach')) return 'triple_hall'
  if (n.includes('doppel')) return 'double_hall'
  return 'sports_hall'
}
function postalCodeOf(address) { const m = (address || '').match(/\b(\d{4})\b/); return m ? m[1] : null }

// ── SQL emit helpers ──────────────────────────────────────────────
function q(v) { return v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'` }
function qJson(obj) { return `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb` }

async function main() {
  if (queryStart > season.end) {
    throw new Error(`season ${season.start}…${season.end} ends before the earliest queryable date ${queryStart}`)
  }
  log(`Hallenfinder scrape — season ${season.start}…${season.end} (querying from ${queryStart}), weekdays ${WEEKDAYS.join(',')}, `
    + `${FROM}-${TO} min ${MIN_MINUTES}m`)
  const holidays = await fetchHolidayRanges()
  log(`Loaded ${holidays.length} Schulferien ranges`)

  // One recurring query per weekday — the city tool itself does the
  // "free every week of the range" reasoning, and reports the free window.
  const targetWeekdays = WEEKDAYS.slice(0, LIMIT)
  log(`Querying ${targetWeekdays.length} weekday(s) over ${queryStart}…${season.end}…`)

  const hallsSeen = new Map()                 // id → {name,hall_type,address,postal_code,districts…}
  const windowByHallWeekday = new Map()       // `${id}|${wd}` → window string ("18:00-22:00")
  const scrapedWeekdays = []                  // weekdays whose query actually succeeded
  const failedWeekdays = []
  let droppedNoWindow = 0

  for (const wd of targetWeekdays) {
    const res = await fetchWeekday(wd)
    if (res === null) { failedWeekdays.push(wd); warn(`  ! weekday ${wd}: giving up`); await sleep(DELAY); continue }
    scrapedWeekdays.push(wd)
    for (const h of res.halls) {
      const id = Number(h.facilityId)
      if (!hallsSeen.has(id)) {
        hallsSeen.set(id, {
          name: h.name, hall_type: hallType(h.name), address: h.address, postal_code: postalCodeOf(h.address),
          city_district: h.cityDistrict, city_quarter: h.cityQuarter, school_district: h.schoolDistrict,
        })
      }
      // A hall without a parsed window is unusable downstream (windowSatisfies
      // rejects it), so drop it loudly rather than caching a dead row.
      if (!h.window) { droppedNoWindow++; continue }
      windowByHallWeekday.set(`${id}|${wd}`, h.window)
    }
    log(`  weekday ${wd}: ${res.halls.length} halls`)
    await sleep(DELAY)
  }
  const report = failedWeekdays.length ? warn : log
  report(`Done: ${hallsSeen.size} halls, ${windowByHallWeekday.size} (hall,weekday) combos`
    + `${droppedNoWindow ? `, ${droppedNoWindow} dropped for missing window` : ''}`
    + `${failedWeekdays.length ? `, FAILED weekdays: ${failedWeekdays.join(',')}` : ''}`)
  if (!scrapedWeekdays.length) {
    throw new Error('every weekday query failed — aborting rather than wiping the cache')
  }

  // Build availability rows. `periodisch` already guarantees the slot is free
  // EVERY week of the range, so each week is free: true and carries the same
  // window; the Schulferien flags stay so the endpoint can keep excluding
  // holiday weeks from its counts.
  const allDatesByWeekday = new Map()
  for (const wd of scrapedWeekdays) {
    allDatesByWeekday.set(wd, [...datesInRange(queryStart, season.end)].filter((iso) => isoWeekday(iso) === wd))
  }
  const rows = []
  for (const [key, win] of windowByHallWeekday) {
    const [idStr, wdStr] = key.split('|'); const id = Number(idStr), wd = Number(wdStr)
    const dates = (allDatesByWeekday.get(wd) || []).map((iso) => ({
      date: iso, free: true, holiday: isHoliday(iso, holidays), errored: false, window: win,
    }))
    rows.push({ facility_id: id, weekday: wd, dates })
  }

  if (!EMIT_SQL) {
    // Dry-run summary.
    const summary = {
      season, queryStart, weekdays: WEEKDAYS, halls: hallsSeen.size, availabilityRows: rows.length,
      sample: rows.slice(0, 3).map((r) => {
        const nh = r.dates.filter((d) => !d.holiday && !d.errored)
        return {
          hall: hallsSeen.get(r.facility_id)?.name, weekday: r.weekday,
          nonHolidayWeeks: nh.length, freeAllNonHoliday: nh.length > 0 && nh.every((d) => d.free),
        }
      }),
    }
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  // Emit atomic refresh SQL.
  const startedAt = new Date().toISOString()
  const out = []
  out.push('BEGIN;')
  for (const [id, h] of hallsSeen) {
    out.push(
      `INSERT INTO city_halls (facility_id, name, hall_type, address, postal_code, city_district, city_quarter, school_district, last_seen) `
      + `VALUES (${id}, ${q(h.name)}, ${q(h.hall_type)}, ${q(h.address)}, ${q(h.postal_code)}, ${q(h.city_district)}, ${q(h.city_quarter)}, ${q(h.school_district)}, NOW()) `
      + `ON CONFLICT (facility_id) DO UPDATE SET name=EXCLUDED.name, hall_type=EXCLUDED.hall_type, address=EXCLUDED.address, postal_code=EXCLUDED.postal_code, `
      + `city_district=EXCLUDED.city_district, city_quarter=EXCLUDED.city_quarter, school_district=EXCLUDED.school_district, last_seen=NOW();`
    )
  }
  // Clear this season's availability, then reinsert fresh (handles halls that lost
  // their slot). Scoped to the weekdays we actually scraped: a weekday whose query
  // failed keeps its previous rows instead of being silently wiped to nothing.
  out.push(`DELETE FROM city_hall_availability WHERE season_start=${q(season.start)} AND season_end=${q(season.end)} `
    + `AND weekday IN (${scrapedWeekdays.join(',')});`)
  for (const r of rows) {
    out.push(
      `INSERT INTO city_hall_availability (facility_id, weekday, season_start, season_end, scrape_window_from, scrape_window_to, scrape_min_minutes, dates, scraped_at) `
      + `VALUES (${r.facility_id}, ${r.weekday}, ${q(season.start)}, ${q(season.end)}, ${q(FROM)}, ${q(TO)}, ${MIN_MINUTES}, ${qJson(r.dates)}, NOW());`
    )
  }
  out.push(
    `UPDATE sync_runs SET last_run_at=NOW(), status='ok', rows_changed=${rows.length}, `
    + `duration_ms=${Date.now() - Date.parse(startedAt)}, error_message=NULL WHERE source='hallenfinder_sync';`
  )
  out.push('COMMIT;')
  console.log(out.join('\n'))
}

main().catch((err) => { console.error(`hallenfinder-scrape failed: ${err.stack || err.message}`); process.exit(1) })
