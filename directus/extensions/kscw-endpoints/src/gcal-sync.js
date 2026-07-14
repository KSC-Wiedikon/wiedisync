/**
 * Google Calendar Sync — ported from gcal_sync_lib.js
 * POST /kscw/admin/gcal-sync — manual trigger (admin only)
 * Also registered as cron in hooks extension (04:00 UTC daily).
 *
 * The KSCW public calendar (embedded at kscw.ch/weiteres/kalender) is a
 * closures-only calendar — every entry means the hall is unavailable that day
 * ("Halle geschlossen", school holidays, tournaments occupying the gym, etc.).
 * So EVERY event is treated as a hall closure:
 *   • hall_closures (source='gcal') — the functional block. One row per KWI hall
 *     (A/B/C — the school gym the calendar refers to), written via ItemsService
 *     so the `hall_closures.items.create/delete` auto-cancel hook fires and
 *     overlapping trainings get cancelled / reversed. This is what makes the
 *     closure actually take effect.
 *   • hall_events (source='gcal') — the display row the Hallenplan / iCal feed
 *     render. Kept for continuity (upserted by uid).
 * Both are reconciled against the live feed each run (insert new, delete stale)
 * so nothing churns for unchanged entries.
 */

import { pushHomeGames, KSCW_CALENDAR_ID } from './gcal-push.js'
import { writeUserLog } from './activity-log.js'

const GCAL_IDS = [
  // KSCW public calendar (kscw.ch/weiteres/kalender → embedded Google Calendar).
  KSCW_CALENDAR_ID,
]

function parseIcsDatetime(str) {
  if (!str) return null
  str = str.trim()
  // DATE-only: YYYYMMDD
  if (/^\d{8}$/.test(str)) {
    return { date: `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`, allDay: true }
  }
  // DATETIME: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const m = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (!m) return null
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
  if (m[7]) {
    // UTC — convert to Zurich (approximate: +1 in winter, +2 in summer)
    const month = dt.getUTCMonth()
    const offset = (month >= 2 && month <= 9) ? 2 : 1
    dt.setUTCHours(dt.getUTCHours() + offset)
  }
  const d = dt.toISOString().slice(0, 10)
  const t = dt.toISOString().slice(11, 16)
  return { date: d, time: t, allDay: false }
}

// ICS all-day DTEND is EXCLUSIVE (a single 04.12 all-day event is
// DTSTART 20261204 / DTEND 20261205). Convert to an inclusive end date.
function minusOneDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function parseIcs(text) {
  const events = []
  const blocks = text.split('BEGIN:VEVENT')
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0]
    const ev = {}
    for (const line of block.split(/\r?\n/)) {
      const [key, ...rest] = line.split(':')
      const val = rest.join(':')
      const baseKey = key.split(';')[0]
      if (baseKey === 'SUMMARY') ev.title = val
      if (baseKey === 'DTSTART') ev.start = parseIcsDatetime(val)
      if (baseKey === 'DTEND') ev.end = parseIcsDatetime(val)
      if (baseKey === 'UID') ev.uid = val
      if (baseKey === 'LOCATION') ev.location = val
    }
    if (ev.uid && ev.start) events.push(ev)
  }
  return events
}

function resolveHall(title, location, hallLookup) {
  const text = `${title} ${location}`.toLowerCase()
  for (const [name, id] of Object.entries(hallLookup)) {
    if (text.includes(name.toLowerCase())) return id
  }
  return null
}

// The KSCW public calendar is the club's FULL calendar — it carries the club's
// own VB/BB games, trainings and "darf trainieren" permissions alongside the
// genuine hall closures. Only the latter may become hall_closures: closing the
// hall for the club's own game/training would self-cancel it, and a "darf
// trainieren" entry is the opposite of a closure. So a closure is an entry that
// names a closure / external occupation and is NOT a club game or training.
// ("VB "-prefixed games are dropped before this is called.)
function isClosureEvent(title) {
  const t = String(title || '').toLowerCase()
  if (/training|trainieren/.test(t)) return false          // trainings + "darf trainieren"
  if (/^bb\s|\bbb\b|basketplan|probasket|basketball/.test(t)) return false // club basketball
  return /geschlossen|gesperrt|sperr|reserv|turnier|tournament|volleynight|volleyball.?nacht|volleyball-night|pfadi|asvz|handball|extern|fremd|belegt/.test(t)
}

