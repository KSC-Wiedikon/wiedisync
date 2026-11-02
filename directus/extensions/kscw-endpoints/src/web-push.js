/**
 * Web Push Notification Endpoints
 *
 * Manages push subscriptions and sends push via Cloudflare Worker.
 *
 * Endpoints:
 *   GET  /kscw/web-push/vapid-public-key  — public VAPID key
 *   POST /kscw/web-push/subscribe         — register/update subscription (auth)
 *   POST /kscw/web-push/unsubscribe       — remove subscription (auth)
 *   POST /kscw/web-push/test              — send test push (admin only)
 *   POST /kscw/web-push/test-self         — send a test push to your own device (auth)
 */

import { FRONTEND_URL } from './email-template.js'
import { logWarning } from './error-log.js'
import { memberLangToCode, tPush } from './push-i18n.js'

// ── Subscription endpoint validation ────────────────────────────────
// Allow-list of public push providers we accept as `endpoint` hostnames. The
// browser only generates URLs on these origins, so anything else is either a
// misconfigured client or an attacker trying to coerce the Worker into making
// HTTPS requests to an attacker-controlled host (SSRF). We use suffix matches
// so future provider sub-domains keep working without a redeploy.
// The Android app registers through UnifiedPush; its distributor app picks the
// push server. Only the two public ones are listed — a self-hosted ntfy is
// rejected on purpose (an arbitrary host is exactly what this list exists to
// refuse); the subscribe toast tells the user to use Sunup or ntfy instead.
// Same hosts as ALLOWED_PUSH_HOSTS in workers/push/src/index.ts (2026-11-02): a
// host accepted here but refused by the Worker was a subscription that said "on"
// and never delivered, so the two lists are now identical.
const PUSH_ENDPOINT_ALLOWED_SUFFIXES = [
  '.fcm.googleapis.com',      // FCM (Chrome, Edge on most platforms)
  '.push.apple.com',          // APNs (Safari, iOS)
  '.push.services.mozilla.com', // Mozilla autopush (Firefox; also the Sunup UnifiedPush distributor)
  '.notify.windows.com',      // WNS (Edge on Windows)
  '.ntfy.sh',                 // UnifiedPush via the ntfy app's default server (2026-10-10)
]

function isPrivateIpv4(host) {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const [, a, b] = m.map(Number)
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 0) return true
  if (a >= 224) return true // multicast + reserved
  return false
}

function isPrivateIpv6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === '::1' || h === '::') return true
  if (h.startsWith('fc') || h.startsWith('fd')) return true // ULA
  if (h.startsWith('fe80')) return true                     // link-local
  return false
}

/**
 * Validate a Web Push subscription endpoint before storing it.
 * Returns `{ ok: true }` or `{ ok: false, error }`.
 *
 * Rejects: non-https, malformed URL, private/loopback/link-local hosts,
 * `localhost`, and hosts outside the known browser-push-provider allow-list.
 * This is the single chokepoint protecting the CF Worker from issuing
 * outbound requests to attacker-chosen hosts (see SECURITY.md, 2026-05-12).
 */
export function validatePushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length < 8 || endpoint.length > 2000) {
    return { ok: false, error: 'endpoint missing or out of length bounds' }
  }
  let u
  try { u = new URL(endpoint) } catch { return { ok: false, error: 'endpoint not a valid URL' } }
  if (u.protocol !== 'https:') return { ok: false, error: 'endpoint must use https' }
  const host = u.hostname.toLowerCase()
  if (!host || host === 'localhost') return { ok: false, error: 'endpoint host not allowed' }
  if (isPrivateIpv4(host)) return { ok: false, error: 'endpoint host not allowed' }
  if (host.startsWith('[') || host.includes(':')) {
    if (isPrivateIpv6(host)) return { ok: false, error: 'endpoint host not allowed' }
  }
  const allowed = PUSH_ENDPOINT_ALLOWED_SUFFIXES.some(s => host === s.slice(1) || host.endsWith(s))
  if (!allowed) return { ok: false, error: 'endpoint host not allowed' }
  if (u.username || u.password) return { ok: false, error: 'endpoint must not carry credentials' }
  if (isNtfyHost(host) && !isNtfyTopicUrl(u)) return { ok: false, error: 'endpoint path not allowed' }
  return { ok: true }
}

