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
import { Transform } from 'node:stream'
import { badSlug, listSubmissions, deleteSubmission, getCloses, setCloses } from './opnform.js'
import { streamManagedFile, readManagedFile } from './storage-read.js'
// Cap and type allowlist are imported, never re-declared: an admin correction must be
// held to exactly what the participant upload accepts, and two copies would drift.
import { SCORER_AUSBILDUNG_EMAIL, SCORER_AUSBILDUNG_FROM, SCORER_EXAM_FOLDER, sniffType, EXT_FOR, UPLOAD_MAX_BYTES, zurichToday } from './scorer-exam.js'
import { buildEmailLayout, buildAlertBox, buildInfoCard, formatDateCH, escHtml } from './email-template.js'

export const ALL_SECTIONS = [
  'news', 'events', 'registrations', 'sponsors', 'scorer_courses', 'mixed_turnier',
  'site_text',
]

export const SECTION_COLLECTIONS = {
  news: ['news'],
  events: ['events'],
  registrations: ['registrations'],
  sponsors: ['sponsors'],
  // scorer_course_attendance holds admin-owned per-signup tracking (attendance,
  // exam, SV licence, notes) that OpnForm cannot store. All-scalar, so the
  // section-scoped-admin scalar guards apply. Not slug-bound like the OpnForm
  // routes: a scorer-scoped admin can read/write any attendance row, but those
  // rows carry only submission ids + booleans + a licence number they can
  // already see via the signups — acceptable for this low-sensitivity data.
  scorer_courses: ['scorer_courses', 'scorer_course_attendance'],
  // Only the signups collection itself. members/participations were removed:
  // the generic admin-accountability CRUD routes bypass RLS, so exposing them
  // here let a mixed_turnier-only Website Admin read/modify/delete any member
  // (full PII) or any participation club-wide (IDOR / privilege escalation).
  mixed_turnier: ['mixed_tournament_signups'],
  // site_text has NO entry on purpose, so the generic /items/:collection CRUD
  // refuses it (`resource_out_of_scope`). Its values are rendered as page text on
  // every visitor's browser, so each one has to pass the checks in site-text.js —
  // a generic PATCH would bypass them. The section still belongs in ALL_SECTIONS
  // above: that is what authorize() and the grant grid enumerate.
}

const MANAGER_ROLES = new Set(['superuser', 'administrator'])

/**
 * Roles ELIGIBLE to hold a website-admin section grant.
 *
 * Eligibility is not access: the grant row in `website_admin_access` is what
 * actually opens a section, and a user of an eligible role with no row still gets
 * nothing (`computeAccess` below). This set only decides who a superuser is
 * allowed to hand sections to.
 *
 * 'sport admin' was added 2026-08-11 because a Directus user has exactly one role:
 * the club's youth/sport administrators already hold `Sport Admin` for Wiedisync,
 * and the only alternatives were to strip that role — taking away the access they
 * do their actual job with — or to give one person a second login. Neither is worth
 * it for a per-user grant that is still explicit.
 */
const GATED_ROLES = new Set(['website admin', 'sport admin'])
const GATED_ROLE_LIST = [...GATED_ROLES]

/**
 * Fold a name to something two spellings of the same person agree on: case, accents,
 * punctuation and repeated spaces. "Léo" typed on a signup and "Leo" as ClubDesk holds it
 * are the same human; a match that misses them leaves a blank the export then fills with
 * a guessed town, which is the outcome this exists to avoid.
 *
 * NFD splits an accented char into base + combining mark, so the mark can be stripped —
 * ü→u, é→e — without a per-character table.
 */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Swiss postcodes are four digits and never start with 0 (1000–9999). A member record
 * carrying "0849" is a typo, not an address.
 */
export function plausiblePlz(v) {
  return /^[1-9]\d{3}$/.test(String(v ?? '').trim())
}

/**
 * A town, not a canton. "ZH" sits in at least one member record where a town should be;
 * two letters is never a Swiss municipality name, and a cantonal abbreviation on an SVRZ
 * list is a wrong answer wearing the clothes of a right one.
 */
export function plausibleOrt(v) {
  const s = String(v ?? '').trim()
  if (s.length < 3) return false
  return !/^(zh|be|lu|ur|sz|ow|nw|gl|zg|fr|so|bs|bl|sh|ar|ai|sg|gr|ag|tg|ti|vd|vs|ne|ge|ju)$/i.test(s)
}

/**
 * Build the exam-result mail (subject + html + text).
 *
 * Exported and pure — it takes plain values, touches no database and sends nothing — so
 * the wording can be unit-tested and previewed exactly as it will arrive. A preview that
 * re-implements the copy is a preview of the preview; this is the only copy.
 *
 * `hasAttachment` is a claim the CALLER has already made good on: the route resolves the
 * attachment bytes before calling this, so the sentence about a PDF in the mail cannot
 * promise a file that failed to load.
 */
