/**
 * WiePlay bridge: login token signing, the adults-only rule, roster assembly, and the
 * route guards (config, state, return URL, service token, Cloudflare refusal) — under the
 * new /kscw/wieplay/v1 routes and the old /kscw/nomal/v1 aliases (WiePlay was Nomal until
 * 17.10.2026; the aliases go after WiePlay's cutover).
 */
import crypto from 'crypto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  signWieplayToken, previousSeasonShort, parseReturnUrls, wieplayConfig, wieplayEnv,
  serviceTokenFrom, serviceTokenOk, parseStringList, sportAdminScopes, parseTeamIds, isoDate,
  hhmm, normalizeSets, adultOn, mergeRelations, buildRosterRows, registerWieplayBridge,
  BRIDGE_ROUTES,
} from '../wieplay-bridge.js'

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const TOKEN = 'service-token-for-tests'
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex')
const RETURN = 'https://wieplay-dev.kscw.ch/api/auth/callback'
const STATE = 'abcdefghijklmnopqrstuvwx'
const PREFIXES = ['wieplay', 'nomal']
const ENV_KEYS = ['JWT_PRIVATE_KEY', 'JWT_KID', 'RETURN_URLS', 'SYNC_TOKEN_HASH', 'JWT_ISSUER', 'LOGIN_URL']

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url'))

