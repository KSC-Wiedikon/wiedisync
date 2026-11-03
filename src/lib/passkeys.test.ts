// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://wiedisync.kscw.ch/"}
//
// Passkeys (lib/passkeys.ts): where they show, how a failure reads, what this device
// remembers, and the app lock's local check — which must accept only one of this
// device's keys WITH the user-verified flag, and never needs the network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { captureAuthError, startAuthentication, startRegistration } = vi.hoisted(() => ({
  captureAuthError: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}))
vi.mock('./sentry', async (importOriginal) => ({ ...(await importOriginal<object>()), captureAuthError }))
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startAuthentication,
  startRegistration,
}))

import {
  PASSKEY_RP_BY_HOST, acceptLocalAssertion, anyPasskeyHere, dismissPasskeyOffer, isPasskeyAlreadyHere, isPasskeyCancel,
  isReportablePasskeyError, passkeyErrorKey, passkeyErrorText, passkeysPossible, readPasskeyHint, reconcilePasskeyHint,
  rememberPasskeyHere, rpIdForHost, setPasskeyLock, setUpPasskey, shouldOfferPasskey, signInWithPasskey,
  unlockOnThisDevice, userVerified,
} from './passkeys'

/** What kscwApi throws for a non-2xx answer: `status` + the server's `code`. */
const serverError = (status: number, code?: string) => Object.assign(new Error(`API /passkey: ${status}`), { status, code })
const domError = (name: string) => Object.assign(new Error(name), { name })

/** A WebAuthn-capable browser with (or without) a platform authenticator. */
function stubWebAuthn(platform = true) {
  vi.stubGlobal('PublicKeyCredential', class {
    static isUserVerifyingPlatformAuthenticatorAvailable = async () => platform
  })
}

/** authenticatorData: 32-byte RP ID hash, the flags byte, a 4-byte counter. */
const authData = (flags: number) => {
  const bytes = new Uint8Array(37)
  bytes[32] = flags
  return bytes.buffer
}

const ID_A = 'AAECAwQFBgcICQ'
const ID_B = 'cGhvbmUta2V5'

