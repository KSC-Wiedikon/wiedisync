/**
 * The hall source switch's sync-side helpers (hall-override.js, migration 455).
 *
 * A sync must keep recording what VolleyManager / Basketplan / the booking mirror
 * says while the hall is overwritten, and must never move the effective hall. The
 * helpers make it resolve and compare against the OFFICIAL court set and send that
 * to synced_* — including the case the trigger alone cannot see: the source moving
 * the game into the very hall it was overwritten to.
 */
import { describe, it, expect } from 'vitest'
import {
  courtSetKey, extraHallIds, hallSourceView, isHallOverridden, overrideAwareWrite,
  HALL_OVERRIDE_COLUMNS, SYNCED_GAME_SOURCES,
} from '../hall-override.js'

process.env.SV_API_KEY ||= 'test-key'
const { resolveHomeHall } = await import('../sv-sync.js')

const KWI_A = 1, KWI_B = 2, KWI_C = 3, DOELTSCHI = 4

const overridden = {
  id: 7, hall: KWI_C, additional_halls: null,
  hall_override: true, synced_hall: KWI_A, synced_additional_halls: [String(KWI_B)],
}
const plain = { id: 8, hall: KWI_A, additional_halls: null, hall_override: false, synced_hall: KWI_A, synced_additional_halls: null }

describe('hallSourceView', () => {
  it('reads the official court set while the hall is overwritten', () => {
    const row = hallSourceView(overridden)
    expect(row.hall).toBe(KWI_A)
    expect(row.additional_halls).toEqual([String(KWI_B)])
    expect(row.id).toBe(7)
  })

  it('a synced game with no official hall reads as hall-less, not as the overwritten hall', () => {
    expect(hallSourceView({ ...overridden, synced_hall: null, synced_additional_halls: null }).hall).toBeNull()
  })

  it('returns the very row when the switch is off, and passes null through', () => {
    expect(hallSourceView(plain)).toBe(plain)
    expect(hallSourceView(null)).toBeNull()
    expect(hallSourceView(undefined)).toBeUndefined()
  })
})

describe('overrideAwareWrite', () => {
  it('sends the official court set to synced_* and leaves the effective one alone', () => {
    const out = overrideAwareWrite({ hall: DOELTSCHI, additional_halls: '[]', date: '2026-12-01' }, overridden)
    expect(out).toEqual({ synced_hall: DOELTSCHI, synced_additional_halls: '[]', date: '2026-12-01' })
    expect('hall' in out).toBe(false)
    expect('additional_halls' in out).toBe(false)
  })

  it('does not invent keys the sync did not send (sv-sync never writes additional_halls)', () => {
    const out = overrideAwareWrite({ hall: KWI_B, status: 'scheduled' }, overridden)
    expect(out).toEqual({ synced_hall: KWI_B, status: 'scheduled' })
  })

  it('is the identity when the switch is off or the row is new', () => {
    const data = { hall: KWI_B }
    expect(overrideAwareWrite(data, plain)).toBe(data)
    expect(overrideAwareWrite(data, null)).toBe(data)
  })

  it('does not mutate its input', () => {
    const data = { hall: KWI_B }
    overrideAwareWrite(data, overridden)
    expect(data).toEqual({ hall: KWI_B })
  })
})

describe('sv-sync resolveHomeHall against the official hall', () => {
  // VM moved the game from KWI A into KWI C — the hall an admin had already
  // overwritten it to. Against the effective row that reads as "no change" and
  // synced_hall would keep KWI A; switching back to Sync would then restore a hall
  // VM no longer gives.
  it('records the move into the overwritten hall', () => {
    const row = hallSourceView({ ...overridden, synced_additional_halls: null })
    const next = resolveHomeHall({ existing: row, feedHall: KWI_C, seasonStarted: true, vmGymByHall: new Map() })
    expect(next).toBe(KWI_C)
    expect(overrideAwareWrite({ hall: next }, overridden)).toEqual({ synced_hall: KWI_C })
  })

  it('keeps an unchanged official hall unchanged (no nightly rewrite)', () => {
    const row = hallSourceView({ ...overridden, synced_additional_halls: null })
    const next = resolveHomeHall({ existing: row, feedHall: KWI_A, seasonStarted: true, vmGymByHall: new Map() })
    expect(next).toBe(row.hall)
  })

  it('the official A+B combo still holds its primary, as for a game that is not overwritten', () => {
    const row = hallSourceView(overridden) // synced: KWI A + [KWI B]
    expect(resolveHomeHall({ existing: row, feedHall: KWI_C, seasonStarted: true, vmGymByHall: new Map() })).toBe(KWI_A)
  })
})

describe('court sets', () => {
  it('extraHallIds reads every shape the json column has held', () => {
    expect(extraHallIds(['2', 3])).toEqual([2, 3])
    expect(extraHallIds('["3","2","2"]')).toEqual([2, 3])
    expect(extraHallIds([{ id: 2 }])).toEqual([2])
    expect(extraHallIds(null)).toEqual([])
    expect(extraHallIds('{2}')).toEqual([])
    expect(extraHallIds({})).toEqual([])
  })

  it('courtSetKey compares hall + additional halls as one set', () => {
    expect(courtSetKey(KWI_A, ['2'])).toBe('1+2')
    expect(courtSetKey(KWI_B, [KWI_A])).toBe('1+2')
    expect(courtSetKey(KWI_C, null)).toBe('3')
    expect(courtSetKey(KWI_C, '[]')).toBe('3')
    expect(courtSetKey(null, null)).toBe('')
  })
})

describe('constants', () => {
  it('names every column of the switch and only the two synced sources', () => {
    expect(HALL_OVERRIDE_COLUMNS).toEqual(['hall_override', 'synced_hall', 'synced_additional_halls', 'hall_override_by_name', 'hall_override_at'])
    expect(SYNCED_GAME_SOURCES).toEqual(['swiss_volley', 'basketplan'])
    expect(isHallOverridden(overridden)).toBe(true)
    expect(isHallOverridden({ hall_override: 'true' })).toBe(false)
  })
})
