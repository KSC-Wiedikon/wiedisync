import { describe, it, expect, vi } from 'vitest'
import { authentication, createDirectus } from '@directus/sdk'
import { hintRenewingStorage } from '../authHintStorage'

/**
 * The auth hint must follow the SLIDING server session, not the login.
 *
 * prod 12.10.2026: the hint was written only at login with a 7-day max-age while
 * every refresh pushed the Directus session out another 7 days — so a week after
 * logging in, an active member's next cold start went straight to /login. Driven
 * through the real SDK composable, because the bug was that its autoRefresh path
 * never touched the hint.
 */
function sessionClient(renew: () => void, responses: Array<{ status: number; body: unknown }>) {
  const fetch = vi.fn(async () => {
    const r = responses.shift() ?? { status: 500, body: {} }
    if (r.status === 204) return new Response(null, { status: 204 })
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  })
  const client = createDirectus('https://directus.example.ch', { globals: { fetch } })
    .with(authentication('session', { credentials: 'include', autoRefresh: false, storage: hintRenewingStorage(renew) }))
  return { client, fetch }
}

const session = { data: { access_token: null, refresh_token: null, expires: 900_000 } }

describe('hintRenewingStorage', () => {
  it('renews the hint on login and on every refresh', async () => {
    const renew = vi.fn()
    const { client } = sessionClient(renew, [{ status: 200, body: session }, { status: 200, body: session }, { status: 200, body: session }])
    await client.login({ email: 'a@example.ch', password: 'x' })
    expect(renew).toHaveBeenCalledTimes(1)
    await client.refresh()
    await client.refresh()
    expect(renew).toHaveBeenCalledTimes(3)
  })

  it('leaves the hint alone when the session is cleared', async () => {
    const renew = vi.fn()
    const { client } = sessionClient(renew, [{ status: 200, body: session }, { status: 204, body: {} }])
    await client.login({ email: 'a@example.ch', password: 'x' })
    await client.logout()
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it('does not renew on a rejected refresh', async () => {
    const renew = vi.fn()
    const { client } = sessionClient(renew, [{ status: 401, body: { errors: [{ message: 'Invalid user credentials.', extensions: { code: 'INVALID_CREDENTIALS' } }] } }])
    await expect(client.refresh()).rejects.toBeTruthy()
    expect(renew).not.toHaveBeenCalled()
  })

  it('still hands the SDK back what it stored', async () => {
    const storage = hintRenewingStorage(() => {})
    const data = { access_token: null, refresh_token: null, expires: 900_000, expires_at: 1 }
    await storage.set(data)
    expect(await storage.get()).toEqual(data)
  })
})
