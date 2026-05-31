import { test, expect } from '@playwright/test'

/**
 * Backend security regressions — verify the 2026-05-31 audit fixes on the live
 * (dev) Directus. Uses only the `request` fixture → no browser needed.
 *
 *   npx playwright test -c playwright.security.config.ts backend-security
 *
 * Targets DIRECTUS_DEV_URL (default https://directus-dev.kscw.ch). The deployed
 * extensions (wadmin, password-reset, set-password consumer) carry the fixes
 * once `npm run ext:deploy:dev` has run; the permission-based checks also need
 * `npm run db:setup-perms:dev`. Privileged checks self-skip unless the relevant
 * token/ids are provided (keep secrets in e2e/.env.test or .env.local, never in
 * source):
 *   E2E_WEBSITE_ADMIN_TOKEN  a NON-Manager "Website Admin" user token (IDOR check)
 *   E2E_MEMBER_TOKEN         a non-admin Member token (impersonation check)
 *   E2E_OTHER_MEMBER_ID      a member id that is NOT that member (impersonation target)
 */
const DIRECTUS = process.env.DIRECTUS_DEV_URL || 'https://directus-dev.kscw.ch'
const STRONG_PW = 'Aud1t-Probe-!x9Q'

test.describe('Backend security regressions (dev)', () => {
  test('directus is reachable', async ({ request }) => {
    const res = await request.get(`${DIRECTUS}/server/ping`)
    expect(res.status()).toBe(200)
  })

  // ── Password-reset hardening (High) ──────────────────────────────────────
  test('password-request: unknown email → 204 (no enumeration, no crash)', async ({ request }) => {
    const res = await request.post(`${DIRECTUS}/kscw/password-request`, {
      data: { email: 'audit-probe-unknown@example.invalid' },
    })
    expect(res.status()).toBe(204)
  })

  test('password-request: missing email → 400', async ({ request }) => {
    const res = await request.post(`${DIRECTUS}/kscw/password-request`, { data: {} })
    expect(res.status()).toBe(400)
  })

  test('set-password: bogus reset token rejected via password_reset_tokens path (400, not 500)', async ({ request }) => {
    // A random 64-hex token hashes to nothing in password_reset_tokens. Proves
    // the Mode-2 consumer validates against the new table, not directus_users.token,
    // and fails closed rather than erroring.
    const res = await request.post(`${DIRECTUS}/kscw/set-password`, {
      data: { token: 'a1b2c3d4'.repeat(8), password: STRONG_PW },
    })
    expect(res.status()).toBe(400)
    const body = await res.json().catch(() => ({}))
    expect(JSON.stringify(body)).toMatch(/token/i)
  })

  test('set-password: OTP mode with no fresh verified row → 400', async ({ request }) => {
    const res = await request.post(`${DIRECTUS}/kscw/set-password`, {
      data: { email: 'audit-probe-unknown@example.invalid', password: STRONG_PW },
    })
    expect(res.status()).toBe(400)
  })

  // ── wadmin IDOR (High) ───────────────────────────────────────────────────
  test('wadmin requires authentication', async ({ request }) => {
    const res = await request.get(`${DIRECTUS}/kscw/wadmin/mixed_turnier/items/members`)
    expect([401, 403]).toContain(res.status())
  })

  test('wadmin: mixed_turnier section can no longer reach members (IDOR fix → 403 out-of-scope)', async ({ request }) => {
    const token = process.env.E2E_WEBSITE_ADMIN_TOKEN
    test.skip(!token, 'set E2E_WEBSITE_ADMIN_TOKEN (a non-Manager Website Admin token) to run')
    const res = await request.get(`${DIRECTUS}/kscw/wadmin/mixed_turnier/items/members`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(403)
  })

  test('wadmin: mixed_turnier signups still reachable for a Website Admin (fix did not over-restrict)', async ({ request }) => {
    const token = process.env.E2E_WEBSITE_ADMIN_TOKEN
    test.skip(!token, 'set E2E_WEBSITE_ADMIN_TOKEN to run')
    const res = await request.get(`${DIRECTUS}/kscw/wadmin/mixed_turnier/items/mixed_tournament_signups`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(200)
  })

  // ── Member create self-scope (High) — needs db:setup-perms:dev + a member token
  test('member cannot create a participation attributed to another member (403)', async ({ request }) => {
    const token = process.env.E2E_MEMBER_TOKEN
    const otherId = process.env.E2E_OTHER_MEMBER_ID
    test.skip(!token || !otherId, 'set E2E_MEMBER_TOKEN + E2E_OTHER_MEMBER_ID (after db:setup-perms:dev) to run')
    const res = await request.post(`${DIRECTUS}/items/participations`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { member: otherId, activity_type: 'training', activity_id: '999999', status: 'declined' },
    })
    // Enforced by the kscw-hooks create-ownership guard (Directus enforces no
    // permissions/validation filter on create). The guard surfaces via the
    // project's kscwScopeError as a 500, so assert "blocked" (not created)
    // rather than a specific status — the security property is that it is NOT a
    // successful 2xx create.
    expect(res.status(), 'impersonation must be rejected, not created').toBeGreaterThanOrEqual(400)
    expect(res.ok(), 'impersonation must not succeed').toBe(false)
  })

  // ── Public reads scoped (Medium) — needs db:setup-perms:dev ───────────────
  test('anonymous members read does not leak hidden PII fields', async ({ request }) => {
    // Public policy should expose only id/first_name/last_name/photo for
    // website_visible members. Assert no email/phone/birthdate/ahv_nummer leak.
    const res = await request.get(`${DIRECTUS}/items/members?limit=5&fields=*`)
    if (res.status() !== 200) {
      test.skip(true, `public members read returned ${res.status()} — skipping field-leak assertion`)
    }
    const body = await res.json()
    const rows: any[] = body?.data ?? []
    for (const r of rows) {
      expect(r.email ?? null, 'email must not be exposed publicly').toBeNull()
      expect(r.phone ?? null, 'phone must not be exposed publicly').toBeNull()
      expect(r.birthdate ?? null, 'birthdate must not be exposed publicly').toBeNull()
      expect(r.ahv_nummer ?? null, 'AHV number must never be exposed').toBeNull()
    }
  })

  // ── public/team field leak (Low) ─────────────────────────────────────────
  test('GET /public/team/:id does not leak internal config fields', async ({ request }) => {
    const teamId = process.env.E2E_PUBLIC_TEAM_ID || '3'
    const res = await request.get(`${DIRECTUS}/kscw/public/team/${teamId}`)
    test.skip(res.status() !== 200, `public/team/${teamId} returned ${res.status()}`)
    const body = await res.json()
    const team = body?.data ?? body
    for (const leaked of ['features_enabled', 'dashboard_range_from', 'dashboard_range_to', 'dashboard_league_only', 'bb_source_id', 'captain']) {
      expect(team?.[leaked], `${leaked} must be stripped from public team payload`).toBeUndefined()
    }
  })
})
