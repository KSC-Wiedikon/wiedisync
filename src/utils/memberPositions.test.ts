import { describe, expect, it } from 'vitest'
import {
  coercePositions,
  getPositionI18nKey,
  getPositionsForSport,
  getSelectablePositions,
  isPositionValidForSport,
  normalizePositionsForSport,
} from './memberPositions'

describe('memberPositions', () => {
  it('returns sport-specific volleyball positions', () => {
    expect(getPositionsForSport('volleyball')).toEqual([
      'setter',
      'outside',
      'middle',
      'opposite',
      'libero',
      'guest',
      'staff_only',
    ])
  })

  it('returns sport-specific basketball positions', () => {
    expect(getPositionsForSport('basketball')).toEqual([
      'point_guard',
      'shooting_guard',
      'small_forward',
      'power_forward',
      'center',
      'guest',
      'staff_only',
    ])
  })

  it('coerces both string and array inputs safely', () => {
    expect(coercePositions('setter')).toEqual(['setter'])
    expect(coercePositions(['setter', 'center', 'unknown'])).toEqual(['setter', 'center'])
    expect(coercePositions(123)).toEqual([])
  })

  it('normalizes out-of-sport and invalid values to other', () => {
    expect(normalizePositionsForSport(['center'], 'volleyball')).toEqual(['other'])
    expect(normalizePositionsForSport(['outside', 'invalid'], 'volleyball')).toEqual(['outside'])
    expect(normalizePositionsForSport([], 'basketball')).toEqual(['other'])
  })

  it('keeps legacy value visible in selectable list', () => {
    // 'center' (out-of-sport) and 'other' (now legacy — no longer in the base
    // list) are current values, so both stay visible, prepended before the base.
    const selectable = getSelectablePositions('volleyball', ['center', 'other'])
    expect(selectable[0]).toBe('center')
    expect(selectable).toContain('other')
    expect(selectable).toContain('setter')
    // The base list now offers 'staff_only' in place of 'other'.
    expect(selectable).toContain('staff_only')
  })

  it('maps known i18n keys and validates sport compatibility', () => {
    expect(getPositionI18nKey('shooting_guard')).toBe('positionShootingGuard')
    expect(getPositionI18nKey('unknown')).toBeNull()

    expect(isPositionValidForSport('center', 'basketball')).toBe(true)
    expect(isPositionValidForSport('center', 'volleyball')).toBe(false)
  })
})
