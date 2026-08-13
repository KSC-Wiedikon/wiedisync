/**
 * The VIS name-matching cascade and the hand-set link contract.
 *
 * Every case here is a real one that cost a debugging session, or a loosening
 * that was deliberately refused. The rules are cheap to relax by accident and
 * expensive to get wrong: `in_vis` is read as evidence that a transfer can be
 * requested for a person at all.
 *
 * ⚠ These helpers are MIRRORED in `kscw-endpoints/src/vis-player-check.js`
 * (which cannot be imported here — separate deploy unit, CLAUDE.md §4). This
 * file therefore covers the endpoint's copy only by proxy: a drift there is
 * invisible to CI, so change both in the same commit.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildRosterIndex, matchMember } from '../vis-player-check.mjs'

const player = (no, firstName, lastName) => ({ no, person: { firstName, lastName } })

/** A stand-in federation index with the real shapes that have bitten us. */
const GER = buildRosterIndex([
  player(243595, 'Lars', 'Bambusch'),
  // The 2026-08-13 case: the member goes by her SECOND given name.
  player(243602, 'Dorothea Christiane', 'Clüver'),
  player(215744, 'Kacper Jan', 'Krawczyński'),
  // Two different people who share a surname — the reason a surname-only
  // fallback was refused.
  player(300001, 'Stefan', 'Imhof'),
  player(300002, 'Linda Marie', 'Imhof'),
])

const ARG = buildRosterIndex([
  // Same three tokens as the member, split the other way across first/last.
  player(243491, 'Paula', 'Fiorella Farina'),
])

const m = (fn, ln, manual = null) => ({ fn, ln, manual })

test('exact last|first still wins', () => {
  assert.equal(matchMember(m('Lars', 'Bambusch'), GER).no, 243595)
})

test('accents and punctuation do not block an exact match', () => {
  assert.equal(matchMember(m('Kacper', 'Krawczynski'), GER).no, 215744)
})

test('an equal token bag matches across a different first/last split', () => {
  assert.equal(matchMember(m('Paula Fiorella', 'Farina'), ARG).no, 243491)
})

test('a member known by a LATER given name matches (Clüver, #243602)', () => {
  // The case this file was written for: exact misses, the token bag is a strict
  // subset (VIS carries "Dorothea" too), and the prefix fallback only walks the
  // front of the given names.
  assert.equal(matchMember(m('Christiane', 'Clüver'), GER).no, 243602)
})

test('a subset match must be unique — a shared surname is never enough', () => {
  // "Imhof" alone matches two people; neither is a subset hit, and the surname
  // must never carry the match on its own.
  assert.equal(matchMember(m('Andrea', 'Imhof'), GER).no, null)
})

test('a first name that is a given name of a DIFFERENT person does not match', () => {
  // "Stefan Imhof" and "Linda Marie Imhof" are two people. A member called
  // "Marie Imhof" is a subset of exactly one of them — which is the rule — but
  // "Imhof" with an unrelated first name must stay unmatched.
  assert.equal(matchMember(m('Marie', 'Imhof'), GER).no, 300002)
  assert.equal(matchMember(m('Sabine', 'Imhof'), GER).no, null)
})

test('a surname must sit on the SURNAME, not inside a given name', () => {
  // Every token present, but "Christiane" as the surname is a different claim.
  assert.equal(matchMember(m('Dorothea', 'Christiane'), GER).no, null)
})

test('an unknown person stays unmatched', () => {
  assert.equal(matchMember(m('Jane', 'Doe'), GER).no, null)
})

// ── The hand-set link (migration 312) ────────────────────────────────────────

test('a CONFIRMED manual link overrides name matching', () => {
  // Deliberately a member whose name resolves to somebody else: the human's
  // decision is the more reliable one, which is the whole point of the column.
  const r = matchMember(m('Stefan', 'Imhof', 243602), GER)
  assert.equal(r.no, 243602)
  assert.equal(r.manualName, 'Dorothea Christiane Clüver')
})

test('an UNCONFIRMED manual link asserts nothing', () => {
  // A typo'd number must never read as "this player is in VIS": in_vis is
  // eligibility evidence. The name match (none here) is what stands.
  const r = matchMember(m('Jane', 'Doe', 999999), GER)
  assert.equal(r.no, null)
  assert.equal(r.manualName, null)
})

test('an unconfirmed manual link does not destroy a good name match', () => {
  const r = matchMember(m('Lars', 'Bambusch', 999999), GER)
  assert.equal(r.no, 243595)
  assert.equal(r.manualName, null)
})

test('no manual link leaves manualName null', () => {
  assert.equal(matchMember(m('Lars', 'Bambusch'), GER).manualName, null)
})

test('the index records VIS spelling verbatim, accents and all', () => {
  assert.equal(GER.byNo.get(243602), 'Dorothea Christiane Clüver')
})
