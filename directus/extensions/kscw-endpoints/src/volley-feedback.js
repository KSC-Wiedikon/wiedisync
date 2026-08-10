/**
 * Volley feedback — public submission endpoint.
 *
 *   POST /kscw/public/volley-feedback
 *
 * Replaces the Directus Flow `Volley Feedback: Submit`
 * (d523d4a2-9dff-4dd5-b007-ec8991ef6392), which was deleted on 2026-08-10 for
 * two reasons (audit 2026-08-08, findings 25 and 30):
 *
 *   1. Its `Validate Turnstile` operation carried the **Turnstile secret as a
 *      literal** in `directus_operations.options`. Flows cannot read env vars
 *      unless `FLOWS_ENV_ALLOW_LIST` is set, so the secret was duplicated into
 *      the database — readable in plaintext by every Administrator-role holder
 *      through the admin UI (including people with no other route to it) and
 *      present in every database backup.
 *   2. Its `create_feedback` operation ran with `permissions: "$full"`, i.e.
 *      admin accountability, which is the same structural problem finding 25
 *      describes: a Flow is a grant surface `setup-permissions.mjs` cannot see
 *      and no permission audit reading `directus_permissions` will ever show.
 *
 * Doing it here instead puts this form on the same path as every other public
 * form on the platform (`contact-form.js`, `public-forms.js`, `registration.js`):
 * one secret, from the environment; a per-IP limiter; an explicit column
 * allow-list; and behaviour that lives in git rather than in a database row.
 */

import { clientIp } from './client-ip.js'

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET

/**
 * Verify a Turnstile token. FAIL-CLOSED when the secret is unset — an
 * unconfigured environment must not silently become an open form.
 * (Mirrors `verifyTurnstile` in index.js and contact-form.js.)
 */
async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) return false
  if (!token) return false
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(token) }).toString(),
    })
    const data = await resp.json()
    return data?.success === true
  } catch {
    return false
  }
}

/** Free-text columns, with the lengths the form itself enforces. */
const TEXT_FIELDS = {
  season: 20,
  locale: 10,
  name: 200,
  other_function: 200,
  other_team: 200,
  feedback_text: 5000,
  ideas_text: 5000,
  other_text: 5000,
}

/** 1–5 star ratings. Anything else becomes null rather than being stored. */
const RATING_FIELDS = [
  'rating_verein', 'rating_vorstand', 'rating_tk_leitung',
  'rating_training', 'rating_kommunikation',
]

/** jsonb arrays of short codes. */
const ARRAY_FIELDS = ['functions', 'teams']

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

const rating = (v) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

/** Cap both the number of entries and each entry's length. */
const codeArray = (v) => {
  if (!Array.isArray(v)) return null
  const out = v.filter((x) => typeof x === 'string').slice(0, 30).map((x) => x.slice(0, 100))
  return out.length ? out : null
}

const ipAttempts = new Map()

export function registerVolleyFeedback(router, { database, logger }) {
  const log = logger.child({ endpoint: 'volley-feedback' })

  router.post('/public/volley-feedback', async (req, res) => {
    try {
      // Per-IP limiter. The flow had none at all — Turnstile was its only
      // bound, so a solved or misconfigured captcha meant unlimited inserts.
      const ip = clientIp(req)
      const now = Date.now()
      const entry = ipAttempts.get(ip)
      if (entry && now < entry.resetAt) {
        if (entry.count >= 5) return res.status(429).json({ error: 'Too many submissions. Try again later.' })
        entry.count++
      } else {
        ipAttempts.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 })
      }
      if (ipAttempts.size > 1000) {
        for (const [k, v] of ipAttempts) if (now > v.resetAt) ipAttempts.delete(k)
      }

      const body = req.body || {}
      const token = body.turnstile_token || req.headers['x-turnstile-token']
      if (!(await verifyTurnstile(token))) {
        return res.status(400).json({ error: 'Captcha verification failed' })
      }

      // Explicit allow-list. The flow interpolated `{{$trigger.body.*}}` per
      // column, which is equivalent — but silently gains any column added to
      // the collection later. This cannot.
      const row = { date_created: new Date().toISOString() }
      for (const [field, max] of Object.entries(TEXT_FIELDS)) row[field] = str(body[field], max)
      for (const field of RATING_FIELDS) row[field] = rating(body[field])
      for (const field of ARRAY_FIELDS) row[field] = JSON.stringify(codeArray(body[field]) ?? [])
      row.is_anonymous = body.is_anonymous === true || body.is_anonymous === 'true'
      // An anonymous submission must not carry a name, whatever the client sent.
      if (row.is_anonymous) row.name = null

      // Refuse an empty submission rather than storing a row of nulls — the
      // flow had no such check and a bare captcha solve created a blank record.
      const hasContent = RATING_FIELDS.some((f) => row[f] != null)
        || ['feedback_text', 'ideas_text', 'other_text'].some((f) => row[f])
      if (!hasContent) return res.status(400).json({ error: 'Empty submission' })

      await database('volley_feedback').insert(row)
      log.info({ msg: 'volley feedback submitted', season: row.season, anonymous: row.is_anonymous })
      return res.status(204).end()
    } catch (err) {
      log.error({ msg: `volley-feedback: ${err.message}`, endpoint: 'volley-feedback', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })
}
