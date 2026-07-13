import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// `.env.test` — legacy test-user credentials. `.env.local` — the per-developer
// Directus dev tokens (`DIRECTUS_DEV_USER_TOKEN_*`) the authenticated projects
// actually run on. Both are gitignored; neither is ever hardcoded in source.
dotenv.config({ path: resolve(__dirname, '.env.test') })
dotenv.config({ path: resolve(__dirname, '.env.local') })

const USER_STATE = 'e2e/.auth/user.json'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:1234',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
  },

  projects: [
    // Auth setup — verifies the dev tokens and writes the storageState files.
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // Desktop (authenticated) — member/ specs.
    {
      name: 'chromium',
      testDir: './e2e/tests/member',
      use: {
        ...devices['Desktop Chrome'],
        storageState: USER_STATE,
      },
      dependencies: ['setup'],
    },

    // Mobile viewport (authenticated) — member/ specs. `mobile-ui.spec.ts` only
    // runs here; `admin-mode.spec.ts` skips itself here (needs the desktop sidebar).
    {
      name: 'mobile',
      testDir: './e2e/tests/member',
      use: {
        ...devices['Pixel 7'],
        storageState: USER_STATE,
      },
      dependencies: ['setup'],
    },

    // Multi-device mobile responsiveness. The committed snapshot baselines
    // (`home-mobile-pixel-7-mobile-pixel-7-linux.png`) fix this project's name —
    // renaming it orphans them.
    //
    // The original config also carried `mobile-iphone-se`, `mobile-iphone-15` and
    // `mobile-ipad-pro-11`. They are NOT restored: no baseline PNG was ever
    // committed for them, so their two `toHaveScreenshot` tests could only fail
    // (missing snapshot) until someone generates and reviews those baselines.
    {
      name: 'mobile-pixel-7',
      testDir: './e2e/tests/mobile-responsive',
      use: {
        ...devices['Pixel 7'],
        storageState: USER_STATE,
      },
      dependencies: ['setup'],
    },
  ],

  // The security specs (`e2e/tests/security/`) deliberately sit outside every
  // project — they run against the live backend via `playwright.security.config.ts`
  // (see the `/kscw-verify-security` skill), not as part of `npm run test`.

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1234',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
