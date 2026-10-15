/**
 * Nomal bridge: login token signing, the adults-only rule, roster assembly, and the
 * route guards (config, state, return URL, service token, Cloudflare refusal).
 */
import crypto from 'crypto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  signNomalToken, previousSeasonShort, parseReturnUrls, nomalConfig, serviceTokenOk,
  parseStringList, sportAdminScopes, parseTeamIds, isoDate, hhmm, normalizeSets, adultOn,
  mergeRelations, buildRosterRows, registerNomalBridge,
} from '../nomal-bridge.js'

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const TOKEN = 'service-token-for-tests'
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex')
const RETURN = 'https://nomal-dev.kscw.ch/api/auth/callback'
const STATE = 'abcdefghijklmnopqrstuvwx'

describe('signNomalToken', () => {
  it('produces a compact EdDSA JWS that verifies with the public key', () => {
    const token = signNomalToken({ sub: 'u', mid: 7, aud: 'nomal' }, { privateKeyPem: PRIVATE_PEM, kid: 'k1' })
    const [h, p, s] = token.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url'))).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'k1' })
    expect(JSON.parse(Buffer.from(p, 'base64url'))).toEqual({ sub: 'u', mid: 7, aud: 'nomal' })
    expect(crypto.verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true)
  })
})

describe('helpers', () => {
  it('previous season', () => {
    expect(previousSeasonShort('2026/27')).toBe('2025/26')
    expect(previousSeasonShort('2000/01')).toBe('1999/00')
  })

  it('return URLs: exact, https or localhost only', () => {
    const urls = parseReturnUrls(`${RETURN}, http://localhost:5173/api/auth/callback ,http://evil.example/cb, junk`)
    expect([...urls]).toEqual([RETURN, 'http://localhost:5173/api/auth/callback'])
  })

  it('config defaults the issuer from PUBLIC_URL and unescapes the key', () => {
    const cfg = nomalConfig({ PUBLIC_URL: 'https://directus-dev.kscw.ch', NOMAL_JWT_PRIVATE_KEY: 'a\\nb' })
    expect(cfg.issuer).toBe('wiedisync-dev')
    expect(cfg.privateKeyPem).toBe('a\nb')
    expect(nomalConfig({ PUBLIC_URL: 'https://directus.kscw.ch' }).issuer).toBe('wiedisync-prod')
  })

  it('service token compares against the SHA-256', () => {
    expect(serviceTokenOk(TOKEN, TOKEN_HASH)).toBe(true)
    expect(serviceTokenOk('wrong', TOKEN_HASH)).toBe(false)
    expect(serviceTokenOk(undefined, TOKEN_HASH)).toBe(false)
    expect(serviceTokenOk(TOKEN, 'not-a-hash')).toBe(false)
  })

  it('roles, sport admin scopes, team ids', () => {
    expect(parseStringList('["user","vb_admin"]')).toEqual(['user', 'vb_admin'])
    expect(parseStringList('nope')).toEqual([])
    expect(sportAdminScopes(['vb_admin', 'bb_admin'])).toEqual(['volleyball', 'basketball'])
    expect(parseTeamIds('3, 1,3')).toEqual([3, 1])
    expect(() => parseTeamIds('1,x')).toThrow(/numeric/)
    expect(() => parseTeamIds(Array.from({ length: 21 }, (_, i) => i + 1).join(','))).toThrow(/1–20/)
  })

  it('dates, times and sets', () => {
    expect(isoDate(new Date(2026, 9, 18))).toBe('2026-10-18')
    expect(isoDate('2026-10-18T00:00:00Z')).toBe('2026-10-18')
    expect(isoDate(null)).toBeNull()
    expect(hhmm('14:00:00')).toBe('14:00')
    expect(normalizeSets([{ home: 25, away: 20 }, { home: '23', away: '25' }, { bad: 1 }])).toEqual([[25, 20], [23, 25]])
    expect(normalizeSets('[]')).toBeNull()
  })
})

describe('adultOn', () => {
  it('needs a birthdate and an 18th birthday on or before the date', () => {
    expect(adultOn(null, '2026-10-18')).toEqual({ ok: false, reason: 'no_birthdate' })
    expect(adultOn('2008-10-18', '2026-10-18')).toEqual({ ok: true, reason: null })
    expect(adultOn('2008-10-19', '2026-10-18')).toEqual({ ok: false, reason: 'under_18' })
    expect(adultOn(new Date(1990, 0, 1), '2026-10-18').ok).toBe(true)
    expect(adultOn('2008-02-29', '2026-02-28').ok).toBe(false)
    expect(adultOn('2008-02-29', '2026-03-01').ok).toBe(true)
  })
})

