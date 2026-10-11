import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // vitest 5 clears every mock before each test by default; the suite is
    // written against v4's behaviour (e.g. season-health asserts a call made
    // at import time).
    clearMocks: false,
    // The backend suites exercise the PRODUCTION code paths. External accounts
    // (VolleyManager / Basketplan) are prod-only and fail closed on anything else
    // (directus/extensions/kscw-endpoints/src/external-accounts.js); the tests of
    // that gate set PUBLIC_URL themselves.
    env: { PUBLIC_URL: 'https://directus.kscw.ch' },
    include: [
      'src/**/*.test.ts',
      'directus/extensions/**/__tests__/**/*.test.js',
    ],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
