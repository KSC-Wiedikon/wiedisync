// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://wiedisync.kscw.ch/"}
//
// AuthProvider's passkey paths, end to end down to the API boundary:
//  - after a PASSWORD sign-in on a device that can keep a passkey, the "Sign in faster
//    next time?" offer appears (rendered by the provider — the sign-in page is gone by
//    then); "Not now" is remembered for this member; "Set up" uses the password just
//    typed, and asks for the authenticator code when the server wants it
//  - loginWithPasskey runs the same post-sign-in steps as login (after priming the SDK
//    session with a refresh) but never the identity-key bootstrap — there is no password
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => {
  localStorage.setItem('wiedisync-lang', 'en')
  const order: string[] = []
  const member = { id: '7', first_name: 'Anna', last_name: 'Muster', role: [] as string[] }
  const passkeyRow = { id: 'p1', credential_id: 'AAECAwQFBgcICQ', label: 'Chrome on Android', created_at: '2026-11-02T10:00:00Z', last_used_at: null }
  type Opts = { body?: Record<string, unknown> } | undefined
  const registerOptions = vi.fn<(opts: Opts) => Promise<unknown>>(async () => ({ data: { challengeId: 'r1', options: { challenge: 'xyz' } } }))
  const kscwApi = vi.fn(async (path: string, opts?: Opts): Promise<unknown> => {
    switch (path) {
      case '/household/me': return { data: { managed: [] } }
      case '/passkey/list': return { data: { available: true, passkeys: [] } }
      case '/passkey/register-options': return registerOptions(opts)
      case '/passkey/register': return { data: { passkey: passkeyRow } }
      case '/passkey/login-options': order.push('login-options'); return { data: { challengeId: 'c1', options: { challenge: 'abc' } } }
      case '/passkey/login': order.push('passkey/login'); return { data: { ok: true } }
    }
    throw new Error(`unexpected ${path}`)
  })
  return {
    order, member, passkeyRow, registerOptions, kscwApi,
    apiLogin: vi.fn(async () => { order.push('password/login') }),
    apiLogout: vi.fn(async () => {}),
    refreshAuth: vi.fn(async () => { order.push('refresh') }),
    setAuthHint: vi.fn((on: boolean) => { order.push(`hint:${on}`) }),
    readMeAsOwner: vi.fn(async () => { order.push('readMe'); return { id: 'u-7' } }),
    bootstrapIdentityKey: vi.fn(async () => {}),
    startRegistration: vi.fn(async () => ({ id: 'AAECAwQFBgcICQ', authenticatorAttachment: 'platform' })),
    startAuthentication: vi.fn(async () => ({ id: 'AAECAwQFBgcICQ', authenticatorAttachment: 'platform' })),
  }
})

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  login: h.apiLogin,
  logout: h.apiLogout,
  refreshAuth: h.refreshAuth,
  setAuthHint: h.setAuthHint,
  isAuthenticated: () => false,
  readMeAsOwner: h.readMeAsOwner,
  fetchItems: vi.fn(async () => [h.member]),
  fetchAllItems: vi.fn(async () => []),
  kscwApi: h.kscwApi,
}))
vi.mock('../lib/e2eeStore', () => ({
  clearAllCachedDocuments: vi.fn(async () => {}),
  clearDeviceKey: vi.fn(async () => {}),
  sweepCachedDocuments: vi.fn(async () => {}),
}))
vi.mock('../lib/identityBootstrap', () => ({ bootstrapIdentityKey: h.bootstrapIdentityKey }))
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startRegistration: h.startRegistration,
  startAuthentication: h.startAuthentication,
}))
// The real Modal is a Radix dialog / vaul drawer; the offer's own behaviour is what is under test.
vi.mock('@/components/Modal', () => ({
  default: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={title}><h2>{title}</h2>{children}</div> : null,
}))

import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'
import { readPasskeyHint } from '../lib/passkeys'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let auth: ReturnType<typeof useAuth>
const expose = (a: typeof auth) => { auth = a }
function Probe() {
  const a = useAuth()
  useEffect(() => { expose(a) })
  return null
}

let root: Root
let container: HTMLElement
const dialog = () => container.querySelector('[role="dialog"]')
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text) ?? null
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull()
  await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await settle()
}
function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const listCalls = () => h.kscwApi.mock.calls.filter(([p]) => p === '/passkey/list').length

