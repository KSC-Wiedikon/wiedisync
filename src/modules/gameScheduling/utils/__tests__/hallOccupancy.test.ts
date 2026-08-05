import { describe, it, expect } from 'vitest'
import {
  minutesOfDay,
  intervalsOverlap,
  hallsCollide,
  vbBusyWindow,
  vbBlocksSlot,
  hallStatusAt,
  dayHallAvailability,
  contiguousRuns,
  availabilityWindows,
  BB_GAME_MINUTES,
  VB_CHANGEOVER_MINUTES,
  VB_DEFAULT_MINUTES,
  MAX_AVAILABILITY_WINDOWS,
  EMPTY_HALL_BLOCKERS,
  type HallBlockers,
  type VbBooking,
} from '../hallOccupancy'
import { HALL_A, HALL_B, HALL_C, HALL_AB, SATURDAY_SLOTS, slotEndTime } from '../probasketSeason'

const SAT = 6 // JS getDay
const SUN = 0

function blockers(partial: Partial<HallBlockers> = {}): HallBlockers {
  return {
    closedHallsByDate: partial.closedHallsByDate ?? new Map(),
    clubBlockedDates: partial.clubBlockedDates ?? new Set(),
    vbBusyByDate: partial.vbBusyByDate ?? new Map(),
  }
}

function vbOn(date: string, bookings: VbBooking[]): HallBlockers {
  return blockers({ vbBusyByDate: new Map([[date, bookings]]) })
}

describe('minutesOfDay', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(minutesOfDay('13:30')).toBe(810)
    expect(minutesOfDay('13:30:00')).toBe(810)
    expect(minutesOfDay('09:05')).toBe(545)
  })

  it('returns null for anything unparsable', () => {
    for (const bad of [null, undefined, '', 'later', '25:00', '12:99']) {
      expect(minutesOfDay(bad)).toBeNull()
    }
  })
})

describe('intervalsOverlap', () => {
  it('is half-open — touching at a boundary is not an overlap', () => {
    expect(intervalsOverlap(0, 60, 60, 120)).toBe(false)
    expect(intervalsOverlap(60, 120, 0, 60)).toBe(false)
  })

  it('detects a real overlap in both directions', () => {
    expect(intervalsOverlap(0, 61, 60, 120)).toBe(true)
    expect(intervalsOverlap(60, 120, 0, 61)).toBe(true)
  })
})

describe('hallsCollide (A+B mutual exclusion)', () => {
  it('a KWI A+B booking blocks A and B', () => {
    expect(hallsCollide(HALL_AB, HALL_A)).toBe(true)
    expect(hallsCollide(HALL_AB, HALL_B)).toBe(true)
  })

  it('a KWI A booking blocks A+B', () => {
    expect(hallsCollide(HALL_A, HALL_AB)).toBe(true)
    expect(hallsCollide(HALL_B, HALL_AB)).toBe(true)
  })

  it('A and B are independent of each other and of C', () => {
    expect(hallsCollide(HALL_A, HALL_B)).toBe(false)
    expect(hallsCollide(HALL_A, HALL_C)).toBe(false)
    expect(hallsCollide(HALL_AB, HALL_C)).toBe(false)
  })

  it('identical halls always collide', () => {
    for (const h of [HALL_A, HALL_B, HALL_C, HALL_AB]) expect(hallsCollide(h, h)).toBe(true)
  })
})

