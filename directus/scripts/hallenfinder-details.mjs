#!/usr/bin/env node
/**
 * hallenfinder-details.mjs — enrich the Hallenfinder cache with each hall's
 * DIMENSIONS and PHOTO from its Stadt-Zürich detail page (migration 269).
 *
 * Companion to hallenfinder-scrape.mjs, deliberately a SEPARATE run: the
 * availability scrape is nightly because free slots change weekly, whereas a
 * hall's floor plan and photo change essentially never. Folding this into the
 * nightly job would multiply the request count against the city's server by
 * ~100 for no new information — hallenfinder-sync.sh runs it monthly instead.
 *
 * Zero npm deps (global fetch). Same contract as the availability scrape: emit
 * SQL to stdout, let the caller pipe it into psql. The script therefore never
 * touches the DB itself, which is why the id list has to be passed in.
 *
 * Usage:
 *   node hallenfinder-details.mjs --ids=2,3,39,44 [--emit-sql] [--delay=350]
 *        [--limit=N] [--quiet]
 *   (no --emit-sql → prints a JSON summary to stdout for dry-runs)
 *
 * Get the id list from the DB on the VPS:
 *   psql -tAc "SELECT string_agg(einrichtung_id::text, ',') FROM city_halls"
 */

import { parseHallDetails, CITY_BASE } from './hallenfinder/parse-details.mjs'

const UA = 'KSCW-Hallenfinder/1.0 (+https://wiedisync.kscw.ch; club training-hall availability sync)'

// ── args ──────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  return m ? [m[1], m[2] ?? true] : [a, true]
}))
const EMIT_SQL = !!args['emit-sql']
const QUIET = !!args.quiet || EMIT_SQL
const DELAY = Number(args.delay || 350)
const LIMIT = args.limit ? Number(args.limit) : Infinity
const IDS = String(args.ids || '')
  .split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).slice(0, LIMIT)

function log(...a) { if (!QUIET) console.error(...a) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (IDS.length === 0) {
  console.error('hallenfinder-details: --ids=<comma-separated einrichtung ids> is required')
  process.exit(1)
}

// ── SQL emit helpers (same shape as hallenfinder-scrape.mjs) ──────
function q(v) { return v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'` }
function n(v) { return v === null || v === undefined || !Number.isFinite(Number(v)) ? 'NULL' : String(Number(v)) }
function qJson(obj) { return `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb` }

/** One detail page. Returns the parsed record, or null after 3 failed attempts. */
async function fetchDetails(id) {
  const url = `${CITY_BASE}/details.php?einrichtung=${id}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: ctrl.signal })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const html = await resp.text()
      const parsed = parseHallDetails(html)
      // A page that yields no dimensions at all is almost certainly an error or
      // redirect page rather than a hall — retry rather than store empty nulls
      // over data a previous run got right.
      if (parsed.length === null && parsed.hallTypeLabel === null) throw new Error('no Details section')
      return parsed
    } catch (err) {
      log(`  hall ${id}: attempt ${attempt} failed (${err.message})`)
      if (attempt === 3) return null
      await sleep(DELAY * attempt * 2)
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

async function main() {
  log(`Hallenfinder details — ${IDS.length} halls`)
  const rows = []
  for (const id of IDS) {
    const d = await fetchDetails(id)
    if (d) {
      rows.push({ id, ...d })
      log(`  ${id}: ${d.hallTypeLabel ?? '?'} ${d.sizeLabel ?? '(no size)'}${d.photoUrl ? ' +photo' : ''}`)
    }
    await sleep(DELAY)
  }

  const withPhoto = rows.filter((r) => r.photoUrl).length
  log(`Parsed ${rows.length}/${IDS.length} halls, ${withPhoto} with a photo`)

  if (!EMIT_SQL) {
    console.log(JSON.stringify({ requested: IDS.length, parsed: rows.length, withPhoto, rows }, null, 2))
    return
  }

  if (rows.length === 0) {
    // Emit nothing rather than an empty transaction — the wrapper treats an
    // empty file as "scrape failed, do not touch the DB".
    return
  }

  const out = ['BEGIN;']
  for (const r of rows) {
    // UPDATE only: a hall that is not already in city_halls has no availability
    // row either, so inserting it here would create a hall the search can never
    // return. The availability scrape owns the roster.
    out.push(
      `UPDATE city_halls SET `
      + `hall_type_label=${q(r.hallTypeLabel)}, size_label=${q(r.sizeLabel)}, `
      + `length_m=${n(r.length)}, width_m=${n(r.width)}, height_m=${n(r.height)}, `
      + `partitions=${qJson(r.partitions)}, photo_url=${q(r.photoUrl)}, `
      + `photo_thumb_url=${q(r.photoThumbUrl)}, contact_email=${q(r.contactEmail)}, `
      + `details_scraped_at=NOW() `
      + `WHERE einrichtung_id=${Number(r.id)};`
    )
  }
  out.push('COMMIT;')
  console.log(out.join('\n'))
}

main().catch((err) => { console.error(`hallenfinder-details failed: ${err.stack || err.message}`); process.exit(1) })
