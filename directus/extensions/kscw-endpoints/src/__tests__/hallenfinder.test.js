/**
 * hallenfinder.js — hall_type filter normalisation (migration 421 moved
 * city_halls.hall_type from German slugs to English ones).
 */
import { describe, it, expect } from 'vitest'
import { normaliseHallType } from '../hallenfinder.js'

describe('normaliseHallType', () => {
  it('passes the English slugs through', () => {
    for (const s of ['sports_hall', 'gym_room', 'triple_hall', 'double_hall']) {
      expect(normaliseHallType(s)).toBe(s)
    }
  })

  it('maps the pre-421 German slugs a cached bundle still sends', () => {
    expect(normaliseHallType('sporthalle')).toBe('sports_hall')
    expect(normaliseHallType('gymnastikraum')).toBe('gym_room')
    expect(normaliseHallType('Dreifachhalle')).toBe('triple_hall')
    expect(normaliseHallType('doppelhalle')).toBe('double_hall')
  })

  it('treats a missing filter as no filter', () => {
    expect(normaliseHallType(undefined)).toBeNull()
    expect(normaliseHallType(null)).toBeNull()
    expect(normaliseHallType('')).toBeNull()
  })
})
