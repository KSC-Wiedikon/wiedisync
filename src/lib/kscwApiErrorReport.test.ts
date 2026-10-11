// kscwApi attached the raw request body to every error report it filed. For the
// credential routes that body IS the secret — /change-password carries the current
// and the new password plus the re-wrapped E2EE key — and a 5xx shipped all of it to
// Sentry and the JSONL log (security audit 2026-10, H2). And only the logout button
// wiped the pre-loaded Show IDs documents; every other way a session ended left them
// (M4). Both now live in api.ts, so both are pinned here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { captureApiError, clearAllCachedDocuments } = vi.hoisted(() => ({
  captureApiError: vi.fn(),
  clearAllCachedDocuments: vi.fn(async () => {}),
}))
vi.mock('./sentry', async (importOriginal) => ({ ...(await importOriginal<object>()), captureApiError }))
vi.mock('./e2eeStore', () => ({ clearAllCachedDocuments }))

import { isCredentialEndpoint, kscwApi, logout } from './api'

const respond = (status: number, body: unknown = {}) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

const pwBody = {
  current_password: 'Old-Secr3t!',
  new_password: 'New-Secr3t!',
  e2ee: { private_key: 'PRIVATE-KEY-B64', salt: 'SALT-B64' }, // gitleaks:allow — synthetic fixture
}

beforeEach(() => {
  captureApiError.mockClear()
  clearAllCachedDocuments.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('isCredentialEndpoint', () => {
  it('covers every route whose body is a credential or key material', () => {
    for (const p of ['/change-password', '/set-password', '/password-request', '/verify-email',
      '/verify-email/confirm', '/check-email', '/signup-invites/redeem', '/identity/keys',
      '/identity/document/12', '/identity/envelopes', '/admin/sql', '/admin/sql/ask',
      '/email-accounts', '/email-accounts/3', '/web-push/subscribe', '/change-password?x=1']) {
      expect(isCredentialEndpoint(p), p).toBe(true)
    }
  })

  it('leaves ordinary routes reportable', () => {
    for (const p of ['/carpools/upcoming', '/clubdesk-update', '/finance/invoices', '/registration/my-docs',
      '/events/4/share-token', '/me/ical-token']) {
      expect(isCredentialEndpoint(p), p).toBe(false)
    }
  })
})

describe('kscwApi error reports', () => {
  it('reports a /change-password 5xx WITHOUT the request body', async () => {
    respond(500, { error: 'Internal error' })
    await expect(kscwApi('/change-password', { method: 'POST', body: pwBody })).rejects.toThrow()
    expect(captureApiError).toHaveBeenCalledTimes(1)
    const ctx = captureApiError.mock.calls[0][1]
    expect(ctx).toMatchObject({ endpoint: '/change-password', status: 500 })
    expect(ctx.payload).toBeUndefined()
    expect(JSON.stringify(ctx)).not.toContain('Secr3t')
  })

  it('does not report the expected /change-password refusals at all', async () => {
    for (const [status, code] of [[403, 'bad_password'], [400, 'unchanged'], [400, 'password_too_common'], [400, 'rewrap_required']] as const) {
      respond(status, { error: 'x', code })
      await expect(kscwApi('/change-password', { method: 'POST', body: pwBody })).rejects.toMatchObject({ code })
    }
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('does not report a password-rule refusal from another route either (keyed on the code)', async () => {
    respond(400, { error: 'weak', code: 'password_weak' })
    await expect(kscwApi('/signup-invites/redeem', { method: 'POST', anonymous: true, body: { token: 't', password: 'p' } }))
      .rejects.toMatchObject({ code: 'password_weak' })
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it('drops the body on a network failure too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(kscwApi('/identity/keys', { method: 'POST', body: { private_key: 'k', salt: 's' } })).rejects.toThrow()
    expect(captureApiError).toHaveBeenCalledTimes(1)
    expect(captureApiError.mock.calls[0][1].payload).toBeUndefined()
  })

  it('still attaches the body on an ordinary route (captureApiError scrubs it)', async () => {
    respond(500)
    const body = { team: 3, ahv_nummer: '756.1234.5678.97' }
    await expect(kscwApi('/clubdesk-update', { method: 'POST', body })).rejects.toThrow()
    expect(captureApiError.mock.calls[0][1].payload).toEqual(body)
  })
})

describe('logout', () => {
  it('wipes the pre-loaded identity documents on every path through it', async () => {
    const store = () => {
      const m = new Map<string, string>()
      return {
        get length() { return m.size },
        key: (i: number) => [...m.keys()][i] ?? null,
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => { m.set(k, v) },
        removeItem: (k: string) => { m.delete(k) },
      }
    }
    vi.stubGlobal('localStorage', store())
    vi.stubGlobal('sessionStorage', store())
    respond(204)
    await logout()
    expect(clearAllCachedDocuments).toHaveBeenCalledTimes(1)
  })
})
