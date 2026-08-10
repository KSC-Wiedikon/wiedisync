/**
 * Event signup forms — the public door of the two-door signup model.
 *
 *   POST   /kscw/events/:id/signup-form   — duplicate the OpnForm template, link it
 *   DELETE /kscw/events/:id/signup-form   — unlink (the OpnForm form is kept)
 *   GET    /kscw/events/:id/signups       — merged internal + external signup list
 *
 * Why two doors: members RSVP natively (`participations`), which is what drives
 * counts, rosters, reminders and the absence machinery. Non-members can't — they
 * have no account — so they go through an OpnForm at forms.kscw.ch, linked from
 * the event via `events.signup_url`. kscw-website already renders that URL as an
 * "Anmelden" CTA with a live count, so a club-wide event needs no website change.
 *
 * Sending MEMBERS through the OpnForm instead would be the tempting shortcut and
 * it silently breaks the app: an external submission creates no `participations`
 * row, so the event card would read "0 going" while 40 people had signed up.
 * That is why the member-app surface is a *share* affordance, not a signup CTA.
 *
 * The form itself is never authored here — see createFormFromTemplate.
 */

import {
  badSlug, listSubmissions, createFormFromTemplate, findFreeSlug, formUrl,
} from './opnform.js'
import { writeUserLog } from './activity-log.js'

/** Same shape kscw-website's calendar-grid.ts parses out of signup_url. */
const SLUG_FROM_URL = /\/forms\/([a-z0-9][a-z0-9-]{0,80})/i

export function slugFromSignupUrl(url) {
  const m = String(url ?? '').match(SLUG_FROM_URL)
  return m ? m[1] : null
}

/**
 * Which OpnForm form new signup forms are copied from.
 *
 * `app_settings` wins over the env var so the template can be repointed from the
 * app — changing an env var means an SSH round-trip and a container RECREATE
 * (a restart does not pick up new env), which is a bad fit for a value that
 * changes whenever the club rebuilds its master form. The env var stays as a
 * bootstrap/fallback so an install with no row configured still works.
 */
const TEMPLATE_SETTING_KEY = 'opnform_event_template_id'

export async function resolveTemplateId(database) {
  let fromDb = ''
  try {
    const row = await database('app_settings').where('key', TEMPLATE_SETTING_KEY).first('value')
    fromDb = String(row?.value ?? '').trim()
  } catch { /* table/row missing — fall through to the env var */ }
  return fromDb || String(process.env.OPNFORM_TEMPLATE_FORM_ID || '').trim()
}

/** Roles that may manage any event, mirroring event-notify's `elevated` set. */
const ELEVATED_ROLES = new Set(['admin', 'superuser', 'vb_admin', 'bb_admin'])

