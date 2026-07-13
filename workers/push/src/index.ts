// KSCW Web Push Worker
// Receives push requests from Directus hooks and delivers via Web Push API.
// Uses Web Crypto API for VAPID JWT signing (no npm dependencies needed).

interface Env {
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  // 2026-05-12 audit #21: VAPID `sub` claim — owner contact for push
  // providers when a subscription causes problems. Sourced from worker
  // secret (`wrangler secret put VAPID_SUB`), falling back to a generic
  // mailto inside createVapidJwt for the unset case.
  VAPID_SUB?: string
  ALLOWED_ORIGIN: string
  AUTH_SECRET: string
}

interface PushRequest {
  subscriptions: PushSubscription[]
  title: string
  body: string
  url?: string
  tag?: string
}

interface PushSubscription {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

interface PushResult {
  sent: number
  failed: number
  errors: string[]
  expired: string[] // subscription endpoints that returned 404/410 (should be removed)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health endpoint — restricted CORS. Exact-origin allowlist (no suffix
    // matching): `endsWith('.kscw.ch')` would reflect arbitrary subdomains
    // like `https://evil.kscw.ch`, so we test exact membership instead.
    if (url.pathname === '/health') {
      const origin = request.headers.get('Origin') || ''
      const allowedOrigin = isAllowedOrigin(origin, env) ? origin : env.ALLOWED_ORIGIN
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders(allowedOrigin) })
      }
      return json({ ok: true }, 200, allowedOrigin)
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(env.ALLOWED_ORIGIN),
      })
    }

    // Fail-closed guard — never collapse to comparing against the literal
    // `Bearer undefined`. If `AUTH_SECRET` is unset/empty/too short (forgotten
    // on a redeploy or a fresh env), reject every request rather than letting
    // an attacker pass with `Authorization: Bearer undefined`.
    if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
      return json({ error: 'misconfigured' }, 500, env.ALLOWED_ORIGIN)
    }

    // Auth check — shared secret from Directus hooks. Constant-time compare
    // closes the timing-oracle on `AUTH_SECRET`: JS `!==` short-circuits on
    // the first differing byte, leaking the secret one char at a time over
    // network latency.
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || !timingSafeEqualStr(authHeader, `Bearer ${env.AUTH_SECRET}`)) {
      return json({ error: 'unauthorized' }, 401, env.ALLOWED_ORIGIN)
    }

    if (request.method === 'POST' && url.pathname === '/push') {
      // Basic per-caller rate limit (defence-in-depth on top of the auth gate).
      // Keyed on the client IP from CF's trusted header. This is an in-isolate
      // token bucket — best-effort, not durable across isolates; for a hard
      // global cap add a Cloudflare Rate Limiting rule or a KV/Durable-Object
      // backstop in wrangler.toml (no binding available in this file).
      const callerIp = request.headers.get('CF-Connecting-IP') || 'unknown'
      if (!rateLimitOk(callerIp)) {
        return json({ error: 'rate limited' }, 429, env.ALLOWED_ORIGIN)
      }
      return handlePush(request, env)
    }

    return json({ error: 'not found' }, 404, env.ALLOWED_ORIGIN)
  },
}

// Hard cap on subscriptions per request — the caller hands us the list and
// we fan out one outbound fetch per entry, so an unbounded array is a spam /
// egress-amplification primitive. Real fan-outs are well under this.
const MAX_SUBSCRIPTIONS = 500

// In-isolate per-IP rate limit: sliding window of timestamps. Best-effort only
// (state is per-isolate, reset on cold start) — a durable cap belongs in a
// Cloudflare Rate Limiting rule or KV/Durable-Object binding, but this still
// blunts a single hot caller hammering one isolate.
const RATE_LIMIT_MAX = 30 // requests
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

// Only deliver to known push-service hosts. Each `fetch(sub.endpoint)` targets
// a caller-supplied URL; without this allowlist the worker is an arbitrary-host
// fetch (SSRF-ish) relay. Matched against the endpoint URL host (exact or
// dot-suffixed subdomain — anchored, not a substring match).
const ALLOWED_PUSH_HOSTS = [
  'googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
]