export function buildExamResultMail({
  en = false, passed = false, note = '', firstName = '',
  courseDateIso = null, examDate = null, svLicense = null, hasAttachment = false,
} = {}) {
  const subject = passed
    ? (en ? 'Scorer exam passed — KSC Wiedikon' : 'Schreiber-Prüfung bestanden — KSC Wiedikon')
    // A fail does not announce itself in the subject line. The result is in the mail; it
    // does not also need to be in the notification on a phone on a tram.
    : (en ? 'Scorer exam — KSC Wiedikon' : 'Schreiber-Prüfung — KSC Wiedikon')
  const alert = passed
    ? buildAlertBox(
      'success',
      en ? 'Exam passed' : 'Prüfung bestanden',
      en
        ? 'Your scorer exam has been marked as passed. Congratulations!'
        : 'Deine Schreiber-Prüfung wurde als bestanden erfasst. Herzliche Gratulation!',
    )
    : buildAlertBox(
      'warning',
      en ? 'Exam not passed' : 'Prüfung nicht bestanden',
      en
        ? 'Your scorer exam has been recorded as not passed.'
        : 'Deine Schreiber-Prüfung wurde als nicht bestanden erfasst.',
    )
  const card = buildInfoCard([
    ...(courseDateIso ? [{ label: en ? 'Course' : 'Kurs', value: formatDateCH(courseDateIso), halfWidth: true }] : []),
    ...(examDate ? [{ label: en ? 'Exam date' : 'Prüfungsdatum', value: formatDateCH(examDate), halfWidth: true }] : []),
    // Licence number only on a pass: on a fail there is no licence coming, and printing
    // the number next to "not passed" reads like one is on its way.
    ...(passed && svLicense ? [{ label: en ? 'Licence no.' : 'Lizenznummer', value: String(svLicense) }] : []),
  ])
  // ⚠ Body paragraphs MUST carry an explicit colour. buildEmailLayout renders on a dark
  // navy card and sets no inherited text colour, so a bare <p> falls back to the client's
  // default — near-black on navy, i.e. invisible. The exam-passed mail shipped in 1.11.0
  // with exactly that bug and its SVRZ paragraph was unreadable; caught by rendering the
  // template rather than by reading it. Matches buildBroadcastEmail's body style.
  const P = 'font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px'
  // Escape first, then newlines → <br>, paragraphs split on blank lines — the same
  // treatment buildBroadcastEmail gives an admin-written message body.
  const noteHtml = note
    ? `<p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;font-weight:700">${
      en ? 'Note from KSC Wiedikon' : 'Anmerkung von KSC Wiedikon'
    }</p>` + escHtml(note).split(/\n{2,}/)
      .map((p) => `<p style="${P}">${p.replace(/\n/g, '<br>')}</p>`).join('')
    : ''
  const attachHtml = hasAttachment
    ? `<p style="${P}">${
      en
        ? 'Your corrected scoresheet is attached as a PDF.'
        : 'Dein korrigiertes Spielblatt findest du als PDF im Anhang.'
    }</p>`
    : ''
  // A pass says where the licence comes from next. A fail deliberately says nothing
  // further: what happens next is a conversation, not a form letter — the note is where
  // that goes when there is something to say.
  const body = (passed
    ? `<p style="${P}">${
      en
        ? 'We have forwarded your details to the SVRZ. They issue the scorer licence — you will hear from them directly.'
        : 'Wir haben deine Angaben an den SVRZ weitergeleitet. Die Schreiberlizenz wird von dort ausgestellt — du hörst direkt von ihnen.'
    }</p>`
    : '') + attachHtml + noteHtml
  const html = buildEmailLayout(alert + card + body, {
    sport: 'vb',
    title: passed
      ? (en ? 'Scorer exam passed' : 'Schreiber-Prüfung bestanden')
      : (en ? 'Scorer exam not passed' : 'Schreiber-Prüfung nicht bestanden'),
    greeting: firstName ? (en ? `Hi ${firstName},` : `Hallo ${firstName},`) : undefined,
  })
  const attachText = hasAttachment
    ? (en ? '\n\nYour corrected scoresheet is attached as a PDF.'
      : '\n\nDein korrigiertes Spielblatt findest du als PDF im Anhang.')
    : ''
  const noteText = note ? `\n\n${en ? 'Note from KSC Wiedikon' : 'Anmerkung von KSC Wiedikon'}:\n${note}` : ''
  const text = (passed
    ? (en
      ? 'Your scorer exam has been marked as passed. Congratulations!\n\nWe have forwarded your details to the SVRZ, who issue the licence.'
      : 'Deine Schreiber-Prüfung wurde als bestanden erfasst. Herzliche Gratulation!\n\nWir haben deine Angaben an den SVRZ weitergeleitet — die Lizenz wird von dort ausgestellt.')
    : (en
      ? 'Your scorer exam has been recorded as not passed.'
      : 'Deine Schreiber-Prüfung wurde als nicht bestanden erfasst.')
  ) + attachText + noteText + '\n\nKSC Wiedikon'

  return { subject, html, text }
}

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
  if (!GATED_ROLES.has(String(roleName || '').toLowerCase())) {
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

// Audit 2026-07-02 (#4, HIGH): the item routes run readByQuery on an
// ItemsService built with `accountability: { admin: true }` (RLS-bypass) and
// `assertCollection` only validates the TOP-LEVEL collection. A section-scoped
// (non-superuser) Website Admin could therefore deep-expand a granted section
// into member PII, e.g. `?fields=invited_members.members_id.email,...ahv_nummer`
// on `events`, exfiltrating the whole member directory. Relational traversal is
// never used by the admin UI for these sections (it passes flat scalar fields,
// or none), so for non-superuser callers we reject any relational `fields` /
// `sort` / `filter`. Managers (superuser) keep full flexibility — they can read
// members via their own role regardless.
// Scalar comparison operators Directus applies directly to a field's own column.
// Anything else on a field (a nested field key, a relational op like _some/_none,
// or an _and/_or group) means the filter walks a relation — which we must reject
// for section-scoped admins (the ItemsService bypasses RLS). Allowlist, not a
// `_`-prefix heuristic: `_some`/`_none`/`_and`/`_or` are `_`-prefixed too and were
// the bypass in the first version of this guard (2026-07-03 review).
const SCALAR_FILTER_OPS = new Set([
  '_eq', '_neq', '_lt', '_lte', '_gt', '_gte', '_in', '_nin',
  '_null', '_nnull', '_contains', '_ncontains', '_icontains',
  '_starts_with', '_nstarts_with', '_istarts_with', '_ends_with', '_nends_with', '_iends_with',
  '_between', '_nbetween', '_empty', '_nempty', '_regex',
])
function filterHasRelational(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false
  for (const [k, v] of Object.entries(node)) {
    if (k === '_and' || k === '_or') {
      // Top-level logical grouping of scalar filters is fine — recurse each arm.
      const arr = Array.isArray(v) ? v : []
      if (arr.some((sub) => filterHasRelational(sub))) return true
      continue
    }
    if (k.startsWith('_')) continue // stray top-level operator — nothing to walk
    // k is a field key. Its value MUST be an object whose keys are ALL scalar
    // operators; any other key (nested field, _some/_none, _and/_or, unknown op)
    // is a relation walk → reject.
    if (!v || typeof v !== 'object' || Array.isArray(v)) return true
    for (const opKey of Object.keys(v)) {
      if (!SCALAR_FILTER_OPS.has(opKey)) return true
    }
  }
  return false
}

export function assertScalarQuery(query) {
  const reject = (msg) => { const e = new Error(msg); e.status = 400; throw e }
  if (Array.isArray(query.fields)) {
    if (query.fields.some((f) => typeof f === 'string' && f.includes('.'))) {
      reject('relational fields are not allowed for a section-scoped admin')
    }
  }
  if (Array.isArray(query.sort)) {
    if (query.sort.some((s) => typeof s === 'string' && s.replace(/^-/, '').includes('.'))) {
      reject('relational sort is not allowed for a section-scoped admin')
    }
  }
  if (query.filter && filterHasRelational(query.filter)) {
    reject('relational filter is not allowed for a section-scoped admin')
  }
  return query
}

// Audit 2026-07-03 (#1, HIGH): the read routes are now scalar-only for
// section-scoped admins, but the POST (createOne) and PATCH (updateOne) routes
// forward `req.body` VERBATIM to the RLS-bypassing admin ItemsService. A
// section-scoped (non-superuser) Website Admin granted only e.g. `events` could
// smuggle a nested relational write — e.g. PATCH events with
//   { invited_members: { create: [{ members_id: { id: 8, email: 'x', role: ['superuser'] } }] } }
// — to create/overwrite arbitrary members (full PII) or escalate roles across
// collections they were never granted. The admin UI only ever writes flat scalar
// fields for these sections, so for non-superuser callers we reject any
// relational write: a top-level value that is a non-null object, or an array
// containing an object (i.e. nested create/update/PK-object payloads). Scalars,
// null, and arrays of scalars (e.g. an in-scope M2M PK list) are allowed.
// Managers (superuser) keep the raw body.
export function assertScalarBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const reject = (field) => {
    const e = new Error(`relational write on '${field}' is not allowed for a section-scoped admin`)
    e.status = 400
    throw e
  }
  for (const [k, v] of Object.entries(body)) {
    if (v === null) continue
    if (Array.isArray(v)) {
      if (v.some((el) => el !== null && typeof el === 'object')) reject(k)
      continue
    }
    if (typeof v === 'object') reject(k)
  }
  return body
}

