import { describe, it, expect } from 'vitest'
import { canBroadcast, type ActivityWithTeam, type MemberLike } from '../canBroadcast'

const event = (over: Partial<ActivityWithTeam> = {}): ActivityWithTeam => ({
  type: 'event',
  id: 1,
  title: 'Vereinsanlass',
  ...over,
})
const game = (over: Partial<ActivityWithTeam> = {}): ActivityWithTeam => ({
  type: 'game',
  id: 2,
  title: 'KSCW vs Foo',
  teamId: 7,
  sport: 'volleyball',
  ...over,
})
const training = (over: Partial<ActivityWithTeam> = {}): ActivityWithTeam => ({
  type: 'training',
  id: 3,
  title: 'Training H1',
  teamId: 7,
  sport: 'volleyball',
  ...over,
})

const member = (over: Partial<MemberLike> = {}): MemberLike => ({
  id: 100,
  role: ['user'],
  isCoachOf: [],
  isResponsibleOf: [],
  ...over,
})

describe('canBroadcast', () => {
  it('admin → true for event, game, training', () => {
    const m = member({ role: ['user', 'admin'] })
    expect(canBroadcast(event(), m)).toBe(true)
    expect(canBroadcast(game(), m)).toBe(true)
    expect(canBroadcast(training(), m)).toBe(true)
  })

  it('superuser → true for event, game, training', () => {
    const m = member({ role: ['superuser'] })
    expect(canBroadcast(event(), m)).toBe(true)
    expect(canBroadcast(game(), m)).toBe(true)
    expect(canBroadcast(training(), m)).toBe(true)
  })

  it('vorstand → true for event, game, training', () => {
    const m = member({ role: ['board'] })
    expect(canBroadcast(event(), m)).toBe(true)
    expect(canBroadcast(game(), m)).toBe(true)
    expect(canBroadcast(training(), m)).toBe(true)
  })

  it("vb_admin + activity.sport='volleyball' → true", () => {
    const m = member({ role: ['vb_admin'] })
    expect(canBroadcast(game({ sport: 'volleyball' }), m)).toBe(true)
    expect(canBroadcast(training({ sport: 'volleyball' }), m)).toBe(true)
  })

  it("vb_admin + activity.sport='basketball' → false", () => {
    const m = member({ role: ['vb_admin'] })
    expect(canBroadcast(game({ sport: 'basketball' }), m)).toBe(false)
    expect(canBroadcast(training({ sport: 'basketball' }), m)).toBe(false)
  })

  it("bb_admin + activity.sport='basketball' → true", () => {
    const m = member({ role: ['bb_admin'] })
    expect(canBroadcast(game({ sport: 'basketball' }), m)).toBe(true)
  })

  it('coach of teamId X + game with teamId X → true', () => {
    const m = member({ role: ['user'], isCoachOf: [7] })
    expect(canBroadcast(game({ teamId: 7 }), m)).toBe(true)
    expect(canBroadcast(training({ teamId: 7 }), m)).toBe(true)
  })

  it('coach of teamId Y + game with teamId X → false', () => {
    const m = member({ role: ['user'], isCoachOf: [99] })
    expect(canBroadcast(game({ teamId: 7 }), m)).toBe(false)
  })

  it('team_responsible of teamId X + training with teamId X → true', () => {
    const m = member({ role: ['user'], isResponsibleOf: [7] })
    expect(canBroadcast(training({ teamId: 7 }), m)).toBe(true)
  })

  it("normal user (role=['user']) → false for all activity types", () => {
    const m = member({ role: ['user'] })
    expect(canBroadcast(event(), m)).toBe(false)
    expect(canBroadcast(game(), m)).toBe(false)
    expect(canBroadcast(training(), m)).toBe(false)
  })

  it('null member → false', () => {
    expect(canBroadcast(event(), null)).toBe(false)
    expect(canBroadcast(game(), null)).toBe(false)
    expect(canBroadcast(training(), null)).toBe(false)
  })

  it('coach of teamId X + EVENT (no teamId) → false', () => {
    const m = member({ role: ['user'], isCoachOf: [7] })
    expect(canBroadcast(event(), m)).toBe(false)
  })

  it('member with no role array → false', () => {
    const m = { id: 1 } as MemberLike
    expect(canBroadcast(game(), m)).toBe(false)
    expect(canBroadcast(event(), m)).toBe(false)
  })

  it('coerces numeric vs string team IDs in coach lookup', () => {
    const m = member({ role: ['user'], isCoachOf: ['7'] })
    expect(canBroadcast(game({ teamId: 7 }), m)).toBe(true)
  })

  it('vb_admin on a game with no sport → false (no global admin escalation)', () => {
    const m = member({ role: ['vb_admin'] })
    expect(canBroadcast(game({ sport: null }), m)).toBe(false)
  })
})
