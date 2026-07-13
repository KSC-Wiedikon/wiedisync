import { test as base, expect, type BrowserContext } from '@playwright/test'

/**
 * Authenticated e2e harness.
 *
 * WHY THIS IS NOT A PLAIN `storageState`
 * --------------------------------------
 * The app moved to Directus **cookie-session** auth (2026-06-18): the session
 * token lives in an httpOnly cookie scoped to `.kscw.ch`, `SameSite=Lax`. A page
 * served from `http://localhost:1234` is cross-site to `directus-dev.kscw.ch`,
 * so the browser will never send that cookie on a fetch — cookie-session auth
 * simply cannot work on localhost (see the comment in `src/lib/api.ts`). The old
 * PocketBase-era `auth.setup.ts` (which dropped a token into localStorage) is
 * therefore unrecoverable as-is.
 *
 * What DOES work against dev is the same mechanism `npm run db:smoke` uses: a
 * **static Directus token** pinned on a real dev member (these survive the
 * nightly prod→dev refresh, which re-pins tokens by user id). We attach it as a
 * bearer header on every Directus request, and make the app *believe* it holds a
 * session:
 *
 *   1. `isAuthenticated()` only reads the non-secret `wiedisync_auth_dev` hint
 *      cookie → the storageState plants it on the localhost origin.
 *   2. `AuthProvider` boots by calling `client.refresh()` and, if that rejects,
 *      logs out and reloads. A static token has no session cookie, so the real
 *      `/auth/refresh` 400s → we stub it with a token-less success.
 *   3. Every other Directus request gets `Authorization: Bearer <token>`.
 *   4. The member self-lookup drives i18n. The specs are written against the
 *      English UI ("Scorer duty", "Edit Profile"), exactly as the retired
 *      `test_user` had `language=english` in the DB — so we pin that field on
 *      the acting member's own row.
 *
 * Tokens are read from the environment only (never hardcoded, never committed):
 *   E2E_MEMBER_TOKEN  ?? DIRECTUS_DEV_USER_TOKEN_MEMBER   — non-admin member
 *   E2E_ADMIN_TOKEN   ?? DIRECTUS_DEV_USER_TOKEN_ADMIN    — app-admin member
 * `playwright.config.ts` loads `.env.test` + `.env.local` (both gitignored).
 */

export const DIRECTUS_URL = process.env.E2E_DIRECTUS_URL || 'https://directus-dev.kscw.ch'
export const APP_ORIGIN = 'http://localhost:1234'

export const USER_FILE = 'e2e/.auth/user.json'
export const ADMIN_FILE = 'e2e/.auth/admin.json'

/**
 * The readable "a session probably exists" hint cookie the app checks in
 * `isAuthenticated()`. Name is per-backend so a dev and a prod login can coexist
 * (`src/lib/api.ts` → `authHintKey()`).
 */
export const AUTH_HINT_COOKIE = DIRECTUS_URL.includes('directus-dev')
  ? 'wiedisync_auth_dev'
  : 'wiedisync_auth'

export const memberToken = (): string | undefined =>
  process.env.E2E_MEMBER_TOKEN || process.env.DIRECTUS_DEV_USER_TOKEN_MEMBER

export const adminToken = (): string | undefined =>
  process.env.E2E_ADMIN_TOKEN || process.env.DIRECTUS_DEV_USER_TOKEN_ADMIN

/** Storage state carries no secret — just the hint cookie + UI prefs. */
export function buildStorageState() {
  return {
    cookies: [
      {
        name: AUTH_HINT_COOKIE,
        value: '1',
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [
      {
        origin: APP_ORIGIN,
        // Pre-login UI language (AuthProvider overrides it from the member row).
        localStorage: [{ name: 'wiedisync-lang', value: 'en' }],
      },
    ],
  }
}

/**
 * Which identity a given storageState path stands for. `test.use({ storageState:
 * ADMIN_FILE })` in a spec therefore automatically picks the admin token.
 */
function resolveToken(storageState: unknown): string {
  const path = typeof storageState === 'string' ? storageState : ''
  const isAdmin = path.includes('admin')

  const token = isAdmin ? adminToken() : memberToken()
  if (token) return token

  const [name, alt] = isAdmin
    ? ['E2E_ADMIN_TOKEN', 'DIRECTUS_DEV_USER_TOKEN_ADMIN']
    : ['E2E_MEMBER_TOKEN', 'DIRECTUS_DEV_USER_TOKEN_MEMBER']
  throw new Error(
    `No ${isAdmin ? 'admin' : 'member'} token configured for the e2e suite.\n` +
      `Set ${name} (or ${alt}) in .env.local / .env.test — it must be the static\n` +
      `Directus token of a dev member whose \`members.role\` ${
        isAdmin ? 'includes admin/superuser' : 'is a plain user'
      }.\n` +
      `A Directus Administrator with no \`members\` row will NOT work: the app's\n` +
      `fetchMember() finds nothing and logs straight back out.`,
  )
}

/** The member self-lookup issued by AuthProvider.fetchMember(). */
function isMemberSelfLookup(url: string): boolean {
  if (!url.includes('/items/members')) return false
  let query: string
  try {
    query = decodeURIComponent(new URL(url).search)
  } catch {
    query = url
  }
  // Directus SDK serializes the filter as JSON; older/manual calls use bracket
  // notation. Match either — both mean "the row linked to the current user".
  return query.includes('"user"') || query.includes('filter[user]')
}

async function installDirectusAuth(context: BrowserContext, token: string) {
  await context.route(`${DIRECTUS_URL}/**`, async (route) => {
    const request = route.request()
    const url = request.url()

    // (2) Token-less refresh success — see the header comment.
    if (url.includes('/auth/refresh')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { expires: 900_000 } }),
      })
      return
    }

    // (3) Bearer-attach.
    const headers = { ...request.headers(), authorization: `Bearer ${token}` }

    // (4) Pin the acting member's UI language to English.
    if (isMemberSelfLookup(url)) {
      const response = await route.fetch({ headers })
      let body: unknown
      try {
        body = await response.json()
      } catch {
        await route.fulfill({ response })
        return
      }
      const data = (body as { data?: unknown })?.data
      if (Array.isArray(data)) {
        for (const row of data) {
          if (row && typeof row === 'object' && 'language' in row) {
            ;(row as { language: string }).language = 'english'
          }
        }
      }
      // Re-send the upstream headers (CORS!) minus the ones invalidated by
      // rewriting the body.
      const outHeaders = { ...response.headers() }
      delete outHeaders['content-length']
      delete outHeaders['content-encoding']
      await route.fulfill({
        status: response.status(),
        headers: outHeaders,
        body: JSON.stringify(body),
      })
      return
    }

    await route.continue({ headers })
  })
}

// NOTE: Playwright passes the "use" callback positionally, so it is named
// `provide` here — `use` trips eslint's react-hooks/rules-of-hooks (it reads as
// React 19's `use()` hook), and the lint gate is not negotiable for this repo.
export const test = base.extend<{ directusToken: string }>({
  directusToken: async ({ storageState }, provide) => {
    await provide(resolveToken(storageState))
  },

  context: async ({ context, directusToken }, provide) => {
    await installDirectusAuth(context, directusToken)
    await provide(context)
  },
})

export { expect }
