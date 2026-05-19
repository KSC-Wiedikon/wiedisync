/**
 * /kscw/wadmin — per-user website-admin section access.
 *
 * The caller's token only IDENTIFIES them (id + role via the
 * directus_users→directus_roles join, as in bugfixes.js). Data is
 * reached with admin-accountability ItemsService (idiomatic; no
 * service-token proxy). website_admin_access is an internal table
 * read/written via raw knex (no Directus REST surface).
 *
 * Manager = Superuser/Administrator (admin_access=true today) → all
 * sections + the management grid. Website Admin = the Phase-C
 * non-admin role → only granted sections. Any other role → nothing.
 */

// Wired into the scorer_courses OpnForm routes in Task A5 — imported here to co-locate the dependency.
import { badSlug, listSubmissions, deleteSubmission } from './opnform.js'

export const ALL_SECTIONS = [
  'news', 'events', 'registrations', 'sponsors', 'scorer_courses', 'mixed_turnier',
]

export const SECTION_COLLECTIONS = {
  news: ['news'],
  events: ['events'],
  registrations: ['registrations'],
  sponsors: ['sponsors'],
  scorer_courses: ['scorer_courses'],
  mixed_turnier: ['mixed_tournament_signups', 'participations', 'members'],
}

const MANAGER_ROLES = new Set(['superuser', 'administrator'])
const GATED_ROLE = 'website admin'

export function isManager(roleName) {
  return !!roleName && MANAGER_ROLES.has(String(roleName).toLowerCase())
}

export function normalizeSections(raw) {
  let arr = raw
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw) } catch { arr = [] }
  }
  if (!Array.isArray(arr)) return []
  return arr.filter((s) => ALL_SECTIONS.includes(s))
}

async function resolveRoleName(database, userId) {
  if (!userId) return null
  const row = await database('directus_users')
    .join('directus_roles', 'directus_users.role', 'directus_roles.id')
    .where('directus_users.id', userId)
    .select('directus_roles.name as role_name')
    .first()
  return row ? row.role_name : null
}

// { isSuperuser, sections } — fail-closed on anything ambiguous.
export async function computeAccess(database, userId) {
  const roleName = await resolveRoleName(database, userId)
  if (isManager(roleName)) return { isSuperuser: true, sections: ALL_SECTIONS }
  if (String(roleName || '').toLowerCase() !== GATED_ROLE) {
    return { isSuperuser: false, sections: [] }
  }
  const row = await database('website_admin_access')
    .where('user', userId)
    .select('sections')
    .first()
  return { isSuperuser: false, sections: normalizeSections(row ? row.sections : null) }
}

export function registerWadmin(router, ctx) {
  const { logger } = ctx
  const database = ctx.database
  const log = logger.child({ endpoint: 'wadmin' })

  router.get('/wadmin/me', async (req, res) => {
    const userId = req.accountability?.user
    if (!userId) return res.status(401).json({ error: 'unauthenticated' })
    try {
      res.json(await computeAccess(database, userId))
    } catch (e) {
      log.warn({ msg: 'wadmin/me failed', error: e.message })
      res.status(200).json({ isSuperuser: false, sections: [] }) // fail closed
    }
  })

  // Per-section item routes — Task A4.
  // Scorer-course OpnForm delegation — Task A5.
  // Management routes — Task A6.
}
