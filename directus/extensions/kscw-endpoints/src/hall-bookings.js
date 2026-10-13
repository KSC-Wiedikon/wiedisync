/**
 * Hall bookings → training trim / cancel (migration 409).
 *
 * Every entry on the KWI hall administration's calendar used to become a
 * whole-day closure of KWI A, B and C (migration 325). Right for "Halle
 * geschlossen"; wrong for a friendly. "Freundschaftsspiel BB DU18 FIRE - Zürich
 * 93 DU16 (Halle C)", 22.10.2026 18:30–20:00, cancelled six trainings in three
 * halls for an evening where one hall was busy for 90 minutes.
 *
 * A HALL BOOKING blocks a set of halls for a time window. Two sources:
 *   • 'calendar:<hall_events.id>' — an APPROVED (closure_override = true),
 *     TIMED, single-day entry on the hall calendar, on the halls it names
 *     ("Halle C", "Halle A+B", "KWI B"; all KWI halls when it names none).
 *     Every other approved entry (all-day, multi-day, no usable times) is a
 *     whole-day closure in gcal-sync.js; a pending or refused one does nothing.
 *   • 'event:<events.id>' — a club event with `hall` (+ `additional_halls`),
 *     booked by an admin in the event form (a friendly, a tournament). Its own
 *     start/end in Zurich time, per day for a multi-day event; all-day = whole
 *     days. A cancelled event books nothing.
 *
 * The window is taken literally — whoever entered it booked the hall for that
 * time, so no warm-up is added. Sport plays no part either: unlike a league game
 * (game-training-shorten.js matches same-sport only) a booking is of the room.
 *
 * Per overlapping training the sweep keeps the LONGEST part of the planned time
 * that no booking covers, and cancels the training when under
 * MIN_REMAINING_MINUTES would be left. Everything is reversible and the sweep is
 * whole-table idempotent:
 *   - auto_adjusted_by_booking = the booking key above
 *   - original_start_time / original_end_time = the planned times, set only for
 *     the side that moved
 * When the booking moves, vanishes, is cancelled, or (calendar) is refused or
 * back to pending, the next run puts the training back.
 *
 * Ownership — the game sweep and this one never act on the same row:
 *   - a row carrying auto_shortened_by_game belongs to the game sweep and is
 *     skipped here (a home game and a booking on one training is left as a
 *     conflict for a human in the Hallenplan);
 *   - game passes 2/3 skip a row carrying our marker;
 *   - game pass 4 (the team's own game day) outranks us: it puts our times back,
 *     clears our marker and cancels.
 * A human un-cancelling one of our cancellations leaves our marker on a live
 * row with no originals — the only way that signature arises. The sweep then
 * stops fighting it, and drops the marker once no booking covers the training.
 *
 * ⚠ Like the game sweep, this looks at a training's primary `hall` only — a
 * training's `extra_halls` are not checked.
 */

export const MIN_REMAINING_MINUTES = 30
// A booking longer than this many days is cut off here — a hall is booked for
// an evening or a tournament weekend, and an event that runs for months must not
// silently cancel a season of trainings.
export const MAX_BOOKING_DAYS = 14

const KWI_LETTERS = ['A', 'B', 'C']

// "Halle C", "Halle KWI C", "Hallen A+B", "Halle A/B", "Halle A und B", "KWI C".
// The trailing \b is what keeps "Halle Abgesagt" from reading as hall A.
// ⚠ MIRRORED in src/modules/hallenplan/utils/virtualSlots.ts — change both.
const HALL_REF = /\b(?:Hallen?\s*(?:KWI\s*)?|KWI\s*)([ABC](?:\s*(?:\+|\/|,|&|und|and|\s)\s*[ABC])*)\b/gi

/** KWI hall letters an entry names explicitly, in A/B/C order; [] when none. */
export function parseNamedKwiHalls(text) {
  const found = new Set()
  for (const m of String(text || '').matchAll(HALL_REF)) {
    // \b around the letter: the "A" inside "AND" is not a hall.
    for (const l of m[1].toUpperCase().match(/\b[ABC]\b/g) || []) found.add(l)
  }
  return KWI_LETTERS.filter((l) => found.has(l))
}

