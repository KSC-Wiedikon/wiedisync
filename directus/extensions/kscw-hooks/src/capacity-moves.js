/**
 * Waiting-list notifications (migration 437).
 *
 * The seat rule lives in Postgres: kscw_rebalance_capacity moves somebody else's
 * RSVP between `confirmed` and `waitlisted` (a team player took a guest's seat, a
 * seat freed up, the cap changed) and queues each move in
 * `participation_capacity_moves`. This drains that queue into the bell, a push and
 * an email (waitlist-email.js).
 * kscw-hooks runs it right after an app write (participations / trainings / events
 * actions) and from a one-minute cron, which also picks up the moves that raw-SQL
 * writers cause (OpnForm sign-ups, absence unwinds, auto-confirm sweeps).
 *
 * Claiming is one UPDATE over a `FOR UPDATE SKIP LOCKED` pick, so the cron and a
 * hook draining at the same moment never announce the same move twice. A move is
 * only announced while it is still news:
 *   - per RSVP, moves that cancel out inside one drain (bumped, then promoted back)
 *     say nothing; otherwise the latest one is announced;
 *   - the RSVP must still have that status (somebody bumped who has since said No
 *     hears nothing). A seat is a Yes or a Maybe (migration 438), so a move
 *     `confirmed` ("got a seat") matches either;
 *   - the activity must still be ahead and not cancelled.
 */

export const CAPACITY_MOVES_BATCH = 200
export const CAPACITY_MOVES_KEEP_DAYS = 30

/** Claim up to `limit` pending moves (sets notified_at) and return them. */
export async function claimCapacityMoves(db, limit = CAPACITY_MOVES_BATCH) {
  const res = await db.raw(`
    UPDATE participation_capacity_moves m
       SET notified_at = now()
     WHERE m.id IN (
       SELECT id FROM participation_capacity_moves
        WHERE notified_at IS NULL
        ORDER BY id
        LIMIT ?
        FOR UPDATE SKIP LOCKED)
    RETURNING m.id, m.participation, m.member, m.activity_type, m.activity_id, m.session_id, m.move`, [limit])
  return res?.rows ?? []
}

/**
 * The moves still worth announcing, one per RSVP (see the header).
 * @param {Array<{id, participation, move}>} moves claimed moves
 * @param {Map<string, string>} statusById participation id → current status
 */
export function movesToAnnounce(moves, statusById) {
  const byRsvp = new Map()
  for (const m of moves) {
    if (m?.participation == null) continue
    const key = String(m.participation)
    const list = byRsvp.get(key) ?? []
    list.push(m)
    byRsvp.set(key, list)
  }
  const out = []
  for (const [key, list] of byRsvp) {
    list.sort((a, b) => Number(a.id) - Number(b.id))
    const first = list[0]
    const last = list[list.length - 1]
    // A status only ever flips between the two, so first ≠ last means the moves
    // cancelled out: the RSVP ended where it started.
    if (first.move !== last.move) continue
    const now = statusById.get(key)
    const stillTrue = last.move === 'confirmed' ? (now === 'confirmed' || now === 'tentative') : now === last.move
    if (!stillTrue) continue
    out.push(last)
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id))
}

/** Bell key (notifications namespace) and push keys (push-i18n) for a move. */
export function capacityMessageKeys(move, activityType) {
  const promoted = move === 'confirmed'
  const kind = promoted ? 'waitlistPromoted' : 'waitlistBumped'
  return {
    bell: `waitlist_${promoted ? 'promoted' : 'bumped'}_${activityType}`,
    pushTitle: `${kind}.title`,
    pushBody: `${kind}.${activityType}`,
  }
}

async function loadActivities(db, moves) {
  const ids = (type) => [...new Set(moves
    .filter((m) => m.activity_type === type && /^\d{1,9}$/.test(String(m.activity_id)))
    .map((m) => Number(m.activity_id)))]
  const trainingIds = ids('training')
  const eventIds = ids('event')
  const out = new Map()
  if (trainingIds.length) {
    const res = await db.raw(`
      SELECT t.id, t.team, tm.name AS team_name,
             to_char(t.date, 'DD.MM.YYYY') AS date,
             to_char(t.start_time, 'HH24:MI') AS time,
             (NOT t.cancelled AND t.date >= (now() AT TIME ZONE 'Europe/Zurich')::date) AS upcoming
        FROM trainings t
        LEFT JOIN teams tm ON tm.id = t.team
       WHERE t.id = ANY(?::int[])`, [trainingIds])
    for (const r of res?.rows ?? []) out.set(`training|${r.id}`, r)
  }
  if (eventIds.length) {
    const res = await db.raw(`
      SELECT e.id, e.title,
             to_char(e.start_date AT TIME ZONE 'Europe/Zurich', 'DD.MM.YYYY') AS date,
             to_char(e.start_date AT TIME ZONE 'Europe/Zurich', 'HH24:MI') AS time,
             (NOT e.cancelled AND (e.start_date IS NULL OR COALESCE(e.end_date, e.start_date) >= now())) AS upcoming
        FROM events e
       WHERE e.id = ANY(?::int[])`, [eventIds])
    for (const r of res?.rows ?? []) out.set(`event|${r.id}`, r)
  }
  return out
}

