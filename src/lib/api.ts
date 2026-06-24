/**
 * Directus API client — thin, typed wrapper around @directus/sdk + fetch.
 *
 * All data access goes through this module. No component should import
 * @directus/sdk or directus.ts directly — use the query hooks instead.
 */

import {
  createDirectus, rest, authentication, realtime,
  readItems, readItem, createItem, updateItem, deleteItem,
  aggregate,
} from '@directus/sdk'
import { captureApiError, captureAuthError } from './sentry'

// ── Config ──────────────────────────────────────────────────────────

// Cookie-session auth (2026-06-18): the access + refresh token live in an
// httpOnly cookie scoped to `.kscw.ch` (set by Directus), unreadable from JS.
// We keep a NON-sensitive boolean "hint" in a readable cookie ALSO scoped to
// `.kscw.ch` so the app can (a) synchronously decide whether a session likely
// exists — gating the session-restore spinner, the 401-retry guard, realtime/
// activity-log gating — and (b) SHARE that knowledge across the member +
// scheduling subdomains (localStorage is per-origin and would break SSO; a
// `.kscw.ch` cookie is shared, exactly like the real session cookie). The
// cookie remains the only actual credential; the hint carries no secret.
function authHintKey(): string {
  // Distinct per backend env so a dev login and a prod login can coexist in one
  // browser without the hint (or the real session cookie) colliding on .kscw.ch.
  return API_URL.includes('directus-dev') ? 'wiedisync_auth_dev' : 'wiedisync_auth'
}

export function setAuthHint(present: boolean): void {
  if (typeof document === 'undefined') return
  // domain=.kscw.ch → shared across subdomains (rejected on localhost/pages.dev,
  // where cookie-session auth doesn't work anyway). secure + lax mirrors the
  // real session cookie.
  const key = authHintKey()
  const attrs = 'domain=.kscw.ch; path=/; secure; samesite=lax'
  document.cookie = present ? `${key}=1; ${attrs}; max-age=604800` : `${key}=; ${attrs}; max-age=0`
}

const host = typeof window !== 'undefined' ? window.location.hostname : ''
const isProd = host === 'wiedisync.kscw.ch'
const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
// `npm run dev:prod` sets VITE_PROD_DATA=1 → vite.config.ts spins up a
// reverse proxy that forwards `/directus/*` (REST + WS) to prod Directus.
// In that mode we use a relative `/directus` prefix so all browser fetches
// stay same-origin (no CORS preflight) and the proxy does the heavy lift.
const useProdProxy = isLocalhost && import.meta.env.VITE_PROD_DATA === '1'
// Localhost ALWAYS points at dev Directus by default, regardless of
// `VITE_DIRECTUS_URL` in `.env*` — prod Directus has a strict CORS allowlist
// that doesn't and shouldn't include localhost, so an env override that
// pointed there would just yield "blocked by CORS policy" on every fetch.
// Prod hostname always points at prod. Any other host (CF Pages preview,
// pages.dev, custom preview domains) honors the env or falls back to dev.
export const API_URL = isProd
  ? 'https://directus.kscw.ch'
  : useProdProxy
    ? '/directus'
    : isLocalhost
      ? 'https://directus-dev.kscw.ch'
      : (import.meta.env.VITE_DIRECTUS_URL || 'https://directus-dev.kscw.ch')

// Loud red banner on every page load when proxying prod — writes from the
// dev server hit live data and that fact can otherwise drift out of mind.
if (useProdProxy && typeof window !== 'undefined') {
  console.warn(
    '%c⚠ DEV SERVER PROXYING PROD DIRECTUS — every write hits live data',
    'background:#dc2626;color:#fff;padding:4px 10px;font-weight:bold;font-size:13px;border-radius:3px;',
  )
}

// ── Scheduling app origin ───────────────────────────────────────────
// The game-scheduling feature lives on its own subdomain
// (spielplanung.wiedisync.kscw.ch). Opponent-invite links must point THERE,
// not at whatever origin the admin happens to be browsing from. Driven by
// `VITE_SCHEDULING_ORIGIN` (set per Cloudflare Pages project). Until that's set
// — i.e. before the subdomain is live — we fall back to the current origin so
// invite links keep working exactly as they do today (this is a no-op flip).
export const SCHEDULING_ORIGIN: string =
  (import.meta.env.VITE_SCHEDULING_ORIGIN as string | undefined) ||
  (typeof window !== 'undefined' ? window.location.origin : 'https://wiedisync.kscw.ch')

