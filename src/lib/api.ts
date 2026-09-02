/**
 * Directus API client — thin, typed wrapper around @directus/sdk + fetch.
 *
 * All data access goes through this module. No component should import
 * @directus/sdk or directus.ts directly — use the query hooks instead.
 */

import {
  createDirectus, rest, authentication, realtime,
  readItems, readItem, createItem, createItems, updateItem, deleteItem,
  aggregate,
} from '@directus/sdk'
import { toast } from 'sonner'
import i18n from '../i18n'
import { captureApiError, captureAuthError } from './sentry'
// Pure predicate, kept in its own module so it is unit-testable without mocking
// this one. Re-exported so existing `from './api'` call sites keep working.
export { isSessionExpired } from './sessionError'

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
  // In dev-proxy mode API_URL is the relative '/directus', so the flag itself
  // says which backend is behind it.
  return (useDevProxy || API_URL.includes('directus-dev')) ? 'wiedisync_auth_dev' : 'wiedisync_auth'
}

export function setAuthHint(present: boolean): void {
  if (typeof document === 'undefined') return
  // domain=.kscw.ch → shared across subdomains (SSO with the scheduling app).
  // A localhost / pages.dev origin REJECTS a cookie scoped to a domain it isn't
  // on, so off *.kscw.ch the hint falls back to a plain host-only cookie — it
  // carries no secret, and without it a dev-proxy login (`npm run dev:login`)
  // would authenticate and then immediately look logged-out to the app.
  // `secure` only where the page itself is https: a Secure cookie set from an
  // http origin is silently discarded (localhost excepted, but plain is safe).
  const key = authHintKey()
  const onKscw = window.location.hostname.endsWith('.kscw.ch')
  const attrs = onKscw
    ? 'domain=.kscw.ch; path=/; secure; samesite=lax'
    : `path=/; samesite=lax${window.location.protocol === 'https:' ? '; secure' : ''}`
  document.cookie = present ? `${key}=1; ${attrs}; max-age=604800` : `${key}=; ${attrs}; max-age=0`
}

const host = typeof window !== 'undefined' ? window.location.hostname : ''
// Every hostname that MUST talk to prod Directus, pinned by name rather than left
// to `VITE_DIRECTUS_URL`. The scheduling app (own CF Pages project) was missing
// here, so prod Spielplanung reached prod only because the Production env var
// happened to be set — an unset/typo'd var would have silently pointed the live
// planner at the dev database. Pinning the host makes that unrepresentable.
const isProd = host === 'wiedisync.kscw.ch' || host === 'spielplanung.wiedisync.kscw.ch'
const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
// `npm run dev:prod` sets VITE_PROD_DATA=1 → vite.config.ts spins up a
// reverse proxy that forwards `/directus/*` (REST + WS) to prod Directus.
// In that mode we use a relative `/directus` prefix so all browser fetches
// stay same-origin (no CORS preflight) and the proxy does the heavy lift.
const useProdProxy = isLocalhost && import.meta.env.VITE_PROD_DATA === '1'
// `npm run dev:login` sets VITE_DEV_PROXY=1 → the same reverse-proxy trick aimed
// at DEV Directus, for a different reason: the dev session cookie is
// `Domain=.kscw.ch; SameSite=Lax`, which no localhost/pages.dev origin can hold —
// so a real browser login against dev only works when every request is
// same-origin through the vite proxy (which strips the cookie's Domain so it
// sticks to the vite origin). Guarded by import.meta.env.DEV: false in builds,
// so the flag can never leak into a deployed bundle. Use via http://localhost
// (SSH tunnel) — the E2EE screens need the secure-context crypto.subtle.
const useDevProxy = import.meta.env.DEV && import.meta.env.VITE_DEV_PROXY === '1'
// Localhost ALWAYS points at dev Directus by default, regardless of
// `VITE_DIRECTUS_URL` in `.env*` — prod Directus has a strict CORS allowlist
// that doesn't and shouldn't include localhost, so an env override that
// pointed there would just yield "blocked by CORS policy" on every fetch.
// Prod hostname always points at prod. Any other host (CF Pages preview,
// pages.dev, custom preview domains) honors the env or falls back to dev.
export const API_URL = isProd
  ? 'https://directus.kscw.ch'
  : (useProdProxy || useDevProxy)
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
// The SDK runs `new URL(base)` on this (since @directus/sdk 23), so the bare
// relative '/directus' of the proxy modes must be absolutized against the vite
// origin — still same-origin, the proxy still does the heavy lift. Passing the
// relative prefix directly crashes module init ("Failed to construct 'URL'")
// and white-screens the app.
const SDK_BASE = API_URL.startsWith('/') && typeof window !== 'undefined'
  ? `${window.location.origin}${API_URL}`
  : API_URL
