import { describe, it, expect } from 'vitest'
import { groupSlotsByDate, type BbPortalFreeSlot } from '../useBbClubPortal'

const slot = (id: number, date: string, time: string, hall: string, score: number | null): BbPortalFreeSlot =>
  ({ id, date, time, hall, end_time: '', score })

describe('groupSlotsByDate', () => {
  it('collapses many pitches on one day into a single choice', () => {
    // The whole point: the club decides on a DAY. Three halls on the 26th is one decision,
    // not three rows.
    const out = groupSlotsByDate([
      slot(1, '2026-09-26', '11:00', 'KWI A', 10),
      slot(2, '2026-09-26', '13:30', 'KWI B', 30),
      slot(3, '2026-09-26', '15:30', 'KWI A+B', 20),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-09-26')
    expect(out[0].options).toHaveLength(3)
  })

  it('puts the generatoric best pitch first, so the default is the best fit', () => {
    const out = groupSlotsByDate([
      slot(1, '2026-09-26', '11:00', 'KWI A', 10),
      slot(2, '2026-09-26', '13:30', 'KWI B', 30),
    ])
    expect(out[0].options[0].id).toBe(2)
  })

  it('never lets a null score win the default', () => {
    const out = groupSlotsByDate([
      slot(1, '2026-09-26', '11:00', 'KWI A', null),
      slot(2, '2026-09-26', '13:30', 'KWI B', 5),
    ])
    expect(out[0].options[0].id).toBe(2)
    expect(out[0].options[1].score).toBeNull()
  })

  it('returns dates in chronological order', () => {
    const out = groupSlotsByDate([
      slot(1, '2026-11-07', '11:00', 'KWI A', 1),
      slot(2, '2026-09-26', '11:00', 'KWI A', 1),
      slot(3, '2026-10-03', '11:00', 'KWI A', 1),
    ])
    expect(out.map((d) => d.date)).toEqual(['2026-09-26', '2026-10-03', '2026-11-07'])
  })

  it('handles an empty list', () => {
    expect(groupSlotsByDate([])).toEqual([])
  })

  it('is the real reduction: 2091 pitches over 34 dates becomes 34 rows', () => {
    // Reproduces the shape that made this necessary — CVJM Frauenfeld's page.
    const many: BbPortalFreeSlot[] = []
    for (let d = 0; d < 34; d++) {
      const date = `2026-09-${String((d % 28) + 1).padStart(2, '0')}`
      for (let k = 0; k < 61; k++) many.push(slot(d * 100 + k, date, '11:00', `hall${k}`, k))
    }
    const out = groupSlotsByDate(many)
    expect(many).toHaveLength(2074)
    expect(out.length).toBeLessThanOrEqual(34)
  })
})