beforeEach(() => {
  localStorage.clear()
  captureAuthError.mockReset()
  startAuthentication.mockReset()
  startRegistration.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('rpIdForHost', () => {
  it('maps the club pages to their relying party', () => {
    expect(rpIdForHost('wiedisync.kscw.ch')).toBe('kscw.ch')
    expect(rpIdForHost('spielplanung.wiedisync.kscw.ch')).toBe('kscw.ch')
    expect(rpIdForHost('accounting.wiedisync.kscw.ch')).toBe('kscw.ch')
    expect(rpIdForHost('wiedisync-dev.kscw.ch')).toBe('wiedisync-dev.kscw.ch')
    expect(Object.keys(PASSKEY_RP_BY_HOST)).toHaveLength(4)
  })

  it('says no everywhere else — exact host only', () => {
    for (const host of ['localhost', '127.0.0.1', 'kscw.ch', 'spielplanung-dev.kscw.ch', 'accounting-dev.kscw.ch',
      'dev.kscw-wiedisync.pages.dev', 'evil-wiedisync.kscw.ch', 'wiedisync.kscw.ch.evil.com', 'WIEDISYNC.KSCW.CH', '',
      'toString', '__proto__', 'constructor']) {
      expect(rpIdForHost(host), host).toBeNull()
    }
    expect(rpIdForHost(null)).toBeNull()
    expect(rpIdForHost(undefined)).toBeNull()
  })
})

describe('passkeysPossible', () => {
  it('needs the right host AND WebAuthn', () => {
    expect(passkeysPossible('wiedisync.kscw.ch')).toBe(false) // no PublicKeyCredential (old Android shell)
    stubWebAuthn()
    expect(passkeysPossible('wiedisync.kscw.ch')).toBe(true)
    expect(passkeysPossible('localhost')).toBe(false)
    expect(passkeysPossible()).toBe(true) // this page: https://wiedisync.kscw.ch/
  })
})

describe('error helpers', () => {
  it('a closed or timed-out device sheet is a cancel', () => {
    expect(isPasskeyCancel(domError('NotAllowedError'))).toBe(true)
    expect(isPasskeyCancel(domError('AbortError'))).toBe(true)
    // @simplewebauthn/browser wraps: name from the cause, or its own abort code.
    expect(isPasskeyCancel(Object.assign(new Error('x'), { name: 'Error', cause: { name: 'NotAllowedError' } }))).toBe(true)
    expect(isPasskeyCancel(Object.assign(new Error('x'), { code: 'ERROR_CEREMONY_ABORTED' }))).toBe(true)
    expect(isPasskeyCancel(domError('InvalidStateError'))).toBe(false)
    expect(isPasskeyCancel(serverError(401, 'passkey_unknown'))).toBe(false)
    expect(isPasskeyCancel(null)).toBe(false)
  })

  it('knows the device that already holds a key for the account', () => {
    expect(isPasskeyAlreadyHere(domError('InvalidStateError'))).toBe(true)
    expect(isPasskeyAlreadyHere(Object.assign(new Error('x'), { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' }))).toBe(true)
    expect(isPasskeyAlreadyHere(domError('NotAllowedError'))).toBe(false)
  })

  it('maps every server refusal and device failure to words', () => {
    const cases: [unknown, string][] = [
      [serverError(401, 'passkey_unknown'), 'passkeyErrUnknown'],
      [serverError(400, 'passkey_challenge'), 'passkeyErrExpired'],
      [serverError(403, 'resource_restricted'), 'passkeyErrRestricted'],
      [serverError(401, 'passkey_origin'), 'passkeyErrOrigin'],
      [serverError(401, 'passkey_invalid'), 'passkeyErrInvalid'],
      [serverError(401, 'passkey_mismatch'), 'passkeyErrInvalid'],
      [serverError(401, 'user_suspended'), 'passkeyErrSuspended'],
      [serverError(403, 'user_suspended'), 'passkeyErrSuspended'],
      [serverError(400, 'password_required'), 'passkeyErrPasswordRequired'],
      [serverError(401, 'bad_password'), 'passkeyErrBadPassword'],
      [serverError(401, 'otp_required'), 'passkeyOtpNeeded'],
      [serverError(401, 'otp_invalid'), 'passkeyErrOtpInvalid'],
      [serverError(409, 'passkeys_full'), 'passkeyErrFull'],
      [serverError(409, 'passkey_exists'), 'passkeyErrAlreadyHere'],
      [serverError(403, 'acting_forbidden'), 'passkeyErrActing'],
      [serverError(429, 'rate_limited'), 'tooManyRequests'],
      [serverError(429), 'tooManyRequests'],
      [serverError(503, 'passkeys_unavailable'), 'passkeyErrUnavailable'],
      [serverError(404), 'passkeyErrUnavailable'], // backend not deployed yet
      [serverError(500), 'passkeyErrGeneric'],
      [new TypeError('Failed to fetch'), 'networkError'],
      [domError('InvalidStateError'), 'passkeyErrAlreadyHere'],
      [domError('SecurityError'), 'passkeyErrDevice'],
      [undefined, 'passkeyErrDevice'],
    ]
    for (const [err, key] of cases) expect(passkeyErrorKey(err), JSON.stringify(err) ?? 'undefined').toBe(key)
    expect(passkeyErrorText((k) => `t:${k}`, serverError(401, 'passkey_unknown'))).toBe('t:passkeyErrUnknown')
  })

  it('reports only real faults — never a cancel, a designed refusal, a 5xx or the network', () => {
    expect(isReportablePasskeyError(serverError(401, 'passkey_origin'))).toBe(true)
    expect(isReportablePasskeyError(serverError(401, 'passkey_invalid'))).toBe(true)
    expect(isReportablePasskeyError(domError('SecurityError'))).toBe(true)
    for (const err of [domError('NotAllowedError'), domError('InvalidStateError'), serverError(401, 'passkey_unknown'),
      serverError(400, 'passkey_challenge'), serverError(401, 'bad_password'), serverError(401, 'otp_required'),
      serverError(403, 'resource_restricted'), serverError(500), serverError(404), new TypeError('Load failed')]) {
      expect(isReportablePasskeyError(err), String((err as { code?: string }).code ?? (err as Error).name)).toBe(false)
    }
  })
})

describe('what this device remembers', () => {
  it('starts empty, and survives junk in storage', () => {
    expect(readPasskeyHint(7)).toEqual({ on: false, credentialIds: [], dismissed: false, lock: false })
    localStorage.setItem('wiedisync-passkeys', '{not json')
    expect(readPasskeyHint(7).on).toBe(false)
    localStorage.setItem('wiedisync-passkeys', JSON.stringify({ 7: { on: 'yes', credentialIds: ['ok_id', 42, 'bad id!'], lock: true } }))
    expect(readPasskeyHint(7)).toEqual({ on: false, credentialIds: ['ok_id'], dismissed: false, lock: true })
  })

  it('a key on this device joins the lock list; a phone used by QR code only marks "on"', () => {
    rememberPasskeyHere(7, ID_B, false)
    expect(readPasskeyHint(7)).toMatchObject({ on: true, credentialIds: [] })
    rememberPasskeyHere(7, ID_A, true)
    rememberPasskeyHere(7, ID_A, true)
    expect(readPasskeyHint(7).credentialIds).toEqual([ID_A])
    expect(readPasskeyHint('7').on).toBe(true) // keyed by id, number or string
    expect(readPasskeyHint(8).on).toBe(false)
    expect(anyPasskeyHere()).toBe(true)
  })

  it('remembers "Not now" per member', () => {
    dismissPasskeyOffer(7)
    expect(readPasskeyHint(7).dismissed).toBe(true)
    expect(readPasskeyHint(8).dismissed).toBe(false)
    expect(anyPasskeyHere()).toBe(false)
  })

  it('never turns the lock on without a key here to ask for', () => {
    setPasskeyLock(7, true)
    expect(readPasskeyHint(7).lock).toBe(false)
    rememberPasskeyHere(7, ID_A, true)
    setPasskeyLock(7, true)
    expect(readPasskeyHint(7).lock).toBe(true)
  })

  it('reconciles with the server: a removed key leaves, and the last one takes the lock with it', () => {
    rememberPasskeyHere(7, ID_A, true)
    rememberPasskeyHere(7, ID_B, true)
    setPasskeyLock(7, true)
    expect(reconcilePasskeyHint(7, [ID_A, 'elsewhere'])).toEqual({ on: true, credentialIds: [ID_A], dismissed: false, lock: true })
    // A password change removed every key on the account.
    expect(reconcilePasskeyHint(7, [])).toEqual({ on: false, credentialIds: [], dismissed: false, lock: false })
  })

  it('reconciling keeps "on" for a member who signs in with a phone, while the account has keys', () => {
    rememberPasskeyHere(7, ID_B, false)
    expect(reconcilePasskeyHint(7, [ID_B]).on).toBe(true)
    expect(reconcilePasskeyHint(7, []).on).toBe(false)
  })

  it('this device\'s keys all gone, others left elsewhere: no longer "on" here', () => {
    rememberPasskeyHere(7, ID_A, true)
    expect(reconcilePasskeyHint(7, ['laptop-key'])).toMatchObject({ on: false, credentialIds: [] })
  })

  it('never throws when storage refuses writes (private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(() => rememberPasskeyHere(7, ID_A, true)).not.toThrow()
    expect(() => dismissPasskeyOffer(7)).not.toThrow()
  })
})

describe('the app lock\'s local check', () => {
  it('reads the user-verified bit from the flags byte', () => {
    expect(userVerified(authData(0x05))).toBe(true) // UP + UV
    expect(userVerified(authData(0x04))).toBe(true)
    expect(userVerified(authData(0x01))).toBe(false) // presence only
    expect(userVerified(authData(0x41))).toBe(false)
    expect(userVerified(new Uint8Array(32).buffer)).toBe(false) // too short
    // A view into a bigger buffer reads its own byte 32, not the buffer's.
    const big = new Uint8Array(40)
    big[35] = 0x04
    expect(userVerified(new Uint8Array(big.buffer, 3, 37))).toBe(true)
    expect(userVerified(new Uint8Array(big.buffer, 0, 37))).toBe(false)
  })

  it('accepts only a listed key with UV', () => {
    const answer = (id: string, flags: number) => ({ type: 'public-key', id, response: { authenticatorData: authData(flags) } })
    expect(acceptLocalAssertion(answer(ID_A, 0x05), [ID_A])).toBe(true)
    expect(acceptLocalAssertion(answer(ID_B, 0x05), [ID_A])).toBe(false)
    expect(acceptLocalAssertion(answer(ID_A, 0x01), [ID_A])).toBe(false)
    expect(acceptLocalAssertion({ ...answer(ID_A, 0x05), type: 'password' }, [ID_A])).toBe(false)
    expect(acceptLocalAssertion({ type: 'public-key', id: ID_A, response: {} }, [ID_A])).toBe(false)
    expect(acceptLocalAssertion(null, [ID_A])).toBe(false)
  })

  it('asks this device for its own keys with a fresh challenge — and never the network', async () => {
    stubWebAuthn()
    const fetchSpy = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', fetchSpy)
    const get = vi.fn(async () => ({ type: 'public-key', id: ID_A, response: { authenticatorData: authData(0x05) } }))
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get } })
    rememberPasskeyHere(7, ID_A, true)

    await expect(unlockOnThisDevice(7)).resolves.toBe('ok')
    expect(fetchSpy).not.toHaveBeenCalled()
    const { publicKey } = (get.mock.calls[0] as unknown as [{ publicKey: PublicKeyCredentialRequestOptions }])[0]
    expect(publicKey.rpId).toBe('kscw.ch')
    expect(publicKey.userVerification).toBe('required')
    expect(publicKey.timeout).toBe(60000)
    expect((publicKey.challenge as Uint8Array).byteLength).toBe(32)
    // Discoverable, like a sign-in (a request naming the key failed in the Android app's
    // WebView); the answer is matched to this device's keys instead (next test).
    expect(publicKey.allowCredentials).toBeUndefined()

    // Two checks never share a challenge.
    await unlockOnThisDevice(7)
    const second = (get.mock.calls[1] as unknown as [{ publicKey: PublicKeyCredentialRequestOptions }])[0].publicKey
    expect([...new Uint8Array(second.challenge as Uint8Array)]).not.toEqual([...new Uint8Array(publicKey.challenge as Uint8Array)])
  })

  it('cancel is silent; an answer without UV or from another key is refused', async () => {
    stubWebAuthn()
    rememberPasskeyHere(7, ID_A, true)
    const get = vi.fn()
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get } })

    get.mockRejectedValueOnce(domError('NotAllowedError'))
    await expect(unlockOnThisDevice(7)).resolves.toBe('cancel')
    get.mockResolvedValueOnce({ type: 'public-key', id: ID_A, response: { authenticatorData: authData(0x01) } })
    await expect(unlockOnThisDevice(7)).resolves.toBe('refused')
    get.mockResolvedValueOnce({ type: 'public-key', id: ID_B, response: { authenticatorData: authData(0x05) } })
    await expect(unlockOnThisDevice(7)).resolves.toBe('refused')
    expect(captureAuthError).not.toHaveBeenCalled()
  })

  it('without a key on this device there is nothing to ask', async () => {
    stubWebAuthn()
    const get = vi.fn()
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get } })
    rememberPasskeyHere(7, ID_B, false)
    await expect(unlockOnThisDevice(7)).resolves.toBe('refused')
    expect(get).not.toHaveBeenCalled()
  })
})

