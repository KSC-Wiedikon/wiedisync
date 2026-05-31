import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Optional local creds/tokens (gitignored). Either file may be absent.
dotenv.config({ path: resolve(__dirname, 'e2e/.env.test') })
dotenv.config({ path: resolve(__dirname, '.env.local') })

/**
 * Standalone Playwright config for the security-regression suite.
 * Self-contained so it does NOT depend on the main playwright.config.ts
 * (whose `projects` are injected elsewhere) or its authenticated storageState.
 *
 * Targets (override via env):
 *   DIRECTUS_DEV_URL  backend under test — default https://directus-dev.kscw.ch
 *   APP_DEV_URL       wiedisync app for the OAuth/frontend checks — default
 *                     http://localhost:1234 (run `npm run dev` on this branch)
 *
 * Backend (`*.api.spec.ts`) tests use Playwright's `request` fixture only — no
 * browser binary needed. Frontend (`*.ui.spec.ts`) tests use a real browser and
 * only run when RUN_FRONTEND=1 (and after `npx playwright install chromium`).
 */
const APP_URL = process.env.APP_DEV_URL || 'http://localhost:1234'

export default defineConfig({
  testDir: './e2e/tests/security',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: APP_URL,
    trace: 'on-first-retry',
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
  },
  projects: [{ name: 'security', use: { ...devices['Desktop Chrome'] } }],
})
