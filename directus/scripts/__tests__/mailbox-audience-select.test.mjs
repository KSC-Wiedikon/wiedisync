import test from 'node:test'
import assert from 'node:assert/strict'
import {
  intersectSets,
  parseClauses,
  parseGroupKeys,
  parseList,
  splitSeason,
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
