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
    expect(SECTION_COLLECTIONS.mixed_turnier).toEqual(
      ['mixed_tournament_signups','participations','members'])
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
    expect(assertCollection('mixed_turnier', 'members')).toBe(true)
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
  })
})