export const client = createDirectus(SDK_BASE)
  .with(authentication('session', { credentials: 'include', autoRefresh: true }))
  .with(rest({
    credentials: 'include',
    // Stamps the acting-member header on every SDK data request. Applied ONLY
    // by the rest composable — `authentication()` never runs it, so login and
    // refresh are structurally guaranteed to stay the real session owner's.
    onRequest: (options) => {
      if (_actingMemberId == null) return options
      return { ...options, headers: { ...(options.headers as Record<string, string>), [ACTING_HEADER]: String(_actingMemberId) } }
    },
  }))
  .with(realtime({
    // The Directus SDK detects URL overrides with `'url' in config` — passing
    // `url: undefined` still hits that branch, then `new URL(undefined)`
    // throws "Invalid URL" and crashes the page (WIEDISYNC-3Q). Only include
    // the key when we genuinely want to override the derived URL. In proxy
    // mode (`npm run dev:prod`), API_URL is the relative `/directus` prefix
    // and the SDK would derive `/directus/websocket` which the browser
    // rejects (WebSocket needs absolute ws:// or wss://); we build the
    // absolute proxy URL explicitly and vite's `ws: true` entry forwards it.
    ...((useProdProxy || useDevProxy) && typeof window !== 'undefined'
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
  // Household acting state — both the in-memory header and the per-session
  // "last used" hints, swept by prefix because the key carries the session
  // owner's id (a fixed removeItem would clear nothing and read as if it had —
  // the exact failure the SQL-workspace comment below records).
  _actingMemberId = null
  try {
    const acting: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('wiedisync-acting-member:')) acting.push(key)
    }
    acting.forEach((key) => localStorage.removeItem(key))
  } catch { /* storage unavailable */ }
  // ⚠ The key cleared here used to be 'wiedisync-sql-history', which NOTHING
  // writes — so the SQL workspace's real drafts and history survived logout on
  // a shared machine, while the cleanup read as if they did not (audit
  // 2026-08-08, finding 37). These two are the keys SqlWorkspacePage actually
  // sets; a raw SQL draft can embed member data pasted while debugging.
  localStorage.removeItem('kscw-sql-workspace-recent')
  localStorage.removeItem('kscw-sql-workspace-draft')

  // Scorer-assignment drafts. The key is BUILT from sport + season
  // (`kscw:scorer-assign-draft:${sport}:${season}`, ScorerAssignPage.tsx), so a fixed
  // removeItem() would clear nothing and read as if it did — the exact failure the
  // comment above records. Sweep by prefix instead. A draft holds who is assigned to
  // which duty, i.e. member names, and these are edited on shared club laptops.
  // Collect first: removing while iterating by index re-indexes the store and skips
  // entries.
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('kscw:scorer-assign-draft:')) stale.push(key)
    }
    stale.forEach((key) => localStorage.removeItem(key))
  } catch { /* storage unavailable (private mode) — nothing to clear */ }
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

// ── Read-only impersonation guard ───────────────────────────────────
// Superadmin "View as member" is READ-ONLY: while active, every write path
// throws so nothing is mis-attributed to the impersonated member (the API
// calls still carry the superadmin's own session). AuthProvider flips this.
let _impersonating = false
export function setImpersonating(v: boolean): void { _impersonating = v }
export function isImpersonating(): boolean { return _impersonating }

export class ReadOnlyImpersonationError extends Error {
  readonly code = 'READ_ONLY_IMPERSONATION'
  constructor() {
    super('READ_ONLY_IMPERSONATION')
    this.name = 'ReadOnlyImpersonationError'
  }
}

/** Throw (and toast) if a write is attempted during read-only impersonation. */
function assertWritable(): void {
  if (!_impersonating) return
  try { toast.error(i18n.t('common:readOnlyImpersonation')) } catch { /* toast/i18n not ready — still block */ }
  throw new ReadOnlyImpersonationError()
}