describe('the server calls', () => {
  /** Answers by path; records each request. The hint cookie says "signed in", so kscwApi WOULD retry a 401. */
  function stubServer(routes: Record<string, () => Response>) {
    document.cookie = 'wiedisync_auth=1; path=/'
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname.replace(/^\/kscw/, '')
      const route = routes[path]
      if (!route) throw new Error(`unexpected ${path}`)
      return route()
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status })
  afterEach(() => { document.cookie = 'wiedisync_auth=; path=/; max-age=0' })

  it('signs in: options → device → login, both WITH cookies (the ceremony cookie binds them)', async () => {
    const fetchMock = stubServer({
      '/passkey/login-options': json(200, { data: { challengeId: 'c1', options: { challenge: 'abc', rpId: 'kscw.ch' } } }),
      '/passkey/login': json(200, { data: { ok: true, expires: 900000 } }),
    })
    startAuthentication.mockResolvedValue({ id: ID_A, rawId: ID_A, type: 'public-key', response: {}, authenticatorAttachment: 'platform' })

    await expect(signInWithPasskey()).resolves.toEqual({ credentialId: ID_A, onDevice: true })
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'abc', rpId: 'kscw.ch' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.credentials).toBe('include')
      expect(init.method).toBe('POST')
    }
    const body = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ challengeId: 'c1', response: { id: ID_A } })
  })

  it('a phone used by QR code is not "on this device"', async () => {
    stubServer({
      '/passkey/login-options': json(200, { data: { challengeId: 'c1', options: { challenge: 'abc' } } }),
      '/passkey/login': json(200, { data: { ok: true } }),
    })
    startAuthentication.mockResolvedValue({ id: ID_B, authenticatorAttachment: 'cross-platform' })
    await expect(signInWithPasskey()).resolves.toEqual({ credentialId: ID_B, onDevice: false })
  })

  it('a refused login goes out ONCE (no refresh-and-resend) and keeps its code; only real faults are reported', async () => {
    const fetchMock = stubServer({
      '/passkey/login-options': json(200, { data: { challengeId: 'c1', options: { challenge: 'abc' } } }),
      '/passkey/login': json(401, { error: 'x', code: 'passkey_unknown' }),
      '/auth/refresh': json(200, { data: {} }),
    })
    startAuthentication.mockResolvedValue({ id: ID_A })
    await expect(signInWithPasskey()).rejects.toMatchObject({ status: 401, code: 'passkey_unknown' })
    expect(fetchMock.mock.calls.map(([u]) => new URL(u as string).pathname)).toEqual(['/kscw/passkey/login-options', '/kscw/passkey/login'])
    expect(captureAuthError).not.toHaveBeenCalled()

    stubServer({
      '/passkey/login-options': json(200, { data: { challengeId: 'c2', options: { challenge: 'abc' } } }),
      '/passkey/login': json(401, { error: 'x', code: 'passkey_origin' }),
    })
    await expect(signInWithPasskey()).rejects.toMatchObject({ code: 'passkey_origin' })
    expect(captureAuthError).toHaveBeenCalledWith(expect.anything(), { action: 'login', method: 'passkey' })
  })

  it('a cancelled device sheet never reaches the login call, and is not reported', async () => {
    const fetchMock = stubServer({
      '/passkey/login-options': json(200, { data: { challengeId: 'c1', options: { challenge: 'abc' } } }),
    })
    startAuthentication.mockRejectedValue(domError('NotAllowedError'))
    await expect(signInWithPasskey()).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(captureAuthError).not.toHaveBeenCalled()
  })

  it('sets one up: the password (and code) once, then the device, then the key', async () => {
    const fetchMock = stubServer({
      '/passkey/register-options': json(200, { data: { challengeId: 'r1', options: { challenge: 'xyz', user: { id: 'u' } } } }),
      '/passkey/register': json(200, { data: { passkey: { id: 'p1', credential_id: ID_A, label: 'iPhone', created_at: '2026-11-02T10:00:00Z', last_used_at: null } } }),
    })
    startRegistration.mockResolvedValue({ id: ID_A, authenticatorAttachment: 'platform' })
    const made = await setUpPasskey({ password: 'S3cret!', otp: '123456' }) // gitleaks:allow — synthetic fixture
    expect(made).toMatchObject({ onDevice: true, passkey: { id: 'p1', credential_id: ID_A } })
    const first = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(first).toEqual({ password: 'S3cret!', otp: '123456' }) // gitleaks:allow — synthetic fixture
  })

  it('a wrong password is sent once — a resend would count twice toward the lockout', async () => {
    const fetchMock = stubServer({
      '/passkey/register-options': json(401, { error: 'x', code: 'bad_password' }),
      '/auth/refresh': json(200, { data: {} }),
    })
    await expect(setUpPasskey({ password: 'wrong' })).rejects.toMatchObject({ code: 'bad_password' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ password: 'wrong' })
    expect(startRegistration).not.toHaveBeenCalled()
    expect(captureAuthError).not.toHaveBeenCalled()
  })
})

