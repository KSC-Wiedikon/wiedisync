import { describe, it, expect } from 'vitest'
import { getGameWarnings, getTrainingWarnings, getEventWarnings } from './participationWarnings'
import type { MemberPosition, Participation, ParticipationWithMember } from '../types'

function makeParticipation(
  overrides: Partial<Participation> & { position?: MemberPosition[] } = {},
): ParticipationWithMember {
  const memberId = 'member-' + Math.random().toString(36).slice(2, 6)
  const base: ParticipationWithMember = {
    id: Math.random().toString(36),
    member: memberId,
    activity_type: 'game',
    activity_id: 'game-1',
    status: 'confirmed',
    note: '',
    session_id: '',
    guest_count: 0,
    is_staff: false,
    waitlisted_at: '',
    collectionId: '',
    collectionName: '',
    created: '',
    updated: '',
  }
  const { position, ...rest } = overrides
  if (position) {
    base.member = { id: memberId, position }
  }
  return { ...base, ...rest }
}

describe('getGameWarnings', () => {
  describe('volleyball', () => {
    it('returns RED when fewer than 6 non-libero confirmed players', () => {
      const parts = [
        makeParticipation({ position: ['outside'] }),
        makeParticipation({ position: ['outside'] }),
        makeParticipation({ position: ['setter'] }),
        makeParticipation({ position: ['middle'] }),
        makeParticipation({ position: ['opposite'] }),
        makeParticipation({ position: ['libero'] }),
      ]
      const warnings = getGameWarnings(parts, 'volleyball')
      const red = warnings.find((w) => w.key === 'warningIncompleteTeam')
      expect(red).toBeDefined()
      expect(red!.level).toBe('red')
      expect(red!.params?.count).toBe(5) // 5 field players, 1 libero
    })

    it('returns no RED when 6 non-libero confirmed players', () => {
      const parts = Array.from({ length: 6 }, () =>
        makeParticipation({ position: ['outside'] }),
      )
      const warnings = getGameWarnings(parts, 'volleyball')
      expect(warnings.find((w) => w.key === 'warningIncompleteTeam')).toBeUndefined()
    })

    it('returns RED for 5+2 libero (only 5 field players)', () => {
      const parts = [
        ...Array.from({ length: 5 }, () => makeParticipation({ position: ['middle'] })),
        makeParticipation({ position: ['libero'] }),
        makeParticipation({ position: ['libero'] }),
      ]
      const warnings = getGameWarnings(parts, 'volleyball')
      const red = warnings.find((w) => w.key === 'warningIncompleteTeam')
      expect(red).toBeDefined()
      expect(red!.params?.count).toBe(5)
    })

    it('returns no RED for 6+1 libero (6 field players)', () => {
      const parts = [
        ...Array.from({ length: 6 }, () => makeParticipation({ position: ['setter'] })),
        makeParticipation({ position: ['libero'] }),
      ]
      const warnings = getGameWarnings(parts, 'volleyball')
      expect(warnings.find((w) => w.key === 'warningIncompleteTeam')).toBeUndefined()
    })

    it('returns RED for 4+2 libero (only 4 field players)', () => {
      const parts = [
        ...Array.from({ length: 4 }, () => makeParticipation({ position: ['outside'] })),
        makeParticipation({ position: ['libero'] }),
        makeParticipation({ position: ['libero'] }),
      ]
      const warnings = getGameWarnings(parts, 'volleyball')
      const red = warnings.find((w) => w.key === 'warningIncompleteTeam')
      expect(red).toBeDefined()
      expect(red!.params?.count).toBe(4)
    })

    it('does not count staff as field players', () => {
      const parts = [
        ...Array.from({ length: 5 }, () => makeParticipation({ position: ['outside'] })),
        makeParticipation({ is_staff: true, position: ['setter'] }), // coach, doesn't count
      ]
      const warnings = getGameWarnings(parts, 'volleyball')
      expect(warnings.find((w) => w.key === 'warningIncompleteTeam')).toBeDefined()
    })

    it('does not count declined/tentative/waitlisted', () => {
      const parts = [
        ...Array.from({ length: 5 }, () => makeParticipation({ position: ['outside'] })),
        makeParticipation({ status: 'tentative', position: ['middle'] }),
        makeParticipation({ status: 'declined', position: ['setter'] }),
      ]
      const warnings = getGameWarnings(parts, 'volleyball')
      expect(warnings.find((w) => w.key === 'warningIncompleteTeam')).toBeDefined()
    })

    it('respects custom min_participants override', () => {
      const parts = Array.from({ length: 7 }, () =>
        makeParticipation({ position: ['outside'] }),
      )
      // With default (6), no warning. With custom min=8, warning.
      expect(getGameWarnings(parts, 'volleyball').find((w) => w.key === 'warningIncompleteTeam')).toBeUndefined()
      expect(getGameWarnings(parts, 'volleyball', 8).find((w) => w.key === 'warningIncompleteTeam')).toBeDefined()
    })
  })

  describe('basketball', () => {
    it('returns RED when fewer than 5 confirmed players', () => {
      const parts = Array.from({ length: 4 }, () => makeParticipation())
      const warnings = getGameWarnings(parts, 'basketball')
      const red = warnings.find((w) => w.key === 'warningIncompleteTeam')
      expect(red).toBeDefined()
      expect(red!.params?.count).toBe(4)
    })

    it('returns no RED when 5+ confirmed players', () => {
      const parts = Array.from({ length: 5 }, () => makeParticipation())
      const warnings = getGameWarnings(parts, 'basketball')
      expect(warnings.find((w) => w.key === 'warningIncompleteTeam')).toBeUndefined()
    })

    it('does not apply libero logic', () => {
      // Even if someone has "libero" position in BB, they should still count
      const parts = Array.from({ length: 5 }, () =>
        makeParticipation({ position: ['libero'] }),
      )
      const warnings = getGameWarnings(parts, 'basketball')
      expect(warnings.find((w) => w.key === 'warningIncompleteTeam')).toBeUndefined()
    })
  })

  describe('coach warning', () => {
    it('returns YELLOW when no staff confirmed', () => {
      const parts = Array.from({ length: 6 }, () =>
        makeParticipation({ position: ['outside'] }),
      )
      const warnings = getGameWarnings(parts, 'volleyball')
      const yellow = warnings.find((w) => w.key === 'warningNoCoach')
      expect(yellow).toBeDefined()
      expect(yellow!.level).toBe('yellow')
    })

    it('returns no YELLOW when staff is confirmed', () => {
      const parts = [
        ...Array.from({ length: 6 }, () => makeParticipation({ position: ['outside'] })),
        makeParticipation({ is_staff: true }),
      ]
      const warnings = getGameWarnings(parts, 'volleyball')
      expect(warnings.find((w) => w.key === 'warningNoCoach')).toBeUndefined()
    })

    it('staff with status!=confirmed does not count', () => {
      const parts = [
        ...Array.from({ length: 6 }, () => makeParticipation({ position: ['outside'] })),
        makeParticipation({ is_staff: true, status: 'declined' }),
      ]
      const warnings = getGameWarnings(parts, 'volleyball')
      expect(warnings.find((w) => w.key === 'warningNoCoach')).toBeDefined()
    })

    it('both RED and YELLOW can appear simultaneously', () => {
      const parts = [
        ...Array.from({ length: 3 }, () => makeParticipation({ position: ['outside'] })),
      ]
      const warnings = getGameWarnings(parts, 'volleyball')
      expect(warnings.find((w) => w.key === 'warningIncompleteTeam')).toBeDefined()
      expect(warnings.find((w) => w.key === 'warningNoCoach')).toBeDefined()
      expect(warnings).toHaveLength(2)
    })
  })
})

