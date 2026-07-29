/**
 * Hall-slot → trainings cascade.
 *
 * Centralizes the "edit the recurring slot, propagate to upcoming trainings"
 * logic that used to live in the React SlotEditor. Running it as a Directus
 * hook means edits via the admin UI, REST, or any other client cascade the
 * same way — no more silent divergence when someone touches `hall_slots`
 * outside the React editor.
 *
 * Scope: only `slot_type = 'training'` slots, only future trainings
 * (`date >= today`). Past trainings stay frozen as historical snapshots
 * (RSVPs/attendance from last month must not retcon).
 *
 * Cascaded fields:
 *   • day_of_week           → shifts each future training's date by
 *                              (newDay − oldDay) days, keeping the row in
 *                              the same Mon–Sun calendar week so RSVPs +
 *                              notes carry over.
 *   • start_time / end_time → patched in place.
 *   • hall                  → patched in place.
 *   • team (M2M)            → first selected team patched onto trainings.
 *   • valid_from / valid_until / indefinite
 *                           → trim future trainings outside the new window;
 *                              generate missing dates inside the new window
 *                              (skipping closures + existing dates).
 *
 * Create-time generation (called from `hall_slots.items.create`) lives in
 * the same module so the rules match exactly.
 */

import { seasonEndDate as sharedSeasonEndDate } from '../../kscw-endpoints/src/season.js'

/** ISO date (YYYY-MM-DD) for "today" in the server's timezone. */
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/** Format a JS Date as YYYY-MM-DD (UTC components — we anchor everything to
 *  UTC midnight to dodge DST surprises in date arithmetic). */
