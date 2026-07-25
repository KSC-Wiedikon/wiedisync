import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHolidayRanges, isHoliday, splitCsvLine } from '../hallenfinder/schulferien.mjs'

const CSV = [
  'start_date,end_date,summary,created_date',
  '2026-10-05,2026-10-17,"Schulen Stadt Zürich: Herbstferien",2020-01-01',
  '2026-12-21,2027-01-04,"Schulen Stadt Zürich: Weihnachtsferien",2020-01-01',
  '2026-08-17,2026-08-18,"Schulen Stadt Zürich: 1. Schultag",2020-01-01', // excluded (school open)
  '2027-02-08,2027-02-15,"Schulen Stadt Zürich: Sportferien",2020-01-01',
].join('\n')

test('parseHolidayRanges keeps closures, drops admin rows, makes end inclusive', () => {
  const ranges = parseHolidayRanges(CSV)
  assert.equal(ranges.length, 3, '1. Schultag row excluded')
  const herbst = ranges.find((r) => r.summary.includes('Herbstferien'))
  assert.equal(herbst.start, '2026-10-05')
  assert.equal(herbst.end, '2026-10-16', 'end_date is exclusive → minus one day')
})

test('isHoliday membership is inclusive on both ends', () => {
  const ranges = parseHolidayRanges(CSV)
  assert.equal(isHoliday('2026-10-05', ranges), true)  // first day
  assert.equal(isHoliday('2026-10-16', ranges), true)  // last (inclusive) day
  assert.equal(isHoliday('2026-10-17', ranges), false) // exclusive end
  assert.equal(isHoliday('2026-11-03', ranges), false) // normal Tuesday
  assert.equal(isHoliday('2026-12-25', ranges), true)  // Weihnachten
})

test('splitCsvLine respects quoted commas', () => {
  assert.deepEqual(splitCsvLine('a,"b,c",d'), ['a', 'b,c', 'd'])
})
