/**
 * Passkeys (passkeys-core.js, passkeys.js).
 *
 * The ceremonies run for real: the software authenticator below makes a P-256 key pair,
 * answers the server's options with a "none" attestation and signs assertions the way a
 * phone does, so the library's checks (challenge, origin, RP ID hash, user verification,
 * signature, counter) are the ones prod makes. The routes run against an in-memory table
 * fake and a fake AuthenticationService — what Directus itself does with the seed session is
 * checked on dev against the real container (see the PR).
 */
import { describe, it, expect, vi } from 'vitest'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'
import {
  ANDROID_RELEASE_CERT_SHA256, apkKeyHashOrigin, cleanTransports, createPasskeyCeremonies,
  originAllowed, passkeyConfig, passkeyDeviceLabel,
} from '../passkeys-core.js'
import { jwtExpiryMs, passkeyAddedMail, registerPasskeys, sessionCookieOptions, zurichDateTime } from '../passkeys.js'

const PROD = { PUBLIC_URL: 'https://directus.kscw.ch' }
const DEV = { PUBLIC_URL: 'https://directus-dev.kscw.ch' }
const APP = 'https://wiedisync.kscw.ch'
const b64u = (buf) => Buffer.from(buf).toString('base64url')

/** A phone's passkey store, in software: one key pair, a signature counter. */
function softAuthenticator({ counting = true } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const credId = randomBytes(16)
  let counter = 0
  let userHandle = null
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, isoBase64URL.toBuffer(jwk.x)], [-3, isoBase64URL.toBuffer(jwk.y)]])
  const authData = (rpId, flags, withKey) => {
    const cnt = Buffer.alloc(4)
    cnt.writeUInt32BE(counter)
    const parts = [createHash('sha256').update(rpId).digest(), Buffer.from([flags]), cnt]
    if (withKey) {
      const len = Buffer.alloc(2)
      len.writeUInt16BE(credId.length)
      parts.push(Buffer.alloc(16), len, credId, Buffer.from(isoCBOR.encode(cose)))
    }
    return Buffer.concat(parts)
  }
  return {
    id: b64u(credId),
    set counter(v) { counter = v },
    /** navigator.credentials.create(): flags UP|UV|AT. */
    create(options, origin, rpId = options.rp.id) {
      userHandle = options.user.id
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }))
      const att = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(rpId, 0x45, true)]]))
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key',
        response: { clientDataJSON: b64u(clientData), attestationObject: b64u(att), transports: ['internal', 'x-bogus'] },
        clientExtensionResults: {}, authenticatorAttachment: 'platform',
      }
    },
    /** navigator.credentials.get(): flags UP|UV; a counting key moves its counter on. */
    get(options, origin, { flags = 0x05, rpId = options.rpId, handle } = {}) {
      if (counting) counter++
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }))
      const ad = authData(rpId, flags, false)
      const signature = sign('sha256', Buffer.concat([ad, createHash('sha256').update(clientData).digest()]), privateKey)
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key',
        response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(ad), signature: b64u(signature), userHandle: handle ?? userHandle },
        clientExtensionResults: {}, authenticatorAttachment: 'platform',
      }
    },
  }
}