describe('shouldOfferPasskey', () => {
  const list = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

  it('offers on a capable device when nothing of this account is known here', async () => {
    stubWebAuthn(true)
    list({ data: { available: true, passkeys: [] } })
    await expect(shouldOfferPasskey(7)).resolves.toBe(true)
  })

  it('never after "Not now" — and does not even ask the server', async () => {
    stubWebAuthn(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    dismissPasskeyOffer(7)
    await expect(shouldOfferPasskey(7)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('not on a device without a fingerprint reader / face / PIN, nor where the server has no passkeys', async () => {
    stubWebAuthn(false)
    list({ data: { available: true, passkeys: [] } })
    await expect(shouldOfferPasskey(7)).resolves.toBe(false)
    stubWebAuthn(true)
    list({ data: { available: false, passkeys: [] } })
    await expect(shouldOfferPasskey(7)).resolves.toBe(false)
    list({ error: 'Not found' }, 404) // backend not deployed yet
    await expect(shouldOfferPasskey(7)).resolves.toBe(false)
  })

  it('not when this device has a key — but again once a password change removed it', async () => {
    stubWebAuthn(true)
    rememberPasskeyHere(7, ID_A, true)
    const row = { id: 'p1', credential_id: ID_A, label: 'x', created_at: '', last_used_at: null }
    list({ data: { available: true, passkeys: [row] } })
    await expect(shouldOfferPasskey(7)).resolves.toBe(false)
    list({ data: { available: true, passkeys: [] } })
    await expect(shouldOfferPasskey(7)).resolves.toBe(true)
    expect(readPasskeyHint(7).on).toBe(false)
  })
})