/**
 * Hall ids a calendar entry applies to: the KWI halls it names, or every KWI
 * hall when it names none (or names one that does not exist).
 */
export function entryHallIds(entry, halls) {
  const kwi = halls.filter((h) => /^kwi/i.test(h.name))
  const letters = parseNamedKwiHalls(`${entry.title || ''} ${entry.location || ''}`)
  const named = kwi.filter((h) => letters.includes(h.name.replace(/^kwi\s*/i, '').trim().toUpperCase()))
  return (named.length ? named : kwi).map((h) => h.id)
}

export const toMinutes = (t) => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`
const hm = (t) => (t ? String(t).slice(0, 5) : '')
const asDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))
const nextDay = (ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * A calendar entry's time window in minutes when it is a booking, else null (→
 * it is a whole-day closure). Needs real times, an end after the start, one day.
 */
export function timeWindow(entry) {
  if (entry.all_day) return null
  const start = toMinutes(entry.start_time)
  const end = toMinutes(entry.end_time)
  if (start == null || end == null || end <= start) return null
  const day = asDay(entry.date)
  const endDay = asDay(entry.end_date) || day
  if (!day || endDay !== day) return null
  return { start, end }
}

/** Hall ids an event books: `hall` plus `additional_halls` (json, ids as numbers or strings). */
export function eventHallIds(e) {
  let extra = e.additional_halls
  if (typeof extra === 'string') {
    try { extra = JSON.parse(extra) } catch { extra = [] }
  }
  const ids = [e.hall, ...(Array.isArray(extra) ? extra : [])]
    .map((v) => Number(typeof v === 'object' && v ? v.hall ?? v.id : v))
    .filter((n) => Number.isInteger(n) && n > 0)
  return [...new Set(ids)]
}

/**
 * Per-day windows an event books, from its Zurich-local start/end
 * ({ start_day, start_hm, end_day, end_hm, all_day }): the first day from its
 * start, the last day until its end, whole days in between; all-day = whole days.
 */
export function eventBookingDays(e) {
  const sd = e.start_day
  const ed = e.end_day || sd
  if (!sd || ed < sd) return []
  const out = []
  for (let d = sd, n = 0; d <= ed && n < MAX_BOOKING_DAYS; d = nextDay(d), n++) {
    const start = e.all_day || d !== sd ? 0 : toMinutes(e.start_hm)
    const end = e.all_day || d !== ed ? 24 * 60 : toMinutes(e.end_hm)
    if (start != null && end != null && end > start) out.push({ day: d, start, end })
  }
  return out
}

/**
 * Pure: what the bookings of the training's hall+day do to it.
 * Works from the PLANNED times (originals when we already trimmed it), so a
 * re-run recomputes from scratch instead of trimming the trimmed version.
 *   { kind: 'none' }
 *   { kind: 'cancel', key, reason }
 *   { kind: 'adjust', start, end, key, reason }   (minutes)
 */
export function planTraining(training, blocks) {
  const os = toMinutes(training.original_start_time ?? training.start_time)
  const oe = toMinutes(training.original_end_time ?? training.end_time)
  if (os == null || oe == null || oe <= os) return { kind: 'none' }
  const hits = blocks
    .filter((b) => b.start < oe && b.end > os)
    .sort((a, b) => a.start - b.start || String(a.key).localeCompare(String(b.key)))
  if (!hits.length) return { kind: 'none' }

  // Planned time minus the union of the bookings (hits are sorted by start).
  const free = []
  let cur = os
  for (const b of hits) {
    if (b.start > cur) free.push([cur, Math.min(b.start, oe)])
    cur = Math.max(cur, b.end)
    if (cur >= oe) break
  }
  if (cur < oe) free.push([cur, oe])

  // Longest part wins; on a tie the earlier one, so the usual start is kept.
  let best = null
  for (const iv of free) if (!best || iv[1] - iv[0] > best[1] - best[0]) best = iv

  const { key, title: reason } = hits[0]
  if (!best || best[1] - best[0] < MIN_REMAINING_MINUTES) return { kind: 'cancel', key, reason }
  return { kind: 'adjust', start: best[0], end: best[1], key, reason }
}

/** Every live booking, keyed `${hall}|${day}` → [{ key, start, end, title }]. */
async function loadBookings(db, halls) {
  const byKey = new Map()
  const add = (hall, day, b) => {
    const k = `${hall}|${day}`
    const list = byKey.get(k) || []
    list.push(b)
    byKey.set(k, list)
  }

  const entries = await db('hall_events')
    .where('source', 'gcal')
    .andWhereRaw('all_day IS NOT TRUE')
    .andWhereRaw('date >= CURRENT_DATE')
    .andWhere('closure_override', true) // approved only — see gcal-sync.js
    .select('id', 'title', 'location', 'all_day',
      db.raw('date::text AS date'), db.raw('end_date::text AS end_date'),
      db.raw('start_time::text AS start_time'), db.raw('end_time::text AS end_time'))
  for (const e of entries) {
    const win = timeWindow(e)
    if (!win) continue
    const b = { key: `calendar:${e.id}`, start: win.start, end: win.end, title: (e.title || 'Hallenbelegung').slice(0, 255) }
    for (const hall of entryHallIds(e, halls)) add(hall, asDay(e.date), b)
  }

  const events = await db('events')
    .whereNotNull('hall')
    .andWhere('cancelled', false)
    .andWhereRaw("(COALESCE(end_date, start_date) AT TIME ZONE 'Europe/Zurich')::date >= CURRENT_DATE")
    .select('id', 'title', 'all_day', 'hall', 'additional_halls',
      db.raw("to_char(start_date AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS start_day"),
      db.raw("to_char(start_date AT TIME ZONE 'Europe/Zurich', 'HH24:MI') AS start_hm"),
      db.raw("to_char(COALESCE(end_date, start_date) AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS end_day"),
      db.raw("to_char(COALESCE(end_date, start_date) AT TIME ZONE 'Europe/Zurich', 'HH24:MI') AS end_hm"))
  for (const e of events) {
    const hallIds = eventHallIds(e)
    for (const d of eventBookingDays(e)) {
      const b = { key: `event:${e.id}`, start: d.start, end: d.end, title: (e.title || 'Hallenbelegung').slice(0, 255) }
      for (const hall of hallIds) add(hall, d.day, b)
    }
  }
  return byKey
}

/**
 * Whole-table sweep. Safe to run any time; touches only future trainings.
 *
 * @param db   knex
 * @param log  logger
 * @param opts.releasingClosureIds  hall_closures ids the caller is ABOUT to
 *   delete (gcal-sync turning yesterday's whole-day closure of a timed entry
 *   into a booking). A training those closures cancelled is treated as free, so
 *   a training the booking still covers changes owner silently (stays cancelled,
 *   no "reinstated" then "cancelled" push pair) and a trimmed one is reinstated
 *   in one write. Whatever no booking covers is left for the closure delete hook
 *   to reinstate, exactly as before.
 * @returns lists of { date, start_time, team, sport, hall, from?, to?, reason? }
 *   for the gcal digest, plus a count of rows handed to a closure or a game.
 */
export async function sweepHallBookings(db, log, { releasingClosureIds = [] } = {}) {
  const releasing = new Set(releasingClosureIds.map(Number))
  const halls = await db('halls').select('id', 'name')
  const bookings = await loadBookings(db, halls)
  const bookedHalls = [...new Set([...bookings.keys()].map((k) => Number(k.split('|')[0])))]
  const bookedDays = [...new Set([...bookings.keys()].map((k) => k.split('|')[1]))]

  const trainings = await db('trainings as t')
    .leftJoin('teams as tm', 'tm.id', 't.team')
    .leftJoin('halls as h', 'h.id', 't.hall')
    .whereRaw('t.date >= CURRENT_DATE')
    .andWhere((qb) => {
      qb.whereNotNull('t.auto_adjusted_by_booking')
      if (bookedHalls.length) {
        qb.orWhere((q) => q.whereIn('t.hall', bookedHalls).whereIn('t.date', bookedDays))
      }
    })
    .select('t.id', 't.hall', 't.team', 't.cancelled', 't.cancel_reason', 't.auto_adjusted_by_booking',
      't.auto_shortened_by_game', 't.auto_cancelled_by_closure',
      db.raw('t.date::text AS date'),
      db.raw('t.start_time::text AS start_time'), db.raw('t.end_time::text AS end_time'),
      db.raw('t.original_start_time::text AS original_start_time'),
      db.raw('t.original_end_time::text AS original_end_time'),
      'tm.name as team_name', 'tm.sport', 'h.name as hall_name')
    .orderBy(['t.date', 't.start_time', 't.id'])

  const out = { cancelled: [], shortened: [], restored: [], handedOver: 0 }
  if (!trainings.length) return out

  // Closures (other than the ones being released) that still shut a hall+day.
  const tHalls = [...new Set(trainings.map((t) => t.hall).filter((h) => h != null))]
  const closures = tHalls.length
    ? await db('hall_closures')
      .whereIn('hall', tHalls).andWhereRaw('end_date >= CURRENT_DATE')
      .select('id', 'hall', 'reason', db.raw('start_date::text AS s'), db.raw('end_date::text AS e'))
    : []
  const coveringClosure = (t) => closures.find((c) => !releasing.has(c.id) && c.hall === t.hall
    && t.date >= c.s && t.date <= c.e) || null

  // The team's own scheduled game that day — game sweep pass 4 territory.
  const tTeams = [...new Set(trainings.map((t) => t.team).filter((x) => x != null))]
  const ownGames = tTeams.length
    ? await db('games')
      .where('status', 'scheduled').whereIn('kscw_team', tTeams).andWhereRaw('date >= CURRENT_DATE')
      .select('id', 'kscw_team', db.raw('date::text AS date'), 'time')
      .orderByRaw('time ASC NULLS LAST, id ASC')
    : []
  const ownGame = (t) => ownGames.find((g) => g.kscw_team === t.team && g.date === t.date) || null

  const span = (s, e) => `${hm(s)}–${hm(e)}`
  const row = (t, extra = {}) => ({
    date: t.date, start_time: t.start_time, team: t.team_name, sport: t.sport, hall: t.hall_name, ...extra,
  })

  // Every write is guarded on the state it was planned from: the closure delete
  // hook and the game sweep can touch the same rows, and a lost race just waits
  // for the next run instead of overwriting their result.
  const write = async (t, patch) => {
    const n = await db('trainings')
      .where('id', t.id)
      .andWhere('cancelled', t.cancelled)
      .andWhereRaw('auto_adjusted_by_booking IS NOT DISTINCT FROM ?::text', [t.auto_adjusted_by_booking])
      .andWhereRaw('auto_cancelled_by_closure IS NOT DISTINCT FROM ?::integer', [t.auto_cancelled_by_closure])
      .whereNull('auto_shortened_by_game')
      .andWhereRaw('start_time IS NOT DISTINCT FROM ?::time', [t.start_time])
      .andWhereRaw('end_time IS NOT DISTINCT FROM ?::time', [t.end_time])
      .update(patch)
    return n > 0
  }

  for (const t of trainings) {
    if (t.auto_shortened_by_game != null) continue // the game sweep's row
    const plan = planTraining(t, bookings.get(`${t.hall}|${t.date}`) || [])
    const mine = t.auto_adjusted_by_booking != null
    const hasOriginals = t.original_start_time != null || t.original_end_time != null
    const plannedStart = t.original_start_time ?? t.start_time
    const plannedEnd = t.original_end_time ?? t.end_time
    const adjustPatch = (p) => {
      const start = toTime(p.start)
      const end = toTime(p.end)
      return {
        start_time: start,
        end_time: end,
        original_start_time: toMinutes(start) !== toMinutes(plannedStart) ? plannedStart : null,
        original_end_time: toMinutes(end) !== toMinutes(plannedEnd) ? plannedEnd : null,
        auto_adjusted_by_booking: p.key,
      }
    }
    const shortenedRow = (p) => row(t, { from: span(plannedStart, plannedEnd), to: span(toTime(p.start), toTime(p.end)), reason: p.reason })

    if (!mine) {
      if (t.cancelled) {
        // Cancelled by someone else — ours only if it is a closure being released.
        if (!releasing.has(Number(t.auto_cancelled_by_closure)) || coveringClosure(t)) continue
        if (plan.kind === 'cancel') {
          if (await write(t, { auto_cancelled_by_closure: null, auto_adjusted_by_booking: plan.key, cancel_reason: plan.reason })) {
            out.cancelled.push(row(t, { reason: plan.reason }))
          }
        } else if (plan.kind === 'adjust') {
          if (await write(t, { cancelled: false, cancel_reason: '', auto_cancelled_by_closure: null, ...adjustPatch(plan) })) {
            out.shortened.push(shortenedRow(plan))
          }
        }
        // 'none' → the closure delete hook reinstates it, as it always has.
        continue
      }
      if (plan.kind === 'cancel') {
        if (await write(t, { cancelled: true, cancel_reason: plan.reason, auto_adjusted_by_booking: plan.key })) {
          out.cancelled.push(row(t, { reason: plan.reason }))
        }
      } else if (plan.kind === 'adjust') {
        if (await write(t, adjustPatch(plan))) out.shortened.push(shortenedRow(plan))
      }
      continue
    }

    // ── Our row ──
    if (!t.cancelled && !hasOriginals) {
      // A human un-cancelled our cancellation. Respect it while the booking
      // stands; re-arm the training once nothing covers it.
      if (plan.kind === 'none') await write(t, { auto_adjusted_by_booking: null })
      continue
    }

    if (t.cancelled && hasOriginals) {
      // We trimmed it, then a human or a closure cancelled it — theirs now. Hand
      // back the planned times once no booking applies.
      if (plan.kind === 'none') {
        await write(t, { start_time: plannedStart, end_time: plannedEnd, original_start_time: null, original_end_time: null, auto_adjusted_by_booking: null })
      }
      continue
    }

    if (t.cancelled) {
      // Our cancellation. A closure covering the day outranks us whatever the
      // plan says: hand the row to it (silently — it stays cancelled).
      const closure = coveringClosure(t)
      if (closure) {
        if (await write(t, { auto_adjusted_by_booking: null, auto_cancelled_by_closure: closure.id, cancel_reason: closure.reason || 'Halle geschlossen' })) out.handedOver++
        continue
      }
      if (plan.kind === 'cancel') {
        // Re-titled, or a different booking now covers it: keep the reason current.
        if (plan.key !== t.auto_adjusted_by_booking || plan.reason !== t.cancel_reason) {
          await write(t, { auto_adjusted_by_booking: plan.key, cancel_reason: plan.reason })
        }
      } else if (plan.kind === 'adjust') {
        if (await write(t, { cancelled: false, cancel_reason: '', ...adjustPatch(plan) })) out.shortened.push(shortenedRow(plan))
      } else {
        // Booking gone. The team playing its own game that day keeps it
        // cancelled under the game's marker (what game pass 4 would have done).
        const game = ownGame(t)
        if (game) {
          if (await write(t, { auto_adjusted_by_booking: null, auto_shortened_by_game: game.id, cancel_reason: '' })) out.handedOver++
        } else if (await write(t, { cancelled: false, cancel_reason: '', auto_adjusted_by_booking: null })) {
          out.restored.push(row(t))
        }
      }
      continue
    }

    // Our trim on a live training.
    if (plan.kind === 'adjust') {
      const p = adjustPatch(plan)
      if (toMinutes(p.start_time) !== toMinutes(t.start_time) || toMinutes(p.end_time) !== toMinutes(t.end_time)) {
        if (await write(t, p)) out.shortened.push(shortenedRow(plan))
      } else if (plan.key !== t.auto_adjusted_by_booking) {
        await write(t, { auto_adjusted_by_booking: plan.key })
      }
    } else if (plan.kind === 'cancel') {
      if (await write(t, {
        cancelled: true, cancel_reason: plan.reason, auto_adjusted_by_booking: plan.key,
        start_time: plannedStart, end_time: plannedEnd, original_start_time: null, original_end_time: null,
      })) out.cancelled.push(row(t, { reason: plan.reason }))
    } else if (await write(t, {
      start_time: plannedStart, end_time: plannedEnd, original_start_time: null, original_end_time: null, auto_adjusted_by_booking: null,
    })) {
      out.restored.push(row(t, { start_time: plannedStart }))
    }
  }

  if (out.cancelled.length || out.shortened.length || out.restored.length || out.handedOver) {
    log.info(`[hall-bookings] cancelled=${out.cancelled.length} shortened=${out.shortened.length} restored=${out.restored.length} handedOver=${out.handedOver}`)
  }
  return out
}
