import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initSentry } from './lib/sentry'
import { forceReloadOnStaleChunk, isChunkLoadError, maybeReloadOnStaleChunk, reloadNow } from './lib/chunkReload'
import './i18n'
import './index.css'

// A deploy rotates the hashed lazy-chunk filenames; a tab still running an older
// bundle then fails to import a now-missing chunk (CF Pages serves index.html for
// the gone path → "Expected a JS module … got text/html"). This bit notably
// every Excel/PDF export, which lazy-loads exceljs/jspdf. Vite fires
// `vite:preloadError` for these — reload once (shared cooldown guard) to pick up
// the current bundle.
window.addEventListener('vite:preloadError', () => { forceReloadOnStaleChunk() })

initSentry()

const root = createRoot(document.getElementById('root')!)

// Two build targets share this single entry. `VITE_APP_TARGET` is statically
// replaced at build time, so the dynamic import in the untaken branch is
// dead-code-eliminated — the member build never bundles SchedulingApp and the
// scheduling build (`npm run build:scheduling`) never bundles the member App.
async function bootstrap() {
  if (import.meta.env.VITE_APP_TARGET === 'scheduling') {
    const { default: SchedulingApp } = await import('./SchedulingApp')
    root.render(
      <StrictMode>
        <SchedulingApp />
      </StrictMode>,
    )
  } else {
    const { default: App } = await import('./App')
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  }
}

// The entry import of `App` / `SchedulingApp` is itself a hashed chunk, so a
// stale tab can fail here — BEFORE App.tsx loads, meaning App's own chunk-reload
// handlers never get to register. Recover at the bootstrap level: reload once to
// pick up the fresh bundle, and if we've already reloaded (assets still
// propagating) render a minimal dependency-free fallback so the user never lands
// on a blank page. Non-chunk bootstrap failures are re-thrown to surface normally.
function renderStaleVersionFallback() {
  const el = document.getElementById('root')
  if (!el) return
  const dark = document.documentElement.classList.contains('dark')
  const bg = dark ? '#0b0f19' : '#ffffff'
  const fg = dark ? '#f3f4f6' : '#111827'
  const muted = dark ? '#9ca3af' : '#6b7280'
  el.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:${bg};color:${fg};padding:1.5rem">
    <div style="text-align:center;max-width:24rem">
      <h1 style="font-size:1.25rem;font-weight:700;margin:0 0 .5rem">A new version is available</h1>
      <p style="color:${muted};margin:0 0 1.25rem;line-height:1.5">Reload to continue.<br>Eine neue Version ist verfügbar — bitte neu laden.</p>
      <button id="kscw-reload-btn" style="background:#3e4889;color:#fff;border:0;border-radius:.5rem;padding:.6rem 1.25rem;font-size:1rem;font-weight:600;cursor:pointer">Reload</button>
    </div>
  </div>`
  document.getElementById('kscw-reload-btn')?.addEventListener('click', () => reloadNow())
}

void bootstrap().catch((err) => {
  if (maybeReloadOnStaleChunk(err)) return // reloading to pick up the fresh bundle
  if (isChunkLoadError(err)) { renderStaleVersionFallback(); return } // already reloaded, still stale
  throw err // genuine bootstrap failure — let it surface to Sentry / the console
})
