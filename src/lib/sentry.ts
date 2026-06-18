/**
 * Sentry error tracking — initialised once in main.tsx.
 *
 * DSN is read from VITE_SENTRY_DSN env var.
 * Source maps are uploaded at build time via @sentry/vite-plugin.
 *
 * Provides rich error context: who (user + role + teams), what (operation),
 * which (collection + record ID), and why (status + response body).
 */

import * as Sentry from '@sentry/react'
import { toError } from '../utils/toError'

const host = typeof window !== 'undefined' ? window.location.hostname : ''
const isProd = host === 'wiedisync.kscw.ch'

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return          // skip in local dev if DSN not set

  Sentry.init({
    dsn,
    tunnel: 'https://sentry-tunnel.kscw.ch/tunnel',
    environment: isProd ? 'production' : 'preview',
    release: import.meta.env.VITE_APP_VERSION || undefined,

    // Performance — sample 20% of transactions in prod, 100% in preview
    tracesSampleRate: isProd ? 0.2 : 1.0,

    // Session replay — capture 10% normally, 100% on error
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.browserTracingIntegration(),
      // Mask all text + inputs in replays — the app renders member names,
      // chat messages, RSVP notes, etc. Without masking, every error replay
      // captures full PII (nFADP issue). Network bodies for our API are also
      // denied since they may carry tokens or member data.
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
        // 2026-05-12 audit #19: also deny our own Sentry tunnel — breadcrumbs
        // captured during replay can include XHR metadata for outbound calls
        // to the tunnel that may carry auth context.
        networkDetailDenyUrls: [
          /directus(?:-dev)?\.kscw\.ch/,
          /sentry-tunnel\.kscw\.ch/,
        ],
      }),
    ],

    // Don't send events from local dev; scrub PII from breadcrumbs;
    // forward all errors to backend JSONL log
    beforeSend(event) {
      if (host === 'localhost' || host === '127.0.0.1') return null
      // Suppress harmless Directus SDK WebSocket auth errors (no token on /login)
      const errMsg = event.exception?.values?.[0]?.value ?? ''
      if (errMsg.includes('No token for authenticating the websocket') ||
          errMsg.includes('No token for re-authenticating the websocket')) return null
      // Suppress @directus/sdk websocket race: re-auth fires after the socket dropped
      // (`r.connection.send` / `connection is undefined`). Realtime auto-reconnects.
      const errStack = event.exception?.values?.[0]?.stacktrace?.frames?.map(f => f.filename ?? '').join(' ') ?? ''
      if (errStack.includes('@directus/sdk') &&
          /connection is undefined|cannot read propert(?:y|ies) of undefined.*\(reading 'send'\)/i.test(errMsg)) return null
      // Suppress browser-extension DOM manipulation errors (Google Translate, Grammarly, etc.)
      if (errMsg.includes("removeChild' on 'Node'") ||
          errMsg.includes("insertBefore' on 'Node'")) return null
      // Suppress Directus's generic "public role" rejection — raised when a fetch
      // fires before the SDK finishes (re)hydrating its auth token. Callers that
      // care (e.g. useBlocks) already catch and treat as empty; a real permission
      // misconfig would surface via the admin UI, not here.
      if (/permission to access collection .* or it does not exist/i.test(errMsg)) return null
      // WIEDISYNC-36: Promise.reject(undefined) / reject() with no value. Sentry
      // synthesizes the "Non-Error promise rejection captured with value: undefined"
      // string for display, but there's no stacktrace and the raw value is empty —
      // not actionable. Typical sources: fetch aborted on route change, SDK race.
      const exType = event.exception?.values?.[0]?.type
      if (exType === 'UnhandledRejection' && /value: undefined$/.test(errMsg)) return null
      // Expired access tokens surface on every in-flight request when a session ages out
      // (e.g. /calendar fires 4-6 parallel useCollection calls → 4-6 Sentry events per expiry).
      // The SDK auto-refreshes or kicks the user to /login; nothing actionable here.
      if (/token expired/i.test(errMsg) || /token has expired/i.test(errMsg)) return null
      // Stale lazy-import chunks after a deploy — App.tsx catches these and hot-reloads
      // the SPA. Mirror the same regex here so the brief race before reload doesn't
      // surface as Sentry noise / false-positive regressions on old guide/route PRs.
      if (/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk \d+ failed|ChunkLoadError|is not a valid JavaScript MIME type|expected a JavaScript(?:-or-Wasm)? module script but the server responded with a MIME type/i.test(errMsg)) return null
      // Strip email-like strings from breadcrumb messages
      if (event.breadcrumbs) {
        for (const bc of event.breadcrumbs) {
          if (typeof bc.message === 'string') {
            bc.message = bc.message.replace(/[\w.+-]+@[\w.-]+\.\w+/g, '[REDACTED]')
          }
        }
      }

      // Forward unhandled errors to backend log (API/auth errors already forwarded)
      const isUnhandled = event.exception?.values?.[0]?.mechanism?.handled === false
      if (isUnhandled) {
        const ex = event.exception?.values?.[0]
        sendToErrorLog({
          source: 'frontend',
          project: 'wiedisync',
          event: 'unhandled_error',
          error: ex?.value || 'Unknown error',
          type: ex?.type || 'Error',
          page: event.request?.url || (typeof window !== 'undefined' ? window.location.pathname : null),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          stack: ex?.stacktrace?.frames?.slice(-5).map(f => `${f.filename}:${f.lineno}:${f.colno} ${f.function || ''}`).join(' <- '),
        })
      }

      return event
    },
  })
}

