/**
 * Unit tests for registration ↔ member duplicate detection.
 *
 * Exists because the public registration form shipped with NO identity check
 * at all, and five of the first 36 prod registrations were filed by people who
 * were already members — REG-2026-7074 (Oskar Fassbind) arrived with the exact
 * same email as member #195.
 *
 * The rule has to hold two opposite lines at once, which is what these tests
 * pin down:
 *   - it must BLOCK an active member re-registering as themselves, and
 *   - it must NEVER block a family sharing one mailbox, which is a legitimate,
 *     verified-on-prod arrangement (the Chatzichrisafis siblings; the Clüver
 *     parent/child pair). `members.email` has no unique index precisely so
 *     those rows can exist.
 *
 * Hermetic — the knex stand-in below answers from an in-memory member table.
 */
import { describe, it, expect } from 'vitest'
import {
  findDuplicateCandidates, findDuplicateCandidatesBatch, findBlockingMember,
  firstNamesMatch, firstNamesEqual, nameKey,
  buildMergeDiff, buildMergePatch, mapLicences, normalizeSex,
} from '../registration-duplicates.js'

// Shapes taken from prod rows (emails/phones altered).
const MEMBERS = [
  { id: 195, first_name: 'Oskar', last_name: 'Fassbind', email: 'oskar.fassbind2@gmail.com', phone: '+41 76 824 60 21', birthdate: '2009-02-01', kscw_membership_active: true },
  { id: 719, first_name: 'Anaïs', last_name: 'Ramp', email: 'anflura@gmx.ch', phone: '+41 79 111 22 33', birthdate: '2001-05-14', kscw_membership_active: false },
  { id: 165, first_name: 'Ion', last_name: 'Chatzichrisafis', email: 'nikos.chatzichrisafis@gmail.com', phone: null, birthdate: '2010-03-02', kscw_membership_active: true },
  { id: 553, first_name: 'Jason', last_name: 'Chatzichrisafis', email: 'nikos.chatzichrisafis@gmail.com', phone: null, birthdate: '2012-09-19', kscw_membership_active: true },
  { id: 34, first_name: 'Christiane', last_name: 'Clüver', email: 'jannileinchen@web.de', phone: null, birthdate: '1979-01-30', kscw_membership_active: true },
  { id: 471, first_name: 'Paula', last_name: 'Gadola', email: 'pg@paulagadola.ch', phone: null, birthdate: null, kscw_membership_active: true },
  // Prefix-sibling pair on ONE family mailbox — "Dani" is the member, "Daniela"
  // is her sister and has never registered. The reason the blocking tier uses
  // exact first-name equality instead of the prefix rule.
  { id: 601, first_name: 'Dani', last_name: 'Meier', email: 'familie.meier@bluewin.ch', phone: null, birthdate: '2006-03-11', kscw_membership_active: true },
]

/** Knex stand-in: supports exactly the four probes the module builds. */
function fakeDb(rows = MEMBERS) {
  return (table) => {
    if (table === 'country_name_aliases') {
      return { where: () => ({ first: async () => null }) }
    }
    let pred = () => false
    const q = {
      whereRaw(sql, [v]) {
        pred = sql.includes('LOWER(email)')
          ? (m) => String(m.email || '').toLowerCase() === v
          : (m) => String(m.last_name || '').toLowerCase() === v
        return q
      },
      where(col, v) {
        pred = col === 'birthdate'
          ? (m) => String(m.birthdate || '').slice(0, 10) === v
          : (m) => String(m[col] || '') === v
        return q
      },
      select: () => q,
      then: (res, rej) => Promise.resolve(rows.filter(pred)).then(res, rej),
    }
    return q
  }
}

const db = fakeDb()

describe('nameKey', () => {
  it('folds accents so a form retyped without them still matches', () => {
    expect(nameKey('Clüver')).toBe(nameKey('Cluver'))
    expect(nameKey('Månsson')).toBe(nameKey('Mansson'))
    expect(nameKey('Anaïs')).toBe(nameKey('Anais'))
  })

  it('collapses punctuation and whitespace', () => {
    expect(nameKey('  Azevedo   Pereira ')).toBe('azevedo pereira')
    expect(nameKey("O'Brien-Smith")).toBe('o brien smith')
  })
})