function isAllowedPushEndpoint(endpoint: string): boolean {
  let host: string
  try {
    const u = new URL(endpoint)
    if (u.protocol !== 'https:') return false
    host = u.host.toLowerCase()
  } catch {
    return false
  }
  return ALLOWED_PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

function isValidSubscription(sub: unknown): sub is PushSubscription {
  if (!sub || typeof sub !== 'object') return false
  const s = sub as Record<string, unknown>
  if (typeof s.endpoint !== 'string' || !s.endpoint) return false
  const keys = s.keys as Record<string, unknown> | undefined
  if (!keys || typeof keys !== 'object') return false
  return typeof keys.p256dh === 'string' && typeof keys.auth === 'string'
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  let body: PushRequest
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid payload' }, 400, env.ALLOWED_ORIGIN)
  }

  if (!body || !Array.isArray(body.subscriptions) || body.subscriptions.length === 0) {
    return json({ error: 'no subscriptions' }, 400, env.ALLOWED_ORIGIN)
  }

  if (body.subscriptions.length > MAX_SUBSCRIPTIONS) {
    return json({ error: 'too many subscriptions' }, 413, env.ALLOWED_ORIGIN)
  }

  const payload = JSON.stringify({
    title: body.title || 'KSC Wiedikon',
    body: body.body || '',
    url: body.url || 'https://wiedisync.kscw.ch',
    tag: body.tag || undefined,
  })

  const result: PushResult = { sent: 0, failed: 0, errors: [], expired: [] }

  const promises = body.subscriptions.map(async (sub) => {
    // Drop malformed entries and any endpoint not on a known push service —
    // closes the arbitrary-host fetch primitive without failing the batch.
    if (!isValidSubscription(sub) || !isAllowedPushEndpoint(sub.endpoint)) {
      result.errors.push('Rejected invalid or untrusted subscription')
      result.failed++
      return
    }
    try {
      const response = await sendWebPush(sub, payload, env)

      if (response.status === 201) {
        result.sent++
      } else if (response.status === 404 || response.status === 410) {
        // Subscription expired or unsubscribed — caller should delete it
        result.expired.push(sub.endpoint)
        result.failed++
      } else {
        const text = await response.text()
        result.errors.push(`${response.status}: ${text.slice(0, 100)}`)
        result.failed++
      }
    } catch (e) {
      result.errors.push(String(e))
      result.failed++
    }
  })

  await Promise.all(promises)

  return json(result, 200, env.ALLOWED_ORIGIN)
}

// ── Web Push with VAPID ───────────────────────────────────────────────

async function sendWebPush(
  sub: PushSubscription,
  payload: string,
  env: Env
): Promise<Response> {
  const endpoint = new URL(sub.endpoint)
  const audience = `${endpoint.protocol}//${endpoint.host}`

  // Create VAPID JWT
  const jwt = await createVapidJwt(audience, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY, env.VAPID_SUB)

  // Encrypt payload using the subscription's keys
  const encrypted = await encryptPayload(payload, sub.keys.p256dh, sub.keys.auth)

  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'normal',
    },
    body: encrypted,
  })
}

// ── VAPID JWT ─────────────────────────────────────────────────────────

async function createVapidJwt(
  audience: string,
  privateKeyB64: string,
  _publicKeyB64: string,
  sub?: string
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    aud: audience,
    exp: now + 86400, // 24h
    sub: sub && /^mailto:[^@\s]+@[^@\s]+$/.test(sub) ? sub : 'mailto:kontakt@kscw.ch',
  }

  const headerB64 = b64url(new TextEncoder().encode(JSON.stringify(header)))
  const claimsB64 = b64url(new TextEncoder().encode(JSON.stringify(claims)))
  const unsigned = `${headerB64}.${claimsB64}`

  // Import ECDSA P-256 private key
  const keyData = b64urlDecode(privateKeyB64)
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: privateKeyB64,
      x: '', // will be set below
      y: '',
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  ).catch(() => {
    // Fallback: import as raw PKCS8
    return importRawPrivateKey(keyData)
  })

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  )

  // Convert DER signature to raw r||s (64 bytes)
  const sigBytes = new Uint8Array(signature)
  const rawSig = sigBytes.length === 64 ? sigBytes : derToRaw(sigBytes)

  return `${unsigned}.${b64url(rawSig)}`
}

async function importRawPrivateKey(keyData: Uint8Array): Promise<CryptoKey> {
  // Build JWK from raw 32-byte private key scalar
  // We need the public key too, but we can derive it — or use PKCS8
  // For simplicity, build a PKCS8 wrapper
  const pkcs8 = buildPkcs8(keyData)
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
}

function buildPkcs8(privateKey: Uint8Array): Uint8Array {
  // PKCS8 wrapper for EC P-256 private key (32 bytes)
  // Fixed ASN.1 structure
  const prefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06,
    0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
    0x01, 0x04, 0x20,
  ])
  const result = new Uint8Array(prefix.length + privateKey.length)
  result.set(prefix)
  result.set(privateKey, prefix.length)
  return result
}

// ── Payload encryption (RFC 8291 / aes128gcm) ────────────────────────

