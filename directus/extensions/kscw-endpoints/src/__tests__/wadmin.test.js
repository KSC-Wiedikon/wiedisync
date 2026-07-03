import { describe, it, expect } from 'vitest'
import {
  ALL_SECTIONS, SECTION_COLLECTIONS,
  isManager, normalizeSections, computeAccess,
} from '../wadmin.js'

function makeDb({ roleRow = null, accessRow = null } = {}) {
  return (table) => {
    const chain = {
      join: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      whereRaw: () => chain,
      orderBy: () => chain,
      select: () => chain,
      first: async () => (table === 'directus_users' ? roleRow : accessRow),
    }
    return chain
  }
}

describe('wadmin core', () => {
  it('contract covers exactly the 6 sections', () => {
    expect(ALL_SECTIONS).toEqual(
      ['news','events','registrations','sponsors','scorer_courses','mixed_turnier'])
    expect(Object.keys(SECTION_COLLECTIONS).sort()).toEqual([...ALL_SECTIONS].sort())
    // Security audit 2026-05-31: 'participations' and 'members' were removed
    // from this section — the generic admin-accountability /wadmin CRUD routes
    // bypass RLS, so exposing those full collections to a Website Admin section
    // was an IDOR / PII-disclosure hole. The mixed-tournament UI works through
    // the signups collection itself.
    expect(SECTION_COLLECTIONS.mixed_turnier).toEqual(
      ['mixed_tournament_signups'])
  })

  it('isManager is case-insensitive for Superuser/Administrator only', () => {
    expect(isManager('Superuser')).toBe(true)
    expect(isManager('administrator')).toBe(true)
    expect(isManager('Website Admin')).toBe(false)
    expect(isManager('Member')).toBe(false)
    expect(isManager(null)).toBe(false)
  })

  it('normalizeSections drops unknown keys and handles array or json string', () => {
    expect(normalizeSections(['news','bogus','events'])).toEqual(['news','events'])
    expect(normalizeSections('["sponsors","x"]')).toEqual(['sponsors'])
    expect(normalizeSections(null)).toEqual([])
  })

  it('computeAccess: manager → all 6', async () => {
    const db = makeDb({ roleRow: { role_name: 'Superuser' } })
    expect(await computeAccess(db, 'u1')).toEqual({ isSuperuser: true, sections: ALL_SECTIONS })
  })

  it('computeAccess: Website Admin with row → its sections', async () => {
    const db = makeDb({
      roleRow: { role_name: 'Website Admin' },
      accessRow: { sections: ['news','scorer_courses'] },
    })
    expect(await computeAccess(db, 'u2')).toEqual(
      { isSuperuser: false, sections: ['news','scorer_courses'] })
  })

  it('computeAccess: Website Admin no row → []', async () => {
    const db = makeDb({ roleRow: { role_name: 'Website Admin' }, accessRow: null })
    expect(await computeAccess(db, 'u3')).toEqual({ isSuperuser: false, sections: [] })
  })

  it('computeAccess: other role → []', async () => {
    const db = makeDb({ roleRow: { role_name: 'Member' } })
    expect(await computeAccess(db, 'u4')).toEqual({ isSuperuser: false, sections: [] })
  })

  it('computeAccess: unknown user (no role row) fails closed', async () => {
    const db = makeDb({ roleRow: null })
    expect(await computeAccess(db, 'u5')).toEqual({ isSuperuser: false, sections: [] })
  })
})

import { authorize, assertCollection, parseQuery } from '../wadmin.js'

describe('wadmin gate + scope', () => {
  const dbManager = (t) => ({ join(){return this}, leftJoin(){return this},
    where(){return this}, whereRaw(){return this}, orderBy(){return this},
    select(){return this}, first: async()=> t==='directus_users'
      ? { role_name:'Superuser' } : null })
  const dbGated = (sections) => (t) => ({ join(){return this}, leftJoin(){return this},
    where(){return this}, whereRaw(){return this}, orderBy(){return this},
    select(){return this}, first: async()=> t==='directus_users'
      ? { role_name:'Website Admin' } : { sections } })

  it('authorize: manager passes any section', async () => {
    expect(await authorize(dbManager, 'u', 'sponsors'))
      .toEqual({ ok: true, isSuperuser: true })
  })
  it('authorize: gated with grant passes that section', async () => {
    expect(await authorize(dbGated(['news']), 'u', 'news'))
      .toEqual({ ok: true, isSuperuser: false })
  })
  it('authorize: gated without grant → section_not_granted', async () => {
    expect(await authorize(dbGated(['news']), 'u', 'sponsors'))
      .toEqual({ ok: false, status: 403, error: 'section_not_granted' })
  })
  it('authorize: unknown section → unknown_section', async () => {
    expect(await authorize(dbManager, 'u', 'bogus'))
      .toEqual({ ok: false, status: 404, error: 'unknown_section' })
  })

  it('assertCollection: in-contract ok, out-of-contract rejected', () => {
    expect(assertCollection('news', 'news')).toBe(true)
    expect(assertCollection('news', 'sponsors')).toBe(false)
    // Security audit 2026-05-31: members/participations no longer in scope for
    // the mixed_turnier section (RLS-bypassing IDOR fix); only signups remain.
    expect(assertCollection('mixed_turnier', 'members')).toBe(false)
    expect(assertCollection('mixed_turnier', 'participations')).toBe(false)
    expect(assertCollection('mixed_turnier', 'mixed_tournament_signups')).toBe(true)
  })

  it('parseQuery maps Directus REST query to ItemsService query', () => {
    expect(parseQuery({
      filter: { active: { _eq: 'true' } },
      fields: 'id,title', sort: '-date,name', limit: '-1',
    })).toEqual({
      filter: { active: { _eq: 'true' } },
      fields: ['id','title'], sort: ['-date','name'], limit: -1,
    })
    expect(parseQuery({})).toEqual({})
    expect(parseQuery({ fields: ['id','title'], sort: ['-date'] })).toEqual({
      fields: ['id','title'], sort: ['-date'],
    })
  })
})