// ── Household acting-member (migration 348) ─────────────────────────
// A guardian (a parent) may act as a member she administers. Unlike the
// read-only impersonation above, this is WRITE-CAPABLE by design: the server
// genuinely resolves the request as the child, so the write really is hers.
//
// ⚠ These are two different modes with one flag each, deliberately kept apart.
// `assertWritable()` above is NOT reused here — folding guardian acting into
// the read-only impersonation guard would produce three-way logic in every
// write path, and the first mistake in that logic silently blocks or silently
// allows.
//
// ⚠ The header rides on `rest({ onRequest })` and on kscwApi's own headers. It
// is structurally impossible for it to reach /auth/login or /auth/refresh: the
// SDK applies `onRequest` only inside the `rest` composable, never in
// `authentication()`. So a switch can never change WHOSE SESSION this is.
export const ACTING_HEADER = 'X-KSCW-Acting-Member'

let _actingMemberId: number | null = null

export function setActingMemberId(id: number | null): void { _actingMemberId = id }
export function getActingMemberId(): number | null { return _actingMemberId }

/**
 * The app's idea of who it is acting as, versus the server's.
 *
 * A desync is unreachable in theory — which is exactly why it must be loud if it
 * ever happens. The server echoes the identity it actually resolved; if it
 * disagrees with ours, every subsequent render is about the wrong child, so we
 * reload rather than paint one daughter's data under another's name.
 *
 * ⚠ Requires CORS_EXPOSED_HEADERS to include the header — without it a
 * cross-origin read returns null and this check silently passes.
 */
function assertActingEcho(res: Response): void {
  const echoed = res.headers.get(ACTING_HEADER)
  const expected = _actingMemberId == null ? null : String(_actingMemberId)
  if (echoed === expected) return
  // A null echo with no expectation is the normal, header-less case.
  if (echoed == null && expected == null) return
  try { toast.error(i18n.t('common:householdSwitchDesync')) } catch { /* i18n not ready */ }
  setTimeout(() => { try { window.location.reload() } catch { /* ignore */ } }, 1200)
}

/** Detect Directus "no permission" errors (token refresh race). */
function isPermissionError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? ''
  return msg.includes("don't have permission") || msg.includes('does not exist')
}

/**
 * Run a Directus SDK request, transparently recovering from the token-refresh
 * race: the SDK can send an about-to-expire access token that Directus rejects
 * as the public role ("no permission" / "does not exist"). When that happens
 * and a session still exists, force one refresh and retry the request once. Any
 * failure of the refresh-or-retry rethrows the ORIGINAL error so the caller's
 * captureApiError sees the real cause. Shared by fetchItems + fetchItem so the
 * recovery logic lives in one place (kscwApi runs a status-based variant since
 * it inspects the Response rather than a thrown error).
 */
async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isPermissionError(err) && isAuthenticated()) {
      try {
        await refreshAuth()
        return await fn()
      } catch { /* fall through — rethrow the original error */ }
    }
    throw err
  }
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
  // Besammlung offset (migration 340). Stringified it would break the
  // `start - offset` arithmetic that derives the displayed clock time.
  'meeting_offset_minutes',
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
 * Build an M2M junction payload that survives an UPDATE.
 *
 * Directus treats a junction object without its own primary key as a CREATE,
 * and only deletes the rows that dropped out of the array *afterwards*. So
 * re-sending an already-linked pair as `{ teams_id: 5 }` INSERTs a second
 * `(parent, 5)` row while the original is still there. That used to pass
 * silently (and quietly accumulate duplicate junction rows); since migration
 * 245 every junction carries a composite unique index, so it now 400s with
 * `Value for field "events_id, teams_id" in collection "events_teams" has to
 * be unique.` — i.e. saving an unchanged team list broke every edit form.
 *
 * Passing the existing junction row's own `id` back turns those into no-op
 * updates, leaving only genuinely new links as inserts.
 *
 * `existing` is the junction array as fetched from Directus. Request the
 * junction PK explicitly (`teams.id`, `invited_members.id`, `coach.id`, …) —
 * a `teams.teams_id` expand alone does NOT include it, and without it this
 * degrades back to the duplicate-insert behaviour.
 */
export function m2mUpdatePayload(
  field: string,
  relatedIds: (string | number)[],
  existing?: unknown,
): Record<string, unknown>[] {
  const junctionIdByRelated = new Map<string, string | number>()
  if (Array.isArray(existing)) {
    for (const row of existing) {
      if (typeof row !== 'object' || row === null) continue
      const { id: junctionId, [field]: related } = row as Record<string, unknown>
      if (junctionId == null || related == null) continue
      const relatedId = typeof related === 'object' ? (related as { id?: unknown }).id : related
      if (relatedId == null) continue
      junctionIdByRelated.set(String(relatedId), junctionId as string | number)
    }
  }
  return relatedIds.map(id => {
    const junctionId = junctionIdByRelated.get(String(id))
    return junctionId == null ? { [field]: id } : { id: junctionId, [field]: id }
  })
}

