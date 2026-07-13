import { test as setup, expect, type APIRequestContext } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import {
  ADMIN_FILE,
  DIRECTUS_URL,
  USER_FILE,
  adminToken,
  buildStorageState,
  memberToken,
} from './fixtures/auth'

/**
 * Produces the two storageState files the authenticated projects depend on.
 *
 * The state itself holds NO credential — only the app's non-secret auth-hint
 * cookie. The actual Directus static token is attached per-request by the
 * fixture in `e2e/fixtures/auth.ts` (see that file for why cookie-session auth
 * can't be replayed from localhost).
 *
 * This setup's real job is to FAIL FAST and loudly when a token is missing or
 * stale — the nightly prod→dev refresh has scrubbed the old `test_*@test.ch`
 * accounts, so a silently unauthenticated run was how this suite rotted before.
 */

function writeState(file: string) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(buildStorageState(), null, 2))
}

/**
 * Verify the token maps to a real `members` row — that is exactly the contract
 * `AuthProvider.fetchMember()` enforces, and a token that fails it (e.g. a bare
 * Directus Administrator) makes the app log itself straight back out.
 */
async function verifyIdentity(request: APIRequestContext, token: string, label: string) {
  const headers = { Authorization: `Bearer ${token}` }

  const me = await request.get(`${DIRECTUS_URL}/users/me`, { headers, params: { fields: 'id' } })
  expect(
    me.ok(),
    `[${label}] Directus rejected the static token (${me.status()}). ` +
      `Dev tokens are re-pinned by the nightly refresh — re-read it from the vault / dev DB.`,
  ).toBeTruthy()
  const userId = (await me.json()).data.id

  const res = await request.get(`${DIRECTUS_URL}/items/members`, {
    headers,
    params: {
      'filter[user][_eq]': userId,
      limit: 1,
      fields: 'id,first_name,last_name,role,language',
    },
  })
  expect(res.ok(), `[${label}] members self-lookup failed (${res.status()})`).toBeTruthy()

  const member = (await res.json()).data?.[0]
  expect(
    member,
    `[${label}] this Directus user has no linked \`members\` row — the app's ` +
      `fetchMember() would return null and immediately log out. Use a token that ` +
      `belongs to a real member.`,
  ).toBeTruthy()

  return member as { id: number; first_name: string; last_name: string; role: string[] }
}

setup('authenticate as member', async ({ request }) => {
  const token = memberToken()
  expect(
    token,
    'No member token. Set E2E_MEMBER_TOKEN (or DIRECTUS_DEV_USER_TOKEN_MEMBER) in .env.local.',
  ).toBeTruthy()

  const member = await verifyIdentity(request, token!, 'member')

  // The member specs assert on a *non-privileged* identity (e.g. scorer.spec.ts
  // expects the "can only be managed by admins and coaches" notice). Guard the
  // precondition so a mis-pinned token surfaces here, not as 6 cryptic failures.
  const privileged = ['admin', 'superuser', 'vb_admin', 'bb_admin'].filter((r) =>
    (member.role ?? []).includes(r),
  )
  expect(
    privileged,
    `[member] token belongs to a privileged member (${privileged.join(', ')}). ` +
      `The member specs need a plain user.`,
  ).toEqual([])

  writeState(USER_FILE)
  console.log(`  ✓ member identity: #${member.id} ${member.first_name} ${member.last_name}`)
})

setup('authenticate as admin', async ({ request }) => {
  const token = adminToken()

  // Always write the state file: the admin specs must be able to open a context
  // and fail with the fixture's precise "no admin token" error rather than an
  // opaque ENOENT — and the member projects must not be blocked by this.
  writeState(ADMIN_FILE)

  if (!token) {
    setup.skip(
      true,
      'No admin token — set E2E_ADMIN_TOKEN (or DIRECTUS_DEV_USER_TOKEN_ADMIN) in .env.local. ' +
        'admin-pages / admin-mode / hallenplan specs cannot run without it.',
    )
    return
  }

  const member = await verifyIdentity(request, token, 'admin')

  const isAdmin = ['admin', 'superuser', 'vb_admin', 'bb_admin'].some((r) =>
    (member.role ?? []).includes(r),
  )
  expect(
    isAdmin,
    `[admin] member #${member.id} has roles ${JSON.stringify(member.role)} — none of them grant ` +
      `admin access, so the admin specs would fail. Point E2E_ADMIN_TOKEN at an admin/superuser member.`,
  ).toBeTruthy()

  console.log(`  ✓ admin identity:  #${member.id} ${member.first_name} ${member.last_name}`)
})
