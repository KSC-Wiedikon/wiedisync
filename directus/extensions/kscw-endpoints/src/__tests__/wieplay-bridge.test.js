/**
 * WiePlay bridge: login token signing, the adults-only rule, roster assembly, and the
 * route guards (config, state, return URL, service token, Cloudflare refusal) under
 * /kscw/wieplay/v1. WiePlay was Nomal until 17.10.2026; since its cutover the old names
 * (/kscw/nomal/v1, aud "nomal", X-Nomal-Service-Token, NOMAL_* env) must get nowhere.
 */
import crypto from 'crypto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  signWieplayToken, previousSeasonShort, parseReturnUrls, wieplayConfig, wieplayEnv,
  serviceTokenOk, parseStringList, sportAdminScopes, parseTeamIds, isoDate,
  hhmm, normalizeSets, adultOn, mergeRelations, buildRosterRows, registerWieplayBridge,
  markWieplayTeams, BRIDGE_BASE, TOKEN_AUDIENCE, SERVICE_TOKEN_HEADER, WIEPLAY_FLAG_GUC,
} from '../wieplay-bridge.js'

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const TOKEN = 'service-token-for-tests'
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex')
const RETURN = 'https://wieplay-dev.kscw.ch/api/auth/callback'
const STATE = 'abcdefghijklmnopqrstuvwx'
const ROUTES = ['authorize', 'teams', 'sync', 'adult-check']
const HEADER = 'x-wieplay-service-token'
const OLD_HEADER = 'x-nomal-service-token'
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

  it('config reads WIEPLAY_* only; the pre-rename NOMAL_* keys are ignored', () => {
    const nomal = Object.fromEntries(ENV_KEYS.map((k) => [`NOMAL_${k}`, `old-${k}`]))
    const wieplay = Object.fromEntries(ENV_KEYS.map((k) => [`WIEPLAY_${k}`, ` new-${k} `]))
    for (const k of ENV_KEYS) {
      expect(wieplayEnv(wieplay, k)).toBe(`new-${k}`)
      expect(wieplayEnv({ ...nomal, ...wieplay }, k)).toBe(`new-${k}`)
      expect(wieplayEnv(nomal, k)).toBe('')
      expect(wieplayEnv({ ...nomal, [`WIEPLAY_${k}`]: '  ' }, k)).toBe('')
      expect(wieplayEnv({}, k)).toBe('')
    }
    const cfgOld = wieplayConfig({
      PUBLIC_URL: 'https://directus-dev.kscw.ch',
      NOMAL_JWT_PRIVATE_KEY: 'old\\nkey', NOMAL_JWT_KID: 'nomal-dev-1', NOMAL_RETURN_URLS: RETURN,
      NOMAL_SYNC_TOKEN_HASH: 'a'.repeat(64), NOMAL_JWT_ISSUER: 'iss-old', NOMAL_LOGIN_URL: 'https://old.example/login',
    })
    expect(cfgOld).toMatchObject({ privateKeyPem: '', kid: '', syncTokenHash: '', issuer: 'wiedisync-dev' })
    expect(cfgOld.loginUrl).not.toBe('https://old.example/login')
    expect(cfgOld.returnUrls.size).toBe(0)
    const cfgNew = wieplayConfig({
      NOMAL_JWT_KID: 'nomal-dev-1', WIEPLAY_JWT_KID: 'wieplay-dev-1',
      NOMAL_RETURN_URLS: 'https://old.example/cb', WIEPLAY_RETURN_URLS: RETURN,
      WIEPLAY_SYNC_TOKEN_HASH: 'A'.repeat(64),
    })
    expect(cfgNew.kid).toBe('wieplay-dev-1')
    expect(cfgNew.syncTokenHash).toBe('a'.repeat(64))
    expect([...cfgNew.returnUrls]).toEqual([RETURN])
  })

  it('service token compares against the SHA-256', () => {
    expect(serviceTokenOk(TOKEN, TOKEN_HASH)).toBe(true)
    expect(serviceTokenOk('wrong', TOKEN_HASH)).toBe(false)
    expect(serviceTokenOk(undefined, TOKEN_HASH)).toBe(false)
    expect(serviceTokenOk(TOKEN, 'not-a-hash')).toBe(false)
  })

  it('one name per thing: /wieplay/v1, aud "wieplay", X-WiePlay-Service-Token', () => {
    expect(BRIDGE_BASE).toBe('/wieplay/v1')
    expect(TOKEN_AUDIENCE).toBe('wieplay')
    expect(SERVICE_TOKEN_HEADER).toBe(HEADER)
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

describe('markWieplayTeams', () => {
  it('switches on the asked-for rows and off every other one, writing only changes, under the GUC', async () => {
    const flags = { 1: false, 2: true, 3: true, 4: false }
    const tx = flagTransaction(flags)
    expect(await markWieplayTeams(tx, [1, 2])).toEqual({ on: [1], off: [3] })
    expect(flags).toEqual({ 1: true, 2: true, 3: false, 4: false })
    const [guc, on, off] = tx.calls
    expect(guc.bindings).toEqual(['kscw.wieplay_enabled_write', 'on'])
    expect(on.filters).toEqual([['in', 'id', [1, 2]], ['eq', 'wieplay_enabled', false]])
    expect(off.filters).toEqual([['notIn', 'id', [1, 2]], ['eq', 'wieplay_enabled', true]])
    // A second sync with the same teams changes nothing.
    expect(await markWieplayTeams(flagTransaction(flags), [1, 2])).toEqual({ on: [], off: [] })
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

/**
 * A knex transaction stand-in for teams.wieplay_enabled: records the GUC and every update with
 * its filters; `flags` is the column's current value per team id. `missing` = the column does
 * not exist (dev between the nightly prod clone and db:deploy:dev).
 */
function flagTransaction(flags, { missing = false } = {}) {
  const calls = []
  const trx = (table) => {
    const filters = []
    const q = {
      whereIn: (col, v) => { filters.push(['in', col, v]); return q },
      whereNotIn: (col, v) => { filters.push(['notIn', col, v]); return q },
      where: (col, v) => { filters.push(['eq', col, v]); return q },
      update: async (data, returning) => {
        if (missing) throw new Error('column "wieplay_enabled" does not exist')
        calls.push({ table, filters, data, returning })
        const keep = (id) => filters.every(([op, , v]) =>
          op === 'in' ? v.includes(id) : op === 'notIn' ? !v.includes(id) : flags[id] === v)
        const hit = Object.keys(flags).map(Number).filter(keep)
        for (const id of hit) flags[id] = data.wieplay_enabled
        return hit.map((id) => ({ id }))
      },
    }
    return q
  }
  trx.raw = async (sql, bindings) => { calls.push({ sql, bindings }) }
  return { calls, transaction: async (fn) => fn(trx) }
}

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
    // Like Express/Directus: a path nobody registered falls through to a 404.
    if (!handler) return res.status(404).json({ error: `Route ${path} doesn't exist.` })
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

  it('registers the four routes under /wieplay/v1 only', () => {
    expect(harness().paths.sort()).toEqual(ROUTES.map((r) => `/wieplay/v1/${r}`).sort())
  })

  it('authorize: 503 wieplay_not_configured until configured', async () => {
    delete process.env.WIEPLAY_JWT_PRIVATE_KEY
    const res = await harness()('/wieplay/v1/authorize', { query: { state: STATE, return: RETURN } })
    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe('wieplay_not_configured')
  })

  it('authorize: refuses bad state and foreign return URLs', async () => {
    const call = harness()
    expect((await call('/wieplay/v1/authorize', { query: { state: 'short', return: RETURN } })).statusCode).toBe(400)
    const foreign = await call('/wieplay/v1/authorize', { query: { state: STATE, return: 'https://evil.example/cb' } })
    expect(foreign.statusCode).toBe(400)
  })

  it('authorize: without a session, logs in first and comes back to the same route', async () => {
    const res = await harness()('/wieplay/v1/authorize', { query: { state: STATE, return: RETURN } })
    expect(res.statusCode).toBe(302)
    const login = new URL(res.location)
    expect(`${login.origin}${login.pathname}`).toBe('https://wiedisync-dev.kscw.ch/login')
    const next = new URL(login.searchParams.get('next'))
    expect(`${next.origin}${next.pathname}`).toBe('https://directus-dev.kscw.ch/kscw/wieplay/v1/authorize')
    expect(next.searchParams.get('return')).toBe(RETURN)
    expect(next.searchParams.get('state')).toBe(STATE)
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('authorize: with a session, signs a token for aud "wieplay" and logs wieplay_login', async () => {
    const inserts = []
    const database = fakeDatabase({
      members: [{ id: 5, uuid: 'uuid-5', first_name: 'Ada', last_name: 'Muster', role: '["user","vb_admin"]' }],
      teams: [{ id: 92, season: '2026/27', captain: 5 }],
      member_teams: [{ team: 92, member: 5, season: '2026/27', guest_level: 0 }],
      teams_coaches: [],
      teams_responsibles: [],
    }, inserts)
    const res = await harness(database)('/wieplay/v1/authorize', {
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
      aud: 'wieplay', iss: 'wiedisync-dev', sub: 'uuid-5', mid: 5, name: 'Ada Muster', state: STATE,
      roles: ['user', 'vb_admin'], sport_admin: ['volleyball'],
      teams: [{ team: 92, season: '2026/27', rel: ['captain', 'player'], guest: false }],
    })
    expect(claims.exp - claims.iat).toBe(60)
    await new Promise((r) => setTimeout(r, 0)) // the user log is fire-and-forget
    const logRow = inserts.find((i) => i.table === 'user_logs')?.row
    expect(logRow?.action).toBe('wieplay_login')
    const logData = JSON.parse(logRow.data)
    expect(logData).toMatchObject({ to: 'wieplay-dev.kscw.ch' })
    expect(logData).not.toHaveProperty('route')
  })

  it('service routes: token required, never through Cloudflare', async () => {
    const call = harness()
    expect((await call('/wieplay/v1/teams')).statusCode).toBe(401)
    expect((await call('/wieplay/v1/teams', { headers: { [HEADER]: 'wrong' } })).statusCode).toBe(401)
    const viaCf = await call('/wieplay/v1/teams', {
      headers: { [HEADER]: TOKEN, 'cf-connecting-ip': '203.0.113.9' },
    })
    expect(viaCf.statusCode).toBe(404)
    delete process.env.WIEPLAY_SYNC_TOKEN_HASH
    const res = await call('/wieplay/v1/sync', { query: { teams: '1' } })
    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe('wieplay_not_configured')
  })

  it('service routes: X-WiePlay-Service-Token is accepted', async () => {
    const database = fakeDatabase({
      teams: [{ id: 92, name: 'H3', sport: 'volleyball', season: '2026/27', league: '3L', team_id: 'h3', active: true }],
    }, [])
    const res = await harness(database)('/wieplay/v1/teams', { headers: { [HEADER]: TOKEN } })
    expect(res.statusCode).toBe(200)
    expect(res.body.teams).toEqual([
      { id: 92, name: 'H3', sport: 'volleyball', season: '2026/27', league: '3L', team_key: 'h3', active: true },
    ])
  })

  it('sync: marks the requested teams in teams.wieplay_enabled and serves the snapshot', async () => {
    const flags = { 92: false, 93: true, 94: true, 95: false }
    const tx = flagTransaction(flags)
    const database = Object.assign(fakeDatabase({
      teams: [{ id: 92, season: '2026/27', captain: null }, { id: 93, season: '2025/26', captain: null }],
      games: [{ id: 501, kscw_team: 92, date: '2026-10-11', time: '20:00:00', type: 'home', status: 'scheduled' }],
    }, []), { transaction: tx.transaction })
    const res = await harness(database)('/wieplay/v1/sync', {
      query: { teams: '92,93' }, headers: { [HEADER]: TOKEN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.games.map((g) => g.id)).toEqual([501])
    expect(flags).toEqual({ 92: true, 93: true, 94: false, 95: false })
    expect(tx.calls[0]).toEqual({ sql: 'SELECT set_config(?, ?, true)', bindings: [WIEPLAY_FLAG_GUC, 'on'] })
  })

  it('sync: still serves the snapshot when the flags cannot be written', async () => {
    const tx = flagTransaction({ 92: false }, { missing: true })
    const database = Object.assign(fakeDatabase({ teams: [{ id: 92, season: '2026/27', captain: null }] }, []), {
      transaction: tx.transaction,
    })
    const res = await harness(database)('/wieplay/v1/sync', { query: { teams: '92' }, headers: { [HEADER]: TOKEN } })
    expect(res.statusCode).toBe(200)
    expect(res.body.version).toBe(1)
  })

  it('sync: an unknown team id marks nothing', async () => {
    const tx = flagTransaction({ 92: false })
    const database = Object.assign(fakeDatabase({ teams: [] }, []), { transaction: tx.transaction })
    const res = await harness(database)('/wieplay/v1/sync', { query: { teams: '92' }, headers: { [HEADER]: TOKEN } })
    expect(res.statusCode).toBe(404)
    expect(tx.calls).toEqual([])
  })

  it('sync: rejects junk team lists before touching the database', async () => {
    const res = await harness()('/wieplay/v1/sync', {
      query: { teams: '1;DROP' }, headers: { [HEADER]: TOKEN },
    })
    expect(res.statusCode).toBe(400)
  })

  it('adult-check: rejects a bad date before touching the database', async () => {
    const res = await harness()('/wieplay/v1/adult-check', {
      query: { team: '92', date: '18.10.2026' }, headers: { [HEADER]: TOKEN },
    })
    expect(res.statusCode).toBe(400)
  })

  describe('the pre-rename names (Nomal) are gone', () => {
    it('/nomal/v1/*: 404 on every route, even with the real token and a session', async () => {
      const call = harness()
      for (const r of ROUTES) {
        const res = await call(`/nomal/v1/${r}`, {
          query: { state: STATE, return: RETURN, teams: '92', team: '92', date: '2026-10-18' },
          headers: { [HEADER]: TOKEN, [OLD_HEADER]: TOKEN },
          accountability: { user: 'user-uuid' },
        })
        expect(res.statusCode).toBe(404)
      }
    })

    it('X-Nomal-Service-Token: 401, on every service route', async () => {
      const call = harness()
      for (const r of ['teams', 'sync', 'adult-check']) {
        const res = await call(`/wieplay/v1/${r}`, {
          query: { teams: '92', team: '92', date: '2026-10-18' }, headers: { [OLD_HEADER]: TOKEN },
        })
        expect(res.statusCode).toBe(401)
        expect(res.body.error).toBe('Invalid service token')
      }
    })

    it('NOMAL_* env alone: 503 wieplay_not_configured, nothing signed', async () => {
      for (const k of Object.keys(process.env)) if (k.startsWith('WIEPLAY_')) delete process.env[k]
      setEnv('NOMAL')
      const call = harness()
      const login = await call('/wieplay/v1/authorize', {
        query: { state: STATE, return: RETURN }, accountability: { user: 'user-uuid' },
      })
      expect(login.statusCode).toBe(503)
      expect(login.body.code).toBe('wieplay_not_configured')
      expect(login.location).toBeUndefined()
      for (const headers of [{ [HEADER]: TOKEN }, { [OLD_HEADER]: TOKEN }]) {
        const teams = await call('/wieplay/v1/teams', { headers })
        expect(teams.statusCode).toBe(503)
        expect(teams.body.code).toBe('wieplay_not_configured')
      }
    })
  })
})
