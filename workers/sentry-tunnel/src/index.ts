/**
 * Sentry Tunnel — Cloudflare Worker
 *
 * Proxies Sentry envelope requests through our own domain
 * so ad blockers don't block them.
 *
 * Frontend sends to: https://sentry-tunnel.kscw.ch/tunnel
 * Worker forwards to: https://o4511121927766016.ingest.de.sentry.io
 */

interface Env {
  SENTRY_HOST: string
  SENTRY_PROJECT_ID: string
  ALLOWED_ORIGIN: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(origin, env.ALLOWED_ORIGIN),
      })
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('ok')
    }

    // Only accept POST to /tunnel
    if (url.pathname !== '/tunnel' || request.method !== 'POST') {
      return new Response('Not found', { status: 404 })
    }

    // Per-caller rate limit (defence-in-depth — this endpoint is unauthenticated).
    // In-isolate token bucket keyed on CF's trusted client-IP header; best-effort
    // only (state is per-isolate, reset on cold start). Mirrors the push worker.
    const callerIp = request.headers.get('CF-Connecting-IP') || 'unknown'
    if (!rateLimitOk(callerIp)) {
      return new Response('Rate limited', {
        status: 429,
        headers: corsHeaders(origin, env.ALLOWED_ORIGIN),
      })
    }

    // Reject oversized envelopes before reading the body — without a cap an
    // unbounded payload is a memory/egress-amplification primitive. Trust the
    // Content-Length hint first (cheap), then re-check actual bytes below.
    const declaredLen = Number(request.headers.get('Content-Length') || '0')
    if (Number.isFinite(declaredLen) && declaredLen > MAX_ENVELOPE_BYTES) {
      return new Response('Payload too large', {
        status: 413,
        headers: corsHeaders(origin, env.ALLOWED_ORIGIN),
      })
    }

    // Each failure path returns a distinct `Bad envelope: <reason>` so
    // `wrangler tail` shows exactly which branch killed a request.
    //
    // CRITICAL: forward the envelope as RAW BYTES, never a re-encoded string.
    // Session-replay envelopes embed a gzip-compressed binary recording item;
    // decoding that to a JS string (request.text() / TextDecoder) replaces
    // invalid UTF-8 byte sequences with U+FFFD and corrupts the payload, so
    // Sentry rejects the envelope with 400 and we relay that 400 to the browser.
    // Only the first line (the envelope header) is ASCII JSON and safe to decode.
    let headerSnippet = ''
    try {
      const contentEncoding = request.headers.get('Content-Encoding') || ''
      // Enforce the cap on the actual bytes too — Content-Length can be absent
      // (chunked upload) or understated. Read the body through the same capped
      // reader as the gzip branch, so an oversized body is cut off at the cap
      // instead of being buffered whole first (audit 2026-09-28, F70). The gzip
      // branch below enforces the same cap on the DECOMPRESSED size separately.
      const raw = request.body ? await readCapped(request.body, MAX_ENVELOPE_BYTES) : new Uint8Array(0)
      if (raw === null) {
        return new Response('Payload too large', {
          status: 413,
          headers: corsHeaders(origin, env.ALLOWED_ORIGIN),
        })
      }
      let bytes: Uint8Array<ArrayBuffer> = raw

      // If the whole request was gzipped by the client, decompress to raw bytes.
      // (The browser SDK does NOT do this — per-item replay compression lives
      // inside the envelope — but keep the branch for completeness.)
      //
      // ⚠ Never buffer the whole decompressed stream: a few hundred KB of gzip
      // can inflate to gigabytes and kill the isolate (audit 2026-09-28, F70).
      // Read it chunk by chunk and give up the moment the running total passes
      // the same cap the raw body is held to.
      if (contentEncoding.includes('gzip')) {
        try {
          const inflated = await readCapped(
            new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip')),
            MAX_ENVELOPE_BYTES,
          )
          if (inflated === null) {
            return new Response('Payload too large', {
              status: 413,
              headers: corsHeaders(origin, env.ALLOWED_ORIGIN),
            })
          }
          bytes = inflated
        } catch (e) {
          console.error('[sentry-tunnel] gzip-decode-failed:', e instanceof Error ? e.message : String(e))
          return new Response('Bad envelope: gzip-decode-failed', { status: 400 })
        }
      }

      if (bytes.length === 0) {
        return new Response('Bad envelope: empty-body', { status: 400 })
      }

      // Sentry envelope: first line is a JSON header with the dsn. Decode ONLY
      // that line (ASCII) — never the binary body below it.
      const nl = bytes.indexOf(0x0a) // '\n'
      const header = new TextDecoder().decode(nl === -1 ? bytes : bytes.subarray(0, nl))
      headerSnippet = header.slice(0, 200)
      let parsed: { dsn?: unknown }
      try {
        parsed = JSON.parse(header)
      } catch (e) {
        console.error('[sentry-tunnel] header-json-invalid:', e instanceof Error ? e.message : String(e), '| header:', header.slice(0, 200))
        return new Response('Bad envelope: header-json-invalid', { status: 400 })
      }
      const dsn = parsed.dsn
      if (typeof dsn !== 'string' || !dsn) {
        console.error('[sentry-tunnel] no-dsn | header:', header.slice(0, 200))
        return new Response('Bad envelope: no-dsn', { status: 400 })
      }

      let dsnUrl: URL
      try {
        dsnUrl = new URL(dsn)
      } catch {
        console.error('[sentry-tunnel] invalid-dsn-url | dsn:', dsn.slice(0, 200))
        return new Response('Bad envelope: invalid-dsn-url', { status: 400 })
      }

      // Validate: only allow our project
      if (dsnUrl.hostname !== env.SENTRY_HOST || !dsnUrl.pathname.includes(env.SENTRY_PROJECT_ID)) {
        return new Response('Invalid DSN', { status: 403 })
      }

      const sentryUrl = `https://${env.SENTRY_HOST}/api/${env.SENTRY_PROJECT_ID}/envelope/`

      const resp = await fetch(sentryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body: bytes,
      })

      return new Response(resp.body, {
        status: resp.status,
        headers: {
          ...corsHeaders(origin, env.ALLOWED_ORIGIN),
          'Content-Type': 'application/json',
        },
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error('[sentry-tunnel] unexpected:', reason, '| header snippet:', headerSnippet)
      return new Response(`Bad envelope: unexpected (${reason})`, { status: 400 })
    }
  },
}