describe('roster', () => {
  const teams = [{ id: 92, season: '2026/27', captain: 5 }, { id: 12, season: '2025/26', captain: null }]
  it('builds relations per team row and ignores other seasons', () => {
    const rows = buildRosterRows(
      teams,
      [
        { team: 92, member: 5, season: '2026/27', guest_level: 0 },
        { team: 92, member: 6, season: '2026/27', guest_level: 1 },
        { team: 92, member: 7, season: '2025/26', guest_level: 0 }, // stray row
        { team: 12, member: 5, season: null, guest_level: 0 },
      ],
      [{ teams_id: 92, members_id: 9 }],
      [{ teams_id: 99, members_id: 8 }], // team not requested
    )
    expect(rows).toEqual([
      { team: 92, member: 5, rel: 'player', guest: false },
      { team: 92, member: 6, rel: 'player', guest: true },
      { team: 12, member: 5, rel: 'player', guest: false },
      { team: 92, member: 9, rel: 'coach' },
      { team: 92, member: 5, rel: 'captain' },
    ])
  })

  it('merges a member\'s relations per team', () => {
    expect(mergeRelations([
      { team: 92, season: '2026/27', rel: 'player' },
      { team: 92, season: '2026/27', rel: 'captain' },
      { team: 12, season: '2025/26', rel: 'player', guest: true },
    ])).toEqual([
      { team: 92, season: '2026/27', rel: ['captain', 'player'], guest: false },
      { team: 12, season: '2025/26', rel: ['player'], guest: true },
    ])
  })
})

// ── Route guards (no database access on these paths) ──────────────────────────
function harness() {
  const routes = new Map()
  const router = { get: (path, handler) => routes.set(path, handler) }
  const noop = () => {}
  const logger = { child: () => ({ info: noop, warn: noop, error: noop }) }
  registerNomalBridge(router, { database: () => { throw new Error('database not expected') }, logger })
  return async (path, { query = {}, headers = {}, accountability = null } = {}) => {
    const res = {
      statusCode: 200, headers: {}, body: undefined, location: undefined,
      set(k, v) { this.headers[k] = v; return this },
      status(c) { this.statusCode = c; return this },
      json(b) { this.body = b; return this },
      redirect(c, url) { this.statusCode = c; this.location = url; return this },
    }
    await routes.get(path)({ query, headers, accountability }, res)
    return res
  }
}

describe('routes', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.PUBLIC_URL = 'https://directus-dev.kscw.ch'
    process.env.NOMAL_JWT_PRIVATE_KEY = PRIVATE_PEM
    process.env.NOMAL_JWT_KID = 'k1'
    process.env.NOMAL_RETURN_URLS = RETURN
    process.env.NOMAL_SYNC_TOKEN_HASH = TOKEN_HASH
    process.env.NOMAL_LOGIN_URL = 'https://wiedisync-dev.kscw.ch/login'
  })
  afterEach(() => { process.env = { ...saved } })

  it('authorize: 503 until configured', async () => {
    delete process.env.NOMAL_JWT_PRIVATE_KEY
    const res = await harness()('/nomal/v1/authorize', { query: { state: STATE, return: RETURN } })
    expect(res.statusCode).toBe(503)
  })

  it('authorize: refuses bad state and foreign return URLs', async () => {
    const call = harness()
    expect((await call('/nomal/v1/authorize', { query: { state: 'short', return: RETURN } })).statusCode).toBe(400)
    const foreign = await call('/nomal/v1/authorize', { query: { state: STATE, return: 'https://evil.example/cb' } })
    expect(foreign.statusCode).toBe(400)
  })

  it('authorize: without a session, logs in first and comes back', async () => {
    const res = await harness()('/nomal/v1/authorize', { query: { state: STATE, return: RETURN } })
    expect(res.statusCode).toBe(302)
    const login = new URL(res.location)
    expect(`${login.origin}${login.pathname}`).toBe('https://wiedisync-dev.kscw.ch/login')
    const next = new URL(login.searchParams.get('next'))
    expect(`${next.origin}${next.pathname}`).toBe('https://directus-dev.kscw.ch/kscw/nomal/v1/authorize')
    expect(next.searchParams.get('return')).toBe(RETURN)
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('service routes: token required, never through Cloudflare', async () => {
    const call = harness()
    expect((await call('/nomal/v1/teams')).statusCode).toBe(401)
    expect((await call('/nomal/v1/teams', { headers: { 'x-nomal-service-token': 'wrong' } })).statusCode).toBe(401)
    const viaCf = await call('/nomal/v1/teams', {
      headers: { 'x-nomal-service-token': TOKEN, 'cf-connecting-ip': '203.0.113.9' },
    })
    expect(viaCf.statusCode).toBe(404)
    delete process.env.NOMAL_SYNC_TOKEN_HASH
    expect((await call('/nomal/v1/sync', { query: { teams: '1' } })).statusCode).toBe(503)
  })

  it('sync: rejects junk team lists before touching the database', async () => {
    const res = await harness()('/nomal/v1/sync', {
      query: { teams: '1;DROP' }, headers: { 'x-nomal-service-token': TOKEN },
    })
    expect(res.statusCode).toBe(400)
  })
})
