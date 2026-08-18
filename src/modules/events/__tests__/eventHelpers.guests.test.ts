import { describe, it, expect } from 'vitest'
import { isGuestExcludedFromEvent, ALL_GUEST_LEVELS } from '../eventHelpers'

/**
 * The `invite_guests` rule (migration 324) is answered per MEMBER across every
 * invited team, and the same rule is re-implemented in SQL by the
 * `assertGuestMayRsvp` event branch in kscw-hooks. These cases are the contract
 * both sides have to satisfy.
 */
const ctx = (teams: Record<string, number>, memberId?: string) => ({
  memberId,
  memberTeamIds: Object.keys(teams),
  getGuestLevel: (id: string) => teams[id] ?? 0,
})

describe('isGuestExcludedFromEvent', () => {
  it('never excludes when the switch is unset (pre-324 rows) or on', () => {
    expect(isGuestExcludedFromEvent({ teams: ['3'] }, ctx({ '3': 1 }))).toBe(false)
    expect(isGuestExcludedFromEvent({ invite_guests: true, teams: ['3'] }, ctx({ '3': 1 }))).toBe(false)
  })

  it('excludes a guest of the only invited team', () => {
    expect(isGuestExcludedFromEvent({ invite_guests: false, teams: ['3'] }, ctx({ '3': 2 }))).toBe(true)
  })

  it('keeps a core player', () => {
    expect(isGuestExcludedFromEvent({ invite_guests: false, teams: ['3'] }, ctx({ '3': 0 }))).toBe(false)
  })

  it('keeps someone who is a guest on one invited team but core on another', () => {
    expect(isGuestExcludedFromEvent(
      { invite_guests: false, teams: ['3', '9'] },
      ctx({ '3': 1, '9': 0 }),
    )).toBe(false)
  })

  it('excludes someone who is a guest on every invited team they are on', () => {
    expect(isGuestExcludedFromEvent(
      { invite_guests: false, teams: ['3', '9'] },
      ctx({ '3': 1, '9': 3, '12': 0 }),   // core on 12, which is NOT invited
    )).toBe(true)
  })

  it('never excludes someone who is on none of the invited teams (role invite / club-wide)', () => {
    expect(isGuestExcludedFromEvent({ invite_guests: false, teams: ['3'] }, ctx({ '9': 1 }))).toBe(false)
    expect(isGuestExcludedFromEvent({ invite_guests: false, teams: [] }, ctx({ '3': 1 }))).toBe(false)
  })

  it('lets a personal invite outrank the switch', () => {
    const event = { invite_guests: false, teams: ['3'], invited_members: [{ members_id: 8 }] }
    expect(isGuestExcludedFromEvent(event, ctx({ '3': 1 }, '8'))).toBe(false)
    expect(isGuestExcludedFromEvent(event, ctx({ '3': 1 }, '9'))).toBe(true)
  })

  it('reads expanded and bare junction shapes for teams and invited members', () => {
    const event = {
      invite_guests: false,
      teams: [{ teams_id: { id: 3, name: 'D1' } }],
      invited_members: [{ members_id: { id: 8 } }],
    }
    expect(isGuestExcludedFromEvent(event, ctx({ '3': 1 }, '8'))).toBe(false)
    expect(isGuestExcludedFromEvent(event, ctx({ '3': 1 }, '11'))).toBe(true)
  })

  it('feeds the roster modal every tier, since events have no per-tier choice', () => {
    expect(ALL_GUEST_LEVELS).toEqual([1, 2, 3])
  })
})
