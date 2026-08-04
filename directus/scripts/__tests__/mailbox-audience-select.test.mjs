import test from 'node:test'
import assert from 'node:assert/strict'
import {
  combineClauseSets,
  intersectSets,
  parseClauses,
  parseGroupKeys,
  parseList,
  splitSeason,
  unionSets,
} from '../../extensions/kscw-endpoints/src/mailbox-audience-select.js'

// These functions decide who a mass mail reaches. A mistake here is invisible
// in the result — a send to the wrong 300 people still reports success — so the
// cases below are the ones that would actually mis-address a message.

test('parseClauses: drill-down shape survives the multipart round-trip', () => {
  // Multipart fields are strings, so the array-of-arrays arrives JSON-encoded.
  const body = { clauses: JSON.stringify([['sektion:volleyball', 'fn:coach'], ['team:12']]) }
  assert.deepEqual(parseClauses(body), [['sektion:volleyball', 'fn:coach'], ['team:12']])
})

test('parseClauses: accepts a real array (JSON body, not multipart)', () => {
  assert.deepEqual(
    parseClauses({ clauses: [['a', 'b']] }),
    [['a', 'b']],
  )
})

test('parseClauses: flat groups become one-key clauses, preserving old unions', () => {
  // The compatibility contract: N flat keys must stay N independent audiences
  // OR'd together, never collapse into a single intersected clause (which
  // would silently shrink every previously-built selection).
  assert.deepEqual(
    parseClauses({ groups: JSON.stringify(['fn:coach', 'team:3']) }),
    [['fn:coach'], ['team:3']],
  )
})

test('parseClauses: single legacy `group` still works', () => {
  assert.deepEqual(parseClauses({ group: 'all' }), [['all']])
})

test('parseClauses: dedupes and trims within a clause', () => {
  assert.deepEqual(
    parseClauses({ clauses: [[' fn:coach ', 'fn:coach', '']] }),
    [['fn:coach']],
  )
})

test('parseClauses: drops empty clauses rather than emitting an empty AND', () => {
  // An empty clause would intersect to nothing and silently swallow the
  // selection; it must not reach the resolver at all.
  assert.deepEqual(parseClauses({ clauses: [[], ['team:1'], ['']] }), [['team:1']])
})

test('parseClauses: malformed JSON falls back to groups, not to a crash', () => {
  assert.deepEqual(parseClauses({ clauses: '{not json', groups: 'fn:coach' }), [['fn:coach']])
})

test('parseClauses: no selection yields no clauses', () => {
  assert.deepEqual(parseClauses({}), [])
  assert.deepEqual(parseClauses({ clauses: '' }), [])
})

test('intersectSets: narrows to the overlap', () => {
  // The volleyball-coaches case: section ∩ coaches.
  const section = new Set([1, 2, 3, 4])
  const coaches = new Set([3, 4, 5])
  assert.deepEqual([...intersectSets([section, coaches])].sort(), [3, 4])
})

test('intersectSets: a single set is returned unchanged', () => {
  assert.deepEqual([...intersectSets([new Set([7, 8])])].sort(), [7, 8])
})

test('intersectSets: no overlap means nobody', () => {
  assert.equal(intersectSets([new Set([1]), new Set([2])]).size, 0)
})

test('intersectSets: empty input is nobody, NOT everyone', () => {
  // The dangerous reading. A clause that resolved nothing must send to no one
  // rather than falling through to the whole club.
  assert.equal(intersectSets([]).size, 0)
  assert.equal(intersectSets(undefined).size, 0)
})

test('parseList: handles JSON, comma strings and arrays', () => {
  assert.deepEqual(parseList(JSON.stringify([1, 2])), ['1', '2'])
  assert.deepEqual(parseList('a,b'), ['a', 'b'])
  assert.deepEqual(parseList(['x']), ['x'])
  assert.deepEqual(parseList(''), [])
  assert.deepEqual(parseList(null), [])
})

test('parseGroupKeys: dedupes, trims and drops blanks', () => {
  assert.deepEqual(parseGroupKeys({ groups: ' a , a ,, b ' }), ['a', 'b'])
})

// ── Season is a modifier, not an audience ────────────────────────────────
// The distinction matters: as a set, "2025/26" AND "coaches" would mean
// current coaches who also appear on a 2025/26 roster. As a modifier it means
// the people who coached in 2025/26 — a different, larger, correct group.

test('splitSeason: lifts the season out and keeps the audiences', () => {
  const { season, keys, seasonScopable } = splitSeason(['season:2025/26', 'fn:coach'])
  assert.equal(season, '2025/26')
  assert.deepEqual(keys, ['fn:coach'])
  assert.equal(seasonScopable, true)
})

test('splitSeason: no season chip leaves the clause untouched', () => {
  const { season, keys } = splitSeason(['fn:coach', 'sektion:volleyball'])
  assert.equal(season, null)
  assert.deepEqual(keys, ['fn:coach', 'sektion:volleyball'])
})