async function encryptPayload(
  payload: string,
  p256dhB64: string,
  authB64: string
): Promise<Uint8Array> {
  const payloadBytes = new TextEncoder().encode(payload)

  // Decode subscriber's public key and auth secret
  const subscriberPubKey = b64urlDecode(p256dhB64)
  const authSecret = b64urlDecode(authB64)

  // Generate ephemeral ECDH key pair
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )

  // Export ephemeral public key (raw, 65 bytes)
  const ephemeralPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeral.publicKey)
  )

  // Import subscriber's public key
  const subKey = await crypto.subtle.importKey(
    'raw',
    subscriberPubKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )

  // ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: subKey },
      ephemeral.privateKey,
      256
    )
  )

  // IKM = HKDF-Extract(auth_secret, ecdh_secret)
  // But Web Crypto HKDF combines extract+expand, so we use a two-step approach
  const ikmKey = await crypto.subtle.importKey(
    'raw', sharedSecret, 'HKDF', false, ['deriveBits']
  )

  // info for IKM: "WebPush: info\0" + subscriber_pub + sender_pub
  const ikmInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    subscriberPubKey,
    ephemeralPubRaw
  )

  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: ikmInfo },
      ikmKey,
      256
    )
  )

  // Derive content encryption key (CEK) and nonce
  const salt = crypto.getRandomValues(new Uint8Array(16))

  const cekKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0')
  const cekBits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo },
      cekKey,
      128
    )
  )

  const nonceKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0')
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo },
      nonceKey,
      96
    )
  )

  // Pad payload (add 0x02 delimiter)
  const padded = new Uint8Array(payloadBytes.length + 1)
  padded.set(payloadBytes)
  padded[payloadBytes.length] = 0x02 // padding delimiter

  // AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey(
    'raw', cekBits, 'AES-GCM', false, ['encrypt']
  )
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      aesKey,
      padded
    )
  )

  // Build aes128gcm record:
  // salt (16) + rs (4, uint32 BE) + idlen (1) + keyid (65, ephemeral pub) + ciphertext
  const rs = 4096
  const header = new Uint8Array(16 + 4 + 1 + ephemeralPubRaw.length)
  header.set(salt, 0)
  header[16] = (rs >> 24) & 0xff
  header[17] = (rs >> 16) & 0xff
  header[18] = (rs >> 8) & 0xff
  header[19] = rs & 0xff
  header[20] = ephemeralPubRaw.length
  header.set(ephemeralPubRaw, 21)

  const result = new Uint8Array(header.length + encrypted.length)
  result.set(header)
  result.set(encrypted, header.length)

  return result
}

// ── Utilities ─────────────────────────────────────────────────────────

function b64url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice(0, (4 - (str.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function derToRaw(der: Uint8Array): Uint8Array {
  // ECDSA DER signature → raw r||s (each 32 bytes)
  const raw = new Uint8Array(64)
  let offset = 2 // skip SEQUENCE tag + length
  // R value
  const rLen = der[offset + 1]
  offset += 2
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset
  const rDest = rLen < 32 ? 32 - rLen : 0
  raw.set(der.slice(rStart, rStart + Math.min(rLen, 32)), rDest)
  offset += rLen
  // S value
  const sLen = der[offset + 1]
  offset += 2
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset
  const sDest = sLen < 32 ? 64 - sLen : 32
  raw.set(der.slice(sStart, sStart + Math.min(sLen, 32)), sDest)
  return raw
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let len = 0
  for (const a of arrays) len += a.length
  const result = new Uint8Array(len)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  // Always compare a fixed-length buffer to avoid leaking length differences
  // via a quick exit. We XOR pad against the longer of the two and OR-fold
  // a length-mismatch flag into the result.
  const len = Math.max(aBytes.length, bBytes.length)
  let diff = aBytes.length ^ bBytes.length
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
  }
  return diff === 0
}

// Exact-origin allowlist for CORS. No suffix matching — a bare
// `endsWith('.kscw.ch')` accepts attacker-controlled subdomains
// (`https://evil.kscw.ch`). We test exact known origins plus the
// `<hash>.wiedisync.pages.dev` CF Pages preview pattern (anchored).
function isAllowedOrigin(origin: string, env: Env): boolean {
  if (!origin) return false
  const exact = new Set([
    env.ALLOWED_ORIGIN,
    'https://wiedisync.kscw.ch',
    'https://wiedisync.pages.dev',
    'http://localhost:5173',
    'http://localhost:4173',
  ])
  if (exact.has(origin)) return true
  // CF Pages branch/preview deploys: https://<hash>.wiedisync.pages.dev
  return /^https:\/\/[a-z0-9-]+\.wiedisync\.pages\.dev$/.test(origin)
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function json(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
    },
  })
}
