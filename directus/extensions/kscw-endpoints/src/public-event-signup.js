/**
 * The guests' door — signing up for one event without a Wiedisync account.
 *
 *   GET  /kscw/public/events/:token          — the event behind a share token
 *   POST /kscw/public/events/:token/signup   — Turnstile-protected signup
 *   POST /kscw/events/:id/share-token        — mint/rotate  (event admin)
 *   DELETE /kscw/events/:id/share-token      — revoke       (event admin)
 *
 * ⚠ This is NOT the members' door. Members RSVP natively into `participations`,
 * which is what feeds counts, rosters, reminders and the absence machinery; a
 * member who signed up here would leave no participation row and the event card
 * would read "0 going" while the hall filled up. The public page detects a
 * session and sends members to the native RSVP — see migration 310's header and
 * event-signup-form.js, which documents the same trap for the OpnForm door.
 *
 * The token IS the authorisation. There is deliberately no other check: anybody
 * holding the link may read this one event and sign up for it. That is the whole
 * point of a shareable link, and it is why the token is minted server-side from
 * a CSPRNG and never derived from the event id.
 *
 * All DB work runs through knex in the extension context, so `events` needs no
 * public Directus policy and `event_public_signups` is not a registered
 * collection at all (migration 310).
 */

import crypto from 'node:crypto'
import { clientIp } from './client-ip.js'
import { writeUserLog } from './activity-log.js'

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || ''

async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) {
    console.error('[public-event-signup] TURNSTILE_SECRET not configured — rejecting request')
    return false
  }
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(token) }).toString(),
    })
    return (await resp.json()).success === true
  } catch {
    // A network failure to Cloudflare must not become an open door.
    return false
  }
}

/**
 * Everything the public page renders — and nothing else.
 *
 * ⚠ Deliberately omits `created_by`, `invited_roles`, the team and member
 * junctions, and every participant name. The share link is handed to people
 * outside the club, and a roster is exactly the kind of thing that carries
 * minors' names (public API minor protection). The only aggregate exposed is a
 * count, which is what kscw-website's "Anmelden" CTA already shows.
 */
const PUBLIC_EVENT_FIELDS = [
  'id', 'title', 'description', 'event_type',
  'start_date', 'end_date', 'all_day',
  'location', 'hall', 'respond_by',
  'cancelled', 'cancel_reason', 'max_players',
]

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{24,64}$/

function mintToken() {
  // 32 bytes → 43 url-safe chars, inside the CHECK's 24..64 window.
  return crypto.randomBytes(32).toString('base64url')
}

/** Salted so the stored value cannot be reversed to an address by scanning. */
function hashIp(ip) {
  return crypto.createHash('sha256')
    .update(`kscw-event-signup:${ip}`)
    .digest('hex')
    .slice(0, 64)
}

const ELEVATED_ROLES = new Set(['admin', 'superuser', 'vb_admin', 'bb_admin'])