// ── User context ─────────────────────────────────────────────────

interface SentryUserContext {
  id: string
  displayName?: string
  roles?: string[]
  memberTeamIds?: string[]
  coachTeamIds?: string[]
  primarySport?: string
  isAdmin?: boolean
}

/**
 * Set the Sentry user context after login.
 * Includes role, teams, and sport so every error carries WHO context.
 * Call with null on logout.
 */
export function setSentryUser(user: SentryUserContext | null) {
  if (user) {
    // ID + display name only — no email (PII)
    Sentry.setUser({ id: user.id, username: user.displayName || `member#${user.id}` })
    Sentry.setTag('user.role', user.roles?.join(',') || 'member')
    Sentry.setTag('user.sport', user.primarySport || 'unknown')
    Sentry.setTag('user.is_admin', String(!!user.isAdmin))
    Sentry.setContext('user_teams', {
      member_of: user.memberTeamIds ?? [],
      coach_of: user.coachTeamIds ?? [],
    })
  } else {
    Sentry.setUser(null)
    Sentry.setTag('user.role', undefined)
    Sentry.setTag('user.sport', undefined)
    Sentry.setTag('user.is_admin', undefined)
    Sentry.setContext('user_teams', null)
  }
}

// ── API error capture ────────────────────────────────────────────

/** Structured API error with full context for Sentry + console. */
export class ApiError extends Error {
  status: number
  responseBody: string
  collection: string
  operation: string
  recordId?: string | number

  constructor(opts: {
    message: string
    status: number
    responseBody: string
    collection: string
    operation: string
    recordId?: string | number
  }) {
    super(opts.message)
    this.name = 'ApiError'
    this.status = opts.status
    this.responseBody = opts.responseBody
    this.collection = opts.collection
    this.operation = opts.operation
    this.recordId = opts.recordId
  }
}

/** True if a session likely exists (reads the readable `.kscw.ch` auth hint
 *  cookie set by api.ts — the real session token is an httpOnly cookie). */
function hasAuthToken(): boolean {
  try {
    if (typeof document === 'undefined') return false
    return document.cookie.split('; ').some((c) => c === 'wiedisync_auth=1' || c === 'wiedisync_auth_dev=1')
  } catch { return false }
}

/**
 * Capture an API error with full operation context to Sentry + console.
 * Called automatically from api.ts data helpers — no manual wiring needed.
 */
