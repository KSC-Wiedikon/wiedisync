// Stale lazy-import chunk recovery (shared by the entry bootstrap in `main.tsx`
// and the in-app error handlers in `App.tsx`).
//
// A deploy rotates the hashed chunk filenames. A tab still running an older
// bundle then tries to import a now-missing chunk; CF Pages serves index.html
// for the gone path, so the failure surfaces with an engine-specific message
// (and on strict-MIME engines a "text/html is not a valid JS MIME type" error).
// We reload ONCE to pick up the current bundle, guarded against a reload loop.

// Per-engine variants — Chromium: `Failed to fetch dynamically imported
// module`, Firefox desktop: `error loading dynamically imported module`, older
// Safari: `Importing a module script failed`, and crucially WebKit/iOS (Safari +
// Firefox iOS + Chrome iOS, where the SPA fallback serves index.html for a
// missing chunk): `'text/html' is not a valid JavaScript MIME type` / Chrome's
// strict-MIME `expected a JavaScript … module script but the server responded
// with a MIME type`.
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk \d+ failed|ChunkLoadError|is not a valid JavaScript MIME type|expected a JavaScript(?:-or-Wasm)? module script but the server responded with a MIME type/i

export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return CHUNK_ERROR_RE.test(msg)
}

// Single cooldown key shared across every reload path so a reload triggered by
// `vite:preloadError`, the bootstrap catch, or App's global listeners all
// rate-limit each other (no double reload).
const RELOAD_COOLDOWN_KEY = 'wiedisync-chunk-reload-ts'
const COOLDOWN_MS = 10_000

// Query param appended by hardReload() to force a genuine cache-miss on the
// document navigation. The HTML is served `no-store`, but a privacy extension
// or corporate proxy can still hand back a stale index.html (or a negatively
// cached SPA-fallback asset), leaving a user stuck on the stale-version screen
// no matter how often they hit reload — a plain location.reload() keeps
// returning the same broken document. A unique URL cannot be served from any
// HTTP cache, so the fresh index.html (which only references chunks that exist)
// is guaranteed to load. stripCacheBustParam() removes it again on the next
// successful boot so it never enters the router or accumulates in the URL bar.
const CACHE_BUST_PARAM = '_v'

// Hard-reload with a cache-busting param so no HTTP/proxy cache can serve a
// stale document. location.replace() (vs assign) keeps the broken state out of
// back-history. Falls back to a plain reload if URL construction ever throws.
function hardReload(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    url.searchParams.set(CACHE_BUST_PARAM, Date.now().toString(36))
    window.location.replace(url.toString())
  } catch {
    window.location.reload()
  }
}

// Remove the cache-bust param on a successful boot. Call once, synchronously,
// before React (and the router) mount so it never sees the param.
export function stripCacheBustParam(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(CACHE_BUST_PARAM)) return
    url.searchParams.delete(CACHE_BUST_PARAM)
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch { /* noop — cosmetic cleanup only */ }
}

// Reload once within the cooldown window. Returns true if a reload was just
// triggered; false if we're still inside the cooldown (already reloaded once —
// the caller should stop and show a fallback rather than loop). The 10s window
// also lets a *later* deploy recover while the assets are still propagating.
function reloadOnce(): boolean {
  if (typeof window === 'undefined') return false
  const now = Date.now()
  const last = Number(sessionStorage.getItem(RELOAD_COOLDOWN_KEY) || 0)
  if (now - last < COOLDOWN_MS) return false // reload-loop guard
  sessionStorage.setItem(RELOAD_COOLDOWN_KEY, String(now))
  hardReload()
  return true
}

// Reload only when `error` looks like a stale-chunk failure. Returns true only
// when a reload was actually triggered this call (callers use that to decide
// whether to swallow the error or surface a fallback / Sentry report).
export function maybeReloadOnStaleChunk(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false
  return reloadOnce()
}

// `vite:preloadError` is, by definition, a chunk-load failure — reload
// unconditionally (its `payload` message doesn't always match the regex above).
export function forceReloadOnStaleChunk(): boolean {
  return reloadOnce()
}

// User clicked "Reload" on the inline fallback — bypass the cooldown so an
// explicit request is never swallowed by the loop guard, and cache-bust so a
// stale document held by a proxy/extension can't survive the reload.
export function reloadNow(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(RELOAD_COOLDOWN_KEY)
  hardReload()
}