// ntfy's publish API takes features in the URL — `?email=` mails anyone, `?call=`
// phones a number, `?delay=`/`?attach=` — and the Worker POSTs to the stored URL as
// is. A UnifiedPush endpoint is only ever one topic, optionally `?up=1`, so that is
// all we store (2026-10-11 audit). Same rule in workers/push/src/index.ts.
const isNtfyHost = (host) => host === 'ntfy.sh' || host.endsWith('.ntfy.sh')
function isNtfyTopicUrl(u) {
  return /^\/[A-Za-z0-9_-]{1,64}$/.test(u.pathname) && (u.search === '' || u.search === '?up=1')
}

// Fail loudly on missing VAPID config rather than silently falling back to a
// public-key value that may not match the worker's secret store. A split-brain
// here makes every push delivery fail with no obvious cause.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const PUSH_WORKER_URL = process.env.PUSH_WORKER_URL || 'https://kscw-push.kscw.workers.dev'
const PUSH_AUTH_SECRET = process.env.PUSH_AUTH_SECRET
if (!VAPID_PUBLIC_KEY) {
  // Don't throw at import time (would crash the whole Directus container);
  // log so it's diagnosable, and the /vapid-public-key route below returns
  // a 503 instead of a wrong key.
  console.error('[web-push] VAPID_PUBLIC_KEY env var not set — push subscriptions will fail until configured')
}

// ── Helper: send push to a single member ────────────────────────────

export async function sendPushToMember(db, memberId, title, body, url, tag, log) {
  if (!memberId) return { sent: 0, failed: 0, cleaned: 0 }

  const subscriptions = await db('push_subscriptions')
    .where('member', memberId)
    .select('id', 'endpoint', 'keys_p256dh', 'keys_auth')

  if (subscriptions.length === 0) return { sent: 0, failed: 0, cleaned: 0 }

  return _sendPush(db, subscriptions, title, body, url, tag, log)
}

// ── Helper: send push to multiple members ───────────────────────────

export async function sendPushToMembers(db, memberIds, title, body, url, tag, log) {
  if (!memberIds || memberIds.length === 0) return { sent: 0, failed: 0, cleaned: 0 }

  const subscriptions = await db('push_subscriptions')
    .whereIn('member', memberIds)
    .select('id', 'endpoint', 'keys_p256dh', 'keys_auth')

  if (subscriptions.length === 0) return { sent: 0, failed: 0, cleaned: 0 }

  return _sendPush(db, subscriptions, title, body, url, tag, log)
}

// ── Internal: call CF Worker and clean up expired subs ──────────────