describe('getTrainingWarnings', () => {
  it('returns empty when no min set', () => {
    const parts = [makeParticipation()]
    expect(getTrainingWarnings(parts, null)).toEqual([])
    expect(getTrainingWarnings(parts, 0)).toEqual([])
    expect(getTrainingWarnings(parts, undefined)).toEqual([])
  })

  it('returns RED when confirmed < min', () => {
    const parts = [
      makeParticipation({ status: 'confirmed' }),
      makeParticipation({ status: 'confirmed' }),
      makeParticipation({ status: 'declined' }),
    ]
    const warnings = getTrainingWarnings(parts, 5)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].level).toBe('red')
    expect(warnings[0].params?.count).toBe(2)
    expect(warnings[0].params?.min).toBe(5)
  })

  it('returns empty when confirmed >= min', () => {
    const parts = Array.from({ length: 5 }, () =>
      makeParticipation({ status: 'confirmed' }),
    )
    expect(getTrainingWarnings(parts, 5)).toEqual([])
  })

  it('excludes staff from count', () => {
    const parts = [
      ...Array.from({ length: 4 }, () => makeParticipation({ status: 'confirmed' })),
      makeParticipation({ status: 'confirmed', is_staff: true }),
    ]
    const warnings = getTrainingWarnings(parts, 5)
    expect(warnings).toHaveLength(1) // only 4 non-staff
  })
})

describe('getEventWarnings', () => {
  it('returns empty when no min set', () => {
    expect(getEventWarnings([], null)).toEqual([])
  })

  it('returns RED when confirmed < min', () => {
    const parts = [makeParticipation({ status: 'confirmed' })]
    const warnings = getEventWarnings(parts, 3)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].level).toBe('red')
  })

  it('returns empty when confirmed >= min', () => {
    const parts = Array.from({ length: 3 }, () =>
      makeParticipation({ status: 'confirmed' }),
    )
    expect(getEventWarnings(parts, 3)).toEqual([])
  })
})