// ── Client ──────────────────────────────────────────────────────────

// Cookie session mode (2026-06-18): the access + refresh token live in an
// httpOnly, Secure, SameSite=Lax cookie scoped to `.kscw.ch` (Directus
// SESSION_COOKIE_*), shared across the member + scheduling subdomains (SSO) and
// unreadable from JS — this CLOSES the former localStorage-token accepted risk.
// Every request must carry the cookie → `credentials: 'include'` on both the
// auth composable (login/refresh) and rest (data). The browser persists the
// cookie per its TTL, so this also removes the old iOS-PWA sessionStorage hack.
export const client = createDirectus(API_URL)
  .with(authentication('session', { credentials: 'include', autoRefresh: true }))
  .with(rest({ credentials: 'include' }))
  .with(realtime({
    // The Directus SDK detects URL overrides with `'url' in config` — passing
    // `url: undefined` still hits that branch, then `new URL(undefined)`
    // throws "Invalid URL" and crashes the page (WIEDISYNC-3Q). Only include
    // the key when we genuinely want to override the derived URL. In proxy
    // mode (`npm run dev:prod`), API_URL is the relative `/directus` prefix
    // and the SDK would derive `/directus/websocket` which the browser
    // rejects (WebSocket needs absolute ws:// or wss://); we build the
    // absolute proxy URL explicitly and vite's `ws: true` entry forwards it.
    ...(useProdProxy && typeof window !== 'undefined'
      ? { url: `${window.location.origin.replace(/^http/, 'ws')}/directus/websocket` }
      : {}),
    authMode: 'handshake',
    heartbeat: false,
    reconnect: { delay: 5000, retries: 2 },
  }))

// Catch unhandled WebSocket auth errors from the Directus SDK.
// The SDK throws unhandled rejections when it tries to authenticate/re-authenticate
// the WebSocket without a valid token (e.g. on /login with stale tokens, or after
// token expiry). These are harmless — the app works fine without realtime.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message ?? ''
    if (
      msg.includes('No token for authenticating the websocket') ||
      msg.includes('No token for re-authenticating the websocket') ||
      (msg.includes('send') && e.reason?.stack?.includes('@directus/sdk'))
    ) {
      e.preventDefault()
    }
  })
}

// ── Auth helpers ────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  try {
    const result = await client.login({ email, password })
    setAuthHint(true)
    return result
  } catch (err) {
    captureAuthError(err, { action: 'login', method: 'password' })
    throw err
  }
}

export async function logout() {
  try { await client.logout() } catch { /* ignore */ }
  setAuthHint(false)
  // Clean up legacy token storage from the pre-cookie era + local caches.
  localStorage.removeItem('directus_auth')
  sessionStorage.removeItem('directus_auth')
  localStorage.removeItem('wiedisync-sql-history')
}

// Centralized refresh lock — prevents concurrent refreshes from consuming
// the one-time-use refresh token multiple times (race condition on page load
// when multiple requests fire simultaneously with an expired access token).
let _refreshPromise: Promise<unknown> | null = null

export async function refreshAuth() {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = client.refresh()
    .catch((err) => {
      captureAuthError(err, { action: 'token_refresh' })
      throw err
    })
    .finally(() => { _refreshPromise = null })
  return _refreshPromise
}

export function isAuthenticated(): boolean {
  // The session token is an httpOnly cookie (unreadable from JS); rely on the
  // readable `.kscw.ch` hint cookie set on login / cleared on logout + failed
  // restore. Shared across subdomains, so it reflects an SSO login on a sibling.
  if (typeof document === 'undefined') return false
  const key = authHintKey()
  return document.cookie.split('; ').some((c) => c === `${key}=1`)
}

// ── Current member ID (for activity logging outside React context) ──

let _currentMemberId: string | number | null = null

export function setCurrentMemberId(id: string | number | null): void { _currentMemberId = id }
export function getCurrentMemberId(): string | number | null { return _currentMemberId }