export function captureApiError(
  error: unknown,
  context: {
    operation: string       // e.g. 'fetchItems', 'createRecord', 'kscwApi'
    collection?: string     // e.g. 'games', 'participations'
    recordId?: string | number
    endpoint?: string       // for kscwApi calls
    method?: string         // HTTP method
    status?: number
    responseBody?: string
    payload?: Record<string, unknown>  // request body (PII-scrubbed)
  },
) {
  const err = toError(error)

  // Transient client-side network failures (signal drop, offline, fetch
  // aborted by navigation) reject with a generic message and NO HTTP status —
  // the request never reached the server, so there's nothing actionable.
  // One flaky mobile connection emits a burst (e.g. the home page's parallel
  // loadTeamContext fetches all failing at once → WIEDISYNC-30/34/43
  // "Load failed" / "Failed to fetch", auto-flagged regressions). Mirror the
  // token-expired carve-out below: console + a downgraded `network_error`
  // (warn — kept for debugging, hidden from the default error view), and
  // skip Sentry so a dropped signal doesn't page anyone. Anchored ^…$ so a
  // real error whose message merely *contains* these words is NOT swallowed,
  // and gated on absent status so every 4xx/5xx (incl. 403 perms) still flows.
  // The @directus/sdk `request` helper appends the API host in parens
  // ("Load failed (directus.kscw.ch)"), so allow an optional trailing " (…)"
  // suffix — without it the anchor missed every SDK fetch reject and these
  // mobile aborts paged anyway (prod 2026-06-18: 6 at once from one iPhone
  // backgrounding /games → fetchItems/fetchAllItems on teams, status null).
  const isTransientNetworkFailure =
    context.status == null &&
    /^(Load failed|Failed to fetch|NetworkError when attempting to fetch resource|The Internet connection appears to be offline|The network connection was lost)\.?(?:\s*\([^)]*\))?$/i.test(
      err.message.trim(),
    )
  if (isTransientNetworkFailure) {
    console.warn(
      `[Network] ${context.operation}${context.collection ? ` on ${context.collection}` : ''} — request did not reach the server (${err.message})`,
    )
    sendToErrorLog({
      source: 'frontend',
      project: 'wiedisync',
      event: 'network_error',
      level: 'warn',
      operation: context.operation,
      collection: context.collection,
      endpoint: context.endpoint,
      method: context.method,
      page: window.location.pathname,
      userAgent: navigator.userAgent,
      error: err.message,
    })
    return
  }

  // Permission/auth denials while there is NO auth token are not bugs — the
  // user is logged out, or the session expired mid-use and in-flight
  // refetches (realtime, react-query) fired before AuthRoute could redirect.
  // Real permission gaps happen WITH a valid session (the userId resolves
  // server-side — that's exactly how the coach_approved_team and
  // message_requests gaps were caught), so gating on an absent token keeps
  // those fully visible while killing the anon/expired churn (logged-out
  // hits to gated pages spamming "no permission to access collection X").
  // Same downgrade contract as the network + token-expired carve-outs.
  const isPermissionDenial =
    context.status === 401 ||
    context.status === 403 ||
    /don't have permission to access|no permission to access|FORBIDDEN|: 40[13]\b/i.test(err.message)
  if (isPermissionDenial && !hasAuthToken()) {
    console.warn(
      `[Unauthenticated] ${context.operation}${context.collection ? ` on ${context.collection}` : ''} while logged out — expected, skipping Sentry`,
    )
    sendToErrorLog({
      source: 'frontend',
      project: 'wiedisync',
      event: 'auth_error',
      level: 'warn',
      action: 'unauthenticated_request',
      operation: context.operation,
      collection: context.collection,
      endpoint: context.endpoint,
      method: context.method,
      status: context.status,
      page: window.location.pathname,
      userAgent: navigator.userAgent,
      error: err.message,
    })
    return
  }

  // Scrub PII from payload before sending
  const safePayload = context.payload ? scrubPii(context.payload) : undefined

  Sentry.withScope((scope) => {
    scope.setTag('error.operation', context.operation)
    if (context.collection) scope.setTag('error.collection', context.collection)
    if (context.status) scope.setTag('error.status', String(context.status))
    if (context.method) scope.setTag('error.method', context.method)
    scope.setContext('api_error', {
      operation: context.operation,
      collection: context.collection ?? null,
      recordId: context.recordId ?? null,
      endpoint: context.endpoint ?? null,
      method: context.method ?? null,
      status: context.status ?? null,
      responseBody: context.responseBody ? scrubResponseBody(context.responseBody).slice(0, 2000) : null,
      payload: safePayload ?? null,
      page: window.location.pathname,
    })
    scope.setFingerprint([
      context.operation,
      context.collection ?? 'unknown',
      String(context.status ?? 'unknown'),
    ])
    scope.setLevel(context.status && context.status < 500 ? 'warning' : 'error')
    Sentry.captureException(err)
  })

  // Also log to console for dev tools debugging
  console.error(
    `[API Error] ${context.operation}${context.collection ? ` on ${context.collection}` : ''}${context.recordId ? `#${context.recordId}` : ''}`,
    {
      status: context.status,
      endpoint: context.endpoint,
      method: context.method,
      page: window.location.pathname,
      response: context.responseBody?.slice(0, 500),
      payload: safePayload,
      error: err.message,
    },
  )

  // Forward to backend JSONL log
  sendToErrorLog({
    source: 'frontend',
    project: 'wiedisync',
    event: 'api_error',
    operation: context.operation,
    collection: context.collection,
    recordId: context.recordId,
    endpoint: context.endpoint,
    method: context.method,
    status: context.status,
    responseBody: context.responseBody?.slice(0, 1000),
    payload: safePayload,
    page: window.location.pathname,
    userAgent: navigator.userAgent,
    error: err.message,
    stack: err.stack?.slice(0, 2000),
  })
}