/**
 * Convert a flat team string[] to M2M format for saving to Directus.
 * Strips the `team` field and adds `teams` in junction format.
 *
 * `existingTeams` is the record's current `teams` junction array (fetched with
 * `teams.id`) — required on UPDATE, see `m2mUpdatePayload`.
 */
export function teamToM2M(payload: Record<string, unknown>, existingTeams?: unknown): Record<string, unknown> {
  const { team, ...rest } = payload
  if (!Array.isArray(team)) return rest
  return { ...rest, teams: m2mUpdatePayload('teams_id', team as string[], existingTeams) }
}

/**
 * True for "you may not read this collection" answers, in both the shapes
 * Directus uses: a 401/403 status, and the FORBIDDEN body it returns for an
 * unreadable collection ("You don't have permission to access collection X").
 */
function isAccessDenied(err: unknown): boolean {
  const e = err as { status?: number; response?: { status?: number }; message?: string } | null
  const status = e?.status ?? e?.response?.status
  if (status === 401 || status === 403) return true
  return /don't have permission to access|no permission to access|FORBIDDEN/i.test(e?.message ?? '')
}

/**
 * Fetch a list of items. Returns the array directly.
 *
 * `optional: true` marks a fetch whose caller already treats "denied" as a
 * legitimate answer — a cross-sport read the viewer may simply not hold, behind
 * a `.catch(() => [])`. Those still THROW (the caller's catch drives the empty
 * state), they just stop reporting an access denial as an `api_error`: a page
 * that is working exactly as designed should not file a bug on every load. Real
 * failures on the same call (a 500, a network drop) report as before.
 */
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
    optional?: boolean
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
    return await withAuthRetry(() =>
      client.request<T[]>(readItems(collection, q as never)).then(stringifyIds),
    )
  } catch (err) {
    if (!(query?.optional && isAccessDenied(err))) {
      captureApiError(err, { operation: 'fetchItems', collection, payload: q as Record<string, unknown> })
    }
    throw err
  }
}

/**
 * Fetch all items (no pagination).
 *
 * Reporting lives entirely in `fetchItems` — this wrapper used to capture the
 * SAME failure a second time, so every denied read filed two log entries (7
 * blocked `basketball_team_rules` loads read as 14 errors on 2026-08-06).
 */
export async function fetchAllItems<T = Record<string, unknown>>(
  collection: string,
  query?: {
    filter?: Record<string, unknown>
    sort?: string[]
    fields?: string[]
    deep?: Record<string, unknown>
    optional?: boolean
  },
): Promise<T[]> {
  return fetchItems<T>(collection, { ...query, limit: -1 })
}

