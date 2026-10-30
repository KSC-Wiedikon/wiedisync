import { describe, it, expect } from 'vitest'
import { optimisticPick, optimisticSaved, shownStatus } from './optimisticRsvp'

const K = 'training|7|'

describe('optimistic RSVP', () => {
  it('shows the tap until the server catches up, then the server', () => {
    const o = optimisticPick(null, K, null, 'confirmed')
    expect(shownStatus(o, K, null)).toBe('confirmed')
    expect(shownStatus(o, K, 'confirmed')).toBe('confirmed')
  })

  it('a server move the viewer did not make wins (promoted / bumped)', () => {
    const o = optimisticPick(null, K, 'waitlisted', 'waitlisted')
    expect(shownStatus(o, K, 'confirmed')).toBe('confirmed')
  })

  it('a quick second tap does not flash the first answer when its refetch lands', () => {
    const first = optimisticPick(null, K, null, 'confirmed')
    const second = optimisticPick(first, K, null, 'declined')
    expect(shownStatus(second, K, null)).toBe('declined')
    expect(shownStatus(second, K, 'confirmed')).toBe('declined')
    expect(shownStatus(second, K, 'declined')).toBe('declined')
    expect(shownStatus(second, K, 'tentative')).toBe('tentative')
  })

  it('a tap after the server caught up starts a fresh burst', () => {
    const first = optimisticPick(null, K, null, 'confirmed')
    const second = optimisticPick(first, K, 'confirmed', 'declined')
    expect(second.accept).toEqual(['confirmed'])
  })

  it('a Yes saved as waitlisted shows the waiting list, and a later promotion shows', () => {
    const tapped = optimisticPick(null, K, null, 'confirmed')
    const saved = optimisticSaved(tapped, K, 'confirmed', 'waitlisted')
    expect(shownStatus(saved, K, null)).toBe('waitlisted')
    expect(shownStatus(saved, K, 'waitlisted')).toBe('waitlisted')
    expect(shownStatus(saved, K, 'confirmed')).toBe('confirmed')
  })

  it('a saved answer does not override a later tap', () => {
    const first = optimisticPick(null, K, null, 'confirmed')
    const second = optimisticPick(first, K, null, 'declined')
    expect(optimisticSaved(second, K, 'confirmed', 'waitlisted')).toBe(second)
  })

  it('belongs to one activity only', () => {
    const o = optimisticPick(null, K, null, 'confirmed')
    expect(shownStatus(o, 'training|8|', null)).toBe(null)
  })
})
