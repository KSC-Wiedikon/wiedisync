/**
 * Combined activity + participations endpoint.
 *
 * Eliminates the games/trainings → participations waterfall: the frontend
 * makes ONE HTTP round-trip and receives both the activity rows (scoped,
 * paginated, field-expanded) and every participation row tied to them.
 *
 * Route: POST /kscw/activities/:type/with-participations
 *   :type ∈ { 'game', 'training' }
 *
 * Body (all optional except where noted):
 *   {
 *     filter: Directus filter object,
 *     sort: string[],
 *     fields: string[],                      // activity fields + expansions
 *     limit: number,
 *     offset: number,
 *     participation_fields: string[]         // defaults to a safe minimal set
 *   }
 *
 * Response:
 *   { data: { items: [...activities], participations: [...] } }
 *
 * Permission model: both underlying reads run through Directus ItemsService
 * with `accountability: req.accountability`, so the requesting user only
 * sees activities + participations they already have read access to. No
 * elevation, no RBAC bypass.
 */

const TYPE_TO_COLLECTION = {
  game: 'games',
  training: 'trainings',
}

const DEFAULT_PARTICIPATION_FIELDS = [
  'id',
  'activity_id',
  'activity_type',
  'member',
  'status',
  'note',
  'session_id',
  'guest_count',
  'is_staff',
  'waitlisted_at',
  // migration 438: the card lets a member moved up after the deadline still say No.
  'promoted_at',
  'date_created',
  'date_updated',
]

export function registerActivitiesWithParticipations(router, { services, getSchema, database, logger }) {
  router.post('/activities/:type/with-participations', async (req, res) => {
    const { type } = req.params
    const collection = TYPE_TO_COLLECTION[type]
    if (!collection) {
      return res.status(400).json({ error: `Unsupported activity type: ${type}` })
    }

    if (!req.accountability?.user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    try {
      const { ItemsService } = services
      const schema = await getSchema()

      const {
        filter,
        sort,
        fields,
        limit,
        offset,
        participation_fields,
      } = req.body ?? {}

      const activityQuery = {}
      if (filter !== undefined) activityQuery.filter = filter
      if (Array.isArray(sort)) activityQuery.sort = sort
      if (Array.isArray(fields)) activityQuery.fields = fields
      if (typeof limit === 'number') activityQuery.limit = limit
      if (typeof offset === 'number') activityQuery.offset = offset

      // Scope by requester accountability → honours existing RBAC exactly.
      const activitiesService = new ItemsService(collection, {
        schema,
        knex: database,
        accountability: req.accountability,
      })
      const items = await activitiesService.readByQuery(activityQuery)

      if (!items.length) {
        return res.json({ data: { items: [], participations: [] } })
      }

      const activityIds = items.map((it) => it.id).filter((id) => id !== undefined && id !== null)

      const participationsService = new ItemsService('participations', {
        schema,
        knex: database,
        accountability: req.accountability,
      })
      const participations = await participationsService.readByQuery({
        filter: {
          _and: [
            { activity_type: { _eq: type } },
            { activity_id: { _in: activityIds.map(String) } },
          ],
        },
        fields: Array.isArray(participation_fields) && participation_fields.length > 0
          ? participation_fields
          : DEFAULT_PARTICIPATION_FIELDS,
        limit: -1,
      })

      res.json({ data: { items, participations } })
    } catch (err) {
      logger.error(`[activities/${type}/with-participations] ${err?.message || err}`)
      const status = typeof err?.status === 'number' ? err.status : 500
      res.status(status).json({ error: err?.message || 'Internal error' })
    }
  })
}
