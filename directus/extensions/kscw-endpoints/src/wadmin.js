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

// → { ok:true, isSuperuser } | { ok:false, status, error }
export async function authorize(database, userId, section) {
  if (!ALL_SECTIONS.includes(section)) {
    return { ok: false, status: 404, error: 'unknown_section' }
  }
  const { isSuperuser, sections } = await computeAccess(database, userId)
  if (isSuperuser) return { ok: true, isSuperuser: true }
  if (sections.includes(section)) return { ok: true, isSuperuser: false }
  return { ok: false, status: 403, error: 'section_not_granted' }
}

export function assertCollection(section, collection) {
  return (SECTION_COLLECTIONS[section] || []).includes(collection)
}

export function parseQuery(q) {
  const out = {}
  if (q && typeof q.filter === 'object' && q.filter !== null) out.filter = q.filter
  if (q?.fields !== undefined) {
    out.fields = Array.isArray(q.fields)
      ? q.fields
      : String(q.fields).split(',').map(s => s.trim()).filter(Boolean)
  }
  if (q?.sort !== undefined) {
    out.sort = Array.isArray(q.sort)
      ? q.sort
      : String(q.sort).split(',').map(s => s.trim()).filter(Boolean)
  }
  if (q?.limit !== undefined) out.limit = Number(q.limit)
  if (q?.offset !== undefined) out.offset = Number(q.offset)
  if (q?.page !== undefined) out.page = Number(q.page)
  if (typeof q?.search === 'string') out.search = q.search
  return out
}

export async function isManagerUser(database, userId) {
  if (!userId) return false
  const row = await database('directus_users')
    .join('directus_roles', 'directus_users.role', 'directus_roles.id')
    .where('directus_users.id', userId)
    .select('directus_roles.name as role_name')
    .first()
  return isManager(row ? row.role_name : null)
}

export function buildUpsert(userId, sections) {
  return {
    row: { user: userId, sections: JSON.stringify(normalizeSections(sections)) },
    conflict: 'user',
  }
}