export async function isManagerUser(database, userId) {
  return isManager(await resolveRoleName(database, userId))
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

  // Audit 2026-07-03 (#7, MED): `accountability: { admin: true }` bypasses RLS
  // but records NO actor, so wadmin create/update/delete (incl. registration-PII
  // deletion + grant changes) leave no trace in directus_activity / revisions.
  // Thread the caller's user id into the accountability — `admin: true` still
  // bypasses RLS, and the user is now captured for the audit trail. Reads may
  // omit it (userId undefined) since they mutate nothing.
  async function svc(collection, userId) {
    const schema = await getSchema()
    const accountability = { admin: true }
    if (userId) accountability.user = userId
    return new ItemsService(collection, { schema, knex: database, accountability })
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
    // #4: remember whether this caller is a full manager. Section-scoped
    // (non-superuser) callers may not use relational query traversal (see
    // assertScalarQuery) against the RLS-bypassing admin ItemsService.
    req.wadminSuper = a.isSuperuser === true
    return collection
  }

  // Read query for GET routes: unrestricted for managers, scalar-only for
  // section-scoped admins (blocks the #4 PII-exfil via relational `fields`).
  function readQuery(req) {
    const q = parseQuery(req.query)
    return req.wadminSuper ? q : assertScalarQuery(q)
  }

  // Write body for POST/PATCH: raw for managers, scalar-only (no relational
  // create/update) for section-scoped admins (blocks the #1 cross-collection
  // PII-write / role-escalation via a nested relational payload).
  function writeBody(req) {
    return req.wadminSuper ? req.body : assertScalarBody(req.body)
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
    try { res.json({ data: await (await svc(c)).readByQuery(readQuery(req)) }) }
    catch (e) { sendErr(res, e) }
  })

  router.get('/wadmin/:section/items/:collection/:id', async (req, res) => {
    const c = await guard(req, res); if (!c) return
    try { res.json({ data: await (await svc(c)).readOne(req.params.id, readQuery(req)) }) }
    catch (e) { sendErr(res, e) }
  })

  router.post('/wadmin/:section/items/:collection', async (req, res) => {
    const c = await guard(req, res); if (!c) return
    try {
      const id = await (await svc(c, req.accountability.user)).createOne(writeBody(req))
      res.json({ data: { id } })
    } catch (e) { sendErr(res, e) }
  })

  router.patch('/wadmin/:section/items/:collection/:id', async (req, res) => {
    const c = await guard(req, res); if (!c) return
    try {
      await (await svc(c, req.accountability.user)).updateOne(req.params.id, writeBody(req))
      res.json({ data: { id: req.params.id } })
    } catch (e) { sendErr(res, e) }
  })

  router.delete('/wadmin/:section/items/:collection/:id', async (req, res) => {
    const c = await guard(req, res); if (!c) return
    try {
      await (await svc(c, req.accountability.user)).deleteOne(req.params.id)
      res.json({ ok: true })
    } catch (e) { sendErr(res, e) }
  })

  async function guardScorer(req, res) {
    const userId = req.accountability?.user
    if (!userId) { res.status(401).json({ error: 'unauthenticated' }); return false }
    const a = await authorize(database, userId, 'scorer_courses')
    if (!a.ok) { res.status(a.status).json({ error: a.error, section: 'scorer_courses' }); return false }
    if (badSlug(req.params.slug)) { res.status(400).json({ error: 'Invalid slug' }); return false }
    // Audit 2026-07-03 (#2, HIGH): authorize() only confirms the caller holds the
    // scorer_courses grant — it does NOT bind the slug to a scorer_courses record.
    // listSubmissions/deleteSubmission hit forms.kscw.ch with a club-wide OpnForm
    // PAT, so a scorer-scoped admin could read/DELETE submissions of ANY OpnForm
    // form by passing an arbitrary slug. For non-superuser callers, restrict to the
    // slugs actually configured on scorer_courses rows. Managers keep open access.
    if (a.isSuperuser !== true) {
      const rows = await database('scorer_courses').select('form_slug_de', 'form_slug_en')
      const allowed = new Set()
      for (const r of rows) {
        if (r.form_slug_de) allowed.add(String(r.form_slug_de))
        if (r.form_slug_en) allowed.add(String(r.form_slug_en))
      }
      if (!allowed.has(String(req.params.slug))) {
        res.status(403).json({ error: 'form_out_of_scope', slug: req.params.slug }); return false
      }
    }
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

  // ── registration deadline (OpnForm closes_at) ──────────────────────────────
  //
  // scorer_courses.registration_closes is the source of truth and drives the public
  // card's lock; that lock is cosmetic, so /admin mirrors it here onto the form's own
  // closes_at, which is what actually rejects a late submission. GET exists so /admin
  // can show drift when someone has edited the deadline in OpnForm directly, rather
  // than silently racing two writers.
  router.get('/wadmin/scorer_courses/opnform/forms/:slug/closes', async (req, res) => {
    if (!(await guardScorer(req, res))) return
    try {
      res.json(await getCloses(req.params.slug))
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Form not found' })
      log.warn({ msg: 'wadmin opnform closes read failed', slug: req.params.slug, status: err.status })
      res.status(err.status || 502).json({ error: 'Upstream error' })
    }
  })

  // PATCH, not PUT — for the reason already documented on /wadmin/admins/:id below:
  // Directus answers a preflight with `Access-Control-Allow-Methods:
  // GET,POST,PATCH,DELETE`, so a cross-origin PUT from /admin on kscw.ch never left
  // the browser. This route WAS a PUT, and because pushClosesToForms() is written to
  // degrade quietly (a failed push warns on an already-saved course rather than
  // failing the save), the deadline silently never reached OpnForm — the public card
  // locked on `registration_closes` while the form itself kept accepting entries.
  router.patch('/wadmin/scorer_courses/opnform/forms/:slug/closes', async (req, res) => {
    if (!(await guardScorer(req, res))) return
    const raw = req.body?.closes_at
    // null = reopen. Anything else must be a real instant: a bad string here would
    // otherwise reach OpnForm and could close a form at an unintended moment.
    let closesAt = null
    if (raw != null && raw !== '') {
      const t = Date.parse(String(raw))
      if (!Number.isFinite(t)) return res.status(400).json({ error: 'invalid_closes_at' })
      closesAt = new Date(t).toISOString()
    }
    try {
      const out = await setCloses(req.params.slug, closesAt)
      log.info({ msg: 'opnform closes_at updated', slug: req.params.slug, closes_at: closesAt, user: req.accountability?.user })
      res.json(out)
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Form not found' })
      if (err.status === 401 || err.status === 403) {
        return res.status(403).json({ error: 'OpnForm rejected the update — the OPNFORM_PAT likely lacks the forms-write ability' })
      }
      if (err.status === 422) {
        log.warn({ msg: 'opnform closes_at rejected', slug: req.params.slug, detail: err.detail })
        return res.status(422).json({ error: 'OpnForm rejected the form payload', detail: err.detail })
      }
      // Includes the post-write verification failure — loud on purpose: it means a
      // live registration form may have been altered beyond its closes_at.
      log.error({ msg: 'wadmin opnform closes write failed', slug: req.params.slug, status: err.status, error: err.message })
      res.status(err.status || 502).json({ error: err.message || 'Upstream error' })
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

  // ── postcode/town lookup for the SVRZ Teilnehmerliste ──────────────────────
  //
  // OpnForm's Adresse is one free-text box, and most people read "Adresse" as "street":
  // 16 of 25 signups carry no postcode or town, which the SVRZ list requires. Members are
  // ClubDesk-synced and DO have both, so this fills the gap from what the club already
  // knows rather than from a guess. (Guessing "Zürich" would be wrong about 30% of the
  // time — only 485 of 691 members with an Ort live there.)
  //
  // ⚠ Deliberately narrow, because /admin cannot read `members` and must not start to
  // (SECTION_COLLECTIONS excludes it: the generic CRUD bypasses RLS, so member access
  // there would be full PII + IDOR). Two limits keep this from becoming that:
  //   - it returns ONLY plz + ort. No street, no email, no birthdate, no id.
  //   - it only ever matches names ALREADY ON the caller's own signup list, so it cannot
  //     be used to enumerate members or to probe for an arbitrary person.
  // A scorer-scoped admin can already see these people's addresses on the signup itself;
  // this adds the postcode for a name they are holding, and nothing else.
  router.get('/wadmin/scorer_courses/opnform/forms/:slug/member-addresses', async (req, res) => {
    if (!(await guardScorer(req, res))) return
    try {
      const listing = await listSubmissions(req.params.slug, { page: 1, perPage: 100 })
      const fields = listing.fields || []
      const idsOf = (re) => fields.filter((f) => re.test(String(f.name || ''))).map((f) => f.id)
      const firstIds = idsOf(/vorname|first\s*name/i)
      const lastIds = idsOf(/nachname|last\s*name/i)

      // Fold case, accents and punctuation: "Léo" on a signup and "Leo" in ClubDesk are
      // the same person, and a list that misses them is a list that invents a town instead.
      const key = (f, l) => `${norm(f)}|${norm(l)}`
      const rows = await database('members').select('first_name', 'last_name', 'plz', 'ort')
      const byName = new Map()
      for (const m of rows) {
        // ClubDesk is human-entered and some of it is junk: one member carries postcode
        // "0849" with the town "ZH" — a canton abbreviation, not a town, and not a Swiss
        // postcode either (they are four digits, 1000–9999). Forwarding that onto an
        // official SVRZ list is worse than leaving the cell blank, because it looks like
        // an answer. Implausible values are dropped here so they cannot reach the export.
        const plz = plausiblePlz(m.plz) ? String(m.plz).trim() : ''
        const ort = plausibleOrt(m.ort) ? String(m.ort).trim() : ''
        if (!ort && !plz) continue
        // First writer wins: two members sharing a name cannot be told apart from a
        // signup, so the ambiguous ones are dropped below rather than guessed at.
        const k = key(m.first_name, m.last_name)
        if (byName.has(k)) byName.set(k, null) // ambiguous → refuse to answer
        else byName.set(k, { plz, ort })
      }

      const out = {}
      for (const row of listing.data || []) {
        const answers = (row && row.data) || row || {}
        const pick = (ids) => { for (const i of ids) { const v = answers[i]; if (v != null && v !== '') return String(v) } return '' }
        const hit = byName.get(key(pick(firstIds), pick(lastIds)))
        if (hit) out[String(row.id)] = hit
      }
      res.json({ data: out })
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Form not found' })
      log.warn({ msg: `member-addresses lookup failed: ${err.message}` })
      res.status(500).json({ error: 'internal' })
    }
  })

  // ── current SV licence lookup ──────────────────────────────────────────────
  //
  // The signup table's SV-licence box renders `attendance.sv_license || <the form
  // answer>` — so it shows whatever the participant typed at signup until a staff
  // member overtypes it, and NEVER consults the member register. Licences the club
  // corrects in wiedisync are therefore invisible here: on 2026-08-20, 20 of 49
  // signups still displayed raw form input, and Paula Fiorella Farina's box read
  // "0000000" (her own "not licensed yet") while member #729 had held 339816 for
  // days. This route is what lets the box know.
  //
  // ⚠ Same narrow contract as member-addresses above, for the same reason: /admin
  // cannot read `members` and must not start to. It returns ONLY the licence number
  // and the member id, only for names ALREADY ON the caller's own signup list — so
  // it cannot enumerate members or probe for an arbitrary person. No email, no
  // birthdate, no address.
  //
  // ⚠ Surnames are matched as written AND with a parenthesised maiden name both
  // stripped and used on its own: member #202 is stored "Duc (Fölmli)" and signed
  // up as "Daniela Duc", which exact matching silently missed — the failure mode
  // being a blank rather than an error, i.e. invisible.
  router.get('/wadmin/scorer_courses/opnform/forms/:slug/member-licences', async (req, res) => {
    if (!(await guardScorer(req, res))) return
    try {
      const listing = await listSubmissions(req.params.slug, { page: 1, perPage: 100 })
      const fields = listing.fields || []
      const idsOf = (re) => fields.filter((f) => re.test(String(f.name || ''))).map((f) => f.id)
      const firstIds = idsOf(/vorname|first\s*name/i)
      const lastIds = idsOf(/nachname|last\s*name/i)

      const rows = await database('members').select('id', 'first_name', 'last_name', 'license_nr')
      const byName = new Map()
      const put = (k, v) => { if (byName.has(k)) byName.set(k, null); else byName.set(k, v) }
      for (const m of rows) {
        const raw = String(m.last_name || '')
        const inner = (raw.match(/\((.*?)\)/) || [])[1] || ''
        for (const variant of new Set([norm(raw), norm(raw.replace(/\(.*?\)/g, '')), norm(inner)])) {
          if (!variant) continue
          put(`${norm(m.first_name)}|${variant}`, m)
        }
      }

      const out = {}
      for (const row of listing.data || []) {
        const answers = (row && row.data) || row || {}
        const pick = (ids) => { for (const i of ids) { const v = answers[i]; if (v != null && v !== '') return String(v) } return '' }
        const hit = byName.get(`${norm(pick(firstIds))}|${norm(pick(lastIds))}`)
        // A member with no licence on file still answers, with licence null — the
        // page needs to tell "we know them and they have none" apart from "we do
        // not know who this is", and only the first of those is safe to act on.
        if (hit) out[String(row.id)] = { member_id: hit.id, licence: hit.license_nr || null }
      }
      res.json({ data: out })
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Form not found' })
      log.warn({ msg: `member-licences lookup failed: ${err.message}` })
      res.status(500).json({ error: 'internal' })
    }
  })

  // ── exam scoresheets ───────────────────────────────────────────────────────
  //
  // Participants upload these themselves (scorer-exam.js). They are personal data and
  // therefore live in a private folder, which puts them out of reach of /assets — so the
  // admin table reads them here instead.
  //
  // ⚠ The file id arrives from the client, so holding the scorer_courses grant must NOT
  // become "read any file in Directus" (that would reach registration ID scans and expense
  // receipts). Two independent conditions, both required: the id must be REFERENCED by a
  // scorer_course_attendance exam-sheet column, and the row must sit in SCORER_EXAM_FOLDER.
  // The folder check alone would be enough today, but the reference check is what keeps
  // this honest if someone ever points another feature at the same folder.
  //
  // Both columns count: exam_file is the participant's sheet, exam_file_corrected the
  // admin's correction. Matching only exam_file would 404 every correction — the same
  // guard, applied to the wrong half of the pair.
  router.get('/wadmin/scorer_courses/assets/:id', async (req, res) => {
    const userId = req.accountability?.user
    if (!userId) return res.status(401).json({ error: 'unauthenticated' })
    const a = await authorize(database, userId, 'scorer_courses')
    if (!a.ok) return res.status(a.status).json({ error: a.error, section: 'scorer_courses' })

    const id = String(req.params.id || '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'invalid_id' })

    try {
      const att = await database('scorer_course_attendance')
        .where('exam_file', id).orWhere('exam_file_corrected', id)
        .first('sub_key')
      if (!att) return res.status(404).json({ error: 'not_found' })
      const file = await database('directus_files').where('id', id)
        .first('id', 'folder', 'filename_download', 'type')
      if (!file || String(file.folder) !== SCORER_EXAM_FOLDER) {
        log.warn({ msg: 'scoresheet read refused — file outside the exam folder', file: id, user: userId })
        return res.status(404).json({ error: 'not_found' })
      }
      await streamManagedFile(id, { services, getSchema, database }, res, {
        filename: file.filename_download || 'matchblatt',
        type: file.type || 'application/octet-stream',
      })
    } catch (e) {
      log.warn({ msg: 'wadmin scoresheet read failed', file: id, error: e.message })
      if (!res.headersSent) res.status(500).json({ error: 'internal' })
    }
  })

  // ── admin uploads a scoresheet ─────────────────────────────────────────────
  //
  // Two slots, chosen by ?slot=:
  //
  //   corrected (default) — an admin's correction. Writes exam_file_corrected and NEVER
  //     exam_file: the participant's own sheet is what they submitted and stays exactly as
  //     they left it. The correction is a second, separate claim that outranks it in the
  //     SVRZ zip. Attribution (exam_file_corrected_by) is resolved HERE from the session
  //     user and is not accepted from the request — a name the client could choose would
  //     be decoration, not a record of who did it.
  //
  //   original — the sheet ITSELF, for when it reached us by email or on paper rather than
  //     through the upload page. Writes exam_file, and only while that slot is EMPTY: an
  //     admin must not be able to quietly replace what a participant submitted. To change
  //     a sheet that already exists, upload a correction — that leaves both, and says who.
  //     Deliberately unattributed, matching what the participant route records.
  //
  // Body is the raw bytes (application/octet-stream), same as the participant route —
  // multipart would buy nothing but a parser.
  //
  // Registered at both paths: /scoresheet is the honest name now that it is not
  // corrections-only, and /scoresheet-correction is kept so a deployed website calling the
  // old path keeps working across the deploy window. Drop the alias once prod is on the
  // new one.
  router.post([
    '/wadmin/scorer_courses/scoresheet/:slug/:id',
    '/wadmin/scorer_courses/scoresheet-correction/:slug/:id',
  ], async (req, res) => {
    if (!(await guardScorer(req, res))) return
    const subId = String(req.params.id || '')
    if (!/^[0-9]+$/.test(subId)) return res.status(400).json({ error: 'Invalid submission id' })
    const subKey = `${req.params.slug}:${subId}`
    const slot = String(req.query?.slot || 'corrected')
    if (slot !== 'original' && slot !== 'corrected') return res.status(400).json({ error: 'invalid_slot' })

    try {
      const who = await database('directus_users').where('id', req.accountability.user)
        .first('first_name', 'last_name', 'email')
      const byName = [who?.first_name, who?.last_name].filter(Boolean).join(' ') || who?.email || 'Unbekannt'

      const prev = await database('scorer_course_attendance').where('sub_key', subKey)
        .first('id', 'exam_file', 'exam_file_corrected')

      // Refused rather than silently rerouted to the correction slot: the caller asked to
      // write the participant's sheet, and there already is one. Saying so is the only way
      // an admin learns they were about to overwrite a submission.
      if (slot === 'original' && prev?.exam_file) return res.status(409).json({ error: 'original_exists' })

      // Everything that awaits happens BEFORE the pipe starts — see the participant
      // route: an async gap between req.pipe() and the consumer is exactly when an early
      // stream error has nobody listening.
      const { FilesService } = services
      const schema = await getSchema()
      const filesService = new FilesService({ schema, knex: database })
      const storage = (process.env.STORAGE_LOCATIONS || 'local').split(',')[0].trim()

      // ⚠ The byte counter MUST live inside the pipeline, not on a req.on('data')
      // listener — that switches the stream to flowing mode and drops chunks emitted
      // before FilesService attaches its pipe. (It truncated 36 registration documents
      // in July; see identity-document.js.)
      let bytes = 0
      let head = Buffer.alloc(0)
      let sniffed = null
      const capped = new Transform({
        transform(chunk, _enc, cb) {
          bytes += chunk.length
          if (bytes > UPLOAD_MAX_BYTES) { cb(Object.assign(new Error('too_large'), { status: 413 })); return }
          if (!sniffed) {
            head = head.length ? Buffer.concat([head, chunk]) : chunk
            if (head.length >= 12) {
              sniffed = sniffType(head)
              if (!sniffed) { cb(Object.assign(new Error('unsupported_type'), { status: 415 })); return }
            }
          }
          cb(null, chunk)
        },
        flush(cb) {
          if (!sniffed) { cb(Object.assign(new Error('unsupported_type'), { status: 415 })); return }
          cb()
        },
      })

      // ⚠⚠ NOT OPTIONAL — a stream that emits 'error' with no 'error' listener is an
      // UNCAUGHT EXCEPTION in Node: it kills the Directus process, PM2 restarts the
      // worker, and every in-flight request across the API 502s. This route rejects on
      // the FIRST chunk (bad magic bytes), so the error fires before FilesService has
      // attached its own handler. Same shape, same reason, as scorer-exam.js.
      let streamError = null
      capped.on('error', (err) => { streamError = err })
      req.on('error', (err) => capped.destroy(err))
      req.pipe(capped)

      const stem = slot === 'original' ? `matchblatt-${subId}` : `matchblatt-korrigiert-${subId}`
      let fileId
      try {
        fileId = await filesService.uploadOne(capped, {
          storage,
          // Provisional — `sniffed` is still null here; corrected below once bytes flowed.
          filename_download: stem,
          type: 'application/octet-stream',
          folder: SCORER_EXAM_FOLDER, // ⚠ never null — folder=null is publicly readable
          title: slot === 'original' ? `Matchblatt ${subKey}` : `Matchblatt (korrigiert) ${subKey}`,
        })
      } catch (err) {
        throw streamError || err
      }
      if (streamError) throw streamError

      // ⚠ The real type is only known AFTER the bytes have flowed — the options object
      // above was built before the Transform saw a chunk. Without this the file is stored
      // as octet-stream and the browser refuses to preview it.
      await database('directus_files').where('id', fileId).update({
        type: sniffed,
        filename_download: `${stem}.${EXT_FOR[sniffed] || 'bin'}`,
      })

      const patch = slot === 'original'
        // exam_date is the upload date, matching the participant route: it is what the
        // SVRZ Teilnehmerliste prints as Prüfungsdatum, and an admin can correct it.
        ? { exam_file: fileId, exam_date: zurichToday() }
        : {
          exam_file_corrected: fileId,
          exam_file_corrected_by: byName,
          exam_file_corrected_on: new Date(),
        }
      if (prev) {
        await database('scorer_course_attendance').where('id', prev.id).update(patch)
      } else {
        // The menu only offers a correction once a sheet exists, so this row should
        // already be here. Insert rather than 404 anyway: refusing to store bytes we have
        // already accepted would lose them for a row we can perfectly well create.
        await database('scorer_course_attendance').insert({
          sub_key: subKey, form_slug: req.params.slug, submission_id: subId, ...patch,
        })
      }

      // Replacing a correction drops the superseded bytes rather than orphaning them.
      // Best-effort: the new file is already linked, so a failure costs disk, not
      // correctness. Note this never touches exam_file — the participant's sheet stays.
      if (prev?.exam_file_corrected && prev.exam_file_corrected !== fileId) {
        try { await filesService.deleteOne(prev.exam_file_corrected) } catch (e) {
          log.warn({ msg: 'could not delete superseded correction', file: prev.exam_file_corrected, error: e.message })
        }
      }

      log.info({ msg: 'scoresheet uploaded by admin', slot, sub_key: subKey, bytes, type: sniffed, by: byName })
      // `id` so the caller can offer "open it" without a refetch; `by`/`on` so the
      // attribution it shows is the one that was stored, not one the client guessed.
      res.json({
        data: {
          ok: true,
          slot,
          id: fileId,
          by: patch.exam_file_corrected_by || null,
          on: patch.exam_file_corrected_on || null,
          exam_date: patch.exam_date || null,
          replaced: slot === 'corrected' && !!prev?.exam_file_corrected,
        },
      })
    } catch (err) {
      const status = err.status === 413 ? 413 : err.status === 415 ? 415 : 500
      if (status === 500) log.error({ msg: `correction upload failed: ${err.message}`, stack: err.stack })
      if (!res.headersSent) res.status(status).json({ error: err.message || 'internal' })
    }
  })

  // ── exam result mail (passed / not passed) ─────────────────────────────────
  // Sent server-side so the recipient address comes from the OpnForm submission we
  // already hold, never from the client — an admin (or anything that reaches this route)
  // cannot aim KSCW's DKIM-aligned sender at an address of their choosing.
  //
  // `note` is an optional free-text line the admin writes in the confirm modal. It is
  // admin-authored rather than public input, but it is still escaped before it enters the
  // HTML: an unescaped '<' would break the layout at best, and "admin-authored" is a
  // property of today's callers, not of this function.
  router.post('/wadmin/scorer_courses/opnform/forms/:slug/submissions/:id/exam-result-email', async (req, res) => {
    if (!(await guardScorer(req, res))) return
    const subId = String(req.params.id || '')
    if (!/^[0-9]+$/.test(subId)) return res.status(400).json({ error: 'Invalid submission id' })

    // No default: a mail that says "passed" because a field was missing is the one
    // mistake this route must not make.
    const result = String(req.body?.result || '')
    if (result !== 'passed' && result !== 'failed') return res.status(400).json({ error: 'invalid_result' })
    const passed = result === 'passed'
    const note = String(req.body?.note || '').slice(0, 2000).trim()

    try {
      const listing = await listSubmissions(req.params.slug, { page: 1, perPage: 100 })
      const fields = listing.fields || []
      const idsOf = (re, typeMatch) => fields
        .filter((f) => (typeMatch && f.type === typeMatch) || re.test(String(f.name || '')))
        .map((f) => f.id)
      const emailIds = idsOf(/^e-?mail/i, 'email')
      const firstIds = idsOf(/vorname|first\s*name/i)
      const row = (listing.data || []).find((r) => String(r.id) === subId)
      if (!row) return res.status(404).json({ error: 'Submission not found' })

      // ⚠ Answers live in `row.data`, keyed by field id — never on the row itself.
      // Reading row[fieldId] yields undefined for everything and the mail silently gets
      // no recipient. Same shape admin.astro reads (var d = row.data).
      const answers = (row && row.data) || row || {}
      const pick = (ids) => { for (const i of ids) { const v = answers[i]; if (v != null && v !== '') return String(v) } return '' }
      const to = pick(emailIds).trim()
      if (!to || /[\r\n]/.test(to)) return res.status(422).json({ error: 'no_email_on_submission' })
      const firstName = pick(firstIds).replace(/[\r\n]/g, '').trim()

      // Which language the person signed up in — the DE form and the EN form are separate
      // records, so the slug itself tells us.
      const course = await database('scorer_courses')
        .where('form_slug_de', req.params.slug).orWhere('form_slug_en', req.params.slug)
        .first('date_iso', 'form_slug_en')
      const en = course && String(course.form_slug_en || '') === String(req.params.slug)

      const att = await database('scorer_course_attendance')
        .where('sub_key', `${req.params.slug}:${subId}`)
        .first('exam_date', 'sv_license', 'exam_file_corrected')

      // Attach the CORRECTED sheet when one exists — not the participant's own, which
      // they uploaded and already have. The correction is the new information.
      //
      // Corrections are stored as PDF (converted in /admin at upload time), so this is a
      // byte passthrough: there is no canvas in Node to convert an image with, and adding
      // an image pipeline here to redo work the browser already did would be daft.
      //
      // Read BEFORE the body is built, so the mail can only mention an attachment that is
      // actually going to be on it. A failure here degrades to a mail with no attachment
      // and no mention of one — the result still has to reach the participant.
      let attachments = null
      if (att?.exam_file_corrected) {
        try {
          const { bytes } = await readManagedFile(att.exam_file_corrected, { services, getSchema, database })
          attachments = [{
            filename: `schreiberpruefung${att.sv_license ? `_${att.sv_license}` : ''}.pdf`,
            content: bytes,
            contentType: 'application/pdf',
          }]
        } catch (e) {
          log.warn({ msg: 'could not attach corrected scoresheet', file: att.exam_file_corrected, error: e.message })
        }
      }

      const { subject, html, text } = buildExamResultMail({
        en, passed, note, firstName,
        courseDateIso: course?.date_iso || null,
        examDate: att?.exam_date || null,
        svLicense: att?.sv_license || null,
        hasAttachment: !!attachments,
      })

      const { MailService } = services
      const mail = new MailService({ schema: await getSchema(), knex: database })
      // MailService forwards nodemailer options, so `attachments` rides through as-is
      // (same shape kscw-hooks uses for its CSV export mail).
      //
      // From AND Reply-To, both the Ausbildung box. This mail is the one most likely to
      // be replied to of anything the club sends ("why did I fail?"), and until
      // 2026-08-15 it went out as EMAIL_FROM (wiedisync@noreply.kscw.ch) with a Reply-To
      // bolted on, because the old box's domain had no SES identity. The box now lives on
      // volleyball.kscw.ch, an SES domain identity with Easy DKIM, so it can be the real
      // sender — DKIM aligns and DMARC passes. Reply-To is kept anyway: it costs nothing
      // and a client that answers the envelope rather than the header still lands right.
      await mail.send({
        to,
        from: SCORER_AUSBILDUNG_FROM,
        replyTo: SCORER_AUSBILDUNG_EMAIL,
        subject,
        html,
        text,
        ...(attachments ? { attachments } : {}),
      })
      log.info({ msg: 'exam-result mail sent', result, noted: !!note, slug: req.params.slug, submission: subId })
      res.json({ ok: true, to })
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: 'Form not found' })
      log.error({ msg: `exam-result mail failed: ${err.message}`, result, stack: err.stack })
      res.status(500).json({ error: 'send_failed' })
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
        // Every eligible role, not just Website Admin — otherwise a Sport Admin who
        // HAS been granted sections is invisible in the grant grid, and a superuser
        // cannot see or change what they were given.
        .whereRaw(
          `LOWER(directus_roles.name) IN (${GATED_ROLE_LIST.map(() => '?').join(', ')})`,
          GATED_ROLE_LIST,
        )
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

  // PATCH (not PUT) — Directus's default CORS_METHODS is GET,POST,PATCH,DELETE;
  // PUT preflight is rejected cross-origin. Semantically equivalent for our upsert.
  router.patch('/wadmin/admins/:id', async (req, res) => {
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
