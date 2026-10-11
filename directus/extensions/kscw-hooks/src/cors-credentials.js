// Credentialed-CORS allow-list (security audit 2026-09-28, F43).
//
// Directus has ONE global CORS_CREDENTIALS switch, so every origin in
// CORS_ORIGIN (prod) — or every origin at all (dev reflects `true`) — is told
// `Access-Control-Allow-Credentials: true`. The session cookie is host-only on
// directus[-dev].kscw.ch and SameSite=Lax, which means any *.kscw.ch page is
// same-site and its credentialed fetch carries it. kscw.ch itself must stay in
// CORS_ORIGIN (the website reads public data and its /admin talks to Directus
// with a BEARER token), but it must never read a cookie-authenticated
// response: an XSS on the website (script-src 'unsafe-inline') would otherwise
// be a wiedisync session takeover.
//
// So: only the app origins that really use the cookie session keep the
// credentials header. Everyone else still gets Access-Control-Allow-Origin
// (bearer + anonymous fetches keep working) — the browser simply refuses to
// hand a credentialed response to their script.
//
// One list per instance (2026-10-11 audit): prod no longer trusts the dev hosts,
// nor local dev servers — a page there cannot hold the prod cookie anyway (it is
// cross-site), so on prod they could only ever be an attacker's page. Which list
// applies follows external-accounts.js: prod only when PUBLIC_URL is exactly
// directus.kscw.ch. Override with KSCW_CREDENTIALED_ORIGINS (comma-separated
// exact origins).

import { isProdInstance } from '../../kscw-endpoints/src/external-accounts.js'

const PROD_CREDENTIALED_ORIGINS = [
  'https://wiedisync.kscw.ch',
  'https://spielplanung.wiedisync.kscw.ch',
]

const DEV_CREDENTIALED_ORIGINS = [
  'https://spielplanung-dev.kscw.ch',
  // Member-app dev preview (CF Pages `kscw-wiedisync`, dev branch alias) —
  // talks to directus-dev with the cookie session like wiedisync.kscw.ch.
  'https://dev.kscw-wiedisync.pages.dev',
  // Member-app dev on .kscw.ch (CF Pages `kscw-wiedisync-dev`) — the only dev
  // host where the Lax session cookie is same-site, i.e. where login sticks.
  'https://wiedisync-dev.kscw.ch',
]

// Local dev servers (Vite on localhost, the Tailscale dev box). Dev only.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|100\.76\.39\.66)(:\d+)?$/

export function credentialedOrigins(env = process.env) {
  const raw = env.KSCW_CREDENTIALED_ORIGINS
  const list = raw ? raw.split(',') : isProdInstance(env) ? PROD_CREDENTIALED_ORIGINS : DEV_CREDENTIALED_ORIGINS
  return new Set(list.map((s) => s.trim()).filter(Boolean))
}

export function mayUseCredentials(origin, allowed, allowLocal = true) {
  if (!origin) return true // same-origin / non-browser: header is irrelevant
  return allowed.has(origin) || (allowLocal && LOCAL_ORIGIN.test(origin))
}

// The WebSocket upgrade never passes through the middleware above, and Directus's own
// upgrade Origin check (websocket/utils/is-origin-allowed) admits every CORS_ORIGIN
// entry — kscw.ch included — and then authenticates the socket from the session
// cookie. A same-site page sends that cookie, so an XSS on the website could open
// wss://directus.kscw.ch/websocket as the visiting member (2026-10-11 audit, H8).
// Same rule as for HTTP: a non-app origin keeps its (anonymous, or bearer via the
// handshake) socket, but never the cookie. Run as the FIRST 'upgrade' listener;
// Directus's handler reads the header after an await, so the strip always wins.
export function createWebSocketCookieGuard(env = process.env) {
  const allowed = credentialedOrigins(env)
  const allowLocal = !isProdInstance(env)
  return (request) => {
    const origin = request.headers.origin
    if (request.headers.cookie && !mayUseCredentials(origin, allowed, allowLocal)) {
      delete request.headers.cookie
    }
  }
}

export function createCorsCredentialsMiddleware(env = process.env) {
  const allowed = credentialedOrigins(env)
  const allowLocal = !isProdInstance(env)
  return (req, res, next) => {
    const origin = req.headers.origin
    if (!mayUseCredentials(origin, allowed, allowLocal)) {
      const setHeader = res.setHeader.bind(res)
      res.setHeader = (name, value) =>
        String(name).toLowerCase() === 'access-control-allow-credentials' ? res : setHeader(name, value)
    }
    next()
  }
}