describe('firstNamesMatch', () => {
  it('treats a nickname as the same person (symmetric prefix)', () => {
    expect(firstNamesMatch('Dani', 'Daniel', true)).toBe(true)
    expect(firstNamesMatch('Daniel', 'Dani', true)).toBe(true)
  })

  it('does not merge unrelated names', () => {
    expect(firstNamesMatch('Anna', 'Luca', true)).toBe(false)
  })

  // The linking path wants missing data to pass (legacy nameless rows still
  // link); the blocking path must not, or an empty member name would refuse a
  // stranger's submission.
  it('splits on missing data: strict refuses, lenient allows', () => {
    expect(firstNamesMatch('', 'Oskar', true)).toBe(false)
    expect(firstNamesMatch('', 'Oskar', false)).toBe(true)
  })
})

describe('firstNamesEqual (the blocking rule)', () => {
  it('folds case and accents but does NOT accept a prefix', () => {
    expect(firstNamesEqual('Anaïs', 'anais')).toBe(true)
    expect(firstNamesEqual('Dani', 'Daniela')).toBe(false)
    expect(firstNamesEqual('Luca', 'Lucas')).toBe(false)
  })

  it('never matches on missing data', () => {
    expect(firstNamesEqual('', 'Oskar')).toBe(false)
    expect(firstNamesEqual('Oskar', null)).toBe(false)
  })
})

describe('findDuplicateCandidates — blocking', () => {
  it('blocks an ACTIVE member re-registering as themselves', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Oskar', nachname: 'Fassbind', email: 'oskar.fassbind2@gmail.com', geburtsdatum: '2009-02-01',
    })
    expect(r.level).toBe('blocked')
    expect(r.candidates[0]).toMatchObject({ id: 195, match: 'exact' })
  })

  it('is case- and accent-insensitive about the name', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'oskar', nachname: 'FASSBIND', email: 'Oskar.Fassbind2@GMAIL.com',
    })
    expect(r.level).toBe('blocked')
  })

  it('findBlockingMember returns the member only for the blocked level', async () => {
    expect(await findBlockingMember(db, { vorname: 'Oskar', nachname: 'Fassbind', email: 'oskar.fassbind2@gmail.com' }))
      .toMatchObject({ id: 195 })
    // Same person, former member → let through and flagged, never blocked.
    expect(await findBlockingMember(db, { vorname: 'Anaïs', nachname: 'Ramp', email: 'anflura@gmx.ch' }))
      .toBeNull()
  })
})

describe('findDuplicateCandidates — must NOT block', () => {
  // The whole reason members.email carries no unique index.
  it('lets a sibling register on the shared family mailbox', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Eleni', nachname: 'Chatzichrisafis', email: 'nikos.chatzichrisafis@gmail.com', geburtsdatum: '2014-07-07',
    })
    expect(r.level).toBe('none')
  })

  it("lets a child register on a parent's mailbox", async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Marie', nachname: 'Clüver', email: 'jannileinchen@web.de', geburtsdatum: '2011-06-08',
    })
    expect(r.level).toBe('none')
  })

  // Regression: the prefix rule would call this the same person and 409 her.
  it('lets a PREFIX-named sibling register on the shared family mailbox', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Daniela', nachname: 'Meier', email: 'familie.meier@bluewin.ch', geburtsdatum: '2009-08-02',
    })
    expect(r.level).not.toBe('blocked')
    expect(await findBlockingMember(db, {
      vorname: 'Daniela', nachname: 'Meier', email: 'familie.meier@bluewin.ch',
    })).toBeNull()
  })

  it('ignores a shared surname alone', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Ferdinand', nachname: 'Fassbind', email: 'ferdi@example.com', geburtsdatum: '1974-06-03',
    })
    expect(r.level).toBe('none')
  })

  it('does not flag a genuine newcomer', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Mia', nachname: 'Zurbriggen', email: 'mia.z@example.com', geburtsdatum: '2004-11-11',
    })
    expect(r.level).toBe('none')
  })
})

