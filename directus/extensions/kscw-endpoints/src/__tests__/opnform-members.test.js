// OpnForm → Wiedisync member lookup + form-only event sign-up (migration 434).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import {
  nameTokens, pickByName, resolveMember, memberTeamsAndSections, signUpForFormEvents, syncFormSignups,
  registerOpnformMembers, SERVICE_TOKEN_HEADER,
} from '../opnform-members.js'

const TOKEN = 'test-service-token'
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const noop = () => {}
const logger = { child: () => ({ info: noop, warn: noop, error: noop }) }

const ANNA = { id: 11, first_name: 'Anna', last_name: 'Müller', club_section: 'volleyball', user: 'u-anna' }
const LUCA = { id: 12, first_name: 'Luca', last_name: 'Müller', club_section: 'volleyball', user: null }

/**
 * Fake knex: `raw` answers by SQL shape (members lookup vs teams), the query builder
 * returns `tables[table]` and records every write.
 */
function fakeDatabase({ members = [], teams = [], tables = {} } = {}) {
  const writes = []
  const raws = []
  const builder = (table) => {
    const q = {
      where: (arg) => { if (typeof arg === 'function') arg(q); return q },
      andWhere: (arg) => { if (typeof arg === 'function') arg(q); return q },
      orWhereNull: () => q, whereNull: () => q, whereNot: () => q, whereIn: () => q,
      select: async () => tables[table] ?? [],
      first: async () => (tables[table] ?? [])[0],
      insert: (row) => {
        writes.push({ table, op: 'insert', row })
        return { onConflict: () => ({ ignore: async () => [1] }) }
      },
      update: async (row) => { writes.push({ table, op: 'update', row }); return 1 },
    }
    return q
  }
  const raw = async (sql, params) => {
    raws.push({ sql, params })
    if (/FROM members m/.test(sql)) return { rows: members }
    if (/FROM teams t/.test(sql)) return { rows: teams }
    return { rows: [], rowCount: 1 }
  }
  const db = Object.assign(builder, { raw })
  db.transaction = async (fn) => fn(Object.assign((t) => builder(t), { raw }))
  db.writes = writes
  db.raws = raws
  return db
}

function harness(database) {
  const routes = new Map()
  const router = { post: (path, handler) => routes.set(path, handler), get: noop }
  registerOpnformMembers(router, { database, logger })
  return async (path, { body = {}, headers = {} } = {}) => {
    const res = {
      statusCode: 200, body: undefined, headers: {},
      set(k, v) { this.headers[k] = v; return this },
      status(c) { this.statusCode = c; return this },
      json(b) { this.body = b; return this },
    }
    await routes.get(path)({ body, headers }, res)
    return res
  }
}

describe('name matching', () => {
  it('tokenizes accent-, case- and hyphen-blind', () => {
    expect(nameTokens('  Müller-Lüdi  ANNA ')).toEqual(['muller', 'ludi', 'anna'])
  })

  it('picks the sibling whose first + last name are all in the typed name', () => {
    expect(pickByName([ANNA, LUCA], 'anna mueller')).toEqual([]) // ue ≠ ü
    expect(pickByName([ANNA, LUCA], 'Muller Anna')).toEqual([ANNA])
    expect(pickByName([ANNA, LUCA], 'Anna Maria Müller')).toEqual([ANNA])
    expect(pickByName([ANNA, LUCA], 'Müller')).toEqual([])
    expect(pickByName([ANNA, LUCA], '')).toEqual([])
  })
})

