import test from 'node:test'
import assert from 'node:assert/strict'
import {
  intersectSets,
  parseClauses,
  parseGroupKeys,
  parseList,
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
