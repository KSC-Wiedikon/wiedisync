// @vitest-environment happy-dom
//
// Restoring a session on app start: only a definitive "your session is gone" signs a
// member out. A network drop, a rate limit or a 5xx from a restarting Directus says
// nothing about the session. Getting this wrong logs members out of a live tool, and
// every reload re-fires a ~350-request boot.
//
// ⚠ The failures here get reported for real by captureAuthError, so `fetch` is stubbed
// below. Without it each run posted its fake errors to the live error log.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => {
  localStorage.setItem('wiedisync-lang', 'en')
  return {
    member: { id: '7', first_name: 'Anna', last_name: 'Muster', role: [] as string[] },
    logout: vi.fn(async () => {}),
    refreshAuth: vi.fn(),
    readMeAsOwner: vi.fn(),
    fetchItems: vi.fn(),
    reload: vi.fn(),
    fetch: vi.fn(async () => new Response(null, { status: 204 })),
  }
})

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  logout: h.logout,
  refreshAuth: h.refreshAuth,
  setAuthHint: vi.fn(),
  isAuthenticated: () => true,
  readMeAsOwner: h.readMeAsOwner,
  fetchItems: h.fetchItems,
  fetchAllItems: vi.fn(async () => []),
  kscwApi: vi.fn(async () => ({ data: { managed: [], available: true, passkeys: [] } })),
}))
vi.mock('../lib/e2eeStore', () => ({
  clearAllCachedDocuments: vi.fn(async () => {}),
  clearDeviceKey: vi.fn(async () => {}),
  sweepCachedDocuments: vi.fn(async () => {}),
}))
vi.mock('../lib/identityBootstrap', () => ({ bootstrapIdentityKey: vi.fn(async () => {}) }))

import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let auth: ReturnType<typeof useAuth>
const expose = (a: typeof auth) => { auth = a }
function Probe() {
  const a = useAuth()
  useEffect(() => { expose(a) })
  return null
}

const answered = (status: number, code?: string) =>
  Object.assign(new Error(code ?? `HTTP ${status}`), { response: { status }, errors: code ? [{ extensions: { code } }] : [] })
const networkDrop = () => new Error('Failed to fetch (directus.kscw.ch)')

describe('restoring a session on app start', () => {
  let root: Root
  let reloadSpy: ReturnType<typeof vi.spyOn>

  const boot = async () => {
    await act(async () => { root.render(<AuthProvider><Probe /></AuthProvider>) })
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
  const expectKept = () => {
    expect(h.logout).not.toHaveBeenCalled()
    expect(h.reload).not.toHaveBeenCalled()
    expect(auth.user).toBeNull()
    expect(auth.isLoading).toBe(false)
  }
  const expectSignedOut = () => {
    expect(h.logout).toHaveBeenCalledTimes(1)
    expect(h.reload).toHaveBeenCalledTimes(1)
  }

  beforeEach(() => {
    for (const mock of [h.logout, h.refreshAuth, h.readMeAsOwner, h.fetchItems, h.reload]) mock.mockReset()
    h.refreshAuth.mockResolvedValue(undefined)
    h.readMeAsOwner.mockResolvedValue({ id: 'u-7' })
    h.fetchItems.mockResolvedValue([h.member])
    vi.stubGlobal('fetch', h.fetch)
    reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(h.reload)
    root = createRoot(document.createElement('div'))
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    reloadSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('signs the member in when everything answers', async () => {
    await boot()
    expect(auth.user?.id).toBe('7')
    expect(h.logout).not.toHaveBeenCalled()
  })

  describe('keeps the session when the refresh', () => {
    it.each([
      ['answers 503 (Directus restarting)', () => answered(503)],
      ['answers 502', () => answered(502)],
      ['answers 429 (a rate limit, maybe a whole hall on one IP)', () => answered(429)],
      ['answers 403 (an edge block)', () => answered(403)],
      ['drops off the network', networkDrop],
    ])('%s', async (_name, error) => {
      h.refreshAuth.mockRejectedValue(error())
      await boot()
      expectKept()
    })
  })

  describe('keeps the session when the refresh worked but /users/me', () => {
    it.each([
      ['answers 503', () => answered(503)],
      ['drops off the network', networkDrop],
    ])('%s', async (_name, error) => {
      h.readMeAsOwner.mockRejectedValue(error())
      await boot()
      expectKept()
    })
  })

  describe('keeps the session when the refresh worked but the member read', () => {
    it.each([
      ['answers 503', () => answered(503)],
      ['answers 403', () => answered(403)],
      ['drops off the network', networkDrop],
    ])('%s', async (_name, error) => {
      h.fetchItems.mockRejectedValue(error())
      await boot()
      expectKept()
    })
  })

  describe('signs the member out when the session really is gone', () => {
    it.each([
      ['a 401', () => answered(401)],
      ['INVALID_CREDENTIALS', () => answered(401, 'INVALID_CREDENTIALS')],
      ['TOKEN_EXPIRED', () => answered(401, 'TOKEN_EXPIRED')],
      ['INVALID_PAYLOAD (no refresh cookie)', () => answered(400, 'INVALID_PAYLOAD')],
      ['INVALID_TOKEN', () => answered(400, 'INVALID_TOKEN')],
    ])('the refresh answers %s', async (_name, error) => {
      h.refreshAuth.mockRejectedValue(error())
      await boot()
      expectSignedOut()
    })

    it('the member read answers 401 right after the refresh', async () => {
      h.fetchItems.mockRejectedValue(answered(401))
      await boot()
      expectSignedOut()
    })
  })

  it('signs out a login with no linked member, without a reload', async () => {
    h.fetchItems.mockResolvedValue([])
    await boot()
    expect(h.logout).toHaveBeenCalledTimes(1)
    expect(h.reload).not.toHaveBeenCalled()
    expect(auth.user).toBeNull()
  })
})