import { badSlug as wadminBadSlug } from '../opnform.js'
describe('wadmin scorer delegation guards', () => {
  it('reuses opnform badSlug for slug validation', () => {
    expect(wadminBadSlug('ok-slug')).toBe(false)
    expect(wadminBadSlug('bad slug')).toBe(true)
  })
})

import { isManagerUser, buildUpsert } from '../wadmin.js'

describe('wadmin management', () => {
  const db = (role) => () => ({ join(){return this}, leftJoin(){return this},
    where(){return this}, whereRaw(){return this}, orderBy(){return this},
    select(){return this}, first: async()=>({ role_name: role }) })

  it('isManagerUser true for Superuser, false for Website Admin', async () => {
    expect(await isManagerUser(db('Superuser'), 'u')).toBe(true)
    expect(await isManagerUser(db('Website Admin'), 'u')).toBe(false)
    expect(await isManagerUser(db(null), 'u')).toBe(false)
  })

  it('buildUpsert filters sections and sets the conflict target', () => {
    const u = buildUpsert('user-1', ['news','x','sponsors'])
    expect(u.row.user).toBe('user-1')
    expect(JSON.parse(u.row.sections)).toEqual(['news','sponsors'])
    expect(u.conflict).toBe('user')
  })

  it('buildUpsert yields valid pg ON CONFLICT SQL (quoted "user", no double-encode)', async () => {
    const { default: knexFactory } = await import('knex')
    const knex = knexFactory({ client: 'pg' })
    const { row, conflict } = buildUpsert('u-1', ['news', 'bogus', 'sponsors'])
    const q = knex('website_admin_access')
      .insert(row)
      .onConflict(conflict)
      .merge({ sections: row.sections, date_updated: knex.fn.now() })
      .toSQL()
    expect(q.sql).toContain('on conflict ("user")')   // reserved word correctly quoted
    expect(q.sql).toContain('do update set')
    expect(q.bindings).toContain('u-1')
    // sections binding is the JSON string ["news","sponsors"] — parsed once, NOT double-encoded
    const sectionsBinding = q.bindings.find(
      (b) => typeof b === 'string' && b.startsWith('[')
    )
    expect(JSON.parse(sectionsBinding)).toEqual(['news', 'sponsors'])
    await knex.destroy()
  })
})

import { assertScalarQuery } from '../wadmin.js'
describe('wadmin assertScalarQuery — relational traversal guard (#4 + 2026-07-03 bypass)', () => {
  const isRel = (q) => { try { assertScalarQuery(q); return false } catch { return true } }
  it('allows plain scalar field filters / fields / sort', () => {
    expect(isRel({ filter: { activity_id: { _eq: 5 } } })).toBe(false)
    expect(isRel({ filter: { _and: [{ a: { _eq: 1 } }, { b: { _in: [2, 3] } }] } })).toBe(false)
    expect(isRel({ fields: ['id', 'title'], sort: ['-date_created'] })).toBe(false)
  })
  it('rejects relational filter traversal incl. _some / _none / _and-as-value', () => {
    expect(isRel({ filter: { invited_members: { members_id: { ahv_nummer: { _eq: 'x' } } } } })).toBe(true)
    expect(isRel({ filter: { invited_members: { _some: { members_id: { ahv_nummer: { _starts_with: '756' } } } } } })).toBe(true)
    expect(isRel({ filter: { invited_members: { _none: { members_id: { iban: { _nnull: true } } } } } })).toBe(true)
    expect(isRel({ filter: { invited_members: { _and: [{ members_id: { email: { _eq: 'a' } } }] } } })).toBe(true)
    expect(isRel({ fields: ['invited_members.members_id.ahv_nummer'] })).toBe(true)
    expect(isRel({ sort: ['invited_members.members_id.email'] })).toBe(true)
  })
})