describe('passkey rules', () => {
  it('prod: RP kscw.ch, and only the three app pages (plus the Android app) may ask', () => {
    const c = passkeyConfig(PROD)
    expect(c.rpId).toBe('kscw.ch')
    for (const o of [APP, 'https://spielplanung.wiedisync.kscw.ch', 'https://accounting.wiedisync.kscw.ch', apkKeyHashOrigin()]) {
      expect(originAllowed(o, c), o).toBe(true)
    }
    // The club website, other club apps, dev, plain http, look-alikes: never.
    for (const o of ['https://kscw.ch', 'https://www.kscw.ch', 'https://wieplay.kscw.ch', 'https://wiedisync-dev.kscw.ch',
      'http://wiedisync.kscw.ch', 'https://wiedisync.kscw.ch.evil.example', 'https://wiedisync.kscw.ch/', 'https://evil-wiedisync.kscw.ch',
      'https://localhost', 'capacitor://localhost', '', undefined]) {
      expect(originAllowed(o, c), String(o)).toBe(false)
    }
  })

  it('dev: its own RP, its own page; a prod page cannot ask dev', () => {
    const c = passkeyConfig(DEV)
    expect(c.rpId).toBe('wiedisync-dev.kscw.ch')
    expect(originAllowed('https://wiedisync-dev.kscw.ch', c)).toBe(true)
    expect(originAllowed(APP, c)).toBe(false)
    expect(originAllowed('https://spielplanung-dev.kscw.ch', c)).toBe(false)
  })

  it('anywhere else passkeys are off, unless a local test names RP and origins', () => {
    expect(passkeyConfig({ PUBLIC_URL: 'http://localhost:8055' })).toBeNull()
    expect(passkeyConfig({})).toBeNull()
    expect(passkeyConfig({ WEBAUTHN_RP_ID: 'localhost' })).toBeNull()
    const local = passkeyConfig({ WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_ORIGINS: 'http://localhost:5173' })
    expect(local.rpId).toBe('localhost')
    expect(originAllowed('http://localhost:5173', local)).toBe(true)
    expect(originAllowed(apkKeyHashOrigin(), local)).toBe(false)
  })

  it('the Android origin is the release certificate from the README, base64url', () => {
    const origin = apkKeyHashOrigin()
    expect(origin.startsWith('android:apk-key-hash:')).toBe(true)
    const bytes = Buffer.from(origin.slice('android:apk-key-hash:'.length), 'base64url')
    expect(bytes.toString('hex').toUpperCase()).toBe(ANDROID_RELEASE_CERT_SHA256.replace(/:/g, ''))
  })

  it('the device label names the device and the browser, and the app', () => {
    expect(passkeyDeviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari')
    expect(passkeyDeviceLabel('Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 WiedisyncApp/android/1.2.0')).toBe('Android · App')
    expect(passkeyDeviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Windows · Edge')
    expect(passkeyDeviceLabel('')).toBe('Device')
  })

  it('transports are cut to WebAuthn\'s list', () => {
    expect(cleanTransports(['internal', 'hybrid', 'x'.repeat(5000), 'internal', 7])).toEqual(['internal', 'hybrid'])
    expect(cleanTransports('usb')).toEqual([])
  })
})

describe('ceremonies with a software authenticator', () => {
  const config = passkeyConfig(PROD)
  const setUp = async (c, device, userId = 'user-1') => {
    const reg = await c.registrationOptions({ userId, email: 'anna@example.ch', displayName: 'Anna Muster', existing: [] })
    const added = await c.finishRegistration({ challengeId: reg.challengeId, userId, response: device.create(reg.options, APP) })
    return { id: 'row-1', userId, ...added }
  }

  it('sets up a key and signs in with it, as the account it belongs to', async () => {
    const c = createPasskeyCeremonies(config)
    const device = softAuthenticator()
    const reg = await c.registrationOptions({ userId: 'user-1', email: 'anna@example.ch', displayName: 'Anna Muster', existing: [] })
    expect(reg.options.rp.id).toBe('kscw.ch')
    expect(reg.options.authenticatorSelection.userVerification).toBe('required')
    expect(reg.options.authenticatorSelection.residentKey).toBe('required')
    expect(reg.options.user.displayName).toBe('Anna Muster')
    const added = await c.finishRegistration({ challengeId: reg.challengeId, userId: 'user-1', response: device.create(reg.options, APP) })
    expect(added.credentialId).toBe(device.id)
    expect(added.transports).toEqual(['internal'])
    const stored = { id: 'row-1', userId: 'user-1', ...added }

    const auth = await c.authenticationOptions()
    expect(auth.options.rpId).toBe('kscw.ch')
    expect(auth.options.allowCredentials ?? []).toEqual([])
    const { passkey, newCounter } = await c.finishAuthentication({
      challengeId: auth.challengeId, response: device.get(auth.options, 'https://spielplanung.wiedisync.kscw.ch'), lookup: async (id) => (id === stored.credentialId ? stored : null),
    })
    expect(passkey.userId).toBe('user-1')
    expect(newCounter).toBe(1)
  })

  it('a challenge works once, and only for what it was issued for', async () => {
    const c = createPasskeyCeremonies(config)
    const device = softAuthenticator()
    const stored = await setUp(c, device)
    const auth = await c.authenticationOptions()
    const answer = device.get(auth.options, APP)
    const lookup = async () => stored
    await c.finishAuthentication({ challengeId: auth.challengeId, response: answer, lookup })
    await expect(c.finishAuthentication({ challengeId: auth.challengeId, response: answer, lookup })).rejects.toMatchObject({ code: 'challenge' })
    const reg = await c.registrationOptions({ userId: 'user-1', email: 'a@x.ch', existing: [] })
    await expect(c.finishAuthentication({ challengeId: reg.challengeId, response: answer, lookup })).rejects.toMatchObject({ code: 'challenge' })
    // A set-up challenge belongs to the account it was issued to.
    const reg2 = await c.registrationOptions({ userId: 'user-1', email: 'a@x.ch', existing: [] })
    await expect(c.finishRegistration({ challengeId: reg2.challengeId, userId: 'user-2', response: softAuthenticator().create(reg2.options, APP) }))
      .rejects.toMatchObject({ code: 'mismatch' })
  })

  it('refuses a page that is not on the list, even on kscw.ch', async () => {
    const c = createPasskeyCeremonies(config)
    const device = softAuthenticator()
    const stored = await setUp(c, device)
    for (const origin of ['https://kscw.ch', 'https://wieplay.kscw.ch', 'https://wiedisync-dev.kscw.ch']) {
      const auth = await c.authenticationOptions()
      await expect(c.finishAuthentication({ challengeId: auth.challengeId, response: device.get(auth.options, origin), lookup: async () => stored }))
        .rejects.toMatchObject({ code: 'origin' })
    }
  })

  it('refuses a key made for another site, without user verification, or under another account', async () => {
    const c = createPasskeyCeremonies(config)
    const device = softAuthenticator()
    const stored = await setUp(c, device)
    const lookup = async () => stored
    let auth = await c.authenticationOptions()
    await expect(c.finishAuthentication({ challengeId: auth.challengeId, response: device.get(auth.options, APP, { rpId: 'wiedisync-dev.kscw.ch' }), lookup }))
      .rejects.toMatchObject({ code: 'invalid' })
    auth = await c.authenticationOptions()
    await expect(c.finishAuthentication({ challengeId: auth.challengeId, response: device.get(auth.options, APP, { flags: 0x01 }), lookup }))
      .rejects.toMatchObject({ code: 'invalid' })
    auth = await c.authenticationOptions()
    await expect(c.finishAuthentication({ challengeId: auth.challengeId, response: device.get(auth.options, APP, { handle: b64u(Buffer.from('user-2')) }), lookup }))
      .rejects.toMatchObject({ code: 'invalid' })
    auth = await c.authenticationOptions()
    await expect(c.finishAuthentication({ challengeId: auth.challengeId, response: device.get(auth.options, APP), lookup: async () => null }))
      .rejects.toMatchObject({ code: 'unknown' })
  })

  it('a key whose counter goes backwards is a copy: refused', async () => {
    const c = createPasskeyCeremonies(config)
    const device = softAuthenticator()
    const stored = { ...(await setUp(c, device)), counter: 5 }
    device.counter = 2
    const auth = await c.authenticationOptions()
    await expect(c.finishAuthentication({ challengeId: auth.challengeId, response: device.get(auth.options, APP), lookup: async () => stored }))
      .rejects.toMatchObject({ code: 'invalid' })
  })
})

// ── Routes, against an in-memory table fake ──────────────────────────────────

/** Just enough of knex for passkeys.js + writeUserLog: where/andWhere/orWhere/whereIn,
 *  first/select/orderBy, insert/update/delete with returning, count, transaction, raw. */
function fakeDb(tables) {
  const t = (name) => (tables[name] ||= [])
  const matcher = (preds) => (row) => preds.every((p) => p(row))
  const pred = (a, b, c) => {
    if (typeof a === 'function') {
      const sub = []
      let mode = 'and'
      const groups = [[]]
      const q = {
        where(...args) { groups[groups.length - 1].push(pred(...args)); return q },
        orWhere(...args) { groups.push([pred(...args)]); mode = 'or'; return q },
      }
      a(q)
      void sub; void mode
      return (row) => groups.some((g) => g.every((p) => p(row)))
    }
    if (typeof a === 'object') return (row) => Object.entries(a).every(([k, v]) => row[k] === v)
    if (c === undefined) return (row) => row[a] === b
    if (b === '<') return (row) => row[a] < c
    throw new Error(`fake: op ${b}`)
  }
  const db = (name) => {
    const preds = []
    const rows = () => t(name).filter(matcher(preds))
    const pick = (r, cols) => (cols.length ? Object.fromEntries(cols.flat().map((k) => [k, r[k]])) : { ...r })
    const q = {
      where(...args) { preds.push(pred(...args)); return q },
      andWhere(...args) { preds.push(pred(...args)); return q },
      whereIn(col, vals) { preds.push((row) => vals.includes(row[col])); return q },
      orderBy() { return q },
      async first(...cols) { const r = rows()[0]; return r ? pick(r, cols) : undefined },
      async select(...cols) { return rows().map((r) => pick(r, cols)) },
      then(res, rej) { return Promise.resolve(rows()).then(res, rej) },
      async insert(row, returning) {
        const list = Array.isArray(row) ? row : [row]
        const made = list.map((r) => ({ id: r.id ?? `id-${Math.random().toString(16).slice(2)}`, created_at: new Date(), last_used_at: null, ...r }))
        if (name === 'passkeys' && made.some((m) => t(name).some((x) => x.credential_id === m.credential_id))) {
          throw Object.assign(new Error('duplicate'), { code: '23505' })
        }
        t(name).push(...made)
        return returning ? made.map((m) => pick(m, [returning])) : [made.length]
      },
      async update(patch) { const r = rows(); r.forEach((x) => Object.assign(x, patch)); return r.length },
      async delete(returning) {
        const r = rows()
        tables[name] = t(name).filter((x) => !r.includes(x))
        return returning ? r.map((x) => pick(x, [returning])) : r.length
      },
      async count() { return [{ n: rows().length }] },
    }
    return q
  }
  db.transaction = async (fn) => fn(db)
  db.raw = async () => ({ rows: [] })
  return db
}

function makeRes() {
  const o = { statusCode: 200, cookies: [] }
  o.status = (c) => { o.statusCode = c; return o }
  o.json = (b) => { o.body = b; return o }
  o.cookie = (name, value, opts) => { o.cookies.push({ name, value, opts }); return o }
  return o
}

const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'

/** A JWT-shaped token whose exp is 7 days out (the cookie's maxAge comes from it). */
const fakeJwt = (exp = Math.floor(Date.now() / 1000) + 7 * 86400) =>
  `h.${Buffer.from(JSON.stringify({ id: 'user-1', exp })).toString('base64url')}.s`

function setup({ env = { ...PROD, SESSION_COOKIE_NAME: 'kscw_session', SESSION_COOKIE_SECURE: true, SESSION_COOKIE_SAME_SITE: 'lax' }, password = 'Volley1ball', otpNeeded = false, status = 'active' } = {}) {
  const tables = {
    directus_users: [{ id: 'user-1', email: 'anna@example.ch', status, provider: 'default' }],
    members: [{ id: 42, user: 'user-1', first_name: 'Anna', last_name: 'Muster', language: 'english' }],
    directus_sessions: [],
    passkeys: [],
    user_logs: [],
  }
  const database = fakeDb(tables)
  const calls = { refresh: [], login: [], mails: [], activity: [], emitted: [] }
  class AuthenticationService {
    async login(provider, payload, options) {
      calls.login.push({ provider, payload, options })
      if (payload.password !== password) throw Object.assign(new Error('bad'), { code: 'INVALID_CREDENTIALS' })
      if (otpNeeded && options?.otp !== '123456') throw Object.assign(new Error('otp'), { code: 'INVALID_OTP' })
      const token = `check-${calls.login.length}`
      tables.directus_sessions.push({ token, user: 'user-1' })
      return { refreshToken: token }
    }
    async refresh(token, options) {
      calls.refresh.push({ token, options })
      const row = tables.directus_sessions.find((s) => s.token === token)
      if (!row) throw Object.assign(new Error('no'), { code: 'INVALID_CREDENTIALS' })
      if (status === 'suspended') throw Object.assign(new Error('suspended'), { code: 'USER_SUSPENDED' })
      return { accessToken: fakeJwt(), refreshToken: 'next', expires: 604800000 }
    }
  }
  class MailService { async send(m) { calls.mails.push(m) } }
  class ActivityService { async createOne(a) { calls.activity.push(a) } }
  const routes = {}
  const router = new Proxy({}, { get: (_, m) => (p, h) => { routes[`${String(m).toUpperCase()} ${p}`] = h } })
  const emitter = { emitAction: (event, meta) => calls.emitted.push({ event, meta }) }
  registerPasskeys(router, { database, services: { AuthenticationService, MailService, ActivityService }, getSchema: async () => ({}), logger, emitter, env })
  const call = async (route, { body = {}, user = null, acting = false, params = {}, origin = APP } = {}) => {
    const res = makeRes()
    const req = {
      body, params,
      accountability: { user, ip: '203.0.113.7', userAgent: UA, origin, ...(acting ? { kscwGuardian: { user: 'u-main', memberId: 50 } } : {}) },
      headers: { 'user-agent': UA }, get: (h) => (h.toLowerCase() === 'user-agent' ? UA : origin), socket: { remoteAddress: '203.0.113.7' },
    }
    await routes[route](req, res)
    return res
  }
  return { tables, calls, call, routes }
}

async function setUpViaRoutes(s, device, origin = APP) {
  const opts = await s.call('POST /passkey/register-options', { user: 'user-1', body: { password: 'Volley1ball' } })
  expect(opts.statusCode).toBe(200)
  const reg = await s.call('POST /passkey/register', {
    user: 'user-1', body: { challengeId: opts.body.data.challengeId, response: device.create(opts.body.data.options, origin) },
  })
  return reg
}

describe('POST /passkey/register-options + /register', () => {
  it('needs the password, checks it with Directus\'s login, and keeps no session from the check', async () => {
    const s = setup()
    expect((await s.call('POST /passkey/register-options', { user: 'user-1', body: {} })).body.code).toBe('password_required')
    const wrong = await s.call('POST /passkey/register-options', { user: 'user-1', body: { password: 'nope' } })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.body.code).toBe('bad_password')
    const ok = await s.call('POST /passkey/register-options', { user: 'user-1', body: { password: 'Volley1ball' } })
    expect(ok.statusCode).toBe(200)
    expect(s.calls.login.at(-1)).toMatchObject({ provider: 'default', payload: { email: 'anna@example.ch' } })
    expect(s.tables.directus_sessions).toEqual([])
  })

  it('an account with an authenticator app also needs its code', async () => {
    const s = setup({ otpNeeded: true })
    expect((await s.call('POST /passkey/register-options', { user: 'user-1', body: { password: 'Volley1ball' } })).body.code).toBe('otp_required')
    expect((await s.call('POST /passkey/register-options', { user: 'user-1', body: { password: 'Volley1ball', otp: '000000' } })).body.code).toBe('otp_invalid')
    expect((await s.call('POST /passkey/register-options', { user: 'user-1', body: { password: 'Volley1ball', otp: '123456' } })).statusCode).toBe(200)
  })

  it('files the key, logs it, and mails the member in their language', async () => {
    const s = setup()
    const device = softAuthenticator()
    const reg = await setUpViaRoutes(s, device)
    expect(reg.statusCode).toBe(200)
    expect(reg.body.data.passkey).toMatchObject({ credential_id: device.id, label: 'iPhone · Safari' })
    expect(s.tables.passkeys).toHaveLength(1)
    expect(s.tables.passkeys[0]).toMatchObject({ user: 'user-1', counter: 0, transports: ['internal'] })
    expect(s.tables.user_logs.at(-1)).toMatchObject({ action: 'create', collection_name: 'passkeys', user: 42 })
    await vi.waitFor(() => expect(s.calls.mails).toHaveLength(1))
    expect(s.calls.mails[0]).toMatchObject({ to: 'anna@example.ch', subject: 'WiediSync – A passkey was added' })
    expect(s.calls.mails[0].html).toContain('iPhone · Safari')
  })

  it('refuses while acting for a household member, before reading anything', async () => {
    const s = setup()
    const res = await s.call('POST /passkey/register-options', { user: 'shadow-1', acting: true, body: { password: 'Volley1ball' } })
    expect(res.statusCode).toBe(403)
    expect(res.body.code).toBe('acting_forbidden')
    expect(s.calls.login).toHaveLength(0)
    for (const route of ['POST /passkey/register', 'GET /passkey/list', 'DELETE /passkey/:id']) {
      expect((await s.call(route, { user: 'shadow-1', acting: true, params: { id: 'x' } })).statusCode).toBe(403)
    }
  })

  it('signed out: no setting up, no list', async () => {
    const s = setup()
    expect((await s.call('POST /passkey/register-options', { body: { password: 'Volley1ball' } })).statusCode).toBe(401)
    expect((await s.call('GET /passkey/list')).statusCode).toBe(401)
  })
})

describe('POST /passkey/login', () => {
  async function signIn(s, device, origin = APP) {
    const opts = await s.call('POST /passkey/login-options', { origin })
    expect(opts.statusCode).toBe(200)
    return s.call('POST /passkey/login', { origin, body: { challengeId: opts.body.data.challengeId, response: device.get(opts.body.data.options, origin) } })
  }

  it('turns a verified key into a Directus session: seed row → refresh(session) → the cookie', async () => {
    const s = setup()
    const device = softAuthenticator()
    await setUpViaRoutes(s, device)
    const res = await signIn(s, device)
    expect(res.statusCode).toBe(200)
    expect(res.body.data.ok).toBe(true)
    // refresh() got the seed, in session mode.
    expect(s.calls.refresh).toHaveLength(1)
    expect(s.calls.refresh[0].options).toEqual({ session: true })
    const seed = s.tables.directus_sessions.find((r) => r.token === s.calls.refresh[0].token)
    expect(seed).toMatchObject({ user: 'user-1', ip: '203.0.113.7', user_agent: UA, origin: APP })
    expect(seed.expires.getTime() - Date.now()).toBeLessThanOrEqual(60 * 1000)
    expect(seed.token).toHaveLength(64)
    // The cookie, as controllers/auth.js sets it.
    expect(res.cookies).toHaveLength(1)
    expect(res.cookies[0].name).toBe('kscw_session')
    expect(res.cookies[0].opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' })
    expect(res.cookies[0].opts.maxAge).toBeGreaterThan(6 * 86400 * 1000)
    // What login() would have done besides.
    expect(s.calls.emitted).toEqual([expect.objectContaining({ event: 'auth.login', meta: expect.objectContaining({ status: 'success', user: 'user-1', provider: 'passkey' }) })])
    expect(s.calls.activity[0]).toMatchObject({ action: 'login', user: 'user-1', collection: 'directus_users' })
    expect(s.tables.user_logs.at(-1)).toMatchObject({ action: 'login', collection_name: 'passkeys' })
    expect(s.tables.passkeys[0].counter).toBe(1)
    expect(s.tables.passkeys[0].last_used_at).toBeInstanceOf(Date)
  })

  it('a suspended account gets no session', async () => {
    const s = setup()
    const device = softAuthenticator()
    await setUpViaRoutes(s, device)
    s.tables.directus_users[0].status = 'suspended'
    const s2 = setup({ status: 'suspended' })
    s2.tables.passkeys.push(...s.tables.passkeys)
    const res = await signIn(s2, device)
    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe('user_suspended')
    expect(res.cookies).toHaveLength(0)
    expect(s2.tables.directus_sessions).toEqual([])
  })

  it('a removed key, a wrong page or a replayed answer gets nothing', async () => {
    const s = setup()
    const device = softAuthenticator()
    await setUpViaRoutes(s, device)
    const opts = await s.call('POST /passkey/login-options')
    const answer = device.get(opts.body.data.options, APP)
    expect((await s.call('POST /passkey/login', { body: { challengeId: opts.body.data.challengeId, response: answer } })).statusCode).toBe(200)
    const replay = await s.call('POST /passkey/login', { body: { challengeId: opts.body.data.challengeId, response: answer } })
    expect(replay.body.code).toBe('passkey_challenge')
    const evil = await signIn(s, device, 'https://kscw.ch')
    expect(evil.body.code).toBe('passkey_origin')
    s.tables.passkeys.length = 0
    const gone = await signIn(s, device)
    expect(gone.statusCode).toBe(401)
    expect(gone.body.code).toBe('passkey_unknown')
    expect(s.calls.refresh).toHaveLength(1)
  })

  it('a key that does not count (synced passkeys report 0) still signs in', async () => {
    const s = setup()
    const device = softAuthenticator({ counting: false })
    await setUpViaRoutes(s, device)
    expect((await signIn(s, device)).statusCode).toBe(200)
    expect((await signIn(s, device)).statusCode).toBe(200)
    expect(s.tables.passkeys[0].counter).toBe(0)
  })

  it('off where no RP is configured: 503, not a guess', async () => {
    const s = setup({ env: { PUBLIC_URL: 'http://localhost:8055' } })
    expect((await s.call('POST /passkey/login-options')).statusCode).toBe(503)
    expect((await s.call('POST /passkey/login', { body: {} })).statusCode).toBe(503)
  })
})

describe('GET /passkey/list + DELETE /passkey/:id', () => {
  it('lists only the account\'s own keys and removes one, logged', async () => {
    const s = setup()
    await setUpViaRoutes(s, softAuthenticator())
    s.tables.passkeys.push({ id: '00000000-0000-4000-8000-000000000002', user: 'user-2', credential_id: 'other', label: 'Mac · Safari' })
    const list = await s.call('GET /passkey/list', { user: 'user-1' })
    expect(list.body.data.available).toBe(true)
    expect(list.body.data.passkeys).toHaveLength(1)
    expect(list.body.data.passkeys[0]).not.toHaveProperty('public_key')
    // Someone else's key: 404, untouched.
    expect((await s.call('DELETE /passkey/:id', { user: 'user-1', params: { id: '00000000-0000-4000-8000-000000000002' } })).statusCode).toBe(404)
    expect((await s.call('DELETE /passkey/:id', { user: 'user-1', params: { id: 'not-a-uuid' } })).statusCode).toBe(400)
    const mine = s.tables.passkeys.find((p) => p.user === 'user-1')
    mine.id = '00000000-0000-4000-8000-000000000001'
    const del = await s.call('DELETE /passkey/:id', { user: 'user-1', params: { id: mine.id } })
    expect(del.statusCode).toBe(200)
    expect(s.tables.passkeys.map((p) => p.user)).toEqual(['user-2'])
    expect(s.tables.user_logs.at(-1)).toMatchObject({ action: 'delete', collection_name: 'passkeys' })
  })
})

describe('session cookie + mail helpers', () => {
  it('cookie options follow Directus\'s SESSION_COOKIE_OPTIONS, maxAge from the token', () => {
    const now = Date.now()
    const token = fakeJwt(Math.floor(now / 1000) + 3600)
    expect(jwtExpiryMs(token)).toBe((Math.floor(now / 1000) + 3600) * 1000)
    expect(jwtExpiryMs('garbage')).toBeNull()
    const o = sessionCookieOptions({ SESSION_COOKIE_SECURE: true }, token, now)
    expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', domain: undefined })
    expect(o.maxAge).toBeGreaterThan(3500 * 1000)
  })

  it('the mail comes in five languages, Swiss date and time, escaped', () => {
    const at = new Date('2026-11-02T17:05:00Z')
    expect(zurichDateTime(at)).toBe('02.11.2026 18:05')
    for (const [lang, subject] of [['german', 'WiediSync – Neuer Passkey'], ['swiss_german', 'WiediSync – Neue Passkey'], ['english', 'WiediSync – A passkey was added'],
      ['french', "WiediSync – Nouvelle clé d'accès"], ['italian', 'WiediSync – Nuova passkey'], [null, 'WiediSync – Neuer Passkey']]) {
      expect(passkeyAddedMail({ language: lang, firstName: 'Anna', label: 'iPhone · Safari', at }).subject).toBe(subject)
    }
    const html = passkeyAddedMail({ language: 'english', firstName: '<b>x</b>', label: '<script>', at }).html
    expect(html).not.toContain('<script>')
    expect(html).toContain('02.11.2026 18:05')
  })
})
