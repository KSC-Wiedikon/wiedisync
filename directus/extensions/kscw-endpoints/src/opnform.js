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
    properties: properties.map((p) => {
      // Choice lists for select/multi_select, so an admin correcting an answer
      // picks from the same options the participant saw instead of retyping one
      // by hand (a typo'd "Teilnahme" is a value the export cannot read back).
      // ⚠ Only the option NAMES are exposed — this is the form's own public
      // config, visible to anyone who opens the form, and deliberately not the
      // rest of the property (prefill, logic, validation) which nothing here
      // needs and which keeps the payload small.
      const choice = (p && p.type && p[p.type] && Array.isArray(p[p.type].options))
        ? p[p.type].options.map((o) => (o && o.name != null ? String(o.name) : String(o ?? ''))).filter(Boolean)
        : null
      return { id: p.id, name: p.name, type: p.type, ...(choice && choice.length ? { options: choice } : {}) }
    }),
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

/** Public form URL for a slug — the shape kscw-website's calendar CTA parses. */
export function formUrl(slug) {
  return `${OPNFORM_BASE}/forms/${slug}`
}

/**
 * Slugify a title into something CustomSlugRule accepts
 * (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, globally unique).
 *
 * Umlauts are transliterated BEFORE the NFD accent strip, so "Mixed Turnier Grün"
 * becomes `gruen` and not `grun` — the slug ends up in a URL club members read
 * and type, and the German spelling is the one they expect.
 */
export function slugifyTitle(s) {
  const out = String(s ?? '')
    .replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return out || 'event'
}

/**
 * OpnForm rejects a duplicate slug with a 422 that looks identical to every other
 * validation failure, so probe first rather than pattern-matching error text.
 * `/api/open/forms/:slug` resolves by slug (that is how getCloses works today).
 */
async function slugTaken(slug) {
  try {
    await opnformFetch(`/forms/${encodeURIComponent(slug)}`)
    return true
  } catch (err) {
    if (err.status === 404) return false
    throw err
  }
}