describe('resolveMember', () => {
  it('not_found for an unknown or malformed email, without querying for junk', async () => {
    const db = fakeDatabase({ members: [] })
    expect(await resolveMember(db, 'nobody@example.com')).toEqual({ status: 'not_found' })
    expect(await resolveMember(db, 'not-an-email')).toEqual({ status: 'not_found' })
    expect(db.raws).toHaveLength(1)
  })

  it('queries with the trimmed, lowercased email in all four arms', async () => {
    const db = fakeDatabase({ members: [ANNA] })
    expect(await resolveMember(db, '  Anna@Example.COM ')).toEqual({ status: 'found', member: ANNA })
    expect(db.raws[0].params).toEqual(Array(4).fill('anna@example.com'))
    expect(db.raws[0].sql).toMatch(/kscw_membership_active = true/)
  })

  it('a shared family email needs the name to decide', async () => {
    const db = fakeDatabase({ members: [ANNA, LUCA] })
    expect(await resolveMember(db, 'family@example.com')).toEqual({ status: 'ambiguous' })
    expect(await resolveMember(db, 'family@example.com', 'Luca Müller')).toEqual({ status: 'found', member: LUCA })
  })
})

describe('memberTeamsAndSections', () => {
  it('labels the sports of active teams', async () => {
    const db = fakeDatabase({ teams: [{ name: 'Herren 2 H3', sport: 'basketball' }, { name: 'H1', sport: 'volleyball' }] })
    expect(await memberTeamsAndSections(db, ANNA)).toEqual({
      sections: ['Basketball', 'Volleyball'], teams: ['Herren 2 H3', 'H1'],
    })
  })

  it('falls back to the ClubDesk Sektion when the member has no team', async () => {
    const db = fakeDatabase({ teams: [] })
    expect(await memberTeamsAndSections(db, ANNA)).toEqual({ sections: ['Volleyball'], teams: [] })
    expect(await memberTeamsAndSections(db, { ...ANNA, club_section: 'club' })).toEqual({ sections: [], teams: [] })
  })
})

describe('signUpForFormEvents', () => {
  it('adds the audience row and a confirmed RSVP for each bound form-only event', async () => {
    const db = fakeDatabase({ tables: { events: [{ id: 7, participation_mode: 'whole', form_signup_only: true }] } })
    expect(await signUpForFormEvents(db, 'kurs-2026', ANNA)).toEqual([7])
    expect(db.writes[0]).toEqual({ table: 'events_members', op: 'insert', row: { events_id: 7, members_id: 11 } })
    const insert = db.raws.find((r) => /INSERT INTO participations/.test(r.sql))
    expect(insert.params).toEqual([11, '7'])
    expect(insert.sql).toMatch(/'confirmed'/)
    expect(insert.sql).toMatch(/ON CONFLICT DO NOTHING/)
    expect(db.writes[1]).toMatchObject({ table: 'participations', op: 'update', row: { status: 'confirmed' } })
  })

  it('an ordinary bound event gets the RSVP but keeps its audience', async () => {
    const db = fakeDatabase({ tables: { events: [{ id: 9, participation_mode: 'whole', form_signup_only: false }] } })
    expect(await signUpForFormEvents(db, 'turnier', ANNA)).toEqual([9])
    expect(db.writes.some((w) => w.table === 'events_members')).toBe(false)
    expect(db.raws.find((r) => /INSERT INTO participations/.test(r.sql)).params).toEqual([11, '9'])
  })

  it('per-session events get the audience row only', async () => {
    const db = fakeDatabase({ tables: { events: [{ id: 8, participation_mode: 'sessions', form_signup_only: true }] } })
    expect(await signUpForFormEvents(db, 'kurs-2026', ANNA)).toEqual([8])
    expect(db.writes.map((w) => w.table)).toEqual(['events_members'])
    expect(db.raws.some((r) => /participations/.test(r.sql))).toBe(false)
  })
})

