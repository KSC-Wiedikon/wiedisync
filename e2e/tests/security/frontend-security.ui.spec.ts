import { test, expect } from '@playwright/test'

/**
 * Frontend security regressions (browser). Runs against the wiedisync app at
 * APP_DEV_URL (default http://localhost:1234). Start `npm run dev` on the
 * security-fixes branch first — the deployed *.pages.dev sites do NOT yet carry
 * these frontend fixes. Needs a browser: `npx playwright install chromium`.
 *
 * Guarded by RUN_FRONTEND=1 so the API suite stays runnable without a browser:
 *   RUN_FRONTEND=1 npx playwright test -c playwright.security.config.ts frontend-security
 */
test.describe('Frontend security regressions (app)', () => {
  test.skip(process.env.RUN_FRONTEND !== '1', 'start `npm run dev` on this branch and run with RUN_FRONTEND=1')

  test('OAuth callback strips access/refresh tokens from the URL and rejects a bad state', async ({ page }) => {
    // Land on the callback with dummy tokens + a state that matches no pending
    // nonce. The page must scrub the query string immediately (replaceState)
    // and must NOT persist the dummy tokens anywhere.
    await page.goto('/auth/callback?access_token=DUMMY_ACCESS_TOKEN&refresh_token=DUMMY_REFRESH_TOKEN&state=does-not-match-any-nonce')
    await page.waitForTimeout(600) // let the callback effect run

    const url = page.url()
    expect(url, 'access_token must be stripped from the URL').not.toContain('access_token')
    expect(url, 'refresh_token must be stripped from the URL').not.toContain('refresh_token')

    const storedBlob = await page.evaluate(() => {
      const out: string[] = []
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) out.push(store.getItem(store.key(i)!) || '')
      }
      return out.join('||')
    })
    expect(storedBlob, 'dummy access token must not be persisted').not.toContain('DUMMY_ACCESS_TOKEN')
    expect(storedBlob, 'dummy refresh token must not be persisted').not.toContain('DUMMY_REFRESH_TOKEN')
  })
})
