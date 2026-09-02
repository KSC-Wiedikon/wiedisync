// Unit tests for the pure half of departMember.ts.
//
// Same reason bulkEdit.test.ts exists: this is the part that can be wrong
// quietly. `alreadyDeparted` decides whether a member is written at all, so a
// false positive silently SKIPS a departure — on a bulk run over 120 people
// nobody would notice, and the register would keep billing them.

import { describe, expect, it } from 'vitest'
import { DEPARTED_ORDERED, alreadyDeparted, buildDepartPatch } from '../departMember'

const PATCH = buildDepartPatch('Ehemaliges Mitglied', '2026-06-30')

describe('buildDepartPatch', () => {
  it('writes all four columns, both flags off', () => {
    expect(PATCH).toEqual({
      register_status: 'Ehemaliges Mitglied',
      austritt: '2026-06-30',
      kscw_membership_active: false,
      wiedisync_active: false,
    })
  })
})

describe('DEPARTED_ORDERED', () => {
  it('is the register picklist verbatim, without Zwischenjahr', () => {
    expect(DEPARTED_ORDERED).toEqual(['Ehemaliges Mitglied', 'Kein Mitglied', 'Verstorben'])
    expect(DEPARTED_ORDERED).not.toContain('Zwischenjahr')
  })
})

describe('alreadyDeparted', () => {
  const departed = {
    register_status: 'Ehemaliges Mitglied',
    austritt: '2026-06-30',
    kscw_membership_active: false,
    wiedisync_active: false,
  }

  it('is true when all four columns already match', () => {
    expect(alreadyDeparted(departed, PATCH)).toBe(true)
  })

  it('tolerates a timestamp-shaped austritt', () => {
    expect(alreadyDeparted({ ...departed, austritt: '2026-06-30T00:00:00Z' }, PATCH)).toBe(true)
  })

  it('is false on a different exit date', () => {
    expect(alreadyDeparted({ ...departed, austritt: '2026-05-31' }, PATCH)).toBe(false)
  })

  it('is false on a different departed status', () => {
    expect(alreadyDeparted({ ...departed, register_status: 'Kein Mitglied' }, PATCH)).toBe(false)
  })

  it('is false while either flag is still on', () => {
    expect(alreadyDeparted({ ...departed, kscw_membership_active: true }, PATCH)).toBe(false)
    expect(alreadyDeparted({ ...departed, wiedisync_active: true }, PATCH)).toBe(false)
  })

  // The regression that motivated asBool(): Directus serves these two columns as
  // `true` / `'true'` / `1` depending on the path, and a bare `=== true` read a
  // still-active member as already departed — i.e. skipped their departure.
  it('reads a stringified or numeric truthy flag as still active', () => {
    expect(alreadyDeparted({ ...departed, kscw_membership_active: 'true' }, PATCH)).toBe(false)
    expect(alreadyDeparted({ ...departed, wiedisync_active: 1 }, PATCH)).toBe(false)
  })

  it('is false on a member who was never departed at all', () => {
    expect(alreadyDeparted(
      { register_status: 'Aktivmitglied', austritt: null, kscw_membership_active: true, wiedisync_active: true },
      PATCH,
    )).toBe(false)
  })
})
