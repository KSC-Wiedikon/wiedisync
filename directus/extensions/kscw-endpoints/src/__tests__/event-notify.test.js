// 2026-09-28 audit F59: a sport admin's notify authority covers only events of their sport.
import { describe, it, expect } from 'vitest'
import { sportAdminCovers, unscopedRecipients } from '../event-notify.js'

describe('sportAdminCovers (F59)', () => {
  it('covers an event whose teams are all of the admin\'s sport', () => {
    expect(sportAdminCovers(['user', 'vb_admin'], ['volleyball', 'volleyball'], false)).toBe(true)
    expect(sportAdminCovers(['vb_admin', 'bb_admin'], ['volleyball', 'basketball'], false)).toBe(true)
  })

  it('refuses another sport, or a mixed event outside their sports', () => {
    expect(sportAdminCovers(['vb_admin'], ['basketball'], false)).toBe(false)
    expect(sportAdminCovers(['vb_admin'], ['volleyball', 'basketball'], true)).toBe(false)
  })

  it('a team-less event counts only when they created it', () => {
    expect(sportAdminCovers(['bb_admin'], [], true)).toBe(true)
    expect(sportAdminCovers(['bb_admin'], [], false)).toBe(false)
  })

  it('is false for anyone without a sport-admin role', () => {
    expect(sportAdminCovers(['user', 'coach', 'vorstand'], ['volleyball'], true)).toBe(false)
  })
})

describe('unscopedRecipients (F17 follow-up)', () => {
  it('a creator who leads every event team has no capped audience, however large', () => {
    const all = Array.from({ length: 90 }, (_, i) => String(i + 1))
    expect(unscopedRecipients(all, new Set(all))).toEqual([])
  })

  it('counts only people reached outside the creator\'s own teams', () => {
    expect(unscopedRecipients(['1', '2', '3', '4'], new Set(['1', '2']))).toEqual(['3', '4'])
  })
})