/** Detect Directus "no permission" errors (token refresh race). */
function isPermissionError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? ''
  return msg.includes("don't have permission") || msg.includes('does not exist')
}

// ── Data helpers ────────────────────────────────────────────────────

/**
 * Numeric data fields that must stay as numbers (not foreign keys).
 * Every other integer field is assumed to be a FK/ID and gets stringified.
 */
const KEEP_AS_NUMBER = new Set([
  'home_score', 'away_score', 'min_participants', 'max_participants',
  'max_players', 'day_of_week', 'guest_level', 'amount', 'rank',
  'points', 'won', 'lost', 'played', 'draws', 'sets_won', 'sets_lost',
  'points_won', 'points_lost', 'point_diff',
  'wins_clear', 'wins_narrow', 'defeats_clear', 'defeats_narrow',
  'sort_order', 'number', 'courts', 'lat', 'lon',
  'game_min_participants', 'game_respond_by_days',
  'training_min_participants', 'training_respond_by_days',
  'guest_count', 'confirmed_proposal', 'seats_available',
  'respond_by_days', 'count',
  'rating_verein', 'rating_vorstand', 'rating_tk_leitung',
  'rating_training', 'rating_kommunikation',
])

/** Coerce Directus integer IDs/FKs to strings for frontend compat. */
export function stringifyIds<T>(items: T[]): T[] {
  return items.map(item => stringifyId(item))
}

export function stringifyId<T>(item: T): T {
  if (item && typeof item === 'object') {
    const obj = { ...item } as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'number' && !KEEP_AS_NUMBER.has(key)) {
        obj[key] = String(obj[key])
      }
    }
    return obj as T
  }
  return item
}

/**
 * Convert M2M `teams` junction array to a flat `team` string[] on HallSlot items.
 * Directus returns M2M as [{teams_id: 5}, ...] or [57, ...] (junction row IDs).
 * The app uses slot.team as string[] of team IDs internally.
 */
export function flattenM2MTeams<T extends Record<string, unknown>>(items: T[]): T[] {
  return items.map(item => {
    const teams = item.teams as unknown[] | undefined
    if (!Array.isArray(teams)) return { ...item, team: [] }
    const teamIds = teams.map(t => {
      if (typeof t === 'object' && t !== null && 'teams_id' in t) return String((t as { teams_id: unknown }).teams_id)
      return String(t)
    }).filter(Boolean)
    return { ...item, team: teamIds }
  }) as T[]
}

/**
 * Convert a flat team string[] to M2M format for saving to Directus.
 * Strips the `team` field and adds `teams` in junction format.
 */
export function teamToM2M(payload: Record<string, unknown>): Record<string, unknown> {
  const { team, ...rest } = payload
  if (!Array.isArray(team)) return rest
  return { ...rest, teams: (team as string[]).map(id => ({ teams_id: id })) }
}

/** Fetch a list of items. Returns the array directly. */
export async function fetchItems<T = Record<string, unknown>>(
  collection: string,
  query?: {
    filter?: Record<string, unknown>
    sort?: string[]
    fields?: string[]
    limit?: number
    offset?: number
    deep?: Record<string, unknown>
    search?: string
  },
): Promise<T[]> {
  const q: Record<string, unknown> = {}
  if (query?.filter) q.filter = query.filter
  if (query?.sort) q.sort = query.sort
  if (query?.fields) q.fields = query.fields
  if (query?.limit !== undefined) q.limit = query.limit
  if (query?.offset !== undefined) q.offset = query.offset
  if (query?.deep) q.deep = query.deep
  if (query?.search) q.search = query.search
  try {
    const items = await client.request<T[]>(readItems(collection, q as never))
    return stringifyIds(items)
  } catch (err) {
    // Token refresh race: SDK sent an expired token, Directus rejected as "root".
    // Retry once after forcing a token refresh.
    if (isPermissionError(err) && isAuthenticated()) {
      try {
        await refreshAuth()
        const items = await client.request<T[]>(readItems(collection, q as never))
        return stringifyIds(items)
      } catch { /* fall through to original error */ }
    }
    captureApiError(err, { operation: 'fetchItems', collection, payload: q as Record<string, unknown> })
    throw err
  }
}