// Reject envelopes larger than this before processing. Session-replay
// envelopes are the biggest legitimate payloads and sit well under 5 MB;
// anything bigger is malformed or abusive.
const MAX_ENVELOPE_BYTES = 5 * 1024 * 1024 // 5 MB

// Drain a byte stream into one buffer, or return null (and cancel the stream)
// as soon as it exceeds `max` bytes — so an over-limit body is never held in
// memory in full.
async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

// In-isolate per-IP rate limit: sliding window of timestamps. Best-effort only
// (state is per-isolate, reset on cold start) — a durable cap belongs in a
// Cloudflare Rate Limiting rule, but this blunts a single hot caller hammering
// one isolate. Mirrors the push worker's bucket.
const RATE_LIMIT_MAX = 60 // requests
const RATE_LIMIT_WINDOW_MS = 60_000 // per 60s
const rateLimitHits = new Map<string, number[]>()

function rateLimitOk(key: string): boolean {
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const recent = (rateLimitHits.get(key) || []).filter((t) => t > cutoff)
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitHits.set(key, recent)
    return false
  }
  recent.push(now)
  rateLimitHits.set(key, recent)
  // Opportunistic cleanup to bound memory across many distinct IPs.
  if (rateLimitHits.size > 10_000) {
    for (const [k, ts] of rateLimitHits) {
      if (ts.every((t) => t <= cutoff)) rateLimitHits.delete(k)
    }
  }
  return true
}

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  // Only allow exact prod domain, main preview, and Cloudflare Pages preview deploys (commit-hash.wiedisync.pages.dev)
  const isAllowed = origin === allowed || origin === 'https://wiedisync.pages.dev' || /^https:\/\/[a-f0-9]+\.wiedisync\.pages\.dev$/.test(origin)
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}
