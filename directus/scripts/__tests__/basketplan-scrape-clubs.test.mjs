import test from 'node:test'
import assert from 'node:assert/strict'
import { pickSchedulingContact, nameKey, lit } from '../basketplan-scrape-clubs.mjs'

// The scraper's page selectors are UNVERIFIED (Basketplan's club pages are
// session-gated and could not be read in this session). What CAN be tested is
// the decision the script makes once a page has been parsed — and that decision
// is the dangerous one: picking the wrong «Klub Funktionäre» row emails a
// stranger at another club a scheduling link for games that are not theirs.

const ROW = (role, name, emails, extra = {}) => ({ role, name, emails, personId: null, phone: null, ...extra })

test('pickSchedulingContact: prefers the Spielplan functionary', () => {
  const rows = [
    ROW('Präsident', 'Muster Hans', ['praesi@example.ch']),
    ROW('Spielplan', 'Gönültas Ekrem', ['spielplan@example.ch', 'zweit@example.ch']),
    ROW('Kassier', 'Meier Anna', ['kasse@example.ch']),
  ]
  const hit = pickSchedulingContact(rows)
  assert.equal(hit.name, 'Gönültas Ekrem')
  assert.deepEqual(hit.emails, ['spielplan@example.ch', 'zweit@example.ch'])
})

test('pickSchedulingContact: matches the role label case-insensitively and as a substring', () => {
  // Basketplan spells roles inconsistently across clubs and locales.
  for (const role of ['Spielplan', 'spielplanung', 'Verantwortlicher Spielplan', 'SPIELPLAN / Technik']) {
    assert.ok(pickSchedulingContact([ROW(role, 'X', ['a@b.ch'])]), `should match ${role}`)
  }
})

test('pickSchedulingContact: falls back down the preference ladder, never sideways', () => {
  const rows = [
    ROW('Kassier', 'Kasse', ['kasse@example.ch']),
    ROW('Sekretariat', 'Sek', ['sek@example.ch']),
    ROW('Präsident', 'Presi', ['presi@example.ch']),
  ]
  // Sekretariat outranks Präsident; Kassier is not in the ladder at all.
  assert.equal(pickSchedulingContact(rows).name, 'Sek')
})

test('pickSchedulingContact: returns null rather than guessing when no role matches', () => {
  // The whole point: a club with no scheduling functionary must surface as
  // "unknown" so a human fills it in — never as "the first person on the page".
  const rows = [ROW('Kassier', 'Kasse', ['kasse@example.ch']), ROW('Materialwart', 'M', ['m@example.ch'])]
  assert.equal(pickSchedulingContact(rows), null)
})

test('pickSchedulingContact: ignores rows without an email — they are unusable for the send path', () => {
  const rows = [ROW('Spielplan', 'Ohne Mail', []), ROW('Sekretariat', 'Mit Mail', ['s@example.ch'])]
  assert.equal(pickSchedulingContact(rows).name, 'Mit Mail')
})

test('pickSchedulingContact: tolerates junk input', () => {
  assert.equal(pickSchedulingContact(null), null)
  assert.equal(pickSchedulingContact([]), null)
  assert.equal(pickSchedulingContact([null, undefined]), null)
})

test('nameKey: matches the lower(btrim(name)) unique index on basketplan_clubs', () => {
  // The ProBasket workbook ships names with trailing spaces ('BS Kriens ').
  assert.equal(nameKey('BS Kriens '), nameKey('bs kriens'))
  assert.equal(nameKey('  BC  Zürich   93 '), 'bc zürich 93')
  assert.equal(nameKey(null), '')
})

test('lit: escapes quotes so a club name cannot break out of the SQL string', () => {
  assert.equal(lit("O'Connor Basket"), "'O''Connor Basket'")
  assert.equal(lit(''), 'NULL')
  assert.equal(lit(null), 'NULL')
})