/**
 * Log an auth-related event (login failure, token refresh failure).
 */
export function captureAuthError(
  error: unknown,
  context: {
    action: string          // e.g. 'login', 'token_refresh'
    method?: string         // 'password', 'otp'
  },
) {
  const err = toError(error)
  // "Token expired." on token_refresh is the normal idle-timeout path —
  // refresh token outlived its TTL and the user simply has to log in again.
  // Not a bug; capturing it spams Sentry (regressed as WIEDISYNC-F on
  // 2026-05-12 with 100+ hits/day). Log to console but skip remote capture.
  if (context.action === 'token_refresh' && /token expired/i.test(err.message)) {
    console.info('[Auth] Refresh token expired — user must re-authenticate')
    return
  }
  Sentry.withScope((scope) => {
    scope.setTag('auth.action', context.action)
    if (context.method) scope.setTag('auth.method', context.method)
    scope.setContext('auth_error', {
      action: context.action,
      method: context.method ?? null,
      page: window.location.pathname,
    })
    scope.setLevel('warning')
    Sentry.captureException(err)
  })
  console.error(`[Auth Error] ${context.action}`, { method: context.method, error: err.message })

  // Forward to backend JSONL log
  sendToErrorLog({
    source: 'frontend',
    project: 'wiedisync',
    event: 'auth_error',
    action: context.action,
    method: context.method,
    page: window.location.pathname,
    userAgent: navigator.userAgent,
    error: err.message,
    stack: err.stack?.slice(0, 2000),
  })
}

/**
 * Add a navigation breadcrumb for debugging context.
 * Called from route changes so Sentry knows what page the user was on.
 */
export function addBreadcrumb(message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: 'app',
    message,
    data,
    level: 'info',
  })
}

// ── Error normalization ──────────────────────────────────────────
// `toError` lives in utils/toError.ts (shared with useMutation) so the
// Directus-shape unwrapping logic can't drift between the two call sites.

// ── PII scrubbing ────────────────────────────────────────────────

const PII_FIELDS = new Set([
  'email', 'password', 'phone', 'birthdate', 'first_name', 'last_name',
  'address', 'iban', 'token', 'access_token', 'refresh_token', 'otp',
])

function scrubPii(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (PII_FIELDS.has(key)) {
      result[key] = '[REDACTED]'
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = scrubPii(val as Record<string, unknown>)
    } else {
      result[key] = val
    }
  }
  return result
}

/**
 * Scrub PII from response body strings before sending to Sentry.
 * Handles both JSON and plain-text responses safely.
 */
function scrubResponseBody(body: string): string {
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(scrubPii(parsed as Record<string, unknown>))
    }
  } catch { /* not JSON — fall through to regex scrub */ }
  // Plain-text fallback: redact email-like strings
  return body.replace(/[\w.+-]+@[\w.-]+\.\w+/g, '[REDACTED]')
}

// ── Forward client errors to backend JSONL log ──────────────────

const API_BASE = (typeof window !== 'undefined' && window.location.hostname === 'wiedisync.kscw.ch')
  ? 'https://directus.kscw.ch'
  : (import.meta.env.VITE_DIRECTUS_URL || 'https://directus-dev.kscw.ch')

/**
 * Fire-and-forget: send a client error to the backend JSONL log.
 * Never throws — logging should not break the app.
 */
function sendToErrorLog(entry: Record<string, unknown>) {
  try {
    // Skip in local dev
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) return

    // Skip empty entries — backend would log them as null-field noise
    if (!entry.error && !entry.stack && !entry.type && !entry.responseBody) return

    // Session cookie (if any) identifies the user; anonymous errors on public
    // pages send no cookie and are logged without a user — both accepted.
    fetch(`${API_BASE}/kscw/client-error`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true, // survives page unload
    }).catch(() => {}) // truly fire-and-forget
  } catch { /* never block */ }
}

/** Re-export ErrorBoundary for use in App.tsx */
export const SentryErrorBoundary = Sentry.ErrorBoundary