describe('findDuplicateCandidates — soft tiers', () => {
  // The case the admin merge exists for: same person, new address.
  it('flags (not blocks) the same person under a different email', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Oskar', nachname: 'Fassbind', email: 'oskar.f.privat@gmail.com', geburtsdatum: '2009-02-01',
    })
    expect(r.level).toBe('possible')
    expect(r.candidates[0]).toMatchObject({ id: 195, match: 'name_dob' })
  })

  it('flags a returning former member as `returning`, not `blocked`', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Anaïs', nachname: 'Ramp', email: 'anflura@gmx.ch', geburtsdatum: '2001-05-14',
    })
    expect(r.level).toBe('returning')
    expect(r.candidates[0]).toMatchObject({ id: 719, match: 'exact', kscw_membership_active: false })
  })

  it('catches a first-name spelling drift via surname + birthdate', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Oscar', nachname: 'Fassbind', email: 'oscar.f@example.com', geburtsdatum: '2009-02-01',
    })
    expect(r.level).toBe('possible')
    expect(r.candidates[0].match).toBe('surname_dob')
  })

  it('matches on a normalized phone number when the email changed', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'O.', nachname: 'Fassbind', email: 'new@example.com', telefon_mobil: '076 824 60 21',
    })
    expect(r.candidates.some((c) => c.id === 195)).toBe(true)
  })

  // Ranking: candidates[0] is what the list badge names, so an email-bearing
  // match must outrank a surname+birthdate one.
  it('ranks an email + surname + birthdate match above surname + birthdate', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Oscar', nachname: 'Fassbind', email: 'oskar.fassbind2@gmail.com', geburtsdatum: '2009-02-01',
    })
    expect(r.candidates[0]).toMatchObject({ id: 195, match: 'name_dob' })
  })

  it('ignores an unparseable phone instead of probing with the raw string', async () => {
    const r = await findDuplicateCandidates(db, {
      vorname: 'Nobody', nachname: 'Unrelated', email: 'nobody@example.com', telefon_mobil: 'call me maybe',
    })
    expect(r.level).toBe('none')
  })

  // An approved row is linked to its member; without the exclusion it would
  // flag itself as a duplicate of itself, forever.
  it('excludes the member the registration is already linked to', async () => {
    const r = await findDuplicateCandidates(
      db,
      { vorname: 'Oskar', nachname: 'Fassbind', email: 'oskar.fassbind2@gmail.com' },
      { excludeMemberId: 195 },
    )
    expect(r.level).toBe('none')
  })
})

describe('findDuplicateCandidatesBatch', () => {
  // The batch classifies every registration against ONE preloaded member set,
  // so it has to agree with the per-row path exactly — a superset of rows must
  // not widen anyone's candidate list.
  function batchDb(rows = MEMBERS) {
    return (table) => {
      let pred = () => false
      const q = {
        whereRaw(sql, [vals]) {
          pred = sql.includes('LOWER(email)')
            ? (m) => vals.includes(String(m.email || '').toLowerCase())
            : (m) => vals.includes(String(m.last_name || '').toLowerCase())
          return q
        },
        whereIn(col, vals) {
          pred = col === 'birthdate'
            ? (m) => vals.includes(String(m.birthdate || '').slice(0, 10))
            : (m) => vals.includes(String(m[col] || ''))
          return q
        },
        select: () => q,
        then: (res, rej) => Promise.resolve(rows.filter(pred)).then(res, rej),
      }
      return q
    }
  }

  const REGS = [
    { id: 1, vorname: 'Oskar', nachname: 'Fassbind', email: 'oskar.fassbind2@gmail.com', geburtsdatum: '2009-02-01', member: null },
    { id: 2, vorname: 'Anaïs', nachname: 'Ramp', email: 'anflura@gmx.ch', geburtsdatum: '2001-05-14', member: null },
    { id: 3, vorname: 'Mia', nachname: 'Zurbriggen', email: 'mia.z@example.com', geburtsdatum: '2004-11-11', member: null },
    { id: 4, vorname: 'Daniela', nachname: 'Meier', email: 'familie.meier@bluewin.ch', geburtsdatum: '2009-08-02', member: null },
  ]

  it('agrees with the per-row path for every registration', async () => {
    const batch = await findDuplicateCandidatesBatch(batchDb(), REGS)
    for (const reg of REGS) {
      const single = await findDuplicateCandidates(db, reg, { excludeMemberId: reg.member })
      expect(batch.get(reg.id).level).toBe(single.level)
      expect(batch.get(reg.id).candidates.map((c) => c.id)).toEqual(single.candidates.map((c) => c.id))
    }
  })

  it('still excludes each row\'s own link', async () => {
    const batch = await findDuplicateCandidatesBatch(batchDb(), [{ ...REGS[0], member: 195 }])
    expect(batch.get(1).level).toBe('none')
  })

  it('returns an entry for every registration, flagged or not', async () => {
    const batch = await findDuplicateCandidatesBatch(batchDb(), REGS)
    expect([...batch.keys()].sort()).toEqual([1, 2, 3, 4])
    expect(batch.get(3).level).toBe('none')
  })
})