describe('vbBusyWindow', () => {
  it('pads the booked window by the changeover on both sides', () => {
    expect(vbBusyWindow({ hall: HALL_A, start: '13:30', end: '15:30' })).toEqual({
      start: 13 * 60 + 30 - VB_CHANGEOVER_MINUTES,
      end: 15 * 60 + 30 + VB_CHANGEOVER_MINUTES,
    })
  })

  it('falls back to a normal match length when end_time is missing', () => {
    expect(vbBusyWindow({ hall: HALL_A, start: '19:30', end: null })).toEqual({
      start: 19 * 60 + 30 - VB_CHANGEOVER_MINUTES,
      end: 19 * 60 + 30 + VB_DEFAULT_MINUTES + VB_CHANGEOVER_MINUTES,
    })
  })

  it('falls back when end_time is not after start_time', () => {
    const w = vbBusyWindow({ hall: HALL_A, start: '20:00', end: '20:00' })
    expect(w).toEqual({
      start: 20 * 60 - VB_CHANGEOVER_MINUTES,
      end: 20 * 60 + VB_DEFAULT_MINUTES + VB_CHANGEOVER_MINUTES,
    })
  })

  it('returns null when there is no start time at all', () => {
    expect(vbBusyWindow({ hall: HALL_A, start: null })).toBeNull()
  })
})

describe('vbBlocksSlot', () => {
  // Prod shape, Sat 07.11.2026: volleyball in KWI A/B/C. The whole date used to
  // render as an empty card because the block was day-granular.
  const nov7: VbBooking[] = [
    { hall: HALL_C, start: '11:00:00', end: '13:30:00' },
    { hall: HALL_A, start: '13:30:00', end: '15:30:00' },
    { hall: HALL_B, start: '13:30:00', end: '15:30:00' },
    { hall: HALL_C, start: '13:30:00', end: '15:30:00' },
    { hall: HALL_A, start: '16:00:00', end: '18:00:00' },
    { hall: HALL_B, start: '16:00:00', end: '18:00:00' },
  ]

  it('blocks the pitch that actually overlaps', () => {
    expect(vbBlocksSlot(nov7, HALL_A, '13:30')).toBe(true)
    expect(vbBlocksSlot(nov7, HALL_A, '16:00')).toBe(true)
  })

  it('leaves a later evening pitch free — exact-boundary is not an overlap', () => {
    // KWI A is busy 15:30 → 18:00 + 30' changeover = free again from 18:30 sharp.
    expect(vbBlocksSlot(nov7, HALL_A, '18:30')).toBe(false)
    expect(vbBlocksSlot(nov7, HALL_B, '18:30')).toBe(false)
    // …and KWI C, whose last booking ends at 15:30, is free from 16:00.
    expect(vbBlocksSlot(nov7, HALL_C, '16:00')).toBe(false)
    expect(vbBlocksSlot(nov7, HALL_C, '18:30')).toBe(false)
  })

  it('blocks an earlier pitch that runs into the booking', () => {
    // 11:00 + 120' = 13:00, and KWI A's 13:30 booking opens at 13:00 → touching only.
    expect(vbBlocksSlot(nov7, HALL_A, '11:00')).toBe(false)
    // KWI C is booked from 11:00, so its 11:00 pitch is gone.
    expect(vbBlocksSlot(nov7, HALL_C, '11:00')).toBe(true)
  })

  it('a NULL start_time blocks the whole day, never frees the hall', () => {
    const nulls: VbBooking[] = [{ hall: HALL_A, start: null, end: null }]
    for (const time of SATURDAY_SLOTS) expect(vbBlocksSlot(nulls, HALL_A, time)).toBe(true)
    // …but only for the hall it names.
    for (const time of SATURDAY_SLOTS) expect(vbBlocksSlot(nulls, HALL_C, time)).toBe(false)
  })

  it('honours the A+B mutual exclusion in both directions', () => {
    const combined: VbBooking[] = [{ hall: HALL_AB, start: '13:30', end: '15:30' }]
    expect(vbBlocksSlot(combined, HALL_A, '13:30')).toBe(true)
    expect(vbBlocksSlot(combined, HALL_B, '13:30')).toBe(true)
    expect(vbBlocksSlot(combined, HALL_C, '13:30')).toBe(false)

    const halfCourt: VbBooking[] = [{ hall: HALL_A, start: '13:30', end: '15:30' }]
    expect(vbBlocksSlot(halfCourt, HALL_AB, '13:30')).toBe(true)
    expect(vbBlocksSlot(halfCourt, HALL_B, '13:30')).toBe(false)
  })

  it('models the basketball game as BB_GAME_MINUTES long', () => {
    // A booking that starts exactly when the game ends (plus changeover) is fine…
    const start = 20 * 60 // 20:00 game → ends 22:00
    const after = `${Math.floor((start + BB_GAME_MINUTES + VB_CHANGEOVER_MINUTES) / 60)}:30`
    expect(vbBlocksSlot([{ hall: HALL_A, start: after, end: null }], HALL_A, '20:00')).toBe(false)
    // …one minute earlier is not.
    expect(vbBlocksSlot([{ hall: HALL_A, start: '22:29', end: null }], HALL_A, '20:00')).toBe(true)
  })
})

