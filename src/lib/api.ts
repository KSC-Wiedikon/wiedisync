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

const AUTH_KEY = 'directus_auth'
const REMEMBER_KEY = 'wiedisync-remember-me'

/** Detect standalone PWA mode (Add to Home Screen). */
const isStandalone = typeof window !== 'undefined' && (
  (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches
)

function isRememberMe(): boolean {
  return localStorage.getItem(REMEMBER_KEY) !== 'false'
}
function getStorage(): Storage {
  // In standalone PWA mode, sessionStorage is cleared when the app is
  // backgrounded/killed by the OS (especially iOS). Always use localStorage
  // so auth tokens survive app restarts.
  if (isStandalone) return localStorage
  return isRememberMe() ? localStorage : sessionStorage
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

// ── Client ──────────────────────────────────────────────────────────

// ACCEPTED RISK (2026-05-31 security audit — [Medium] "Access + refresh tokens
// stored in localStorage/sessionStorage as plaintext"):
// We use Directus `json` auth mode with a custom storage adapter that persists
// the access_token + refresh_token to localStorage (or sessionStorage) under
// `directus_auth`. This is XSS-exfiltratable in principle — a successful XSS or
// a compromised dependency could read both tokens from web storage.
// We keep this DELIBERATELY: standalone-PWA persistence requires localStorage
// (iOS clears sessionStorage when a backgrounded standalone app is killed), and
// switching to httpOnly-cookie session mode is an architectural change that
// would break that persistence. The compensating control is the strict CSP
// shipped in `public/_headers` — `script-src 'self' …` with no 'unsafe-inline'/
// 'unsafe-eval', plus a tight `connect-src` allowlist that blocks exfiltration
// to an arbitrary endpoint — together with DOMPurify on every HTML sink,
// X-Frame-Options: DENY, nosniff and HSTS.
// Never log the token payload (no console.* / Sentry of `data` below).
// TODO: migrate to Directus cookie session mode (`authentication('session')`)
//   so the refresh token lives in an httpOnly Secure SameSite cookie unreadable
//   from JS, keeping only the short-lived access token in memory.
export const client = createDirectus(API_URL)
  .with(authentication('json', {
    storage: {
      get: () => {
        const raw = getStorage().getItem(AUTH_KEY)
        if (!raw) return null
        try { return JSON.parse(raw) } catch { return null }
      },
      set: (data) => {
        if (data) {
          getStorage().setItem(AUTH_KEY, JSON.stringify(data))
        } else {
          // SDK calls set(null) on logout
          localStorage.removeItem(AUTH_KEY)
          sessionStorage.removeItem(AUTH_KEY)
        }
      },
    },
    autoRefresh: true,
  }))
  .with(rest())
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
    return await client.login({ email, password })
  } catch (err) {
    captureAuthError(err, { action: 'login', method: 'password' })
    throw err
  }
}

export async function logout() {
  try { await client.logout() } catch { /* ignore */ }
  localStorage.removeItem(AUTH_KEY)
  sessionStorage.removeItem(AUTH_KEY)
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

export function getAccessToken(): string | null {
  const raw = getStorage().getItem(AUTH_KEY)
  if (!raw) return null
  try { return JSON.parse(raw)?.access_token || null } catch { return null }
}

export function isAuthenticated(): boolean {
  return !!getAccessToken()
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

/** Get a Directus asset URL (images, files). */
export function assetUrl(fileId: string | null | undefined, transforms?: string): string {
  if (!fileId) return ''
  return transforms ? `${API_URL}/assets/${fileId}?${transforms}` : `${API_URL}/assets/${fileId}`
}

/** Call a custom KSCW endpoint. */
export async function kscwApi<T = unknown>(
  path: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<T> {
  const method = options?.method || 'GET'

  const doFetch = async (): Promise<Response> => {
    const token = getAccessToken()
    return fetch(`${API_URL}/kscw${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  // Token refresh race: retry once after refreshing if we got 401/403
  if ((res.status === 401 || res.status === 403) && isAuthenticated()) {
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
