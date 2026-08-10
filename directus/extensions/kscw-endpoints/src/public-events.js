/**
 * Public events feed for the kscw-website.
 *
 *   GET /kscw/public/events            — all club-wide events, sorted by start_date
 *   GET /kscw/public/events?from=YYYY-MM-DD&limit=3   — upcoming subset
 *
 * Returns ONLY club-wide events: events with NO team scope AND NO member scope.
 * A team-/member-scoped event (e.g. a tournament limited to H3) stays internal to
 * the wiedisync member app and never surfaces on the public site. Cancelled
 * events are excluded too — kscw.ch must not keep advertising them.
 *
 * Why an endpoint and not a plain /items/events read: the public policy deliberately
 * cannot read events_teams / events_members (migration 035), so the website can't tell
 * a club-wide event from a scoped one client-side. This runs with the extension's DB
 * context and filters server-side.
 *
 * Response shape mirrors Directus: { data: [...] } with snake_case fields.
 */

const PUBLIC_EVENT_FIELDS = [
  'id', 'title', 'event_type', 'start_date', 'end_date',
  'all_day', 'location', 'description', 'signup_url',
]

/**
 * The event types the PUBLIC policy is allowed to read
 * (`setup-permissions.mjs` → Public `/items/events` read). Keep the two in step:
 * this endpoint exists to be a server-side equivalent of that policy, so being
 * WIDER than it defeats the purpose.
 */
const PUBLIC_EVENT_TYPES = ['verein', 'tournament']

/**
 * The single definition of "publicly visible event", used by both
 * `/kscw/public/events` and the iCal feed — which had drifted into two copies of
 * two of the three rules.
 *
 * Audience has THREE axes, and only two were being checked (audit 2026-08-08,
 * finding 6):
 *   1. team scope   — `events_teams`   (was checked)
 *   2. member scope — `events_members` (was checked)
 *   3. role scope   — `events.invited_roles`, a plain json COLUMN, not a
 *      junction. A role-targeted event has zero rows in both junctions, so it
 *      passed both NOT EXISTS checks and was published.
 * …plus the `event_type` axis, which the Public policy enforces and this did not,
 * so `meeting` / `social` / `friendly` / `trainingsweekend` / `other` were all
 * served anonymously.
 *
 * The combination was strictly worse than it sounds: `MEMBER_POLICY`'s
 * EVENTS_VISIBLE has no `invited_roles` branch, so a leader-created `meeting`
 * with only role chips was UNREADABLE by an ordinary logged-in member yet served
 * to anonymous callers with title, location and description — and syndicated into
 * every subscribed calendar.
 *
 * The role predicate is deliberately FAIL-CLOSED: only NULL or an empty array is
 * public. Anything else — a populated array, a JSON object, a `null` literal, any
 * future shape — is treated as targeted and withheld. `NOT EXISTS` rather than
 * `NOT IN` for the junctions, because those `events_id` columns are nullable and
 * one NULL row makes a `NOT IN` predicate never true, silently emptying the feed
 * (that outage is why the comment exists).
 */
export function publicEventsQuery(database) {
  return database('events')
    .whereNotExists(database('events_teams').select('id').whereRaw('events_teams.events_id = events.id'))
    .whereNotExists(database('events_members').select('id').whereRaw('events_members.events_id = events.id'))
    .where('cancelled', false)
    .whereIn('event_type', PUBLIC_EVENT_TYPES)
    .whereRaw(`(
      invited_roles IS NULL
      OR (jsonb_typeof(invited_roles::jsonb) = 'array' AND jsonb_array_length(invited_roles::jsonb) = 0)
    )`)
}

export function registerPublicEvents(router, { database, logger }) {
  const log = logger.child({ endpoint: 'public-events' })

  router.get('/public/events', async (req, res) => {
    try {
      // Scope rules live in publicEventsQuery — shared with the iCal feed so the
      // two cannot drift apart again. See its doc comment.
      let q = publicEventsQuery(database)
        .orderBy('start_date')
        .select(PUBLIC_EVENT_FIELDS)

      const from = typeof req.query.from === 'string' ? req.query.from : null
      if (from && /^\d{4}-\d{2}-\d{2}/.test(from)) {
        q = q.where('start_date', '>=', from)
      }

      const limit = Number.parseInt(req.query.limit, 10)
      if (Number.isInteger(limit) && limit > 0) q = q.limit(limit)

      const rows = await q

      res.set('Cache-Control', 'public, max-age=300')
      res.json({ data: rows })
    } catch (err) {
      log.error({
        msg: `public-events: ${err.message}`,
        endpoint: 'public-events',
        query: { from: req.query?.from, limit: req.query?.limit },
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