/** Fetch a single item by ID. */
export async function fetchItem<T = Record<string, unknown>>(
  collection: string,
  id: string | number,
  query?: { fields?: string[] },
): Promise<T> {
  try {
    return await withAuthRetry(() =>
      client.request<T>(readItem(collection, id, query as never)).then(stringifyId),
    )
  } catch (err) {
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

/**
 * Run a Directus aggregate query (COUNT / SUM / AVG …) with optional `groupBy`.
 *
 * Generalises the pattern used by `countItems` + `fetchSeasons`: returns one row
 * per distinct group so callers can compute grouped totals (e.g. players vs
 * guests per team) WITHOUT over-fetching every underlying row. IDs in the result
 * are stringified to match the rest of the app (see `fetchItems` → `stringifyIds`);
 * aggregate values (`count`, `sum`, …) come back as strings from Directus — wrap
 * them in `Number(...)` at the call site. Permission filters apply exactly as they
 * do to a normal read, so counts reflect only rows the requester can see.
 */
export async function aggregateItems<R = Record<string, unknown>>(
  collection: string,
  opts: {
    aggregate: Record<string, string | string[]>
    groupBy?: string[]
    filter?: Record<string, unknown>
    sort?: string[]
  },
): Promise<R[]> {
  const query: Record<string, unknown> = {}
  if (opts.filter) query.filter = opts.filter
  if (opts.sort) query.sort = opts.sort
  try {
    const result = await withAuthRetry(() =>
      client.request(aggregate(collection, {
        aggregate: opts.aggregate,
        groupBy: opts.groupBy,
        query: Object.keys(query).length ? query : undefined,
      } as never)),
    )
    return stringifyIds(result as R[])
  } catch (err) {
    captureApiError(err, { operation: 'aggregateItems', collection })
    throw err
  }
}

/** Create a new item. */
export async function createRecord<T = Record<string, unknown>>(
  collection: string,
  data: Record<string, unknown>,
  opts: { silentOnUnique?: boolean } = {},
): Promise<T> {
  assertWritable()
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

/**
 * Batch-create multiple items in a SINGLE request (`POST /items/:collection` with
 * an array body). Mirrors `createRecord` for arrays — use it instead of firing N
 * parallel `createRecord` calls (e.g. generating a season of recurring trainings).
 * Returns the created items with IDs stringified, in input order.
 */
export async function createRecords<T = Record<string, unknown>>(
  collection: string,
  data: Record<string, unknown>[],
): Promise<T[]> {
  assertWritable()
  try {
    const items = await client.request<T[]>(createItems(collection, data as never))
    return stringifyIds(items)
  } catch (err) {
    captureApiError(err, { operation: 'createRecords', collection, payload: { count: data.length } })
    throw err
  }
}

/**
 * Update an item. `query` shapes the returned record — pass `fields` when the
 * caller re-uses the response (e.g. to read back junction row IDs so the next
 * `m2mUpdatePayload` call still has them).
 */
export async function updateRecord<T = Record<string, unknown>>(
  collection: string,
  id: string | number,
  data: Record<string, unknown>,
  query?: { fields?: string[] },
): Promise<T> {
  assertWritable()
  try {
    const item = await client.request<T>(updateItem(collection, id, data as never, query as never))
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
  assertWritable()
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
  assertWritable()
  const fd = new FormData()
  // Non-file fields must precede the file part for Directus to apply them as
  // metadata — `folder` drops the upload straight into a (private) folder.
  if (folder) fd.append('folder', folder)
  fd.append('file', file)
  let res: Response
  try {
    res = await fetch(`${API_URL}/files`, {
      method: 'POST',
      credentials: 'include', // session cookie carries auth (no Bearer header)
      body: fd,
    })
  } catch (err) {
    // Network error (offline, DNS, CORS) — captureApiError downgrades transient
    // fetch failures to a warn log and skips Sentry.
    captureApiError(err, { operation: 'uploadFile', collection: 'directus_files' })
    throw err
  }
  if (!res.ok) {
    const responseBody = await res.text().catch(() => '')
    const err = new Error(`Upload failed (${res.status})`)
    captureApiError(err, { operation: 'uploadFile', collection: 'directus_files', status: res.status, responseBody })
    throw err
  }
  const { data } = await res.json()
  return { id: String(data.id), name: data.filename_download || file.name }
}

/** Get a Directus asset URL (images, files). */
export function assetUrl(fileId: string | null | undefined, transforms?: string): string {
  if (!fileId) return ''
  return transforms ? `${API_URL}/assets/${fileId}?${transforms}` : `${API_URL}/assets/${fileId}`
}

// Auth-flow endpoints whose 4xx responses are ALWAYS user-input validation
// failures (wrong/expired OTP, weak password, unknown email, already-registered)
// that the calling UI already surfaces inline. Their sub-500 responses are pure
// noise in Sentry + the JSONL error log — every fat-fingered OTP code or
// unregistered-email attempt otherwise reads as an `api_error`. kscwApi still
// THROWS them (so the caller's catch drives the UX), just without capture. Any
// 5xx from these endpoints is a real bug and still reports. Mirrors the
// network-failure / unauthenticated / token-expired carve-outs in sentry.ts.
const EXPECTED_VALIDATION_ENDPOINTS = new Set([
  '/verify-email',
  '/verify-email/confirm',
  '/set-password',
  '/register',
])

// Same carve-out, matched on the response's `code` instead of the path, for
// endpoints whose URL carries a record id (`/identity/document/:id`) and so can
// never match an exact-path Set.
//
// These are "asked a question, answer is none" responses, not failures. The
// identity-document check runs for every member opening /profile/edit, and most
// members have no document on file — so a normal empty state was generating a
// Sentry event and a console.error per profile visit, which is both misleading
// (it reads as `api_error` on a page that is working correctly) and self-
// defeating: that volume helps trip the sentry-tunnel worker's 60/min per-IP
// cap, and the 429s it causes drop REAL errors that happen in the same burst.
const EXPECTED_ERROR_CODES = new Set([
  'no_document',
  // /admin/vis-player-check 409s: a run is already in flight, or VIS_USER/
  // VIS_PASS are not set on this environment. Both are states the Transfers
  // page renders inline — neither is a bug to file.
  'vis_check_running',
  'vis_credentials_missing',
  // Identity documents. `outside_window` is the designed refusal outside the
  // pre-load window, and `no_envelope` means the caller is entitled staff who
  // was never wrapped a key (they set their identity key up after the upload) —
  // both are inline states with their own copy, not bugs. Left uncarved they
  // fire one Sentry event PER PLAYER on a Show-IDs pre-load: nine per team for
  // one coach, which is exactly the burst that trips the tunnel's rate cap.
  'no_envelope',
  'outside_window',
  // Nothing left to re-grant — a repair that raced another device, or a stale
  // banner. The UI just re-reads; there is no failure to report.
  'nothing_to_add',
  // Same shape on the ClubDesk decision table: every id in the click was already
  // decided — by a second admin, or by this admin's own tab left open across a
  // sync-down. The list is what is stale, so the UI re-reads it. Not a failure.
  'already_decided',
])

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
  options?: { method?: string; body?: unknown; headers?: Record<string, string>; anonymous?: boolean; actAs?: number },
): Promise<T> {
  const method = options?.method || 'GET'
  const anonymous = options?.anonymous === true

  // Block state-changing endpoint calls during read-only impersonation.
  if (method !== 'GET' && !anonymous) assertWritable()

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
        // Household acting-member. `actAs` is a per-call override for the rare
        // case of acting on one member's behalf while the app is showing
        // another (the RSVP undo toast re-issues against the id captured at
        // press time, not whoever is current by the time it fires).
        // Never on anonymous calls — those are token-in-URL public endpoints
        // with no session to narrow.
        ...(!anonymous && (options?.actAs ?? _actingMemberId) != null
          ? { [ACTING_HEADER]: String(options?.actAs ?? _actingMemberId) }
          : {}),
        ...options?.headers,
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    })
  }

  let res: Response
  try {
    res = await doFetch()
    if (!anonymous && options?.actAs == null) assertActingEcho(res)
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
    const err = new Error(`API ${path}: ${res.status}`) as Error & { code?: string; body?: unknown; status?: number }
    // The HTTP status, carried as a field rather than only inside the message.
    // Callers that need to tell one failure from another were parsing the string
    // — and the one case that really needs it is a 404 during a deploy window,
    // where the frontend has shipped ahead of an endpoint that does not exist
    // yet and must stay quiet instead of alarming the operator.
    err.status = res.status
    // Parse response body and attach error code + full body if present (callers
    // like the Terminplanung opponent flow map on body.error / body.teams).
    try { const parsed = JSON.parse(responseBody); if (parsed?.code) err.code = parsed.code; err.body = parsed } catch { /* ignore */ }
    // Benign: an unauthenticated session hitting a protected endpoint (e.g. iOS
    // Safari evicted the stored token while backgrounded). The throw still drives
    // the login redirect; reporting it to Sentry/JSONL is just noise. Mirrors the
    // no-token auth-error suppression in sentry.ts. Real auth bugs (401/403 while
    // authenticated, refresh failed) still fall through to captureApiError below.
    if (res.status === 401 && !isAuthenticated()) throw err
    // Expected, caller-handled validation failures on the auth flows (wrong or
    // expired OTP, weak password, unknown email). The UI shows each inline, so
    // reporting the sub-500 to Sentry/JSONL is just noise. `err.code`/`err.body`
    // were already parsed above, so the caller's catch keeps its control flow.
    if (res.status < 500 && EXPECTED_VALIDATION_ENDPOINTS.has(path.split('?')[0])) throw err
    // Same rationale, keyed on the parsed response code for id-bearing paths.
    if (res.status < 500 && err.code && EXPECTED_ERROR_CODES.has(err.code)) throw err
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
  // 204 No Content carries an empty body, so res.json() throws SyntaxError and
  // the caller's catch reports a success as a failure. /password-request 204s by
  // design (it must never reveal whether an address exists) — which is why the
  // profile page's "Reset password" button showed an error on every click even
  // though the mail had already gone out.
  if (res.status === 204) return undefined as T
  return res.json()
}
