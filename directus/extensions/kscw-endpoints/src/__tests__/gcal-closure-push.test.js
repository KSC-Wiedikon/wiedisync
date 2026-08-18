import { describe, it, expect } from 'vitest'
import { closureKey, findDuplicate } from '../gcal-push.js'

describe('closureKey — one calendar event per closure GROUP', () => {
  // A KWI closure is three rows (hall A/B/C). Keying on the row id would put
  // three identical entries on the hall administration's calendar.
  it('is identical for every hall of the same span+reason', () => {
    const a = closureKey('2026-12-13', '2026-12-13', 'VB U20 Tournament')
    const b = closureKey('2026-12-13', '2026-12-13', 'VB U20 Tournament')
    expect(a).toBe(b)
  })

  // The edit path deletes and recreates rows, so a row-id key would orphan the
  // old event and create a second one on every save.
  it('survives a re-save because it never sees a row id', () => {
    expect(closureKey('2027-03-07', '2027-03-07', 'VB U20 Tournament'))
      .toBe(closureKey('2027-03-07', '2027-03-07', 'VB U20 Tournament'))
  })

  it('ignores casing and surrounding whitespace in the reason', () => {
    expect(closureKey('2027-03-07', '2027-03-07', '  vb u20 tournament '))
      .toBe(closureKey('2027-03-07', '2027-03-07', 'VB U20 Tournament'))
  })

  it.each([
    ['2026-12-13', '2026-12-13', 'VB U20 Tournament', '2026-12-14', '2026-12-14', 'VB U20 Tournament'],
    ['2026-12-13', '2026-12-13', 'VB U20 Tournament', '2026-12-13', '2026-12-14', 'VB U20 Tournament'],
    ['2026-12-13', '2026-12-13', 'VB U20 Tournament', '2026-12-13', '2026-12-13', 'BB Mini-Turnier'],
  ])('differs when the span or the reason differs', (s1, e1, r1, s2, e2, r2) => {
    expect(closureKey(s1, e1, r1)).not.toBe(closureKey(s2, e2, r2))
  })
})

describe('findDuplicate — never push what they already have', () => {
  const theirs = [
    { date: '2026-11-27', end_date: '2026-11-29', title: 'Halle geschlossen' },
    { date: '2027-04-17', end_date: '2027-04-18', title: 'Miniturnier KSCW' },
    { date: '2026-10-30', end_date: '2026-10-30', title: 'Halle Geschlossen' },
  ]

  // The two real cases from 2026-08-18: the BB mini tournament IS on their
  // calendar, both U20 tournament dates are not.
  it('suppresses the BB mini tournament — they entered it themselves', () => {
    expect(findDuplicate(theirs, '2027-04-17', '2027-04-18')?.title).toBe('Miniturnier KSCW')
  })

  it('lets both U20 tournament dates through — genuinely missing', () => {
    expect(findDuplicate(theirs, '2026-12-13', '2026-12-13')).toBeNull()
    expect(findDuplicate(theirs, '2027-03-07', '2027-03-07')).toBeNull()
  })

  // Overlap, not equality: their 27.–29.11 span covers our single 27.11 block.
  it('counts a partial overlap as covered', () => {
    expect(findDuplicate(theirs, '2026-11-27', '2026-11-27')?.title).toBe('Halle geschlossen')
    expect(findDuplicate(theirs, '2026-11-29', '2026-12-02')?.title).toBe('Halle geschlossen')
  })

  it('does not match a span that merely touches the edges', () => {
    expect(findDuplicate(theirs, '2026-11-25', '2026-11-26')).toBeNull()
    expect(findDuplicate(theirs, '2026-11-30', '2026-12-01')).toBeNull()
  })

  // A single-day entry stores end_date = date, but a pre-325 row could be null.
  it('treats a null end_date as a single day rather than an open range', () => {
    const rows = [{ date: '2026-10-30', end_date: null, title: 'Halle Geschlossen' }]
    expect(findDuplicate(rows, '2026-10-30', '2026-10-30')?.title).toBe('Halle Geschlossen')
    expect(findDuplicate(rows, '2026-11-05', '2026-11-05')).toBeNull()
  })

  it('is empty-safe', () => {
    expect(findDuplicate([], '2026-12-13', '2026-12-13')).toBeNull()
  })
})