describe('service routes', () => {
  const saved = process.env.OPNFORM_SERVICE_TOKEN_HASH
  beforeEach(() => { process.env.OPNFORM_SERVICE_TOKEN_HASH = sha256(TOKEN) })
  afterEach(() => {
    if (saved === undefined) delete process.env.OPNFORM_SERVICE_TOKEN_HASH
    else process.env.OPNFORM_SERVICE_TOKEN_HASH = saved
  })
  const auth = { [SERVICE_TOKEN_HEADER]: TOKEN }

  it('503 unconfigured, 404 through Cloudflare, 401 with a wrong token', async () => {
    const call = harness(fakeDatabase())
    delete process.env.OPNFORM_SERVICE_TOKEN_HASH
    expect((await call('/opnform/v1/member-lookup', { headers: auth })).statusCode).toBe(503)
    process.env.OPNFORM_SERVICE_TOKEN_HASH = sha256(TOKEN)
    expect((await call('/opnform/v1/member-lookup', { headers: { ...auth, 'cf-connecting-ip': '1.2.3.4' } })).statusCode).toBe(404)
    expect((await call('/opnform/v1/member-lookup', { headers: { [SERVICE_TOKEN_HEADER]: 'nope' } })).statusCode).toBe(401)
  })

  it('member-lookup returns sections and teams only for a single match', async () => {
    const found = await harness(fakeDatabase({ members: [ANNA], teams: [{ name: 'H1', sport: 'volleyball' }] }))(
      '/opnform/v1/member-lookup', { headers: auth, body: { email: 'anna@example.com' } })
    expect(found.body).toEqual({ status: 'found', name: 'Anna Müller', sections: ['Volleyball'], teams: ['H1'] })
    expect(found.headers['Cache-Control']).toBe('no-store')

    const shared = await harness(fakeDatabase({ members: [ANNA, LUCA] }))(
      '/opnform/v1/member-lookup', { headers: auth, body: { email: 'family@example.com' } })
    expect(shared.body).toEqual({ status: 'ambiguous' })
  })

  it('signup rejects a bad slug and signs nobody in for an unknown email', async () => {
    const db = fakeDatabase({ members: [], tables: { events: [{ id: 7 }] } })
    const call = harness(db)
    expect((await call('/opnform/v1/signup', { headers: auth, body: { form_slug: '../x', email: 'a@b.ch' } })).statusCode).toBe(400)
    const res = await call('/opnform/v1/signup', { headers: auth, body: { form_slug: 'kurs-2026', email: 'a@b.ch' } })
    expect(res.body).toEqual({ status: 'not_found', events: [] })
    expect(db.writes).toEqual([])
  })

  it('signup signs a matched member into the bound events', async () => {
    const db = fakeDatabase({ members: [LUCA], tables: { events: [{ id: 7, participation_mode: null, form_signup_only: true }] } })
    const res = await harness(db)('/opnform/v1/signup', {
      headers: auth, body: { form_slug: 'kurs-2026', submission_id: 'abc', email: 'luca@example.com' },
    })
    expect(res.body).toEqual({ status: 'found', events: [7] })
    expect(db.writes[0].row).toEqual({ events_id: 7, members_id: 12 })
  })
})

describe('syncFormSignups', () => {
  const fields = [{ id: 'e', type: 'email', name: 'Email' }, { id: 'n', type: 'text', name: 'Name' }]

  it('signs in every member who already submitted and counts the rest', async () => {
    let call = 0
    const db = fakeDatabase({ tables: { events: [{ id: 7, participation_mode: 'whole', form_signup_only: true }] } })
    const realRaw = db.raw
    db.raw = async (sql, params) => {
      if (/FROM members m/.test(sql)) {
        call++
        return { rows: params[0] === 'anna@example.com' ? [ANNA] : params[0] === 'family@example.com' ? [ANNA, LUCA] : [] }
      }
      return realRaw(sql, params)
    }
    // Real OpnForm rows nest the answers under `data`; a flat row is tolerated too.
    const res = await syncFormSignups(db, 'kurs', { fields, data: [
      { id: 1, data: { e: 'anna@example.com', n: '' } },
      { id: 2, data: { e: 'guest@example.com', n: 'Guest' } },
      { e: 'family@example.com', n: 'Someone else' },
    ] })
    expect(res).toEqual({ submissions: 3, signed_in: 1, not_members: 1, ambiguous: 1, events: [7] })
    expect(call).toBe(3)
  })

  it('needs an email question', async () => {
    expect((await syncFormSignups(fakeDatabase(), 'x', { fields: [{ id: 'n', type: 'text' }], data: [{}] })).error).toBe('no_email_question')
  })
})