/** Fetch all items (no pagination). */
export async function fetchAllItems<T = Record<string, unknown>>(
  collection: string,
  query?: {
    filter?: Record<string, unknown>
    sort?: string[]
    fields?: string[]
    deep?: Record<string, unknown>
  },
): Promise<T[]> {
  try {
    return await fetchItems<T>(collection, { ...query, limit: -1 })
  } catch (err) {
    captureApiError(err, { operation: 'fetchAllItems', collection })
    throw err
  }
}

/** Fetch a single item by ID. */
export async function fetchItem<T = Record<string, unknown>>(
  collection: string,
  id: string | number,
  query?: { fields?: string[] },
): Promise<T> {
  try {
    const item = await client.request<T>(readItem(collection, id, query as never))
    return stringifyId(item)
  } catch (err) {
    if (isPermissionError(err) && isAuthenticated()) {
      try {
        await refreshAuth()
        const item = await client.request<T>(readItem(collection, id, query as never))
        return stringifyId(item)
      } catch { /* fall through */ }
    }
    captureApiError(err, { operation: 'fetchItem', collection, recordId: id })
    throw err
  }
}

/** Count items in a collection. */
export async function countItems(
  collection: string,
  filter?: Record<string, unknown>,
): Promise<number> {
  try {
    const result = await client.request(aggregate(collection, {
      aggregate: { count: '*' },
      query: filter ? { filter } as never : undefined,
    }))
    return Number(result[0]?.count ?? 0)
  } catch (err) {
    captureApiError(err, { operation: 'countItems', collection })
    throw err
  }
}

/**
 * Fetch the distinct, descending-sorted values of a season-scoped collection's
 * `season` field via Directus `groupBy`. Used by `useEffectiveSeason`.
 *
 * Directus rejects comparison operators (`_lte`/`_lt`) on `string`-typed fields
 * with a 400, so the season is selected client-side rather than server-side. A
 * `groupBy` aggregate returns one row per distinct season regardless of how many
 * games/rankings rows that season has, so the result set stays tiny.
 */
export async function fetchSeasons(collection: 'games' | 'rankings'): Promise<string[]> {
  try {
    const result = await client.request(aggregate(collection, {
      aggregate: { count: '*' },
      groupBy: ['season'],
      query: { sort: ['-season'] } as never,
    }))
    return (result as Array<{ season: string | null }>)
      .map(r => r.season)
      .filter((s): s is string => !!s)
  } catch (err) {
    captureApiError(err, { operation: 'fetchSeasons', collection })
    throw err
  }
}

/** Create a new item. */
export async function createRecord<T = Record<string, unknown>>(
  collection: string,
  data: Record<string, unknown>,
  opts: { silentOnUnique?: boolean } = {},
): Promise<T> {
  try {
    const item = await client.request<T>(createItem(collection, data as never))
    return stringifyId(item)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (opts.silentOnUnique && /has to be unique/i.test(msg)) {
      // Pre-check raced or RLS hid an existing row; the (member, team) invariant
      // is satisfied either way. Caller will refetch.
      throw err
    }
    captureApiError(err, { operation: 'createRecord', collection, payload: data })
    throw err
  }
}

/** Update an item. */
export async function updateRecord<T = Record<string, unknown>>(
  collection: string,
  id: string | number,
  data: Record<string, unknown>,
): Promise<T> {
  try {
    const item = await client.request<T>(updateItem(collection, id, data as never))
    return stringifyId(item)
  } catch (err) {
    captureApiError(err, { operation: 'updateRecord', collection, recordId: id, payload: data })
    throw err
  }
}

/** Delete an item. */
export async function deleteRecord(
  collection: string,
  id: string | number,
): Promise<void> {
  try {
    await client.request(deleteItem(collection, id))
  } catch (err) {
    captureApiError(err, { operation: 'deleteRecord', collection, recordId: id })
    throw err
  }
}

/**
 * Upload a single file to Directus (`POST /files`) as the current user and
 * return its id + display name. Used by the `file` form-field type. Members
 * already hold `directus_files.create` (profile photos / feedback screenshots).
 */
