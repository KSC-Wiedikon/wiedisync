import { describe, expect, it } from 'vitest'
import type { HallSlot, Training } from '../types'
import { describeExtraHalls, expandExtraHalls, extraHallWindow, parseExtraHalls } from './extraHalls'

const base = {
  collectionId: '', collectionName: 'hall_slots', created: '', updated: '',
  team: ['75'], day_of_week: 1, slot_type: 'training', recurring: true,
  valid_from: '', valid_until: '', indefinite: true, label: '', notes: '',
} as const

function slot(over: Partial<HallSlot>): HallSlot {
  return { ...base, id: '70', hall: '2', start_time: '18:00', end_time: '20:00', ...over } as HallSlot
}

describe('parseExtraHalls', () => {
  it('accepts objects, bare ids, JSON strings and null', () => {
    expect(parseExtraHalls(null)).toEqual([])
    expect(parseExtraHalls([8])).toEqual([{ hall: '8' }])
    expect(parseExtraHalls('[{"hall":1,"start_time":"18:30"}]')).toEqual([{ hall: '1', start_time: '18:30', end_time: null }])
    expect(parseExtraHalls('not json')).toEqual([])
  })
})

describe('extraHallWindow', () => {
  it('narrows to the entry window and clamps to a shortened slot', () => {
    expect(extraHallWindow({ hall: 1, start_time: '18:30' }, '18:00', '20:00')).toEqual({ start: '18:30', end: '20:00' })
    expect(extraHallWindow({ hall: 1, start_time: '18:30' }, '18:00', '19:15')).toEqual({ start: '18:30', end: '19:15' })
    expect(extraHallWindow({ hall: 1, start_time: '18:30' }, '18:00', '18:30')).toBeNull()
  })
})

describe('expandExtraHalls', () => {
  it('adds a copy per extra hall that points back at the original', () => {
    const s = slot({ extra_halls: [{ hall: 1, start_time: '18:30' }] })
    const out = expandExtraHalls([s])
    expect(out).toHaveLength(2)
    const copy = out[1]
    expect(copy).toMatchObject({ id: '70@1', hall: '1', start_time: '18:30', end_time: '20:00' })
    expect(copy._extraOf).toBe(s)
  })

  it('reads a training occurrence from its source record', () => {
    const training = { id: '9', extra_halls: [{ hall: 8 }] } as unknown as Training
    const vs = slot({ id: 'training-9', hall: '7', _virtual: { source: 'training', sourceId: '9', sourceRecord: training } })
    expect(expandExtraHalls([vs]).map((x) => x.hall)).toEqual(['7', '8'])
  })

  it('respects the hall filter and leaves plain slots untouched', () => {
    const plain = [slot({})]
    expect(expandExtraHalls(plain)).toBe(plain)
    expect(expandExtraHalls([slot({ extra_halls: [{ hall: 1 }] })], ['2'])).toHaveLength(1)
  })
})

describe('describeExtraHalls', () => {
  const t = (k: string, o?: Record<string, string>) => `${k}|${Object.values(o ?? {}).join(',')}`
  it('names the hall and its window', () => {
    const halls = [{ id: '1', name: 'KWI A' }, { id: '8', name: 'Borrweg 2' }]
    expect(describeExtraHalls([{ hall: 1, start_time: '18:30' }, { hall: 8 }], halls, t))
      .toEqual(['common:extraHallFrom|KWI A,18:30', 'Borrweg 2'])
  })
})
