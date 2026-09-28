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
// Override with KSCW_CREDENTIALED_ORIGINS (comma-separated exact origins).

const DEFAULT_CREDENTIALED_ORIGINS = [
  'https://wiedisync.kscw.ch',
  'https://spielplanung.wiedisync.kscw.ch',
  'https://spielplanung-dev.kscw.ch',
  // Member-app dev preview (CF Pages `kscw-wiedisync`, dev branch alias) —
  // talks to directus-dev with the cookie session like wiedisync.kscw.ch.
  'https://dev.kscw-wiedisync.pages.dev',
  // Member-app dev on .kscw.ch (CF Pages `kscw-wiedisync-dev`) — the only dev
  // host where the Lax session cookie is same-site, i.e. where login sticks.
  'https://wiedisync-dev.kscw.ch',
]

// Local dev servers (Vite on localhost, the Tailscale dev box).
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|100\.76\.39\.66)(:\d+)?$/

export function credentialedOrigins(env = process.env) {
  const raw = env.KSCW_CREDENTIALED_ORIGINS
  const list = raw ? raw.split(',') : DEFAULT_CREDENTIALED_ORIGINS
  return new Set(list.map((s) => s.trim()).filter(Boolean))
}

export function mayUseCredentials(origin, allowed) {
  if (!origin) return true // same-origin / non-browser: header is irrelevant
  return allowed.has(origin) || LOCAL_ORIGIN.test(origin)
}

export function createCorsCredentialsMiddleware(env = process.env) {
  const allowed = credentialedOrigins(env)
  return (req, res, next) => {
    const origin = req.headers.origin
    if (!mayUseCredentials(origin, allowed)) {
      const setHeader = res.setHeader.bind(res)
      res.setHeader = (name, value) =>
        String(name).toLowerCase() === 'access-control-allow-credentials' ? res : setHeader(name, value)
    }
    next()
  }
}