export async function uploadFile(file: File, folder?: string): Promise<{ id: string; name: string }> {
  const fd = new FormData()
  // Non-file fields must precede the file part for Directus to apply them as
  // metadata — `folder` drops the upload straight into a (private) folder.
  if (folder) fd.append('folder', folder)
  fd.append('file', file)
  const res = await fetch(`${API_URL}/files`, {
    method: 'POST',
    credentials: 'include', // session cookie carries auth (no Bearer header)
    body: fd,
  })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
  const { data } = await res.json()
  return { id: String(data.id), name: data.filename_download || file.name }
}

/**
 * Open a PRIVATE Directus asset (e.g. a finance invoice PDF in the private folder)
 * in a new tab. A plain /assets link only carries the session cookie same-site, so
 * fetch it credentialed → object URL → open. Caller should revoke the URL later or
 * let the tab own it. Throws on 403 (no access) / network error.
 */
export async function openPrivateAsset(fileId: string): Promise<void> {
  const res = await fetch(assetUrl(fileId), { credentials: 'include' })
  if (!res.ok) throw new Error(`Asset ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Get a Directus asset URL (images, files). */
export function assetUrl(fileId: string | null | undefined, transforms?: string): string {
  if (!fileId) return ''
  return transforms ? `${API_URL}/assets/${fileId}?${transforms}` : `${API_URL}/assets/${fileId}`
}

/**
 * Call a custom KSCW endpoint.
 *
 * `anonymous: true` sends NO Authorization header even when a member is logged
 * in. Use it for genuinely public endpoints (token-in-URL is the auth), e.g. the
 * Terminplanung opponent flow: attaching a logged-in member's Bearer there only
 * hurt — a stale/expired access token makes Directus' global auth middleware
 * reject the request with 401 *before* the public endpoint runs, which surfaced
 * as a spurious "Invalid link" on first load (WIEDISYNC first-load bug).
 */
export async function kscwApi<T = unknown>(
  path: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string>; anonymous?: boolean },
): Promise<T> {
  const method = options?.method || 'GET'
  const anonymous = options?.anonymous === true

  const doFetch = async (): Promise<Response> => {
    return fetch(`${API_URL}/kscw${path}`, {
      method,
      // Authenticated calls send the `.kscw.ch` session cookie. Anonymous calls
      // (token-in-URL opponent flow) MUST omit it — a logged-in admin's cookie
      // hitting a public endpoint trips Directus' global auth middleware (401
      // "Invalid link") before the public handler runs, the same first-load bug
      // the Bearer-omitting `anonymous` flag originally guarded against.
      credentials: anonymous ? 'omit' : 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    })
  }

  let res: Response
  try {
    res = await doFetch()
  } catch (err) {
    // Network error (offline, DNS, CORS)
    captureApiError(err, {
      operation: 'kscwApi',
      endpoint: path,
      method,
      payload: options?.body as Record<string, unknown> | undefined,
    })
    throw err
  }

  // Token refresh race: retry once after refreshing if we got 401/403.
  // Skipped for anonymous calls — there's no auth to refresh, and a public
  // endpoint's own 401 ("Invalid or expired link") must surface unchanged.
  if (!anonymous && (res.status === 401 || res.status === 403) && isAuthenticated()) {
    try {
      await refreshAuth()
      res = await doFetch()
    } catch { /* fall through to original error handling */ }
  }

  if (!res.ok) {
    const responseBody = await res.text().catch(() => '')
    const err = new Error(`API ${path}: ${res.status}`) as Error & { code?: string; body?: unknown }
    // Parse response body and attach error code + full body if present (callers
    // like the Terminplanung opponent flow map on body.error / body.teams).
    try { const parsed = JSON.parse(responseBody); if (parsed?.code) err.code = parsed.code; err.body = parsed } catch { /* ignore */ }
    // Benign: an unauthenticated session hitting a protected endpoint (e.g. iOS
    // Safari evicted the stored token while backgrounded). The throw still drives
    // the login redirect; reporting it to Sentry/JSONL is just noise. Mirrors the
    // no-token auth-error suppression in sentry.ts. Real auth bugs (401/403 while
    // authenticated, refresh failed) still fall through to captureApiError below.
    if (res.status === 401 && !isAuthenticated()) throw err
    captureApiError(err, {
      operation: 'kscwApi',
      endpoint: path,
      method,
      status: res.status,
      responseBody,
      payload: options?.body as Record<string, unknown> | undefined,
    })
    throw err
  }
  return res.json()
}