describe('signWieplayToken', () => {
  it('produces a compact EdDSA JWS that verifies with the public key', () => {
    const token = signWieplayToken({ sub: 'u', mid: 7, aud: 'wieplay' }, { privateKeyPem: PRIVATE_PEM, kid: 'k1' })
    const [h, p, s] = token.split('.')
    expect(decode(h)).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'k1' })
    expect(decode(p)).toEqual({ sub: 'u', mid: 7, aud: 'wieplay' })
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
    const cfg = wieplayConfig({ PUBLIC_URL: 'https://directus-dev.kscw.ch', WIEPLAY_JWT_PRIVATE_KEY: 'a\\nb' })
    expect(cfg.issuer).toBe('wiedisync-dev')
    expect(cfg.privateKeyPem).toBe('a\nb')
    expect(wieplayConfig({ PUBLIC_URL: 'https://directus.kscw.ch' }).issuer).toBe('wiedisync-prod')
  })

  it('config reads WIEPLAY_* and falls back to NOMAL_* per key when unset or empty', () => {
    const nomal = Object.fromEntries(ENV_KEYS.map((k) => [`NOMAL_${k}`, `old-${k}`]))
    const wieplay = Object.fromEntries(ENV_KEYS.map((k) => [`WIEPLAY_${k}`, `new-${k}`]))
    for (const k of ENV_KEYS) {
      expect(wieplayEnv(nomal, k)).toBe(`old-${k}`)
      expect(wieplayEnv({ ...nomal, ...wieplay }, k)).toBe(`new-${k}`)
      expect(wieplayEnv({ ...nomal, [`WIEPLAY_${k}`]: '  ' }, k)).toBe(`old-${k}`)
      expect(wieplayEnv({}, k)).toBe('')
    }
    const hashA = 'A'.repeat(64)
    const cfgOld = wieplayConfig({
      NOMAL_JWT_PRIVATE_KEY: 'old\\nkey', NOMAL_JWT_KID: 'nomal-dev-1', NOMAL_RETURN_URLS: RETURN,
      NOMAL_SYNC_TOKEN_HASH: hashA, NOMAL_JWT_ISSUER: 'iss-old', NOMAL_LOGIN_URL: 'https://old.example/login',
    })
    expect(cfgOld).toMatchObject({
      privateKeyPem: 'old\nkey', kid: 'nomal-dev-1', syncTokenHash: 'a'.repeat(64),
      issuer: 'iss-old', loginUrl: 'https://old.example/login',
    })
    expect([...cfgOld.returnUrls]).toEqual([RETURN])
    const cfgNew = wieplayConfig({
      NOMAL_JWT_KID: 'nomal-dev-1', WIEPLAY_JWT_KID: 'wieplay-dev-1',
      NOMAL_RETURN_URLS: 'https://old.example/cb', WIEPLAY_RETURN_URLS: RETURN,
    })
    expect(cfgNew.kid).toBe('wieplay-dev-1')
    expect([...cfgNew.returnUrls]).toEqual([RETURN])
  })

  it('service token compares against the SHA-256', () => {
    expect(serviceTokenOk(TOKEN, TOKEN_HASH)).toBe(true)
    expect(serviceTokenOk('wrong', TOKEN_HASH)).toBe(false)
    expect(serviceTokenOk(undefined, TOKEN_HASH)).toBe(false)
    expect(serviceTokenOk(TOKEN, 'not-a-hash')).toBe(false)
  })

  it('service token comes from the new header first, else the old one', () => {
    expect(serviceTokenFrom({ 'x-wieplay-service-token': 'new' })).toBe('new')
    expect(serviceTokenFrom({ 'x-nomal-service-token': 'old' })).toBe('old')
    expect(serviceTokenFrom({ 'x-wieplay-service-token': 'new', 'x-nomal-service-token': 'old' })).toBe('new')
    expect(serviceTokenFrom({})).toBeUndefined()
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

// ── Routes ──────────────────────────────────────────────────────────────────────

/**
 * Minimal knex stand-in: every query on a table resolves to that table's rows (`first()` to
 * the first one); inserts are recorded. Enough for the authorize and service paths.
 */
function fakeDatabase(tables, inserts) {
  return (table) => {
    const rows = tables[table] ?? []
    const q = {
      where: () => q, whereIn: () => q, leftJoin: () => q, orderBy: () => q, select: () => q,
      first: async () => rows[0],
      insert: async (row) => { inserts.push({ table, row }); return [1] },
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    }
    return q
  }
}

const NO_DATABASE = () => { throw new Error('database not expected') }

function harness(database = NO_DATABASE) {
  const routes = new Map()
  const router = { get: (path, handler) => routes.set(path, handler) }
  const noop = () => {}
  const logger = { child: () => ({ info: noop, warn: noop, error: noop }) }
  registerWieplayBridge(router, { database, logger })
  const call = async (path, { query = {}, headers = {}, accountability = null } = {}) => {
    const res = {
      statusCode: 200, headers: {}, body: undefined, location: undefined,
      set(k, v) { this.headers[k] = v; return this },
      status(c) { this.statusCode = c; return this },
      json(b) { this.body = b; return this },
      redirect(c, url) { this.statusCode = c; this.location = url; return this },
    }
    const handler = routes.get(path)
    if (!handler) throw new Error(`no route ${path}`)
    await handler({ query, headers, accountability }, res)
    return res
  }
  call.paths = [...routes.keys()]
  return call
}

function setEnv(family) {
  process.env.PUBLIC_URL = 'https://directus-dev.kscw.ch'
  process.env[`${family}_JWT_PRIVATE_KEY`] = PRIVATE_PEM
  process.env[`${family}_JWT_KID`] = 'k1'
  process.env[`${family}_RETURN_URLS`] = RETURN
  process.env[`${family}_SYNC_TOKEN_HASH`] = TOKEN_HASH
  process.env[`${family}_LOGIN_URL`] = 'https://wiedisync-dev.kscw.ch/login'
}

describe('routes', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('WIEPLAY_') || k.startsWith('NOMAL_')) delete process.env[k]
    }
    setEnv('WIEPLAY')
  })
  afterEach(() => { process.env = { ...saved } })

  it('registers every route under both names', () => {
    expect(BRIDGE_ROUTES.map((r) => [r.prefix, r.aud])).toEqual([['wieplay', 'wieplay'], ['nomal', 'nomal']])
    expect(harness().paths.sort()).toEqual(PREFIXES.flatMap((p) =>
      ['authorize', 'teams', 'sync', 'adult-check'].map((r) => `/${p}/v1/${r}`)).sort())
  })

  for (const prefix of PREFIXES) {
    describe(`/${prefix}/v1`, () => {
      it('authorize: 503 wieplay_not_configured until configured', async () => {
        delete process.env.WIEPLAY_JWT_PRIVATE_KEY
        const res = await harness()(`/${prefix}/v1/authorize`, { query: { state: STATE, return: RETURN } })
        expect(res.statusCode).toBe(503)
        expect(res.body.code).toBe('wieplay_not_configured')
      })

      it('authorize: refuses bad state and foreign return URLs', async () => {
        const call = harness()
        expect((await call(`/${prefix}/v1/authorize`, { query: { state: 'short', return: RETURN } })).statusCode).toBe(400)
        const foreign = await call(`/${prefix}/v1/authorize`, { query: { state: STATE, return: 'https://evil.example/cb' } })
        expect(foreign.statusCode).toBe(400)
      })

      it('authorize: without a session, logs in first and comes back to the same route', async () => {
        const res = await harness()(`/${prefix}/v1/authorize`, { query: { state: STATE, return: RETURN } })
        expect(res.statusCode).toBe(302)
        const login = new URL(res.location)
        expect(`${login.origin}${login.pathname}`).toBe('https://wiedisync-dev.kscw.ch/login')
        const next = new URL(login.searchParams.get('next'))
        expect(`${next.origin}${next.pathname}`).toBe(`https://directus-dev.kscw.ch/kscw/${prefix}/v1/authorize`)
        expect(next.searchParams.get('return')).toBe(RETURN)
        expect(next.searchParams.get('state')).toBe(STATE)
        expect(res.headers['Cache-Control']).toBe('no-store')
      })

      it(`authorize: with a session, signs a token for aud "${prefix}" and logs wieplay_login`, async () => {
        const inserts = []
        const database = fakeDatabase({
          members: [{ id: 5, uuid: 'uuid-5', first_name: 'Ada', last_name: 'Muster', role: '["user","vb_admin"]' }],
          teams: [{ id: 92, season: '2026/27', captain: 5 }],
          member_teams: [{ team: 92, member: 5, season: '2026/27', guest_level: 0 }],
          teams_coaches: [],
          teams_responsibles: [],
        }, inserts)
        const res = await harness(database)(`/${prefix}/v1/authorize`, {
          query: { state: STATE, return: RETURN }, accountability: { user: 'user-uuid' },
        })
        expect(res.statusCode).toBe(302)
        const back = new URL(res.location)
        expect(`${back.origin}${back.pathname}`).toBe(RETURN)
        expect(back.searchParams.get('state')).toBe(STATE)
        const [h, p, s] = back.searchParams.get('token').split('.')
        expect(crypto.verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true)
        expect(decode(h).kid).toBe('k1')
        const claims = decode(p)
        expect(claims).toMatchObject({
          aud: prefix, iss: 'wiedisync-dev', sub: 'uuid-5', mid: 5, name: 'Ada Muster', state: STATE,
          roles: ['user', 'vb_admin'], sport_admin: ['volleyball'],
          teams: [{ team: 92, season: '2026/27', rel: ['captain', 'player'], guest: false }],
        })
        expect(claims.exp - claims.iat).toBe(60)
        await new Promise((r) => setTimeout(r, 0)) // the user log is fire-and-forget
        const logRow = inserts.find((i) => i.table === 'user_logs')?.row
        expect(logRow?.action).toBe('wieplay_login')
        expect(JSON.parse(logRow.data)).toMatchObject({ to: 'wieplay-dev.kscw.ch', route: prefix })
      })

      it('service routes: token required, never through Cloudflare', async () => {
        const call = harness()
        expect((await call(`/${prefix}/v1/teams`)).statusCode).toBe(401)
        for (const header of ['x-wieplay-service-token', 'x-nomal-service-token']) {
          expect((await call(`/${prefix}/v1/teams`, { headers: { [header]: 'wrong' } })).statusCode).toBe(401)
          const viaCf = await call(`/${prefix}/v1/teams`, {
            headers: { [header]: TOKEN, 'cf-connecting-ip': '203.0.113.9' },
          })
          expect(viaCf.statusCode).toBe(404)
        }
        delete process.env.WIEPLAY_SYNC_TOKEN_HASH
        const res = await call(`/${prefix}/v1/sync`, { query: { teams: '1' } })
        expect(res.statusCode).toBe(503)
        expect(res.body.code).toBe('wieplay_not_configured')
      })

      for (const header of ['x-wieplay-service-token', 'x-nomal-service-token']) {
        it(`service routes: ${header} is accepted`, async () => {
          const database = fakeDatabase({
            teams: [{ id: 92, name: 'H3', sport: 'volleyball', season: '2026/27', league: '3L', team_id: 'h3', active: true }],
          }, [])
          const res = await harness(database)(`/${prefix}/v1/teams`, { headers: { [header]: TOKEN } })
          expect(res.statusCode).toBe(200)
          expect(res.body.teams).toEqual([
            { id: 92, name: 'H3', sport: 'volleyball', season: '2026/27', league: '3L', team_key: 'h3', active: true },
          ])
        })
      }

      it('sync: rejects junk team lists before touching the database', async () => {
        const res = await harness()(`/${prefix}/v1/sync`, {
          query: { teams: '1;DROP' }, headers: { 'x-wieplay-service-token': TOKEN },
        })
        expect(res.statusCode).toBe(400)
      })

      it('adult-check: rejects a bad date before touching the database', async () => {
        const res = await harness()(`/${prefix}/v1/adult-check`, {
          query: { team: '92', date: '18.10.2026' }, headers: { 'x-nomal-service-token': TOKEN },
        })
        expect(res.statusCode).toBe(400)
      })
    })
  }

  describe('the pre-rename NOMAL_* env alone (the env today)', () => {
    beforeEach(() => {
      for (const k of Object.keys(process.env)) if (k.startsWith('WIEPLAY_')) delete process.env[k]
      setEnv('NOMAL')
    })

    for (const prefix of PREFIXES) {
      it(`/${prefix}/v1: configured, signs for aud "${prefix}", accepts the service token`, async () => {
        const database = fakeDatabase({
          members: [{ id: 5, uuid: 'uuid-5', first_name: 'Ada', last_name: 'Muster', role: '[]' }],
          teams: [], member_teams: [], teams_coaches: [], teams_responsibles: [],
        }, [])
        const call = harness(database)
        const res = await call(`/${prefix}/v1/authorize`, {
          query: { state: STATE, return: RETURN }, accountability: { user: 'user-uuid' },
        })
        expect(res.statusCode).toBe(302)
        const token = new URL(res.location).searchParams.get('token')
        expect(decode(token.split('.')[1]).aud).toBe(prefix)
        const teams = await call(`/${prefix}/v1/teams`, { headers: { 'x-nomal-service-token': TOKEN } })
        expect(teams.statusCode).toBe(200)
      })
    }
  })
})
