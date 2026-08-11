import { describe, it, expect } from 'vitest'
import {
  ALL_SECTIONS, SECTION_COLLECTIONS,
  isManager, normalizeSections, computeAccess, buildExamResultMail, norm, plausiblePlz, plausibleOrt,
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
  // Sections whose writes go through their own validating routes instead of the
  // generic /wadmin/:section/items/:collection CRUD, and which therefore have no
  // SECTION_COLLECTIONS entry on purpose.
  //
  // site_text (page text for the kscw-website): every value is rendered as text on
  // a public page, so each one must pass the checks in site-text.js. The generic
  // CRUD would let a PATCH store anything the column accepts.
  const CUSTOM_ROUTE_SECTIONS = ['site_text']

  it('contract covers exactly the 7 sections', () => {
    expect(ALL_SECTIONS).toEqual(
      ['news','events','registrations','sponsors','scorer_courses','mixed_turnier','site_text'])
    // Every section EXCEPT the custom-route ones must map to collections. A new
    // section missing from both lists would authorize but reach nothing.
    expect(Object.keys(SECTION_COLLECTIONS).sort()).toEqual(
      ALL_SECTIONS.filter((s) => !CUSTOM_ROUTE_SECTIONS.includes(s)).sort())
    // Named explicitly so removing the custom routes without restoring a generic
    // mapping fails here rather than silently leaving the section unreachable.
    expect(SECTION_COLLECTIONS.site_text).toBeUndefined()
    // Security audit 2026-05-31: 'participations' and 'members' were removed
    // from this section — the generic admin-accountability /wadmin CRUD routes
    // bypass RLS, so exposing those full collections to a Website Admin section
    // was an IDOR / PII-disclosure hole. The mixed-tournament UI works through
    // the signups collection itself.
    expect(SECTION_COLLECTIONS.mixed_turnier).toEqual(
      ['mixed_tournament_signups'])
    // scorer_courses also exposes the admin-owned attendance tracking table
    // (all-scalar; per-signup presence/exam/SV-licence/notes). See wadmin.js.
    expect(SECTION_COLLECTIONS.scorer_courses).toEqual(
      ['scorer_courses', 'scorer_course_attendance'])
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

  // A Directus user has exactly one role, and the club's youth/sport administrators
  // need Sport Admin for Wiedisync. Making them a website admin used to mean giving
  // that role up, so Sport Admin is eligible to hold a grant too (2026-08-11).
  it('computeAccess: Sport Admin with row → its sections', async () => {
    const db = makeDb({
      roleRow: { role_name: 'Sport Admin' },
      accessRow: { sections: ['site_text', 'news'] },
    })
    expect(await computeAccess(db, 'u6')).toEqual(
      { isSuperuser: false, sections: ['site_text', 'news'] })
  })

  it('computeAccess: Sport Admin WITHOUT a row → [] (eligibility is not access)', async () => {
    // The whole point of widening the gate: it decides who may be GRANTED sections,
    // never who has them. Both Sport Admins must still see nothing until a superuser
    // ticks something for them individually.
    const db = makeDb({ roleRow: { role_name: 'Sport Admin' }, accessRow: null })
    expect(await computeAccess(db, 'u7')).toEqual({ isSuperuser: false, sections: [] })
  })

  it('computeAccess: a grant row on an ineligible role is inert', async () => {
    // Defence in depth: a stray row against a Member (mis-click, bad import) must
    // not become access just because the row exists.
    const db = makeDb({
      roleRow: { role_name: 'Member' },
      accessRow: { sections: ['registrations'] },
    })
    expect(await computeAccess(db, 'u8')).toEqual({ isSuperuser: false, sections: [] })
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
    expect(assertCollection('scorer_courses', 'scorer_courses')).toBe(true)
    expect(assertCollection('scorer_courses', 'scorer_course_attendance')).toBe(true)
    expect(assertCollection('scorer_courses', 'members')).toBe(false)
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

describe('buildExamResultMail', () => {
  const base = { firstName: 'Anna', courseDateIso: '2026-08-12', examDate: '2026-08-19', svLicense: '337646' }

  it('says passed on a pass, in both languages', () => {
    expect(buildExamResultMail({ ...base, passed: true }).subject).toContain('bestanden')
    expect(buildExamResultMail({ ...base, passed: true, en: true }).subject).toContain('passed')
    expect(buildExamResultMail({ ...base, passed: true }).html).toContain('Herzliche Gratulation')
  })

  // The result belongs in the mail, not in a phone's lock-screen preview.
  it('keeps the verdict out of a failure subject line', () => {
    expect(buildExamResultMail({ ...base, passed: false }).subject).toBe('Schreiber-Prüfung — KSC Wiedikon')
    expect(buildExamResultMail({ ...base, passed: false, en: true }).subject).toBe('Scorer exam — KSC Wiedikon')
    expect(buildExamResultMail({ ...base, passed: false }).html).toContain('nicht bestanden erfasst')
  })

  // On a fail no licence is coming; printing the number reads like one is on its way.
  it('shows the licence number only on a pass', () => {
    expect(buildExamResultMail({ ...base, passed: true }).html).toContain('337646')
    expect(buildExamResultMail({ ...base, passed: false }).html).not.toContain('337646')
  })

  // ⚠ Regression guard. The 1.11.0 exam-passed mail rendered its body paragraph with no
  // colour on buildEmailLayout's dark navy card — near-black on navy, unreadable. Caught
  // only by rendering the template. Every body paragraph must carry an explicit colour.
  it('gives every body paragraph an explicit colour', () => {
    const html = buildExamResultMail({ ...base, passed: true, hasAttachment: true, note: 'x' }).html
    const bodyParas = html.match(/<p style="[^"]*margin:0 0 12px[^"]*"/g) || []
    expect(bodyParas.length).toBeGreaterThan(0)
    for (const p of bodyParas) expect(p, `paragraph without a colour: ${p}`).toContain('color:')
  })

  it('only mentions an attachment when one is actually going out', () => {
    expect(buildExamResultMail({ ...base, passed: false, hasAttachment: true }).html).toContain('im Anhang')
    expect(buildExamResultMail({ ...base, passed: false, hasAttachment: true }).text).toContain('im Anhang')
    expect(buildExamResultMail({ ...base, passed: false, hasAttachment: false }).html).not.toContain('Anhang')
    expect(buildExamResultMail({ ...base, passed: false, hasAttachment: false }).text).not.toContain('Anhang')
  })

  // Admin-authored today — but that is a property of the callers, not of this function.
  it('escapes HTML in the note instead of rendering it', () => {
    const html = buildExamResultMail({ ...base, passed: false, note: '<img src=x onerror=alert(1)>' }).html
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    // The only <img> in the mail is the layout's logo — the note must not add another.
    const withoutNote = buildExamResultMail({ ...base, passed: false }).html
    expect((html.match(/<img/g) || []).length).toBe((withoutNote.match(/<img/g) || []).length)
  })

  it('renders a multi-paragraph note as separate paragraphs', () => {
    const html = buildExamResultMail({ ...base, passed: false, note: 'first\n\nsecond' }).html
    expect(html).toContain('first')
    expect(html).toContain('second')
    expect(html).toContain('Anmerkung von KSC Wiedikon')
  })

  it('omits the note block entirely when there is no note', () => {
    expect(buildExamResultMail({ ...base, passed: true }).html).not.toContain('Anmerkung von KSC Wiedikon')
  })

  it('drops the greeting rather than greeting nobody', () => {
    expect(buildExamResultMail({ ...base, passed: true, firstName: '' }).html).not.toContain('Hallo ,')
  })
})

describe('member address lookup helpers', () => {
  // "Léo" on a signup and "Leo" in ClubDesk are the same person; a miss here becomes a
  // guessed town on the SVRZ list downstream.
  it('folds accents, case and punctuation when matching names', () => {
    expect(norm('Léo')).toBe(norm('Leo'))
    expect(norm('Zürich')).toBe('zurich')
    expect(norm('  Anna-Maria ')).toBe('anna maria')
    expect(norm('van Kleef')).toBe('van kleef')
    expect(norm(null)).toBe('')
  })

  // Swiss postcodes are 1000–9999. A real member record carries "0849", which is a typo.
  it('rejects postcodes that are not Swiss', () => {
    expect(plausiblePlz('8055')).toBe(true)
    expect(plausiblePlz('1000')).toBe(true)
    expect(plausiblePlz('0849')).toBe(false) // the actual junk in the data
    expect(plausiblePlz('849')).toBe(false)
    expect(plausiblePlz('80555')).toBe(false)
    expect(plausiblePlz('')).toBe(false)
    expect(plausiblePlz(null)).toBe(false)
  })

  // A canton code on an official list is a wrong answer dressed as a right one — worse
  // than the blank it replaces.
  it('rejects a canton abbreviation where a town belongs', () => {
    expect(plausibleOrt('Zürich')).toBe(true)
    expect(plausibleOrt('Uitikon Waldegg')).toBe(true)
    expect(plausibleOrt('Zug')).toBe(true) // a real town that is also 3 letters
    expect(plausibleOrt('ZH')).toBe(false) // the actual junk in the data
    expect(plausibleOrt('BE')).toBe(false)
    expect(plausibleOrt('')).toBe(false)
    expect(plausibleOrt(null)).toBe(false)
  })
})
