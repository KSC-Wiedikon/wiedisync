import { describe, it, expect } from 'vitest'
import { hasTrainingEnded, hasGameEnded, hasEventEnded } from './dateHelpers'

// Zurich is UTC+2 on 24.10.2026 (CEST), UTC+1 from 25.10.2026 (CET).
const at = (iso: string) => new Date(iso).getTime()

describe('hasTrainingEnded', () => {
  const training = { date: '2026-10-24', start_time: '09:00:00', end_time: '11:00:00' }

  it('is upcoming before its end time and gone after it', () => {
    expect(hasTrainingEnded(at('2026-10-24T08:59:00Z'), training)).toBe(false) // 10:59 Zurich
    expect(hasTrainingEnded(at('2026-10-24T09:00:00Z'), training)).toBe(true) // 11:00 Zurich
  })

  it('stays during the session', () => {
    expect(hasTrainingEnded(at('2026-10-24T07:30:00Z'), training)).toBe(false) // 09:30 Zurich
  })

  it('reads an end before the start as past midnight', () => {
    const late = { date: '2026-10-24', start_time: '22:00', end_time: '00:30' }
    expect(hasTrainingEnded(at('2026-10-24T21:00:00Z'), late)).toBe(false) // 23:00 Zurich
    expect(hasTrainingEnded(at('2026-10-24T22:30:00Z'), late)).toBe(true) // 00:30 Zurich
  })

  it('without times lasts the whole day', () => {
    const allDay = { date: '2026-10-24', start_time: '', end_time: '' }
    expect(hasTrainingEnded(at('2026-10-24T20:00:00Z'), allDay)).toBe(false) // 22:00 Zurich
    expect(hasTrainingEnded(at('2026-10-24T22:00:00Z'), allDay)).toBe(true) // 00:00 Zurich, next day
  })

  it('handles a Postgres date with a time part', () => {
    expect(hasTrainingEnded(at('2026-10-24T09:00:00Z'), { ...training, date: '2026-10-24 00:00:00' })).toBe(true)
  })
})

describe('hasGameEnded', () => {
  const game = { date: '2026-10-24', time: '14:00:00' }

  it('stays for 2.5 h after kickoff', () => {
    expect(hasGameEnded(at('2026-10-24T14:29:00Z'), game)).toBe(false) // 16:29 Zurich
    expect(hasGameEnded(at('2026-10-24T14:30:00Z'), game)).toBe(true) // 16:30 Zurich
  })

  it('uses the winter offset after the DST switch', () => {
    const winter = { date: '2026-10-25', time: '14:00' }
    expect(hasGameEnded(at('2026-10-25T15:29:00Z'), winter)).toBe(false) // 16:29 Zurich (CET)
    expect(hasGameEnded(at('2026-10-25T15:30:00Z'), winter)).toBe(true)
  })

  it('never ends without a date', () => {
    expect(hasGameEnded(at('2030-01-01T00:00:00Z'), { date: null, time: '14:00' })).toBe(false)
  })
})

describe('hasEventEnded', () => {
  it('a timed event ends at its end instant', () => {
    const ev = { start_date: '2026-10-24T08:00:00Z', end_date: '2026-10-24T10:00:00Z', all_day: false }
    expect(hasEventEnded(at('2026-10-24T09:59:00Z'), ev)).toBe(false)
    expect(hasEventEnded(at('2026-10-24T10:00:00Z'), ev)).toBe(true)
  })

  it('an all-day event runs to the end of its last Zurich day', () => {
    // Midnight Zurich of 24.10 is stored as 22:00 UTC the day before.
    const ev = { start_date: '2026-10-23T22:00:00Z', end_date: '2026-10-23T22:00:00Z', all_day: true }
    expect(hasEventEnded(at('2026-10-24T21:59:00Z'), ev)).toBe(false) // 23:59 Zurich
    expect(hasEventEnded(at('2026-10-24T22:00:00Z'), ev)).toBe(true) // 00:00 Zurich, next day
  })
})
