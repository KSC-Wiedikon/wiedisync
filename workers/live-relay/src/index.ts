// KSCW live-scoring relay — Worker entry (router + CORS + publish auth).
//
// Routes (channel defaults to DEFAULT_CHANNEL when the last segment is omitted):
//   GET  /subscribe/:channel   -> SSE stream (PUBLIC, no auth) — the wiedisync Live page
//   POST /publish/:channel     -> push a board snapshot (AUTH: Bearer RELAY_TOKEN)
//   GET  /state/:channel       -> current envelope as JSON (PUBLIC; debugging / SSR poll)
//   GET  /history/:channel     -> completed matches, newest first (PUBLIC)
//   POST /reset/:channel       -> clear current match -> idle (AUTH)
//   GET  /healthz              -> liveness probe
//
// The Worker owns CORS + the publish auth gate; the Durable Object owns state,
// fan-out and history. The DO is reached with a normalized internal URL so it
// never has to parse channels out of the public path.

import type { Env } from './types'
export { LiveMatchRelay } from './relay'

const CHANNEL_RE = /^[a-z0-9-]{1,32}$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''
    const allowOrigin = pickAllowedOrigin(origin, env)

    // CORS preflight — answer for every route in one place.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) })
    }

    if (url.pathname === '/healthz') {
      return json({ ok: true, service: 'kscw-live-relay' }, 200, allowOrigin)
    }

    // /{op}/{channel?}
    const [, op, channelRaw] = url.pathname.split('/')
    const channel = (channelRaw || env.DEFAULT_CHANNEL || 'kscw').toLowerCase()
    if (!CHANNEL_RE.test(channel)) {
      return json({ error: 'invalid channel' }, 400, allowOrigin)
    }

    // Publish + reset mutate state — require the shared secret. Fail CLOSED if the
    // secret is unset/short (mirrors the push worker: never compare against
    // `Bearer undefined`).
    if (op === 'publish' || op === 'reset') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, allowOrigin)
      if (!env.RELAY_TOKEN || env.RELAY_TOKEN.length < 24) {
        return json({ error: 'relay misconfigured' }, 500, allowOrigin)
      }
      const auth = request.headers.get('Authorization') || ''
      if (!timingSafeEqual(auth, `Bearer ${env.RELAY_TOKEN}`)) {
        return json({ error: 'unauthorized' }, 401, allowOrigin)
      }
    } else if (op === 'subscribe' || op === 'state' || op === 'history') {
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, allowOrigin)
    } else {
      return json({ error: 'not found' }, 404, allowOrigin)
    }

    // Route to the per-channel Durable Object.
    const id = env.LIVE.idFromName(channel)
    const stub = env.LIVE.get(id)

    // Normalized internal request: the DO only sees /{op}, with the channel + a
    // forwarded client body. Keep the abort signal so the DO learns of SSE
    // disconnects (request.signal fires on client close).
    const internal = new Request(`https://relay.do/${op}`, {
      method: request.method,
      headers: { 'X-Relay-Channel': channel },
      body: request.method === 'POST' ? request.body : undefined,
      signal: request.signal,
    })

    let res: Response
    try {
      res = await stub.fetch(internal)
    } catch (err) {
      return json({ error: 'relay unavailable' }, 502, allowOrigin)
    }

    // Re-emit with CORS. Passing res.body through preserves SSE streaming.
    const headers = new Headers(res.headers)
    applyCors(headers, allowOrigin)
    return new Response(res.body, { status: res.status, headers })
  },
}

// --- CORS ---

function pickAllowedOrigin(origin: string, env: Env): string {
  const allow = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  // Exact membership only — never suffix-match (`endsWith('.kscw.ch')` would
  // reflect evil.kscw.ch). Fall back to the first configured origin.
  if (origin && allow.includes(origin)) return origin
  return allow[0] || '*'
}

function corsHeaders(allowOrigin: string): Headers {
  const h = new Headers()
  applyCors(h, allowOrigin)
  return h
}

function applyCors(h: Headers, allowOrigin: string): void {
  h.set('Access-Control-Allow-Origin', allowOrigin)
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  h.set('Access-Control-Max-Age', '86400')
  h.append('Vary', 'Origin')
}

function json(body: unknown, status: number, allowOrigin: string): Response {
  const h = corsHeaders(allowOrigin)
  h.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers: h })
}

// Constant-time string compare — closes the timing oracle on RELAY_TOKEN that a
// short-circuiting `!==` would open (mirrors workers/push/src/index.ts).
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}
