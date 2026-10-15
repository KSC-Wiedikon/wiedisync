import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseSearchResult, parseResultCount, parseFormErrors } from '../hallenfinder/parse-result.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(here, 'fixtures', 'freieTermine-periodisch-di.html'), 'utf-8')
const rejected = readFileSync(join(here, 'fixtures', 'freieTermine-rejected-startdate.html'), 'utf-8')

test('parseResultCount reads the "N Treffer" checksum', () => {
  assert.equal(parseResultCount(html), 3)
})

test('parseSearchResult extracts every hall with all fields', () => {
  const { count, halls } = parseSearchResult(html)
  assert.equal(count, 3)
  assert.equal(halls.length, 3, 'halls.length must equal the Treffer count')

  const buhnrain = halls.find((h) => h.facilityId === '39')
  assert.ok(buhnrain, 'Gymnastikraum Buhnrain (39) present')
  assert.equal(buhnrain.name, 'Gymnastikraum Buhnrain')
  assert.equal(buhnrain.window, '18:00-22:00')
  assert.equal(buhnrain.cityDistrict, '11')
  assert.equal(buhnrain.cityQuarter, 'Seebach')
  assert.equal(buhnrain.schoolDistrict, 'Glattal')
  assert.equal(buhnrain.address, 'Buhnrain 40, 8052 Zürich')

  // Every hall must have a stable id, a name and a parsed Stadtkreis.
  for (const h of halls) {
    assert.match(h.facilityId, /^\d+$/)
    assert.ok(h.name && h.name.length > 0)
    assert.ok(h.cityDistrict, `${h.name} has a Stadtkreis`)
  }
})

test('parseSearchResult on an empty page yields count 0 / no halls', () => {
  const empty = '<html><body><h2>Suchergebnis: <span id="search_result_summary_message" class="total">0 Treffer</span></h2></body></html>'
  const { count, halls } = parseSearchResult(empty)
  assert.equal(count, 0)
  assert.equal(halls.length, 0)
})

test('parseResultCount treats the "keine Treffer" page as 0, not null', () => {
  const none = '<span id="search_result_summary_message" class="total">Ihre Suchanfrage ergab keine Treffer</span>'
  assert.equal(parseResultCount(none), 0)
  assert.equal(parseSearchResult(none).halls.length, 0)
})

// 25.08.–16.10.2026: every nightly run sent tag_ab=01.09.2026, the city refused
// it as fewer than 7 days ahead, and the scraper only ever logged "no result marker".
test('a rejected query has no result count, and parseFormErrors says why', () => {
  assert.equal(parseResultCount(rejected), null, 'a validation page must not read as "0 Treffer"')
  assert.equal(parseSearchResult(rejected).halls.length, 0)
  assert.deepEqual(parseFormErrors(rejected), [
    'Datum muss min. 7 Tage in der Zukunft liegen',
    'Bitte vervollständigen Sie die obligatorischen (*) Benutzerdaten.',
  ])
})

test('parseFormErrors is empty on a normal result page', () => {
  assert.deepEqual(parseFormErrors(html), [])
})