describe('hallStatusAt', () => {
  const date = '2026-11-07'

  it('reports free when nothing blocks', () => {
    expect(hallStatusAt(date, '18:30', HALL_A, EMPTY_HALL_BLOCKERS, false)).toBe('free')
  })

  it('a ProBasket blackout makes every hall unavailable', () => {
    expect(hallStatusAt(date, '18:30', HALL_A, EMPTY_HALL_BLOCKERS, true)).toBe('unavailable')
  })

  it('a club-wide block makes every hall unavailable', () => {
    const b = blockers({ clubBlockedDates: new Set([date]) })
    expect(hallStatusAt(date, '18:30', HALL_A, b, false)).toBe('unavailable')
  })

  it('a hall closure is per hall, and "*" closes them all', () => {
    const one = blockers({ closedHallsByDate: new Map([[date, new Set([HALL_C])]]) })
    expect(hallStatusAt(date, '11:00', HALL_C, one, false)).toBe('unavailable')
    expect(hallStatusAt(date, '11:00', HALL_A, one, false)).toBe('free')
    const all = blockers({ closedHallsByDate: new Map([[date, new Set(['*'])]]) })
    expect(hallStatusAt(date, '11:00', HALL_A, all, false)).toBe('unavailable')
  })

  it('volleyball is its own status, distinct from unavailable', () => {
    const b = vbOn(date, [{ hall: HALL_A, start: '13:30', end: '15:30' }])
    expect(hallStatusAt(date, '13:30', HALL_A, b, false)).toBe('vb')
    expect(hallStatusAt(date, '18:30', HALL_A, b, false)).toBe('free')
  })
})

describe('dayHallAvailability', () => {
  const date = '2026-11-07'

  it('reopens the reported bug: 07.11.2026 has free evening pitches', () => {
    const b = vbOn(date, [
      { hall: HALL_C, start: '11:00:00', end: '13:30:00' },
      { hall: HALL_A, start: '13:30:00', end: '15:30:00' },
      { hall: HALL_B, start: '13:30:00', end: '15:30:00' },
      { hall: HALL_C, start: '13:30:00', end: '15:30:00' },
      { hall: HALL_A, start: '16:00:00', end: '18:00:00' },
      { hall: HALL_B, start: '16:00:00', end: '18:00:00' },
    ])
    const day = dayHallAvailability(date, SAT, b, false)
    expect(day.noneFree).toBe(false)
    expect(day.reason).toBeNull()
    expect(day.freeByHall.find((h) => h.hall === HALL_A)?.free).toEqual(['11:00', '18:30'])
    expect(day.freeByHall.find((h) => h.hall === HALL_C)?.free).toEqual(['16:00', '18:30'])
  })

  it('names the reason when volleyball takes the whole day', () => {
    const b = vbOn(date, [HALL_A, HALL_B, HALL_C].map((hall) => ({ hall, start: null, end: null })))
    const day = dayHallAvailability(date, SAT, b, false)
    expect(day.noneFree).toBe(true)
    expect(day.reason).toBe('volleyball')
  })

  it('reports blackout / club block / closure ahead of volleyball', () => {
    expect(dayHallAvailability(date, SAT, EMPTY_HALL_BLOCKERS, true).reason).toBe('blackout')
    expect(
      dayHallAvailability(date, SAT, blockers({ clubBlockedDates: new Set([date]) }), false).reason,
    ).toBe('club_block')
    expect(
      dayHallAvailability(date, SAT, blockers({ closedHallsByDate: new Map([[date, new Set(['*'])]]) }), false).reason,
    ).toBe('hall_closed')
  })

  it('offers Sunday its own pitch list and never claims a reason on a free day', () => {
    const day = dayHallAvailability('2026-11-08', SUN, EMPTY_HALL_BLOCKERS, false)
    expect(day.times).toEqual(['10:00', '12:30', '15:00'])
    expect(day.noneFree).toBe(false)
    expect(day.reason).toBeNull()
  })
})

