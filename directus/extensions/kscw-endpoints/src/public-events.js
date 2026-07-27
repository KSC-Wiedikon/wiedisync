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

export function registerPublicEvents(router, { database, logger }) {
  const log = logger.child({ endpoint: 'public-events' })

  router.get('/public/events', async (req, res) => {
    try {
      // NOT EXISTS, not NOT IN: the junction events_id columns are nullable, and
      // a single NULL row in a NOT IN subquery makes the predicate never true
      // (SQL three-valued logic) — silently emptying the whole feed.
      let q = database('events')
        .whereNotExists(database('events_teams').select('id').whereRaw('events_teams.events_id = events.id'))
        .whereNotExists(database('events_members').select('id').whereRaw('events_members.events_id = events.id'))
        .where('cancelled', false)
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
