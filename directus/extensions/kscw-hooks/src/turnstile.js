/**
 * Shared Cloudflare Turnstile verifier (audit 2026-09-28, F-27).
 *
 * The hook copy this replaces had two gaps:
 *   1. it FAILED OPEN — `if (!TURNSTILE_SECRET) return true`, so a container
 *      recreated without the secret accepted anonymous feedback, event signups,
 *      mixed-tournament signups and member creates with no captcha at all, while
 *      every /kscw endpoint already failed closed;
 *   2. it checked `success` only. A token solved on ANY site that embeds our site
 *      key (or on a hostname added to the widget by mistake) was as good as one
 *      solved on kscw.ch.
 *
 * Here: no secret → reject; network/parse error → reject; `success` must be true;
 * the solving `hostname` must be one of ours; and when the caller names an
 * expected `action` the token must carry it. Pure apart from the injected `fetch`,
 * so the unit test drives every branch without the network.
 *
 * No widget on either site sets an `action` today, so the hook passes none; the
 * parameter exists so a route that does set one can pin it.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Hostnames a genuine widget is solved on: both production sites and every
 *  subdomain of kscw.ch, the Cloudflare Pages projects (and their per-branch
 *  preview subdomains), and local dev. Extend per environment with the
 *  comma-separated TURNSTILE_ALLOWED_HOSTNAMES env var. */
export const DEFAULT_TURNSTILE_HOSTNAMES = [
  'kscw.ch',
  'wiedisync.pages.dev',
  'kscw-wiedisync.pages.dev',
  'kscw-web.pages.dev',
  'kscw-website.pages.dev',
  'localhost',
  '127.0.0.1',
]

/** Cloudflare's published test secrets (always-pass / always-fail / token-spent).
 *  Their responses carry `hostname: "example.com"`, so the hostname check is
 *  skipped for them — they only ever run on dev. */
const TEST_SECRET_RE = /^[123]x0+AA$/

export function allowedHostnames(env = process.env) {
  const extra = String(env.TURNSTILE_ALLOWED_HOSTNAMES || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return [...DEFAULT_TURNSTILE_HOSTNAMES, ...extra]
}

/** True when `host` is an allowed hostname or a subdomain of one. */
export function isAllowedTurnstileHostname(host, allowed = DEFAULT_TURNSTILE_HOSTNAMES) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '')
  if (!h) return false
  return allowed.some((a) => h === a || h.endsWith(`.${a}`))
}

/**
 * Verify a Turnstile token. Resolves `{ ok, reason }` and never throws.
 *
 * @param {string} token
 * @param {{ secret?: string, expectedAction?: string, hostnames?: string[], fetchImpl?: typeof fetch, remoteip?: string }} opts
 */
export async function verifyTurnstileToken(token, opts = {}) {
  const { secret = '', expectedAction, hostnames = allowedHostnames(), fetchImpl = globalThis.fetch, remoteip } = opts
  if (!secret) return { ok: false, reason: 'no_secret' }
  if (!token || typeof token !== 'string') return { ok: false, reason: 'no_token' }
  if (token.length > 2048) return { ok: false, reason: 'token_too_long' }

  let data
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (remoteip) body.set('remoteip', remoteip)
    const resp = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    data = await resp.json()
  } catch {
    return { ok: false, reason: 'siteverify_unreachable' }
  }

  if (data?.success !== true) return { ok: false, reason: 'not_success' }
  if (!TEST_SECRET_RE.test(secret) && !isAllowedTurnstileHostname(data.hostname, hostnames)) {
    return { ok: false, reason: 'hostname' }
  }
  if (expectedAction && data.action !== expectedAction) return { ok: false, reason: 'action' }
  return { ok: true, reason: null }
}