beforeEach(async () => {
  localStorage.removeItem('wiedisync-passkeys')
  h.order.length = 0
  for (const fn of [h.kscwApi, h.registerOptions, h.apiLogin, h.refreshAuth, h.setAuthHint, h.readMeAsOwner,
    h.bootstrapIdentityKey, h.startRegistration, h.startAuthentication]) fn.mockClear()
  // A browser with WebAuthn and a fingerprint reader / face / PIN.
  vi.stubGlobal('PublicKeyCredential', class { static isUserVerifyingPlatformAuthenticatorAvailable = async () => true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<AuthProvider><Probe /></AuthProvider>))
  await settle()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

/** What the member just typed into the sign-in form (a test value, not a credential). */
const TYPED = 'pw-just-typed'

describe('the passkey offer after a password sign-in', () => {
  it('appears after the sign-in, and "Not now" is remembered for this member', async () => {
    expect(dialog()).toBeNull()
    await act(async () => { await auth.login('anna@example.ch', TYPED) })
    await settle()
    expect(dialog()?.getAttribute('aria-label')).toBe('Sign in faster next time?')
    expect(container.textContent).toContain('Use your fingerprint, face or phone PIN instead of the password on this device.')

    await click(button('Not now'))
    expect(dialog()).toBeNull()
    expect(readPasskeyHint('7').dismissed).toBe(true)
    expect(h.registerOptions).not.toHaveBeenCalled()

    // Signed out and in again: not asked again — the server is not even consulted.
    await act(async () => { await auth.logout() })
    await act(async () => { await auth.login('anna@example.ch', TYPED) })
    await settle()
    expect(dialog()).toBeNull()
    expect(listCalls()).toBe(1)
  })

  it('"Set up" uses the password just typed, then remembers the key on this device', async () => {
    await act(async () => { await auth.login('anna@example.ch', TYPED) })
    await settle()
    await click(button('Set up'))
    expect(h.registerOptions).toHaveBeenCalledWith({ method: 'POST', body: { password: TYPED }, noAuthRetry: true })
    expect(h.startRegistration).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    expect(readPasskeyHint('7')).toMatchObject({ on: true, credentialIds: [h.passkeyRow.credential_id] })
  })

  it('asks for the authenticator code when the account has one', async () => {
    h.registerOptions.mockRejectedValueOnce(Object.assign(new Error('API /passkey/register-options: 401'), { status: 401, code: 'otp_required' }))
    await act(async () => { await auth.login('anna@example.ch', TYPED) })
    await settle()
    await click(button('Set up'))
    const codeInput = container.querySelector<HTMLInputElement>('#passkey-offer-otp')
    expect(codeInput).not.toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    type(codeInput!, '123456')
    await click(button('Set up'))
    expect(h.registerOptions).toHaveBeenLastCalledWith({ method: 'POST', body: { password: TYPED, otp: '123456' }, noAuthRetry: true })
    expect(dialog()).toBeNull()
  })

  it('is not offered again on a device that already has this member\'s key', async () => {
    localStorage.setItem('wiedisync-passkeys', JSON.stringify({ 7: { on: true, credentialIds: [h.passkeyRow.credential_id] } }))
    const list = { data: { available: true, passkeys: [h.passkeyRow] } }
    const original = h.kscwApi.getMockImplementation()!
    h.kscwApi.mockImplementation(async (path, opts) => (path === '/passkey/list' ? list : original(path, opts)))
    try {
      await act(async () => { await auth.login('anna@example.ch', TYPED) })
      await settle()
      expect(listCalls()).toBe(1)
      expect(dialog()).toBeNull()
    } finally {
      h.kscwApi.mockImplementation(original)
    }
  })
})

describe('loginWithPasskey', () => {
  it('signs in with the same post-login steps, after priming the session — and no identity-key bootstrap', async () => {
    await act(async () => { await auth.loginWithPasskey() })
    await settle()
    expect(h.order.slice(0, 5)).toEqual(['login-options', 'passkey/login', 'hint:true', 'refresh', 'readMe'])
    expect(auth.user?.id).toBe('7')
    expect(h.apiLogin).not.toHaveBeenCalled()
    expect(h.bootstrapIdentityKey).not.toHaveBeenCalled()
    expect(dialog()).toBeNull() // no offer after a passkey sign-in
    expect(readPasskeyHint('7')).toMatchObject({ on: true, credentialIds: ['AAECAwQFBgcICQ'] })
  })

  it('a cancelled device sheet signs nobody in', async () => {
    h.startAuthentication.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }))
    await expect(act(async () => { await auth.loginWithPasskey() })).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(h.setAuthHint).not.toHaveBeenCalled()
    expect(h.refreshAuth).not.toHaveBeenCalled()
    expect(auth.user).toBeNull()
  })
})
