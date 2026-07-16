/**
 * OpnForm proxy endpoints
 *   GET /kscw/opnform/forms/:slug/count        — public, cached, returns { count }
 *   GET /kscw/opnform/forms/:slug/submissions  — admin, returns { fields, data, total }
 *
 * OpnForm PAT is server-only (env OPNFORM_PAT). Slugs are non-secret (public URL).
 */

const OPNFORM_BASE = (process.env.OPNFORM_BASE_URL || 'https://forms.kscw.ch').replace(/\/$/, '')
const COUNT_CACHE_TTL_MS = 60_000
const FORM_META_CACHE_TTL_MS = 5 * 60_000

const countCache = new Map()  // slug → { value, expiresAt }
const formMetaCache = new Map() // slug → { properties, title, expiresAt }

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/i

export function badSlug(slug) {
  return !slug || !SLUG_RE.test(slug)
}

async function opnformFetch(path, { method = 'GET', body } = {}) {
  const token = process.env.OPNFORM_PAT || ''
  if (!token) {
    const err = new Error('OPNFORM_PAT not configured')
    err.status = 503
    throw err
  }
  const res = await fetch(`${OPNFORM_BASE}/api/open${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`OpnForm ${res.status} on ${path}`)
    // Pass through auth/not-found so callers can report something useful
    // instead of a misleading 502. 422 carries the validation detail, which is
    // the difference between "your date was rejected" and "we sent junk".
    err.status = [401, 403, 404, 422].includes(res.status) ? res.status : 502
    err.detail = text.slice(0, 500)
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

export async function getCount(slug) {
  const cached = countCache.get(slug)
  if (cached && cached.expiresAt > Date.now()) return { count: cached.value, cached: true }
  const json = await opnformFetch(`/forms/${encodeURIComponent(slug)}/submissions?per_page=1`)
  const total = Number(json?.meta?.total ?? 0) || 0
  countCache.set(slug, { value: total, expiresAt: Date.now() + COUNT_CACHE_TTL_MS })
  return { count: total, cached: false }
}

export async function listSubmissions(slug, { page = 1, perPage = 100 } = {}) {
  const pp = Math.min(100, Math.max(1, Number(perPage) || 100))
  const pg = Math.max(1, Number(page) || 1)
  const [submissionsJson, meta] = await Promise.all([
    opnformFetch(`/forms/${encodeURIComponent(slug)}/submissions?per_page=${pp}&page=${pg}`),
    getFormMeta(slug),
  ])
  const data = Array.isArray(submissionsJson?.data) ? submissionsJson.data : []
  const total = Number(submissionsJson?.meta?.total ?? data.length)
  const lastPage = Number(submissionsJson?.meta?.last_page ?? 1)
  return { title: meta.title, fields: meta.properties, data, total, page: pg, per_page: pp, last_page: lastPage }
}

// Fields UpdateFormRequest marks `required` — a PUT missing any of them is a 422.
// Everything else is `sometimes`/`nullable`, and Laravel writes only the keys
// present in validated(), so omitting them leaves the stored value untouched.
// Sending this minimal set instead of spreading the whole ~69-key GET response
// back keeps the write surface as small as the validator allows.
const FORM_REQUIRED_FIELDS = [
  'title', 'visibility', 'language', 'theme', 'presentation_style', 'width', 'size',
  'border_radius', 'dark_mode', 'color', 'uppercase_labels', 'no_branding',
  'transparent_background', 'properties',
]

async function getForm(slug) {
  const json = await opnformFetch(`/forms/${encodeURIComponent(slug)}`)
  return json?.data || json
}

/** The form's own deadline — what actually rejects a late submission. */
export async function getCloses(slug) {
  const form = await getForm(slug)
  return {
    slug,
    id: form?.id ?? null,
    closes_at: form?.closes_at ?? null,
    is_closed: form?.is_closed === true,
  }
}

/** Field-set fingerprint — what a bad write to a live form would destroy. */
function propsSignature(form) {
  return JSON.stringify((form?.properties || []).map((p) => [p.id, p.name, p.type]))
}

/**
 * Mirror a course's registration deadline onto the form's own closes_at.
 * `closesAt` is an ISO instant, or null to reopen.
 *
 * ⚠ `properties` (the form's actual question set) is `required` by
 * UpdateFormRequest, so it must be round-tripped on every write — which makes a
 * bad write capable of damaging a live registration form. Two things keep that
 * honest: we send back exactly what we read, and we re-read afterwards and throw
 * rather than report success if the field set moved.
 */
export async function setCloses(slug, closesAt) {
  const before = await getForm(slug)
  if (!before || !before.id) {
    const err = new Error(`OpnForm ${slug}: form has no id`)
    err.status = 502
    throw err
  }

  const payload = { closes_at: closesAt }
  for (const k of FORM_REQUIRED_FIELDS) payload[k] = before[k]
  await opnformFetch(`/forms/${before.id}`, { method: 'PUT', body: payload })

  const after = await getForm(slug)
  if (propsSignature(before) !== propsSignature(after)) {
    const err = new Error(`OpnForm ${slug}: field set changed during a closes_at write`)
    err.status = 500
    throw err
  }
  formMetaCache.delete(slug)
  return {
    slug,
    id: after.id,
    closes_at: after.closes_at ?? null,
    is_closed: after.is_closed === true,
  }
}

export async function deleteSubmission(slug, id) {
  await opnformFetch(
    `/forms/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
  countCache.delete(slug)
  return { ok: true }
}

export function registerOpnform(router, { logger }) {
  const log = logger.child({ endpoint: 'opnform' })

  // ── Public: submission count ────────────────────────────────────
  router.get('/opnform/forms/:slug/count', async (req, res) => {
    const { slug } = req.params
    if (badSlug(slug)) return res.status(400).json({ error: 'Invalid slug' })

    try {
      const r = await getCount(slug)
      res.json(r)
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
      const payload = await listSubmissions(slug, { page, perPage })
      res.json(payload)
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
      await deleteSubmission(slug, id)
      res.json({ ok: true })
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Submission not found' })
      if (err.status === 401 || err.status === 403) {
        log.warn({ msg: 'OpnForm delete unauthorized', slug, id, status: err.status })
        return res.status(403).json({ error: 'OpnForm rejected the delete — the OPNFORM_PAT likely lacks the forms-write ability' })
      }
      log.warn({ msg: 'OpnForm delete failed', slug, id, status: err.status, error: err.message })
      res.status(err.status || 502).json({ error: 'Upstream error' })
    }
  })
}