describe('contiguousRuns', () => {
  const times = [...SATURDAY_SLOTS] // 11:00, 13:30, 16:00, 18:30

  it('keeps one run when the free list is contiguous', () => {
    expect(contiguousRuns(times, ['11:00', '13:30'])).toEqual([['11:00', '13:30']])
  })

  it('SPLITS a non-contiguous free list instead of spanning the hole', () => {
    // The latent export bug: ['11:00','18:30'] must not become 11:00 → 20:30.
    expect(contiguousRuns(times, ['11:00', '18:30'])).toEqual([['11:00'], ['18:30']])
  })

  it('handles the real prod shape (KWI B on 12.12.2026: 13:30 taken)', () => {
    expect(contiguousRuns(times, ['11:00', '16:00', '18:30'])).toEqual([['11:00'], ['16:00', '18:30']])
  })

  it('returns nothing when nothing is free, everything when all is', () => {
    expect(contiguousRuns(times, [])).toEqual([])
    expect(contiguousRuns(times, times)).toEqual([times])
  })

  it('ignores free times that are not pitches of that day', () => {
    expect(contiguousRuns(times, ['09:00', '11:00'])).toEqual([['11:00']])
  })
})

describe('availabilityWindows', () => {
  const times = [...SATURDAY_SLOTS]

  it('emits one (from, to, hall) triple per contiguous run', () => {
    const out = availabilityWindows(times, [{ hall: HALL_B, free: ['11:00', '16:00', '18:30'] }])
    expect(out).toEqual([
      { hall: HALL_B, from: '11:00', to: slotEndTime('11:00'), pitches: 1 },
      { hall: HALL_B, from: '16:00', to: slotEndTime('18:30'), pitches: 2 },
    ])
  })

  it('never declares a blocked middle as available', () => {
    const [first] = availabilityWindows(times, [{ hall: HALL_C, free: ['11:00', '18:30'] }])
    expect(first.to).toBe(slotEndTime('11:00')) // 13:00 — NOT 20:30
  })

  it('caps at three windows and keeps the longest ones', () => {
    const out = availabilityWindows(times, [
      { hall: HALL_A, free: times },              // 4 pitches
      { hall: HALL_B, free: ['11:00', '13:30'] }, // 2 pitches
      { hall: HALL_C, free: ['11:00'] },          // 1 pitch
      { hall: HALL_AB, free: ['16:00', '18:30'] }, // 2 pitches
    ])
    expect(out).toHaveLength(MAX_AVAILABILITY_WINDOWS)
    expect(out.map((w) => w.hall).sort()).toEqual([HALL_A, HALL_AB, HALL_B].sort())
    // Kept windows are printed chronologically.
    expect(out.map((w) => w.from)).toEqual([...out.map((w) => w.from)].sort())
  })

  it('returns nothing when no hall is free', () => {
    expect(availabilityWindows(times, [{ hall: HALL_A, free: [] }])).toEqual([])
  })
})