export function registerWadmin(router, ctx) {
  const { logger } = ctx
  const database = ctx.database
  const log = logger.child({ endpoint: 'wadmin' })

  const { services, getSchema } = ctx
  const { ItemsService } = services

  async function svc(collection) {
    const schema = await getSchema()
    return new ItemsService(collection, { schema, knex: database, accountability: { admin: true } })
  }

  function sendErr(res, e) {
    const status = typeof e?.status === 'number' ? e.status : 500
    if (status === 403) return res.status(403).json({ error: 'forbidden' })
    if (status === 400) return res.status(400).json({ error: 'invalid_payload' })
    log.warn({ msg: 'wadmin items error', error: e?.message })
    return res.status(500).json({ error: 'internal' })
  }

  // Resolve+authorize+scope once; returns the collection or null
  // (response already sent on failure).
  async function guard(req, res) {
    const userId = req.accountability?.user
    if (!userId) { res.status(401).json({ error: 'unauthenticated' }); return null }
    const { section, collection } = req.params
    const a = await authorize(database, userId, section)
    if (!a.ok) { res.status(a.status).json({ error: a.error, section }); return null }
    if (!assertCollection(section, collection)) {
      res.status(403).json({ error: 'resource_out_of_scope', collection }); return null
    }
    return collection
  }

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

  router.get('/wadmin/:section/items/:collection', async (req, res) => {
    const c = await guard(req, res); if (!c) return
    try { res.json({ data: await (await svc(c)).readByQuery(parseQuery(req.query)) }) }
    catch (e) { sendErr(res, e) }
  })

  router.get('/wadmin/:section/items/:collection/:id', async (req, res) => {
    const c = await guard(req, res); if (!c) return
    try { res.json({ data: await (await svc(c)).readOne(req.params.id, parseQuery(req.query)) }) }
    catch (e) { sendErr(res, e) }
  })

  router.post('/wadmin/:section/items/:collection', async (req, res) => {
    const c = await guard(req, res); if (!c) return
    try {
      const id = await (await svc(c)).createOne(req.body)
      res.json({ data: { id } })
    } catch (e) { sendErr(res, e) }
  })

  router.patch('/wadmin/:section/items/:collection/:id', async (req, res) => {
    const c = await guard(req, res); if (!c) return
    try {
      await (await svc(c)).updateOne(req.params.id, req.body)
      res.json({ data: { id: req.params.id } })
    } catch (e) { sendErr(res, e) }
  })

  router.delete('/wadmin/:section/items/:collection/:id', async (req, res) => {
    const c = await guard(req, res); if (!c) return
    try {
      await (await svc(c)).deleteOne(req.params.id)
      res.json({ ok: true })
    } catch (e) { sendErr(res, e) }
  })

  async function guardScorer(req, res) {
    const userId = req.accountability?.user
    if (!userId) { res.status(401).json({ error: 'unauthenticated' }); return false }
    const a = await authorize(database, userId, 'scorer_courses')
    if (!a.ok) { res.status(a.status).json({ error: a.error, section: 'scorer_courses' }); return false }
    if (badSlug(req.params.slug)) { res.status(400).json({ error: 'Invalid slug' }); return false }
    return true
  }

  router.get('/wadmin/scorer_courses/opnform/forms/:slug/submissions', async (req, res) => {
    if (!(await guardScorer(req, res))) return
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 100))
    const page = Math.max(1, Number(req.query.page) || 1)
    try {
      res.json(await listSubmissions(req.params.slug, { page, perPage }))
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Form not found' })
      log.warn({ msg: 'wadmin opnform list failed', slug: req.params.slug, status: err.status })
      res.status(err.status || 502).json({ error: 'Upstream error' })
    }
  })

  router.delete('/wadmin/scorer_courses/opnform/forms/:slug/submissions/:id', async (req, res) => {
    if (!(await guardScorer(req, res))) return
    if (!/^[0-9]+$/.test(String(req.params.id))) {
      return res.status(400).json({ error: 'Invalid submission id' })
    }
    try {
      await deleteSubmission(req.params.slug, req.params.id)
      res.json({ ok: true })
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Submission not found' })
      if (err.status === 401 || err.status === 403) {
        log.warn({ msg: 'wadmin opnform delete unauthorized', slug: req.params.slug, id: req.params.id, status: err.status })
        return res.status(403).json({ error: 'OpnForm rejected the delete — the OPNFORM_PAT likely lacks the forms-write ability' })
      }
      log.warn({ msg: 'wadmin opnform delete failed', slug: req.params.slug, status: err.status })
      res.status(err.status || 502).json({ error: 'Upstream error' })
    }
  })

  router.get('/wadmin/admins', async (req, res) => {
    const userId = req.accountability?.user
    if (!(await isManagerUser(database, userId))) {
      return res.status(403).json({ error: 'manager_required' })
    }
    try {
      const rows = await database('directus_users')
        .join('directus_roles', 'directus_users.role', 'directus_roles.id')
        .leftJoin('website_admin_access', 'website_admin_access.user', 'directus_users.id')
        .whereRaw('LOWER(directus_roles.name) = ?', ['website admin'])
        .select(
          'directus_users.id as id',
          'directus_users.first_name as first_name',
          'directus_users.last_name as last_name',
          'directus_users.email as email',
          'website_admin_access.sections as sections',
        )
        .orderBy(['directus_users.first_name', 'directus_users.last_name'])
      res.json({
        data: rows.map((r) => ({
          id: r.id,
          name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email,
          email: r.email,
          sections: normalizeSections(r.sections),
        })),
      })
    } catch (e) {
      log.warn({ msg: 'wadmin/admins list failed', error: e.message })
      res.status(500).json({ error: 'internal' })
    }
  })

  router.put('/wadmin/admins/:id', async (req, res) => {
    const userId = req.accountability?.user
    if (!(await isManagerUser(database, userId))) {
      return res.status(403).json({ error: 'manager_required' })
    }
    const target = req.params.id
    const sections = Array.isArray(req.body?.sections) ? req.body.sections : []
    try {
      const { row, conflict } = buildUpsert(target, sections)
      await database('website_admin_access')
        .insert(row)
        .onConflict(conflict)
        .merge({ sections: row.sections, date_updated: database.fn.now() })
      res.json({ data: { id: target, sections: normalizeSections(sections) } })
    } catch (e) {
      log.warn({ msg: 'wadmin/admins upsert failed', error: e.message })
      res.status(500).json({ error: 'internal' })
    }
  })
}
