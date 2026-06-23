import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initSentry } from './lib/sentry'
import './i18n'
import './index.css'

// A deploy rotates the hashed lazy-chunk filenames; a tab still running an older
// bundle then fails to import a now-missing chunk (CF Pages serves index.html for
// the gone path → "Expected a JS module … got text/html"). This bit notably
// every Excel/PDF export, which lazy-loads exceljs/jspdf. Vite fires
// `vite:preloadError` for these — reload once to pick up the current bundle. The
// 10s window lets a later deploy recover too while preventing a reload loop.
window.addEventListener('vite:preloadError', () => {
  const last = Number(sessionStorage.getItem('chunkReloadAt') || 0)
  if (Date.now() - last < 10_000) return
  sessionStorage.setItem('chunkReloadAt', String(Date.now()))
  window.location.reload()
})

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

void bootstrap()