test('splitSeason: sport and team keys are season-scopable', () => {
  assert.equal(splitSeason(['season:2025/26', 'sport:volleyball']).seasonScopable, true)
  assert.equal(splitSeason(['season:2025/26', 'team:12']).seasonScopable, true)
})

test('splitSeason: register-based audiences are NOT season-scopable', () => {
  // A section, a qualification or the whole register are not seasonal facts.
  // The endpoint rejects these rather than quietly ignoring the season and
  // returning a different audience than the chip claims.
  for (const key of ['sektion:volleyball', 'qual:scorer_vb', 'all', 'former_members']) {
    assert.equal(splitSeason(['season:2025/26', key]).seasonScopable, false, key)
  }
})

test('splitSeason: a season with nothing to scope leaves no keys', () => {
  const { season, keys, seasonScopable } = splitSeason(['season:2025/26'])
  assert.equal(season, '2025/26')
  assert.deepEqual(keys, [])
  assert.equal(seasonScopable, false)
})

test('splitSeason: a blank season value is treated as absent', () => {
  assert.equal(splitSeason(['season:', 'fn:coach']).season, null)
})

test('splitSeason: season survives parseClauses end to end', () => {
  const body = { clauses: JSON.stringify([['season:2025/26', 'sport:volleyball']]) }
  const [clause] = parseClauses(body)
  assert.deepEqual(splitSeason(clause), {
    season: '2025/26',
    keys: ['sport:volleyball'],
    seasonScopable: true,
  })
})

// ── combineClauseSets: OR within a section, AND across sections ──────────────
// The rule that decides whether clicking two chips widens or empties a send.

test('unionSets: merges, dedupes, and empty input is nobody', () => {
  assert.deepEqual([...unionSets([new Set([1, 2]), new Set([2, 3])])].sort(), [1, 2, 3])
  assert.equal(unionSets([]).size, 0)
  assert.equal(unionSets(undefined).size, 0)
})

test('two chips in the SAME section union — D1 + D2 is both rosters, not neither', () => {
  // The regression this rule exists for: under the old intersect-everything
  // reading this returned 0 people while the operator had just picked 39.
  const out = combineClauseSets([
    { section: 'teams', set: new Set([1, 2, 3]) },
    { section: 'teams', set: new Set([4, 5]) },
  ])
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5])
})

test('two chips in DIFFERENT sections intersect — volleyball ▸ coaches stays a narrowing', () => {
  const out = combineClauseSets([
    { section: 'sektion', set: new Set([1, 2, 3, 4]) },
    { section: 'roles', set: new Set([3, 4, 5]) },
  ])
  assert.deepEqual([...out].sort(), [3, 4])
})

test('mixed: sections OR inside, then AND across', () => {
  // "(D1 or D2) and volleyball" — 5 is on D2 but is not volleyball.
  const out = combineClauseSets([
    { section: 'teams', set: new Set([1, 2]) },
    { section: 'teams', set: new Set([2, 5]) },
    { section: 'sektion', set: new Set([1, 2, 3]) },
  ])
  assert.deepEqual([...out].sort(), [1, 2])
})

test('mutually exclusive statuses union instead of cancelling out', () => {
  // Active ∧ Passive is empty by definition — shipping the membership
  // sub-chips under an AND rule would have made every pair send to nobody.
  const out = combineClauseSets([
    { section: 'everyone', set: new Set([1, 2]) },
    { section: 'everyone', set: new Set([3]) },
  ])
  assert.deepEqual([...out].sort(), [1, 2, 3])
})

test('a section that resolves to nobody empties the clause, it does not widen it', () => {
  const out = combineClauseSets([
    { section: 'teams', set: new Set([1, 2]) },
    { section: 'roles', set: new Set() },
  ])
  assert.equal(out.size, 0)
})

test('empty input is nobody, NOT everyone', () => {
  assert.equal(combineClauseSets([]).size, 0)
  assert.equal(combineClauseSets(undefined).size, 0)
})

test('a section-less entry still ANDs rather than silently widening', () => {
  // Defensive: an unclassified key must not land in the same bucket as a real
  // section and union itself into the audience.
  const out = combineClauseSets([
    { section: 'teams', set: new Set([1, 2, 3]) },
    { set: new Set([3, 9]) },
  ])
  assert.deepEqual([...out], [3])
})

test('one chip alone resolves to exactly itself', () => {
  const out = combineClauseSets([{ section: 'roles', set: new Set([7, 8]) }])
  assert.deepEqual([...out].sort(), [7, 8])
})

test('re-adding a chip already in the draft is idempotent', () => {
  // group-counts computes "draft + this chip" for every chip, including ones
  // already picked; that must report the current total, not double anything.
  const d1 = { section: 'teams', set: new Set([1, 2]) }
  assert.deepEqual([...combineClauseSets([d1, d1])].sort(), [1, 2])
})