async function _sendPush(db, subscriptions, title, body, url, tag, log) {
  const subs = subscriptions.map(s => ({
    endpoint: s.endpoint,
    keys: { p256dh: s.keys_p256dh, auth: s.keys_auth },
  }))

  const result = { sent: 0, failed: 0, cleaned: 0 }

  if (!PUSH_AUTH_SECRET) {
    log?.error?.('[push] PUSH_AUTH_SECRET not configured — skipping push')
    reportPushFailure('PUSH_AUTH_SECRET not configured — no push is sent', { subscriptions: subs.length })
    return result
  }

  try {
    const resp = await fetch(`${PUSH_WORKER_URL}/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PUSH_AUTH_SECRET}`,
      },
      body: JSON.stringify({
        subscriptions: subs,
        title: title || 'KSC Wiedikon',
        body: body || '',
        url: url || FRONTEND_URL,
        ...(tag ? { tag } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (resp.ok) {
      const data = await resp.json()
      result.sent = data.sent || 0
      result.failed = data.failed || 0
      if (result.failed > 0) {
        // The Worker's per-subscription errors are the push service's answers
        // ("403: …" for a key mismatch, "401: …" for a bad VAPID token). They
        // never contain the endpoint, so they are safe to log.
        const errors = (data.errors || []).slice(0, 3).map(e => String(e).slice(0, 160))
        log?.warn?.(`[push] Sent ${result.sent}, failed ${result.failed}, expired ${data.expired?.length || 0}: ${errors.join(' | ')}`)
        if (result.sent === 0) reportPushFailure('Push service refused every subscription', { failed: result.failed, errors })
      }

      // Clean up expired/gone subscriptions
      if (data.expired?.length > 0) {
        for (const endpoint of data.expired) {
          try {
            const deleted = await db('push_subscriptions').where('endpoint', endpoint).delete()
            if (deleted > 0) result.cleaned++
          } catch { /* ignore */ }
        }
      }
    } else {
      log?.warn?.(`[push] Worker returned ${resp.status}`)
      reportPushFailure(`Push Worker returned ${resp.status}`, { status: resp.status, subscriptions: subs.length })
    }
  } catch (err) {
    log?.error?.(`[push] Worker call failed: ${err.message}`)
    reportPushFailure(`Push Worker call failed: ${err.message}`, { subscriptions: subs.length })
  }

  return result
}

// A push that cannot go out used to leave no trace outside the container log
// (2026-11-02: a member never got one, and nothing said why). The error log and
// Sentry get one entry per failure kind per 10 minutes, so a dead Worker during
// a 500-member fanout is one line, not 500.
const PUSH_FAILURE_REPORT_MS = 10 * 60_000
const lastPushFailureReport = new Map()

function reportPushFailure(message, extra) {
  const kind = message.replace(/\d+/g, 'N')
  const now = Date.now()
  if (now - (lastPushFailureReport.get(kind) || 0) < PUSH_FAILURE_REPORT_MS) return
  lastPushFailureReport.set(kind, now)
  try { logWarning('push_send_failed', message, extra) } catch { /* logging never breaks a send */ }
}

// ── Self test: "Send test notification" in the notification panel ────
// A member checks that THIS device gets pushes. Only the caller's own rows,
// optionally narrowed to one endpoint (the device asking), and a few per
// member per ten minutes, so the button cannot be used to spam a phone.
const SELF_TEST_WINDOW_MS = 10 * 60_000
const SELF_TEST_MAX = 3
const selfTestHits = new Map()

function selfTestAllowed(memberId, now = Date.now()) {
  const recent = (selfTestHits.get(memberId) || []).filter(t => now - t < SELF_TEST_WINDOW_MS)
  if (recent.length >= SELF_TEST_MAX) {
    selfTestHits.set(memberId, recent)
    return false
  }
  recent.push(now)
  selfTestHits.set(memberId, recent)
  return true
}

// ── Register routes ─────────────────────────────────────────────────

export function registerWebPush(router, ctx) {
  const { database, logger } = ctx
  const log = logger.child({ extension: 'kscw-web-push' })

  // GET /kscw/web-push/vapid-public-key — public, no auth
  router.get('/web-push/vapid-public-key', (_req, res) => {
    if (!VAPID_PUBLIC_KEY) {
      return res.status(503).json({ error: 'Push not configured' })
    }
    res.json({ publicKey: VAPID_PUBLIC_KEY })
  })

  // POST /kscw/web-push/subscribe — upsert subscription (auth required)
  router.post('/web-push/subscribe', async (req, res) => {
    try {
      if (!req.accountability?.user) {
        log.warn({ msg: 'web-push/subscribe: unauthenticated request', endpoint: 'web-push/subscribe', method: req.method })
        return res.status(401).json({ error: 'Authentication required' })
      }

      const userId = req.accountability.user
      const member = await database('members').where('user', userId).select('id').first()
      if (!member) return res.status(400).json({ error: 'Member not found' })

      const { endpoint, keys_p256dh, keys_auth } = req.body
      if (!endpoint || !keys_p256dh || !keys_auth) {
        return res.status(400).json({ error: 'endpoint, keys_p256dh, and keys_auth are required' })
      }
      const epCheck = validatePushEndpoint(endpoint)
      if (!epCheck.ok) {
        log.warn({ msg: `web-push/subscribe: rejected endpoint (${epCheck.error})`, userId: req.accountability.user })
        return res.status(400).json({ error: 'endpoint not accepted' })
      }

      // F37 (migration 382): a row registered while a main account acts for a
      // linked member carries that guardian login, so revoking the grant unbinds
      // her device. Server-side only — from the acting swap, never the body; an
      // own-device (re)subscribe clears it.
      const actingGuardianUser = req.accountability?.kscwGuardian?.user ?? null

      // Upsert by member+endpoint
      const existing = await database('push_subscriptions')
        .where('member', member.id)
        .where('endpoint', endpoint)
        .first()

      if (existing) {
        await database('push_subscriptions').where('id', existing.id).update({
          keys_p256dh,
          keys_auth,
          acting_guardian_user: actingGuardianUser,
        })
        log.info(`Updated push subscription for member ${member.id}`)
        return res.json({ success: true, updated: true })
      }

      await database('push_subscriptions').insert({
        member: member.id,
        endpoint,
        keys_p256dh,
        keys_auth,
        acting_guardian_user: actingGuardianUser,
      })

      log.info(`New push subscription for member ${member.id}`)
      res.status(201).json({ success: true, created: true })
    } catch (err) {
      log.error({ msg: `web-push/subscribe: ${err.message}`, endpoint: 'web-push/subscribe', userId: req.accountability?.user, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/web-push/unsubscribe — remove subscription (auth required)
  router.post('/web-push/unsubscribe', async (req, res) => {
    try {
      if (!req.accountability?.user) {
        log.warn({ msg: 'web-push/unsubscribe: unauthenticated request', endpoint: 'web-push/unsubscribe', method: req.method })
        return res.status(401).json({ error: 'Authentication required' })
      }

      const userId = req.accountability.user
      const member = await database('members').where('user', userId).select('id').first()
      if (!member) return res.status(400).json({ error: 'Member not found' })

      const { endpoint } = req.body
      if (!endpoint) return res.status(400).json({ error: 'endpoint is required' })

      await database('push_subscriptions')
        .where('member', member.id)
        .where('endpoint', endpoint)
        .delete()

      log.info(`Unsubscribed push for member ${member.id}`)
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `web-push/unsubscribe: ${err.message}`, endpoint: 'web-push/unsubscribe', userId: req.accountability?.user, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/web-push/test-self — a test push to the caller's own device(s).
  // `{ endpoint }` narrows it to the device asking. `registered: false` means
  // the server holds no row for it — the device was never (or no longer)
  // registered, which is exactly what a member needs to know.
  router.post('/web-push/test-self', async (req, res) => {
    try {
      if (!req.accountability?.user) {
        log.warn({ msg: 'web-push/test-self: unauthenticated request', endpoint: 'web-push/test-self', method: req.method })
        return res.status(401).json({ error: 'Authentication required' })
      }

      const member = await database('members').where('user', req.accountability.user).select('id', 'language').first()
      if (!member) return res.status(400).json({ error: 'Member not found' })

      const endpoint = typeof req.body?.endpoint === 'string' && req.body.endpoint ? req.body.endpoint : null
      let query = database('push_subscriptions').where('member', member.id)
      if (endpoint) query = query.where('endpoint', endpoint)
      const subscriptions = await query.select('id', 'endpoint', 'keys_p256dh', 'keys_auth')
      if (subscriptions.length === 0) return res.json({ registered: false, sent: 0, failed: 0 })

      if (!selfTestAllowed(member.id)) return res.status(429).json({ error: 'rate_limited' })

      const lang = memberLangToCode(member.language)
      const result = await _sendPush(
        database, subscriptions,
        tPush(lang, 'selftest.title'), tPush(lang, 'selftest.body'),
        FRONTEND_URL, 'self-test', log,
      )
      log.info(`Self-test push for member ${member.id}: ${JSON.stringify(result)}`)
      res.json({ registered: true, sent: result.sent, failed: result.failed })
    } catch (err) {
      log.error({ msg: `web-push/test-self: ${err.message}`, endpoint: 'web-push/test-self', userId: req.accountability?.user, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/web-push/test — send test push (admin only)
  router.post('/web-push/test', async (req, res) => {
    try {
      if (!req.accountability?.admin) {
        log.warn({ msg: 'web-push/test: non-admin request', endpoint: 'web-push/test', userId: req.accountability?.user, method: req.method })
        return res.status(403).json({ error: 'Admin access required' })
      }

      const { member_id, title, body, url } = req.body

      // Default to current user's member
      let memberId = member_id
      if (!memberId) {
        const member = await database('members').where('user', req.accountability.user).select('id').first()
        memberId = member?.id
      }
      if (!memberId) return res.status(400).json({ error: 'member_id required' })

      const result = await sendPushToMember(
        database, memberId,
        title || 'Test Push',
        body || 'This is a test notification from KSC Wiedikon.',
        url || FRONTEND_URL,
        'test', log,
      )

      log.info(`Test push to member ${memberId}: ${JSON.stringify(result)}`)
      res.json(result)
    } catch (err) {
      log.error({ msg: `web-push/test: ${err.message}`, endpoint: 'web-push/test', userId: req.accountability?.user, method: req.method, body: { member_id: req.body?.member_id }, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