export function registerGCalSync(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'gcal-sync' })

  async function runSync(db, schema) {
    const { ItemsService } = services

    // ── PUSH first: our home games onto the calendar. It hands back the ids of
    // every event we own, so the import below can skip its own output instead of
    // re-importing our games as duplicate hall_events display rows.
    const push = await pushHomeGames(db, log)

    const halls = await db('halls').select('id', 'name')
    const hallLookup = Object.fromEntries(halls.map(h => [h.name, h.id]))
    // Halls a calendar closure applies to: the KWI school gym (A/B/C). These are
    // the halls the public calendar's "Halle geschlossen" entries refer to and
    // the set the previous gcal sync used. Döltschi / external halls follow their
    // own availability and are not closed by this calendar.
    const kwiHallIds = halls.filter(h => /^kwi/i.test(h.name)).map(h => h.id)

    let eventsCreated = 0, eventsUpdated = 0, eventsDeleted = 0
    let closuresCreated = 0, closuresDeleted = 0

    for (const calId of GCAL_IDS) {
      const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calId)}/public/basic.ics`
      const resp = await fetch(url)
      if (!resp.ok) { log.warn({ msg: `GCal fetch failed for ${calId}: ${resp.status}`, endpoint: 'gcal-sync', calendarId: calId, httpStatus: resp.status }); continue }
      const icsText = await resp.text()
      const events = parseIcs(icsText)

      // Season start (Sept 1 of current or previous year). We only manage
      // closures from here forward so past (frozen) data is never churned.
      const now = new Date()
      const seasonStart = new Date(now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear(), 8, 1)
        .toISOString().split('T')[0]

      // Zurich school holidays are the curated source of truth and take
      // PRIORITY: never create a gcal closure where a school_holidays closure
      // already covers that hall+date (no duplicates; the holiday record stands,
      // and we don't churn/reverse it). Mirrors schulferien-sync's own
      // skip-if-overlapping rule.
      const shRows = await db('hall_closures')
        .where('source', 'school_holidays').andWhere('end_date', '>=', seasonStart)
        .select('hall', db.raw('start_date::text as s'), db.raw('end_date::text as e'))
      const shByHall = new Map()
      for (const r of shRows) {
        const list = shByHall.get(r.hall) || []
        list.push([(r.s || '').slice(0, 10), (r.e || '').slice(0, 10)])
        shByHall.set(r.hall, list)
      }
      const coveredBySchoolHoliday = (hall, start, end) =>
        (shByHall.get(hall) || []).some(([s, e]) => start <= e && end >= s)

      const seenUids = new Set()
      // Desired hall_closures for this feed, keyed hall|start|end (no reason in
      // the key, so re-titling an entry doesn't force a delete+recreate).
      const desiredClosures = new Map()

      for (const ev of events) {
        if (!ev.start || ev.start.date < seasonStart) continue
        // Never re-import an event WE wrote (ICS UID is "<eventId>@google.com").
        // Our games already reach the Hallenplan as virtual slots off `games`, so
        // a hall_events row would duplicate them — and a hall_closure would cancel
        // the very game it describes.
        //
        // Deliberately keyed on OUR event ids, not on a "BB "/"VB " title prefix:
        // the hall admin hand-types basketball friendlies and junior games
        // (`BB - Freundschaftsspiel`, `BB DU16E …`) that exist ONLY on this
        // calendar and in no `games` row. Skipping those by title deleted 84
        // hall_events on dev — i.e. showed the hall as free while a junior game
        // was being played in it. Other people's events keep importing exactly as
        // they did before.
        if (push.eventIds.has(String(ev.uid).split('@')[0])) continue
        if (ev.title?.startsWith('VB ')) continue // club VB games — app-managed, never a closure
        seenUids.add(ev.uid)

        // ── hall_events (display) — upsert by uid (raw knex; no hook needed) ──
        const hallId = resolveHall(ev.title || '', ev.location || '', hallLookup)
        const record = {
          title: ev.title || '', date: ev.start.date,
          start_time: ev.start.time || null, end_time: ev.end?.time || null,
          all_day: ev.start.allDay, location: ev.location || '',
          source: 'gcal', uid: ev.uid,
        }
        if (hallId) record.hall = hallId
        const existing = await db('hall_events').where('uid', ev.uid).first()
        if (existing) {
          await db('hall_events').where('id', existing.id).update({ ...record, date_updated: new Date() })
          eventsUpdated++
        } else {
          await db('hall_events').insert({ ...record, date_created: new Date(), date_updated: new Date() })
          eventsCreated++
        }

        // ── hall_closures (block) — only genuine closure / external-occupation
        // entries close the KWI halls for their span (not club games/trainings). ──
        if (isClosureEvent(ev.title)) {
          const startD = ev.start.date
          let endD = startD
          if (ev.end?.date) endD = ev.end.allDay ? minusOneDay(ev.end.date) : ev.end.date
          if (endD < startD) endD = startD
          const reason = (ev.title || 'Halle geschlossen').slice(0, 255)
          for (const h of kwiHallIds) {
            if (coveredBySchoolHoliday(h, startD, endD)) continue // Zurich holiday wins
            desiredClosures.set(`${h}|${startD}|${endD}`, { hall: h, start_date: startD, end_date: endD, reason })
          }
        }
      }

      // Delete hall_events no longer in the feed (raw knex).
      const existingEvents = await db('hall_events').where('source', 'gcal').select('id', 'uid')
      for (const row of existingEvents) {
        if (!seenUids.has(row.uid)) { await db('hall_events').where('id', row.id).delete(); eventsDeleted++ }
      }

      // Reconcile hall_closures (source='gcal') via ItemsService so the training
      // auto-cancel hook fires on create and reverses on delete. Scoped to
      // end_date >= seasonStart so past closures (and their frozen training
      // cancellations) are never touched.
      const closures = new ItemsService('hall_closures', { schema, knex: db })
      const existingClos = await db('hall_closures')
        .where('source', 'gcal').andWhere('end_date', '>=', seasonStart)
        .select('id', 'hall', db.raw('start_date::text as start_date'), db.raw('end_date::text as end_date'))
      const existKeys = new Map()
      for (const c of existingClos) {
        existKeys.set(`${c.hall}|${(c.start_date || '').slice(0, 10)}|${(c.end_date || '').slice(0, 10)}`, c.id)
      }
      // Delete stale closures (no longer in the feed). Never delete a gcal
      // closure that now sits under a Zurich school holiday — leave it as a
      // harmless duplicate rather than risk reversing a training cancellation.
      for (const [k, id] of existKeys) {
        if (desiredClosures.has(k)) continue
        const [h, s, e] = k.split('|')
        if (coveredBySchoolHoliday(parseInt(h, 10), s, e)) continue
        await closures.deleteOne(id); closuresDeleted++
      }
      // Insert newly-appeared closures.
      for (const [k, c] of desiredClosures) {
        if (!existKeys.has(k)) {
          await closures.createOne({ hall: c.hall, start_date: c.start_date, end_date: c.end_date, reason: c.reason, source: 'gcal' })
          closuresCreated++
        }
      }
    }

    return {
      eventsCreated, eventsUpdated, eventsDeleted, closuresCreated, closuresDeleted,
      gamesPushed: push.created, gamesUpdated: push.updated, gamesRemoved: push.deleted,
      gamesSkipped: push.skipped, pushEnabled: !push.disabled,
    }
  }

  router.post('/admin/gcal-sync', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin access required' })
    try {
      log.info('Manual GCal sync triggered')
      const schema = await getSchema()
      const result = await runSync(database, schema)
      // Writes to a calendar the hall administration reads — record who triggered it.
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'gcal_sync',
        collection: 'hall_closures',
        recordId: null,
        data: result,
      })
      res.json({ status: 'ok', ...result })
    } catch (err) {
      log.error({ msg: `gcal-sync: ${err.message}`, endpoint: 'gcal-sync', userId: req?.accountability?.user || null, method: req?.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