function parseRoles(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

/**
 * Admin, sport admin, or the event's creator. Deliberately NOT the coach/TR
 * branch event-notify allows: that one exists so a team leader can notify their
 * own team, whereas creating a signup form publishes a public URL under the
 * club's domain — a narrower thing to hand out.
 */
async function authorizeEventAdmin(database, accountability, event) {
  if (!accountability?.user) return { ok: false, status: 401, error: 'Authentication required' }
  if (accountability.admin === true) return { ok: true, member: null }

  const caller = await database('members')
    .where('user', accountability.user)
    .first('id', 'role')
  if (!caller) return { ok: false, status: 403, error: 'Not a member' }

  const roles = parseRoles(caller.role)
  if (roles.some((r) => ELEVATED_ROLES.has(r))) return { ok: true, member: caller }
  if (event?.created_by != null && String(event.created_by) === String(caller.id)) {
    return { ok: true, member: caller }
  }
  return { ok: false, status: 403, error: 'Event admin access required' }
}

/**
 * Per-user create limit. Each call creates a real form on forms.kscw.ch, so a
 * stuck client retrying is not just noise — it litters the club's form list.
 */
const createLimit = new Map() // user → { count, resetAt }
const CREATE_MAX = 10
const CREATE_WINDOW_MS = 10 * 60_000

function underCreateLimit(user) {
  const now = Date.now()
  const e = createLimit.get(user)
  if (e && now < e.resetAt) {
    if (e.count >= CREATE_MAX) return false
    e.count++
  } else {
    createLimit.set(user, { count: 1, resetAt: now + CREATE_WINDOW_MS })
  }
  if (createLimit.size > 1000) {
    for (const [k, v] of createLimit) { if (now > v.resetAt) createLimit.delete(k) }
  }
  return true
}

export function registerEventSignupForm(router, { database, logger }) {
  const log = logger.child({ endpoint: 'event-signup-form' })

  async function loadEvent(req, res) {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_event_id' })
      return null
    }
    const event = await database('events')
      .where('id', id)
      .first('id', 'title', 'start_date', 'respond_by', 'signup_url', 'created_by')
    if (!event) {
      res.status(404).json({ error: 'Event not found' })
      return null
    }
    const auth = await authorizeEventAdmin(database, req.accountability, event)
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error })
      return null
    }
    return event
  }

  // ── Create + link ────────────────────────────────────────────────
  router.post('/events/:id/signup-form', async (req, res) => {
    const event = await loadEvent(req, res)
    if (!event) return

    const templateId = await resolveTemplateId(database)
    if (!templateId) {
      return res.status(503).json({
        error: 'template_not_configured',
        message: 'No signup form template is configured — set one in the event form (superuser only).',
      })
    }

    if (event.signup_url && req.body?.force !== true) {
      return res.status(409).json({
        error: 'signup_url_exists',
        signup_url: event.signup_url,
        message: 'This event already has a signup form. Pass force to replace the link.',
      })
    }

    if (!underCreateLimit(req.accountability.user)) {
      return res.status(429).json({ error: 'rate_limited' })
    }

    // The form's own closes_at is what actually rejects a late submission, so
    // default it to the event's RSVP deadline rather than leaving it open.
    let closesAt = null
    const rawCloses = req.body?.closes_at !== undefined ? req.body.closes_at : event.respond_by
    if (rawCloses != null && rawCloses !== '') {
      const t = Date.parse(String(rawCloses))
      if (!Number.isFinite(t)) return res.status(400).json({ error: 'invalid_closes_at' })
      closesAt = new Date(t).toISOString()
    }

    // Year-suffix the slug: "mixed-turnier" recurs annually and the slug is
    // globally unique forever, so without it every edition after the first
    // lands on the -2/-3 fallback and reads like a mistake.
    //
    // Zurich year, not UTC: a 1 January event starting 00:30 local is still
    // 31 December in UTC, and would be slugged with the previous year.
    const year = event.start_date
      ? new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', year: 'numeric' })
        .format(new Date(event.start_date))
      : null
    const slugBase = year ? `${event.title} ${year}` : event.title

    try {
      const slug = await findFreeSlug(slugBase)
      const form = await createFormFromTemplate(templateId, {
        title: event.title,
        slug,
        closesAt,
      })

      await database('events').where('id', event.id).update({
        signup_url: form.url,
        date_updated: new Date(),
      })

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'update',
        collection: 'events',
        recordId: event.id,
        data: { signup_url: form.url, opnform_id: form.id, replaced: event.signup_url || null },
      })

      log.info({
        msg: 'event signup form created',
        event: event.id, slug: form.slug, user: req.accountability.user,
      })
      res.json(form)
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        return res.status(403).json({ error: 'OpnForm rejected the request — the OPNFORM_PAT likely lacks form-write access' })
      }
      if (err.status === 404) {
        return res.status(404).json({ error: 'template_not_found', message: `OpnForm has no form ${templateId}` })
      }
      if (err.status === 422) {
        log.warn({ msg: 'OpnForm rejected the form payload', event: event.id, detail: err.detail })
        return res.status(422).json({ error: 'OpnForm rejected the form payload', detail: err.detail })
      }
      log.error({ msg: 'event signup form create failed', event: event.id, status: err.status, error: err.message })
      res.status(err.status || 502).json({ error: err.message || 'Upstream error' })
    }
  })

  // ── Unlink ───────────────────────────────────────────────────────
  //
  // Clears the link only. The OpnForm form and its submissions survive on
  // purpose: unlinking is a routine "wrong form" correction, and deleting a
  // form that already holds real signups is not recoverable from here.
  router.delete('/events/:id/signup-form', async (req, res) => {
    const event = await loadEvent(req, res)
    if (!event) return

    if (!event.signup_url) return res.json({ ok: true, signup_url: null })

    await database('events').where('id', event.id).update({
      signup_url: null,
      date_updated: new Date(),
    })
    await writeUserLog(database, log, {
      accountability: req.accountability,
      action: 'update',
      collection: 'events',
      recordId: event.id,
      data: { signup_url: null, unlinked: event.signup_url },
    })
    res.json({ ok: true, signup_url: null, unlinked: event.signup_url })
  })

  // ── Merged signup list ───────────────────────────────────────────
  //
  // Read-time merge rather than a webhook mirroring OpnForm into event_signups:
  // one fewer moving part, and the list cannot go stale or half-sync. The cost
  // is a live call to forms.kscw.ch per view, which is why an upstream failure
  // degrades to the internal half instead of failing the whole request — the
  // member RSVPs are the authoritative side and must always render.
  router.get('/events/:id/signups', async (req, res) => {
    const event = await loadEvent(req, res)
    if (!event) return

    const internalRows = await database('participations')
      .leftJoin('members', 'members.id', 'participations.member')
      .where('participations.activity_type', 'event')
      .where('participations.activity_id', String(event.id))
      .whereIn('participations.status', ['confirmed', 'tentative'])
      .select(
        'participations.id as id',
        'participations.status',
        'participations.guest_count',
        'participations.date_created',
        'members.id as member_id',
        'members.first_name',
        'members.last_name',
        'members.email',
      )

    const internal = internalRows.map((r) => ({
      id: r.id,
      member_id: r.member_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' '),
      email: r.email ?? null,
      status: r.status,
      guest_count: r.guest_count ?? 0,
      date_created: r.date_created,
    }))

    const slug = slugFromSignupUrl(event.signup_url)
    let external = null
    let externalError = null
    if (slug && !badSlug(slug)) {
      try {
        external = await listSubmissions(slug, { page: 1, perPage: 100 })
      } catch (err) {
        externalError = err.status === 404 ? 'form_not_found' : 'upstream_error'
        log.warn({ msg: 'event signups external fetch failed', event: event.id, slug, status: err.status })
      }
    }

    res.json({
      event: { id: event.id, title: event.title, signup_url: event.signup_url ?? null },
      internal,
      internal_total: internal.length,
      external,
      external_error: externalError,
    })
  })
}