function parseRoles(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

/**
 * Same authority as creating an OpnForm signup form (event-signup-form.js):
 * admin, sport admin, or the event's creator. Deliberately NOT the coach/TR
 * branch — minting this token publishes a URL that reaches outside the club,
 * which is a narrower thing to hand out than notifying your own team.
 */
async function authorizeEventAdmin(database, accountability, event) {
  if (!accountability?.user) return { ok: false, status: 401, error: 'Authentication required' }
  if (accountability.admin === true) return { ok: true }

  const caller = await database('members').where('user', accountability.user).first('id', 'role')
  if (!caller) return { ok: false, status: 403, error: 'Not a member' }
  if (parseRoles(caller.role).some((r) => ELEVATED_ROLES.has(r))) return { ok: true }
  if (event?.created_by != null && String(event.created_by) === String(caller.id)) return { ok: true }
  return { ok: false, status: 403, error: 'Event admin access required' }
}

export function registerPublicEventSignup(router, { database, logger }, helpers) {
  const { ipRateLimit, requireAuth, logEndpointError } = helpers
  const log = logger.child({ endpoint: 'public-event-signup' })
  const readIp = new Map()
  const signupIp = new Map()

  /** Resolve a share token to its event, or null. */
  async function eventForToken(rawToken) {
    const token = String(rawToken || '')
    // Check the shape before touching the DB: it bounds the input and means a
    // junk token costs a regex rather than a query.
    if (!TOKEN_SHAPE.test(token)) return null
    return database('events')
      .where('public_share_token', token)
      .first([...PUBLIC_EVENT_FIELDS, 'public_share_token'])
  }

  // ── Read ─────────────────────────────────────────────────────────
  router.get('/public/events/:token', async (req, res) => {
    try {
      if (!ipRateLimit(readIp, req, 60, 10 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests' })
      }
      const event = await eventForToken(req.params.token)
      // Same answer for a malformed token, a revoked one and a deleted event —
      // otherwise the endpoint becomes an oracle for which tokens once existed.
      if (!event) return res.status(404).json({ error: 'Not found' })

      const [{ count } = { count: 0 }] = await database('event_public_signups')
        .where('event', event.id).count({ count: '*' })

      const { public_share_token: _omit, ...safe } = event
      // No caching: a cancelled event or a closed deadline must not sit in a
      // shared cache after the club has changed it.
      res.set('Cache-Control', 'no-store')
      res.json({
        data: {
          ...safe,
          signup_count: Number(count) || 0,
          closed: !!event.cancelled
            || (!!event.respond_by && new Date() > new Date(event.respond_by)),
        },
      })
    } catch (err) {
      logEndpointError(log, 'public/events/:token', err, req)
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Sign up ──────────────────────────────────────────────────────
  router.post('/public/events/:token/signup', async (req, res) => {
    try {
      if (!ipRateLimit(signupIp, req, 8, 10 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests' })
      }
      const { name, email, phone, note, guest_count, turnstile_token } = req.body || {}
      if (!turnstile_token || !(await verifyTurnstile(turnstile_token))) {
        return res.status(400).json({ error: 'Captcha verification failed' })
      }

      const cleanName = String(name ?? '').trim().slice(0, 200)
      if (!cleanName) return res.status(400).json({ error: 'Name is required' })

      const event = await eventForToken(req.params.token)
      if (!event) return res.status(404).json({ error: 'Not found' })

      // Server-side gates. The client hides the form in these states, but the
      // client is not the enforcement point.
      if (event.cancelled) return res.status(400).json({ error: 'This event is cancelled' })
      if (event.respond_by && new Date() > new Date(event.respond_by)) {
        return res.status(400).json({ error: 'Signups for this event are closed' })
      }

      const guests = Number.isFinite(Number(guest_count)) ? Math.trunc(Number(guest_count)) : 0
      if (guests < 0 || guests > 20) return res.status(400).json({ error: 'Invalid guest count' })

      const cleanEmail = String(email ?? '').trim().slice(0, 255) || null

      try {
        const [row] = await database('event_public_signups')
          .insert({
            event: event.id,
            name: cleanName,
            email: cleanEmail,
            phone: String(phone ?? '').trim().slice(0, 60) || null,
            note: String(note ?? '').trim().slice(0, 2000) || null,
            guest_count: guests,
            ip_hash: hashIp(clientIp(req)),
          })
          .returning('id')
        log.info({ msg: 'public event signup', event: event.id, signup: row?.id ?? row })
      } catch (err) {
        // 310's partial unique index on (event, lower(email)). Not an upsert —
        // re-submitting is a mistake to report, not a change to apply.
        if (err?.code === '23505') {
          return res.status(409).json({ error: 'This email address is already signed up' })
        }
        throw err
      }

      res.json({ ok: true })
    } catch (err) {
      logEndpointError(log, 'public/events/:token/signup', err, req)
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Mint / rotate (authenticated) ────────────────────────────────
  async function loadManageableEvent(req, res) {
    requireAuth(req, log)
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'invalid_event_id' }); return null
    }
    const event = await database('events').where('id', id)
      .first('id', 'title', 'created_by', 'public_share_token')
    if (!event) { res.status(404).json({ error: 'Event not found' }); return null }
    const auth = await authorizeEventAdmin(database, req.accountability, event)
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return null }
    return event
  }

  router.post('/events/:id/share-token', async (req, res) => {
    try {
      const event = await loadManageableEvent(req, res)
      if (!event) return
      // Rotating is the revoke-and-reissue path: the previous link stops working
      // the moment this lands, which is the point when a link has leaked.
      const token = mintToken()
      await database('events').where('id', event.id)
        .update({ public_share_token: token, date_updated: new Date() })
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'update',
        collection: 'events',
        recordId: event.id,
        data: { public_share_token: 'minted', rotated: !!event.public_share_token },
      })
      res.json({ public_share_token: token, rotated: !!event.public_share_token })
    } catch (err) {
      logEndpointError(log, 'events/:id/share-token', err, req)
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  router.delete('/events/:id/share-token', async (req, res) => {
    try {
      const event = await loadManageableEvent(req, res)
      if (!event) return
      if (!event.public_share_token) return res.json({ ok: true, public_share_token: null })
      await database('events').where('id', event.id)
        .update({ public_share_token: null, date_updated: new Date() })
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'update',
        collection: 'events',
        recordId: event.id,
        data: { public_share_token: null, revoked: true },
      })
      // The signups themselves survive on purpose: revoking a link is a routine
      // "stop sharing this" action, and it must not delete who already signed up.
      res.json({ ok: true, public_share_token: null })
    } catch (err) {
      logEndpointError(log, 'events/:id/share-token delete', err, req)
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })
}
