import { describe, expect, it } from 'vitest'
import type { Game } from '../../../types'
import { servedDutiesByMember } from './dutyHistory'

const game = (id: string, date: string, seats: Record<string, unknown>) =>
  ({ id, date, ...seats }) as unknown as Game

describe('servedDutiesByMember', () => {
  const games = [
    game('1', '2026-10-04', { bb_scorer_member: '10', bb_timekeeper_member: '11', bb_24s_official: null }),
    game('2', '2026-11-06', { bb_scorer_member: '11', bb_timekeeper_member: '', bb_24s_official: '12', scorer_member: '99' }),
  ]

  it('counts every basketball seat a member held, newest first', () => {
    const m = servedDutiesByMember(games, 'basketball')
    expect(m.get('11')?.map((d) => [d.gameId, d.seat])).toEqual([['2', 'bb_scorer_member'], ['1', 'bb_timekeeper_member']])
    expect(m.get('10')).toHaveLength(1)
    expect(m.get('12')?.[0].seat).toBe('bb_24s_official')
  })

  it('skips empty seats and seats of the other sport', () => {
    const m = servedDutiesByMember(games, 'basketball')
    expect(m.has('99')).toBe(false)
    expect(m.has('')).toBe(false)
    expect(servedDutiesByMember(games, 'volleyball').get('99')).toHaveLength(1)
  })

  it('reads an expanded member object', () => {
    const m = servedDutiesByMember([game('3', '2026-09-20', { bb_scorer_member: { id: 7 } })], 'basketball')
    expect(m.get('7')).toHaveLength(1)
  })
})