export async function findFreeSlug(base) {
  const root = slugifyTitle(base)
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`
    if (!(await slugTaken(candidate))) return candidate
  }
  const err = new Error(`No free OpnForm slug for "${root}" after 25 attempts`)
  err.status = 409
  throw err
}

/**
 * Duplicate the master signup template, then rename/reslug/schedule the copy.
 *
 * Two calls rather than one create, deliberately: the template is built and
 * maintained by hand in OpnForm's builder, so its field set, theme and branding
 * stay editable by a human without any deploy. We never author `properties`
 * ourselves — we copy whatever the template currently holds.
 *
 * ⚠ `duplicate` takes no body: it always produces "Copy of <title>" with a
 * generated slug, so the PUT is not optional. If that PUT fails we delete the
 * copy — a half-renamed "Copy of …" form left public would be worse than none.
 */
export async function createFormFromTemplate(templateId, { title, slug, closesAt = null }) {
  const dup = await opnformFetch(
    `/forms/${encodeURIComponent(templateId)}/duplicate`,
    { method: 'POST' },
  )
  const created = dup?.new_form || dup?.form || dup?.data || null
  if (!created?.id) {
    const err = new Error('OpnForm duplicate returned no form')
    err.status = 502
    throw err
  }

  try {
    const payload = {}
    // UpdateFormRequest marks the whole set required — round-trip the copy's own
    // values, then apply only what we actually mean to change.
    for (const k of FORM_REQUIRED_FIELDS) payload[k] = created[k]
    payload.title = String(title || created.title || 'Signup').slice(0, 60) // StoreFormRequest caps title at 60
    payload.slug = slug
    payload.visibility = 'public'
    payload.closes_at = closesAt
    await opnformFetch(`/forms/${created.id}`, { method: 'PUT', body: payload })
  } catch (err) {
    try {
      await opnformFetch(`/forms/${created.id}`, { method: 'DELETE' })
    } catch { /* best effort — the orphan is logged by the caller either way */ }
    throw err
  }

  const after = await getForm(String(created.id))
  const finalSlug = after?.slug ?? slug
  return {
    id: after?.id ?? created.id,
    slug: finalSlug,
    title: after?.title ?? title,
    closes_at: after?.closes_at ?? null,
    url: formUrl(finalSlug),
  }
}

/**
 * File a signup that never went through the form.
 *
 * OpnForm has **no admin route that creates a submission** — the only door is the
 * PUBLIC `POST /api/forms/{slug}/answer`, and that is precisely what makes the result a
 * real signup rather than a copy of one: the form's own validation runs, and its
 * notification integrations fire, so the participant gets the same confirmation mail as
 * everybody who signed up themselves. Two consequences follow, and both belong to the
 * caller:
 *
 *   1. the participant AND scorer@volleyball.kscw.ch are emailed — there is no quiet
 *      variant of this route;
 *   2. `FormPolicy::answer` refuses a CLOSED form outright, and a signup added by hand
 *      is almost always late. `reopenIfClosed` lifts `closes_at` for the length of one
 *      POST and restores it in a `finally` — the only way to file a late entry through
 *      a door OpnForm opens from the public side only.
 *
 * The reopen window is a live public form standing open for about a second. If the
 * restore itself fails the error says so in as many words (`form_left_open`) and is
 * logged at error level: a registration form left open is a thing a human must go and
 * close, not a warning to scroll past.
 */
const ANSWER_MAX_LEN = 2000
const ANSWER_MAX_ITEMS = 50

function answerError(message, status = 400, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}

/**
 * One answer, in the shape the form's own validator expects.
 *
 * Keys are checked against the form's field ids — an id the form does not have is
 * refused rather than written, so this route cannot be used to stuff arbitrary keys
 * into a submission document that /admin and the SVRZ export both read back.
 */
export function normalizeAnswer(prop, raw) {
  if (raw == null) return null
  if (Array.isArray(raw)) {
    if (raw.length > ANSWER_MAX_ITEMS) throw answerError(`too_many_values:${prop.id}`)
    const out = raw.map((v) => normalizeAnswer({ ...prop, type: 'text' }, v)).filter((v) => v !== null)
    return out.length ? out : null
  }
  if (typeof raw === 'object') throw answerError(`invalid_value:${prop.id}`)
  const s = String(raw).trim()
  if (!s) return null // an empty answer is no answer — let the form decide if it was required
  if (s.length > ANSWER_MAX_LEN) throw answerError(`value_too_long:${prop.id}`)
  // A number field validated as numeric but stored as "8003" reads back as a string in
  // every consumer of the submission; the form's own UI sends a number, so we do too.
  if (prop.type === 'number' && /^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  // multi_select holds a list even when only one option is picked — a bare string is
  // stored, then read back as a string, and the SVRZ export sees a different shape for
  // this signup than for every other one.
  if (prop.type === 'multi_select') return [s]
  return s
}

export async function createSubmission(slug, answers, { reopenIfClosed = false } = {}) {
  const meta = await getFormMeta(slug)
  const byId = new Map((meta.properties || []).map((p) => [String(p.id), p]))

  const payload = {}
  for (const [id, raw] of Object.entries(answers || {})) {
    const prop = byId.get(String(id))
    if (!prop) throw answerError(`unknown_field:${id}`)
    // submission_id in the payload makes `answer` UPDATE an existing submission
    // (editable_submissions is on for these forms) instead of creating one — which
    // would silently overwrite somebody else's signup.
    if (id === 'submission_id' || id === 'submission_hash') throw answerError(`unknown_field:${id}`)
    const v = normalizeAnswer(prop, raw)
    if (v !== null) payload[id] = v
  }
  if (!Object.keys(payload).length) throw answerError('empty_submission')

  const form = await getForm(slug)
  const closesAt = form?.closes_at ?? null
  const closed = form?.is_closed === true
  if (closed && !reopenIfClosed) {
    throw answerError('form_closed', 409, { closes_at: closesAt })
  }

  let reopened = false
  try {
    if (closed) {
      await setCloses(slug, null)
      reopened = true
    }
    const res = await fetch(`${OPNFORM_BASE}/api/forms/${encodeURIComponent(slug)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      const err = new Error(`OpnForm ${res.status} on /forms/${slug}/answer`)
      // 422 carries which answer the form refused, which is the whole difference
      // between "you left the Natel empty" and "we sent junk".
      err.status = [403, 404, 422].includes(res.status) ? res.status : 502
      err.detail = text.slice(0, 1000)
      throw err
    }
    countCache.delete(slug)
    let body = {}
    try { body = text ? JSON.parse(text) : {} } catch { body = {} }
    return { ok: true, submission_id: body?.submission_id ?? null, reopened }
  } finally {
    if (reopened) {
      // Not `await`ed away into a catch: a form left open is worse than a failed
      // signup, so the failure has to reach the caller.
      await setCloses(slug, closesAt).catch((e) => {
        throw answerError('form_left_open', 500, { slug, closes_at: closesAt, cause: e.message })
      })
    }
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