function toISODate(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Coerce a Postgres `date` value (which pg-node returns as a JS Date
 *  object in the server's TZ, not a string) or an ISO string to a
 *  YYYY-MM-DD-anchored UTC Date. Bare `String(date)` produces
 *  `"Wed Sep 01 2025 …"` which slice(0,10)'d gives `"Wed Sep 01"` and
 *  blows up `new Date(...)` into Invalid Date → NaN-NaN-NaN downstream.
 *  Branch on Date instance so we read the calendar fields directly. */
function parseDate(s) {
  if (s instanceof Date) {
    const y = s.getFullYear()
    const m = String(s.getMonth() + 1).padStart(2, '0')
    const d = String(s.getDate()).padStart(2, '0')
    return new Date(`${y}-${m}-${d}T00:00:00Z`)
  }
  const str = String(s).slice(0, 10)
  return new Date(str + 'T00:00:00Z')
}

/** Rolling-horizon length for indefinite training slots. "Indefinite" can't
 *  mean literally forever (the trainings table would be unbounded), so the
 *  cron + cascade keep `INDEFINITE_HORIZON_WEEKS` worth of upcoming
 *  trainings always populated and never trim past that point. 12 weeks is
 *  the PlayerPlus default and matches the typical "next 3 months" planning
 *  window members care about. Tune here when needed. */
const INDEFINITE_HORIZON_WEEKS = 12

/** Season-end fallback for non-indefinite slots that omit `valid_until` —
 *  legacy create-time behavior the React editor used to apply. Returns
 *  May 31 of current or next season. */
// Was a UTC-month copy — flipped two hours early on Jun 1. See season.js.
const seasonEndDate = sharedSeasonEndDate

/** YYYY-MM-DD `INDEFINITE_HORIZON_WEEKS` weeks from today. */
function rollingHorizonDate() {
  const d = parseDate(todayStr())
  d.setUTCDate(d.getUTCDate() + INDEFINITE_HORIZON_WEEKS * 7)
  return toISODate(d)
}

/** Run a knex callback in a transaction that suppresses the
 *  `trg_trainings_notify` Postgres trigger via the
 *  `kscw.skip_trainings_notify` GUC (set by migration 054). Used so that
 *  slot-cascade bulk INSERTs/UPDATEs/DELETEs on `trainings` don't
 *  push-spam every member on every routine top-up.
 *
 *  Third arg to `set_config` is `is_local = true` → the setting is scoped
 *  to the current transaction only, so it can't leak to other queries on
 *  the pooled connection after COMMIT/ROLLBACK. */
async function withTrainingsNotifySilenced(database, fn) {
  return database.transaction(async (trx) => {
    await trx.raw("SELECT set_config('kscw.skip_trainings_notify', 'on', true)")
    return fn(trx)
  })
}

/** Map our day_of_week (0=Mon … 6=Sun) to JS getDay() (0=Sun … 6=Sat). */
function targetJsDay(dayOfWeek) {
  return (dayOfWeek + 1) % 7
}

/** Fetch the M2M teams attached to a slot (returns array of team ids). */
async function getSlotTeams(database, slotId) {
  const rows = await database('hall_slots_teams')
    .where('hall_slots_id', slotId)
    .select('teams_id')
  return rows.map(r => r.teams_id).filter(t => t != null)
}

/** Dates a coach has intentionally removed from a slot (deleted the occurrence
 *  or detached it by editing the time) that the generators must NOT regenerate.
 *  Backed by `training_slot_skips` (migration 162), keyed (hall_slot, date).
 *  Returns a Set of YYYY-MM-DD strings. The three generators below filter their
 *  candidate inserts against this so a removed occurrence stays removed instead
 *  of respawning on the nightly top-up / next slot edit. */
async function getSkipSet(database, slotId) {
  const rows = await database('training_slot_skips')
    .where('hall_slot', slotId)
    .select('date')
  return new Set(rows.map(r => toISODate(parseDate(r.date))))
}

/** Record a "do not regenerate" tombstone for (slotId, date). Idempotent —
 *  the unique(hall_slot, date) constraint makes a repeat a no-op. */
export async function addTrainingSkip(database, slotId, date, userUuid) {
  if (!slotId || !date) return
  await database('training_slot_skips')
    .insert({ hall_slot: slotId, date: toISODate(parseDate(date)), created_by: userUuid || null })
    .onConflict(['hall_slot', 'date'])
    .ignore()
}

/** Clear a tombstone for (slotId, date) — called when a training is (re)created
 *  or re-attached to the slot for that date, so the occurrence can come back. */
export async function clearTrainingSkip(database, slotId, date) {
  if (!slotId || !date) return
  await database('training_slot_skips')
    .where({ hall_slot: slotId, date: toISODate(parseDate(date)) })
    .delete()
}

/** Snapshot a slot's cascade-relevant fields plus its team junction. Used
 *  by the filter hook to capture pre-state before Directus applies the
 *  update. */
export async function snapshotSlot(database, slotId) {
  const slot = await database('hall_slots').where('id', slotId).first()
  if (!slot) return null
  const teams = await getSlotTeams(database, slotId)
  return {
    id: slot.id,
    day_of_week: slot.day_of_week,
    start_time: slot.start_time,
    end_time: slot.end_time,
    hall: slot.hall,
    slot_type: slot.slot_type,
    valid_from: slot.valid_from ? toISODate(parseDate(slot.valid_from)) : null,
    valid_until: slot.valid_until ? toISODate(parseDate(slot.valid_until)) : null,
    indefinite: !!slot.indefinite,
    teams,
  }
}

/** Effective window end for generation. For indefinite slots this is the
 *  rolling horizon (today + N weeks) — the upper bound is "soft" because
 *  the nightly cron keeps extending it. For bounded slots, explicit
 *  `valid_until` wins; falls back to season-end on legacy rows that have
 *  neither indefinite nor valid_until set. */
function effectiveEnd(slot) {
  if (slot.indefinite) return rollingHorizonDate()
  return slot.valid_until || seasonEndDate()
}

/** Effective window start for generation: never reach into the past — the
 *  cascade only ever touches `date >= today`. */
function effectiveStart(slot) {
  const today = todayStr()
  return (slot.valid_from && slot.valid_from > today) ? slot.valid_from : today
}

/** Return all dates the slot's weekly recurrence would land on between
 *  `start` and `end` (inclusive), skipping hall closures. Used to compute
 *  which trainings need to exist for the new window. */
async function expectedDates(database, slot, start, end) {
  const out = []
  if (!start || !end || start > end) return out
  const closures = await database('hall_closures')
    .where('hall', slot.hall)
    .select('start_date', 'end_date')
  const isClosed = (dateStr) => closures.some(c => {
    const s = c.start_date ? toISODate(parseDate(c.start_date)) : null
    const e = c.end_date ? toISODate(parseDate(c.end_date)) : null
    return s && e && s <= dateStr && e >= dateStr
  })
  const target = targetJsDay(slot.day_of_week)
  const cur = parseDate(start)
  const endD = parseDate(end)
  while (cur.getUTCDay() !== target && cur <= endD) {
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  while (cur <= endD) {
    const dateStr = toISODate(cur)
    if (!isClosed(dateStr)) out.push(dateStr)
    cur.setUTCDate(cur.getUTCDate() + 7)
  }
  return out
}

/** Initial generation when a new training slot is created. Mirrors the old
 *  React `generateTrainings` exactly, just running server-side now.
 *  Notifications are suppressed for the bulk insert — admins creating a
 *  new slot shouldn't push-spam every member with 30+ "training_created"
 *  pings for the routine weekly skeleton. */
export async function generateInitialTrainings(database, slotId, log) {
  const slot = await database('hall_slots').where('id', slotId).first()
  if (!slot || slot.slot_type !== 'training' || !slot.hall) return []
  const teams = await getSlotTeams(database, slotId)
  const teamId = teams[0]
  if (!teamId) return []
  const start = effectiveStart(slot)
  const end = effectiveEnd(slot)
  const dates = await expectedDates(database, slot, start, end)
  if (dates.length === 0) return []
  const createdIds = []
  await withTrainingsNotifySilenced(database, async (trx) => {
    const existing = await trx('trainings').where('hall_slot', slotId).select('date')
    const existingSet = new Set(existing.map(r => toISODate(parseDate(r.date))))
    const skipSet = await getSkipSet(trx, slotId)
    const inserts = dates
      .filter(d => !existingSet.has(d) && !skipSet.has(d))
      .map(d => ({
        team: teamId,
        hall_slot: slotId,
        hall: slot.hall,
        date: d,
        start_time: slot.start_time,
        end_time: slot.end_time,
        cancelled: false,
      }))
    if (inserts.length === 0) return
    const rows = await trx('trainings').insert(inserts).returning('id')
    for (const r of rows) createdIds.push(typeof r === 'object' ? r.id : r)
    log?.info?.({ msg: '[slot-cascade] generated initial trainings', slot: slotId, count: inserts.length, event: 'slot_generate' })
  })
  return createdIds
}

/** Apply the cascade after a slot update. `pre` is the snapshot from the
 *  filter hook; the post-state is re-read here so we see the actual stored
 *  values rather than trusting the payload (which may omit unchanged
 *  fields). */
export async function cascadeSlotUpdate(database, slotId, pre, log) {
  if (!pre) return []
  const post = await snapshotSlot(database, slotId)
  if (!post) return []
  if (post.slot_type !== 'training') return []

  const today = todayStr()
  const createdIds = []

  // All mutations on `trainings` here are routine slot-edit propagation —
  // members already know about the slot, they don't need a push per row.
  // Single transaction with the silencer flag set.
  await withTrainingsNotifySilenced(database, async (trx) => {
    // 1. Shift dates if day_of_week changed. Use signed delta so a switch
    //    from Sunday (6) → Monday (0) lands on the same calendar week's
    //    Monday rather than next week's. Range: -6..+6.
    let dateShiftApplied = false
    if (pre.day_of_week != null && post.day_of_week != null && pre.day_of_week !== post.day_of_week) {
      const delta = post.day_of_week - pre.day_of_week
      const future = await trx('trainings')
        .where('hall_slot', slotId)
        .andWhere('date', '>=', today)
        .select('id', 'date')
      for (const tr of future) {
        const newDate = parseDate(tr.date)
        newDate.setUTCDate(newDate.getUTCDate() + delta)
        const newDateStr = toISODate(newDate)
        // Skip when shifted date already has a training (rare — happens if
        // the user previously moved a single training manually onto the
        // target weekday). Leave the conflict in place; admin can resolve.
        const clash = await trx('trainings')
          .where('hall_slot', slotId)
          .andWhere('date', newDateStr)
          .andWhereNot('id', tr.id)
          .first()
        if (clash) continue
        await trx('trainings').where('id', tr.id).update({ date: newDateStr })
      }
      dateShiftApplied = true
    }

    // 2. Patch time / hall / team on remaining future trainings, OR
    //    delete them outright if the slot became teamless. Teamless slot
    //    means the slot is released for any team to claim — the existing
    //    committed sessions for the previous team no longer apply.
    const timeChanged = pre.start_time !== post.start_time || pre.end_time !== post.end_time
    const hallChanged = pre.hall !== post.hall
    const preTeam = pre.teams[0] ?? null
    const postTeam = post.teams[0] ?? null
    const teamChanged = preTeam !== postTeam

    if (teamChanged && postTeam == null) {
      const deleted = await trx('trainings')
        .where('hall_slot', slotId)
        .andWhere('date', '>=', today)
        .del()
      log?.info?.({ msg: '[slot-cascade] cleared future trainings for now-teamless slot', slot: slotId, count: deleted, event: 'slot_free' })
    } else if (timeChanged || hallChanged || teamChanged || dateShiftApplied) {
      const patch = {}
      if (timeChanged) { patch.start_time = post.start_time; patch.end_time = post.end_time }
      if (hallChanged) patch.hall = post.hall
      if (teamChanged && postTeam != null) patch.team = postTeam
      if (Object.keys(patch).length > 0) {
        await trx('trainings')
          .where('hall_slot', slotId)
          .andWhere('date', '>=', today)
          .update(patch)
      }
    }

    // 3. Trim trainings outside the new validity window. Lower bound
    //    always trims; upper bound only for bounded slots.
    const newStart = effectiveStart(post)
    const newEnd = effectiveEnd(post)

    await trx('trainings')
      .where('hall_slot', slotId)
      .andWhere('date', '>=', today)
      .andWhere('date', '<', newStart)
      .del()

    if (!post.indefinite) {
      await trx('trainings')
        .where('hall_slot', slotId)
        .andWhere('date', '>=', today)
        .andWhere('date', '>', newEnd)
        .del()
    }

    // 4. Generate missing dates inside the new window.
    const desired = await expectedDates(trx, post, newStart, newEnd)
    if (desired.length > 0 && postTeam != null) {
      const existing = await trx('trainings')
        .where('hall_slot', slotId)
        .andWhere('date', '>=', today)
        .select('date')
      const existingSet = new Set(existing.map(r => toISODate(parseDate(r.date))))
      const skipSet = await getSkipSet(trx, slotId)
      const inserts = desired
        .filter(d => !existingSet.has(d) && !skipSet.has(d))
        .map(d => ({
          team: postTeam,
          hall_slot: slotId,
          hall: post.hall,
          date: d,
          start_time: post.start_time,
          end_time: post.end_time,
          cancelled: false,
        }))
      if (inserts.length > 0) {
        const rows = await trx('trainings').insert(inserts).returning('id')
        for (const r of rows) createdIds.push(typeof r === 'object' ? r.id : r)
        log?.info?.({ msg: '[slot-cascade] filled missing trainings', slot: slotId, count: inserts.length, event: 'slot_fill' })
      }
    }
  })
  return createdIds
}

/** Nightly rolling top-up for indefinite training slots. Generates any
 *  missing trainings between today and `today + INDEFINITE_HORIZON_WEEKS`,
 *  skipping closures and existing dates. Bounded slots are left alone —
 *  their valid_until is the source of truth. Past trainings are never
 *  touched.
 *
 *  Idempotent: safe to run every night; only new dates that crossed into
 *  the rolling window get an INSERT, everything else is a no-op. Returns
 *  the total number of trainings created across all slots so the cron
 *  caller can heartbeat it. */
export async function topUpIndefiniteSlots(database, log, onCreated) {
  const slots = await database('hall_slots')
    .where('slot_type', 'training')
    .andWhere('indefinite', true)
    .select('*')
  if (slots.length === 0) return 0
  const today = todayStr()
  const horizon = rollingHorizonDate()
  let totalCreated = 0
  for (const slotRow of slots) {
    try {
      if (!slotRow.hall) continue
      const teams = await getSlotTeams(database, slotRow.id)
      const teamId = teams[0]
      if (!teamId) continue
      // Respect valid_from when set — don't generate before a slot starts.
      const slotStart = slotRow.valid_from ? toISODate(parseDate(slotRow.valid_from)) : today
      const start = slotStart > today ? slotStart : today
      const desired = await expectedDates(database, slotRow, start, horizon)
      if (desired.length === 0) continue
      const existing = await database('trainings')
        .where('hall_slot', slotRow.id)
        .andWhere('date', '>=', today)
        .select('date')
      const existingSet = new Set(existing.map(r => toISODate(parseDate(r.date))))
      const skipSet = await getSkipSet(database, slotRow.id)
      const inserts = desired
        .filter(d => !existingSet.has(d) && !skipSet.has(d))
        .map(d => ({
          team: teamId,
          hall_slot: slotRow.id,
          hall: slotRow.hall,
          date: d,
          start_time: slotRow.start_time,
          end_time: slotRow.end_time,
          cancelled: false,
        }))
      if (inserts.length === 0) continue
      const createdIds = []
      await withTrainingsNotifySilenced(database, async (trx) => {
        const rows = await trx('trainings').insert(inserts).returning('id')
        for (const r of rows) createdIds.push(typeof r === 'object' ? r.id : r)
      })
      totalCreated += inserts.length
      if (onCreated && createdIds.length) {
        try { await onCreated(createdIds) } catch (err) {
          log?.error?.({ msg: `[slot-cascade] onCreated callback failed for slot ${slotRow.id}: ${err.message}`, event: 'slot_topup_oncreated_failed', slot: slotRow.id, stack: err.stack })
        }
      }
      log?.info?.({ msg: '[slot-cascade] rolling top-up', slot: slotRow.id, count: inserts.length, event: 'slot_topup' })
    } catch (err) {
      log?.error?.({ msg: `[slot-cascade] top-up failed for slot ${slotRow.id}: ${err.message}`, event: 'slot_topup_failed', slot: slotRow.id, stack: err.stack })
    }
  }
  return totalCreated
}
