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
  window.location.reload()
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
// explicit request is never swallowed by the loop guard.
export function reloadNow(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(RELOAD_COOLDOWN_KEY)
  window.location.reload()
}
