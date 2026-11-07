import { describe, it, expect } from 'vitest'
import { trimConsecutiveGames } from '../virtualSlots'
import { buildConflictSet } from '../conflictDetection'
import type { HallSlot } from '../../../../types'

const slot = (id: string, start: string, end: string, extra: Partial<HallSlot> = {}): HallSlot => ({
  id,
  hall: 'kwi-a',
  day_of_week: 5,
  start_time: start,
  end_time: end,
  slot_type: 'game',
  valid_from: '2026-11-07',
  valid_until: '2026-11-07',
  team: [],
  _virtual: { source: 'game', sourceId: id },
  ...extra,
} as unknown as HallSlot)

const ends = (slots: HallSlot[]) => Object.fromEntries(slots.map((s) => [s.id, s.end_time]))

describe('trimConsecutiveGames', () => {
  it('ends a game when the next one starts, like the 07.11 Saturday in KWI A', () => {
    const trimmed = trimConsecutiveGames([
      slot('du23', '10:15', '13:00'),
      slot('d3', '12:45', '15:30'),
      slot('du18', '15:15', '18:00'),
    ])
    expect(ends(trimmed)).toEqual({ du23: '12:45', d3: '15:15', du18: '18:00' })
  })

  it('removes the conflict badge that those few minutes caused', () => {
    const games = [slot('du23', '10:15', '13:00'), slot('d3', '12:45', '15:30')]
    expect(buildConflictSet(games).size).toBe(2)
    expect(buildConflictSet(trimConsecutiveGames(games)).size).toBe(0)
  })

  it('keeps a real double booking: two games at the same start', () => {
    const games = [slot('a', '12:45', '15:30'), slot('b', '12:45', '15:30')]
    expect(ends(trimConsecutiveGames(games))).toEqual({ a: '15:30', b: '15:30' })
    expect(buildConflictSet(trimConsecutiveGames(games)).size).toBe(2)
  })

  it('keeps a real double booking: games too close for the first to have been played', () => {
    const games = [slot('a', '10:15', '13:00'), slot('b', '11:45', '14:30')]
    expect(ends(trimConsecutiveGames(games))).toEqual({ a: '13:00', b: '14:30' })
  })

  it('trims at exactly 2 hours, and not below', () => {
    expect(ends(trimConsecutiveGames([slot('a', '10:00', '12:45'), slot('b', '12:00', '14:45')])).a).toBe('12:00')
    expect(ends(trimConsecutiveGames([slot('a', '10:00', '12:45'), slot('b', '11:59', '14:44')])).a).toBe('12:45')
  })

  it('leaves games in another hall, or on another day, alone', () => {
    const otherHall = [slot('a', '10:15', '13:00'), slot('b', '12:45', '15:30', { hall: 'kwi-b' })]
    expect(ends(trimConsecutiveGames(otherHall)).a).toBe('13:00')
    const otherDay = [slot('a', '10:15', '13:00'), slot('b', '12:45', '15:30', { day_of_week: 6 })]
    expect(ends(trimConsecutiveGames(otherDay)).a).toBe('13:00')
  })

  it('leaves a training alone, and a training does not trim a game', () => {
    const mixed = [slot('game', '10:15', '13:00'), slot('training', '12:45', '14:00', { slot_type: 'training' })]
    expect(ends(trimConsecutiveGames(mixed))).toEqual({ game: '13:00', training: '14:00' })
  })

  it('follows a game across both halls of a shared court', () => {
    const span = { _virtual: { source: 'game', sourceId: 'x', spanHallIds: ['kwi-a', 'kwi-b'] } } as Partial<HallSlot>
    const games = [slot('both', '10:15', '13:00', span), slot('next', '12:45', '15:30', { hall: 'kwi-b' })]
    expect(ends(trimConsecutiveGames(games)).both).toBe('12:45')
  })

  it('does not change the slots it was given', () => {
    const games = [slot('a', '10:15', '13:00'), slot('b', '12:45', '15:30')]
    trimConsecutiveGames(games)
    expect(games[0].end_time).toBe('13:00')
  })
})