/**
 * Drain the queue once.
 * @param {object} db knex
 * @param {object} opts
 * @param {(memberIds: number[], titleKey: string, bodyKey: string, vars: object, url: string, tag: string) => Promise<unknown>} opts.push
 * @param {(p: { memberId: number, move: string, activityType: string, vars: object, isGuest: boolean, url: string }) => Promise<unknown>} [opts.email]
 * @param {string} opts.frontendUrl
 * @param {object} opts.log
 * @returns {Promise<{ claimed: number, notified: number }>}
 */
export async function drainCapacityMoves(db, { push, email, frontendUrl, log }) {
  const claimed = await claimCapacityMoves(db)
  if (claimed.length === 0) return { claimed: 0, notified: 0 }

  const rsvpIds = [...new Set(claimed.map((m) => m.participation).filter((v) => v != null))]
  const current = rsvpIds.length
    ? await db('participations').whereIn('id', rsvpIds).select('id', 'status')
    : []
  const statusById = new Map(current.map((r) => [String(r.id), r.status]))
  const moves = movesToAnnounce(claimed, statusById)
  const activities = await loadActivities(db, moves)

  const bell = []
  const pushes = new Map()
  const mails = []
  for (const m of moves) {
    const act = activities.get(`${m.activity_type}|${m.activity_id}`)
    if (!act?.upcoming) continue
    const vars = m.activity_type === 'training'
      ? { team: act.team_name || '', date: act.date || '', time: act.time || '' }
      : { title: act.title || '', date: act.date || '', time: act.time || '' }
    const keys = capacityMessageKeys(m.move, m.activity_type)
    bell.push({
      member: m.member,
      type: 'activity_change',
      title: keys.bell,
      body: JSON.stringify(vars),
      activity_type: m.activity_type,
      activity_id: String(m.activity_id),
      team: m.activity_type === 'training' ? (act.team ?? null) : null,
      read: false,
    })
    mails.push({ m, act, vars })
    const groupKey = `${m.activity_type}|${m.activity_id}|${m.move}`
    const group = pushes.get(groupKey) ?? { keys, vars, type: m.activity_type, id: m.activity_id, members: [] }
    group.members.push(m.member)
    pushes.set(groupKey, group)
  }

  if (bell.length) await db('notifications').insert(bell)
  for (const g of pushes.values()) {
    const path = g.type === 'training' ? `/trainings/${g.id}` : `/events/${g.id}`
    try {
      await push(g.members, g.keys.pushTitle, g.keys.pushBody, g.vars, `${frontendUrl}${path}`, `waitlist-${g.type}-${g.id}`)
    } catch (err) {
      log?.warn?.({ msg: `[capacity-moves] push failed: ${err.message}`, event: 'capacity_moves_push', stack: err.stack })
    }
  }
  if (email) {
    for (const { m, act, vars } of mails) {
      try {
        // A lost seat tells a guest why (team players first); the SQL function is
        // the rebalance's own definition of "guest" for this activity.
        let isGuest = false
        if (m.move === 'waitlisted') {
          const res = await db.raw('SELECT kscw_capacity_guest_level(?, ?, ?::integer, ?::integer) AS lvl',
            [m.activity_type, String(m.activity_id), m.activity_type === 'training' ? (act.team ?? null) : null, m.member])
          isGuest = Number(res?.rows?.[0]?.lvl ?? 0) > 0
        }
        const path = m.activity_type === 'training' ? `/trainings/${m.activity_id}` : `/events/${m.activity_id}`
        await email({ memberId: m.member, move: m.move, activityType: m.activity_type, vars, isGuest, url: `${frontendUrl}${path}` })
      } catch (err) {
        log?.warn?.({ msg: `[capacity-moves] email failed: ${err.message}`, event: 'capacity_moves_email', stack: err.stack })
      }
    }
  }
  return { claimed: claimed.length, notified: bell.length }
}

/** Forget announced moves after CAPACITY_MOVES_KEEP_DAYS. */
export async function cleanupCapacityMoves(db) {
  return db('participation_capacity_moves')
    .whereNotNull('notified_at')
    .where('notified_at', '<', db.raw(`now() - (? * interval '1 day')`, [CAPACITY_MOVES_KEEP_DAYS]))
    .delete()
}
