/**
 * OpnForm proxy endpoints
 *   GET /kscw/opnform/forms/:slug/count        — public, cached, returns { count }
 *   GET /kscw/opnform/forms/:slug/submissions  — admin, returns { fields, data, total }
 *
 * OpnForm PAT is server-only (env OPNFORM_PAT). Slugs are non-secret (public URL).
 */

const OPNFORM_BASE = (process.env.OPNFORM_BASE_URL || 'https://forms.kscw.ch').replace(/\/$/, '')
const TOKEN = process.env.OPNFORM_PAT || ''
const COUNT_CACHE_TTL_MS = 60_000
const FORM_META_CACHE_TTL_MS = 5 * 60_000

const countCache = new Map()  // slug → { value, expiresAt }
const formMetaCache = new Map() // slug → { properties, title, expiresAt }

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/i

function badSlug(slug) {
  return !slug || !SLUG_RE.test(slug)
}

async function opnformFetch(path, { method = 'GET' } = {}) {
  if (!TOKEN) {
    const err = new Error('OPNFORM_PAT not configured')
    err.status = 503
    throw err
  }
  const res = await fetch(`${OPNFORM_BASE}/api/open${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const err = new Error(`OpnForm ${res.status} on ${path}`)
    err.status = res.status === 404 ? 404 : 502
    throw err
  }
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

async function getFormMeta(slug) {
  const cached = formMetaCache.get(slug)
  if (cached && cached.expiresAt > Date.now()) return cached
  const json = await opnformFetch(`/forms/${encodeURIComponent(slug)}`)
  const form = json?.data || json
  const properties = Array.isArray(form?.properties) ? form.properties : []
  const meta = {
    properties: properties.map((p) => ({
      id: p.id, name: p.name, type: p.type,
    })),
    title: form?.title || slug,
    expiresAt: Date.now() + FORM_META_CACHE_TTL_MS,
  }
  formMetaCache.set(slug, meta)
  return meta
}

export function registerOpnform(router, { logger }) {
  const log = logger.child({ endpoint: 'opnform' })

  // ── Public: submission count ────────────────────────────────────
  router.get('/opnform/forms/:slug/count', async (req, res) => {
    const { slug } = req.params
    if (badSlug(slug)) return res.status(400).json({ error: 'Invalid slug' })

    const cached = countCache.get(slug)
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ count: cached.value, cached: true })
    }
    try {
      const json = await opnformFetch(`/forms/${encodeURIComponent(slug)}/submissions?per_page=1`)
      const total = Number(json?.meta?.total ?? 0) || 0
      countCache.set(slug, { value: total, expiresAt: Date.now() + COUNT_CACHE_TTL_MS })
      res.json({ count: total, cached: false })
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Form not found' })
      log.warn({ msg: 'OpnForm count failed', slug, status: err.status, error: err.message })
      res.status(err.status || 502).json({ error: 'Upstream error' })
    }
  })

  // ── Admin: full submissions list ────────────────────────────────
  router.get('/opnform/forms/:slug/submissions', async (req, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const { slug } = req.params
    if (badSlug(slug)) return res.status(400).json({ error: 'Invalid slug' })

    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 100))
    const page = Math.max(1, Number(req.query.page) || 1)

    try {
      const [submissionsJson, meta] = await Promise.all([
        opnformFetch(`/forms/${encodeURIComponent(slug)}/submissions?per_page=${perPage}&page=${page}`),
        getFormMeta(slug),
      ])
      const data = Array.isArray(submissionsJson?.data) ? submissionsJson.data : []
      const total = Number(submissionsJson?.meta?.total ?? data.length)
      const lastPage = Number(submissionsJson?.meta?.last_page ?? 1)
      res.json({
        title: meta.title,
        fields: meta.properties,
        data,
        total,
        page,
        per_page: perPage,
        last_page: lastPage,
      })
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Form not found' })
      log.warn({ msg: 'OpnForm submissions failed', slug, status: err.status, error: err.message })
      res.status(err.status || 502).json({ error: 'Upstream error' })
    }
  })

  // ── Admin: delete a single submission ───────────────────────────
  router.delete('/opnform/forms/:slug/submissions/:id', async (req, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const { slug, id } = req.params
    if (badSlug(slug)) return res.status(400).json({ error: 'Invalid slug' })
    if (!/^[0-9]+$/.test(String(id))) {
      return res.status(400).json({ error: 'Invalid submission id' })
    }

    try {
      await opnformFetch(
        `/forms/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      countCache.delete(slug) // count is now stale
      res.json({ ok: true })
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Submission not found' })
      log.warn({ msg: 'OpnForm delete failed', slug, id, status: err.status, error: err.message })
      res.status(err.status || 502).json({ error: 'Upstream error' })
    }
  })
}