describe('merge diff + patch', () => {
  const member = {
    id: 195, first_name: 'Oskar', last_name: 'Fassbind', email: 'oskar.fassbind2@gmail.com',
    phone: '+41 76 824 60 21', adresse: null, plz: null, ort: null, birthdate: '2009-02-01',
    nationalitaet_codes: 'CH', federation_of_origin: null, sex: 'm', anrede: null,
    ahv_nummer: null, iban: null, beitragskategorie: null, scorer_vb: false, referee_vb: false,
  }
  const reg = {
    vorname: 'Oskar', nachname: 'Fassbind', email: 'oskar.fassbind2@gmail.com',
    telefon_mobil: '+41 79 444 55 66', adresse: 'Birmensdorferstrasse 12', plz: '8003', ort: 'Zürich',
    geburtsdatum: '2009-02-01', nationalitaet_codes: 'CH', federation_of_origin: 'NONE',
    geschlecht: 'm', anrede: 'Herr', ahv_nummer: '756.1234.5678.97', iban: 'CH9300762011623852957',
    beitragskategorie: 'Schüler', lizenz: 'Schreiber', membership_type: 'volleyball',
  }

  it('marks gap-fills and overwrites differently', async () => {
    const diff = await buildMergeDiff(db, reg, member)
    const by = Object.fromEntries(diff.map((d) => [d.key, d]))
    expect(by.adresse).toMatchObject({ differs: true, member_empty: true })
    expect(by.phone).toMatchObject({ differs: true, member_empty: false })
    expect(by.birthdate).toMatchObject({ differs: false })
  })

  it('never proposes clearing a member column from a blank form field', async () => {
    const diff = await buildMergeDiff(db, { ...reg, adresse: null, iban: '' }, member)
    expect(diff.find((d) => d.key === 'adresse')).toBeUndefined()
    expect(diff.find((d) => d.key === 'iban')).toBeUndefined()
  })

  it('offers licences additively and never withdraws one', async () => {
    const diff = await buildMergeDiff(db, reg, member)
    expect(diff.find((d) => d.key === 'scorer_vb')).toMatchObject({ kind: 'licence', registration_value: 'yes' })
    // Already held → nothing to offer.
    const held = await buildMergeDiff(db, reg, { ...member, scorer_vb: true })
    expect(held.find((d) => d.key === 'scorer_vb')).toBeUndefined()
  })

  it('writes only the ticked, actually-differing fields', async () => {
    const diff = await buildMergeDiff(db, reg, member)
    const patch = buildMergePatch(diff, ['adresse', 'birthdate', 'scorer_vb', 'first_name'])
    expect(patch).toEqual({ adresse: 'Birmensdorferstrasse 12', scorer_vb: true })
  })

  it('ignores keys the diff never offered — the client sends keys, not values', async () => {
    const diff = await buildMergeDiff(db, reg, member)
    expect(buildMergePatch(diff, ['role', 'kscw_membership_active', 'id'])).toEqual({})
  })

  it('stamps iban_confirmed when the IBAN is applied', async () => {
    const diff = await buildMergeDiff(db, reg, member)
    expect(buildMergePatch(diff, ['iban'])).toEqual({ iban: 'CH9300762011623852957', iban_confirmed: true })
  })
})

describe('mirrored transforms (kscw-hooks parity)', () => {
  it('maps licence free text per sport', () => {
    expect(mapLicences('Schreiber, Schiedsrichter', 'volleyball')).toEqual(['scorer_vb', 'referee_vb'])
    expect(mapLicences('OTR 1', 'basketball')).toEqual(['otr1_bb'])
    // A level-less OTN asserts nothing — the club cannot back the claim.
    expect(mapLicences('OTN', 'basketball')).toEqual([])
    expect(mapLicences('', 'volleyball')).toEqual([])
  })

  it('normalizes sex, and drops anything it cannot read', () => {
    expect(normalizeSex('männlich')).toBe('m')
    expect(normalizeSex('Female')).toBe('f')
    expect(normalizeSex('divers')).toBeNull()
    expect(normalizeSex(null)).toBeNull()
  })
})
