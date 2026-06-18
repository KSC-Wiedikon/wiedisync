import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initSentry } from './lib/sentry'
import './i18n'
import './index.css'

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
