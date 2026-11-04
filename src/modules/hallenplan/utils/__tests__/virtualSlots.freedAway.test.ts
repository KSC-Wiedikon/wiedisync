import { describe, it, expect } from 'vitest'
import type { HallSlot, Training, Game, SlotClaim, HallClosure } from '../../../../types'
import { mergeVirtualSlots, trainingToVirtualSlot } from '../virtualSlots'

// Week of Mon 2026-11-02 .. Sun 2026-11-08. Wed = 2026-11-04 (day_of_week 2).
const weekDays: Date[] = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 2 + i))

const noClaims: SlotClaim[] = []
const noClosures: HallClosure[] = []
const noGames: Game[] = []
const HORIZON = '2027-12-31'

// Directus returns Postgres TIME as HH:MM:SS.
function template(o: Partial<HallSlot> = {}): HallSlot {
  return {
    id: 'rs1', collectionId: '', collectionName: 'hall_slots', created: '', updated: '',
    hall: 'h-a', team: ['3'], day_of_week: 2, start_time: '18:00:00', end_time: '19:45:00',
    slot_type: 'training', recurring: true, valid_from: '', valid_until: '', indefinite: true,
    label: '', notes: '', ...o,
  } as HallSlot
}

function training(o: Partial<Training> = {}): HallSlot {
  return trainingToVirtualSlot({
    id: 't1', team: '3', hall_slot: 'rs1', date: '2026-11-04', start_time: '18:00:00', end_time: '19:45:00',
    hall: 'h-a', hall_name: '', coach: '', notes: '', cancelled: true, cancel_reason: '', ...o,
  } as unknown as Training, weekDays)!
}

function awayGame(id = 'g1'): Game {
  return { id, type: 'away', status: 'scheduled', kscw_team: '3', date: '2026-11-04', time: '20:00:00' } as unknown as Game
}

const merge = (real: HallSlot[], virtual: HallSlot[], games: Game[]) =>
  mergeVirtualSlots(real, virtual, noClaims, noClosures, games, weekDays, HORIZON)

const freed = (slots: HallSlot[]) => slots.filter((s) => s._virtual?.isFreed)

describe('a slot freed by an away game is offered once', () => {
  it('away game + the training the nightly sweep cancelled → one available slot', () => {
    const result = freed(merge([template()], [training()], [awayGame()]))
    expect(result.map((s) => s.id)).toEqual(['training-t1'])
  })

  it('away game + a training that is still on → nothing available, the training stays', () => {
    const result = merge([template()], [training({ cancelled: false })], [awayGame()])
    expect(freed(result)).toEqual([])
    expect(result.map((s) => s.id)).toEqual(['training-t1'])
  })

  it('away game + no training row at all → the template is offered', () => {
    const result = freed(merge([template()], [], [awayGame()]))
    expect(result.map((s) => s.id)).toEqual(['freed-away-g1-rs1'])
  })

  it('two away games on one day → still one available slot', () => {
    const result = freed(merge([template()], [], [awayGame('g1'), awayGame('g2')]))
    expect(result.map((s) => s.id)).toEqual(['freed-away-g1-rs1'])
  })
})

describe('merged slots carry HH:MM times', () => {
  it.each([
    ['freed by an away game', [template()], [], [awayGame()]],
    ['freed recurring template', [template()], [], noGames],
    ['teamless real slot', [template({ team: [], recurring: false })], [], noGames],
    ['cancelled training', [template()], [training()], noGames],
  ] as [string, HallSlot[], HallSlot[], Game[]][])('%s', (_name, real, virtual, games) => {
    const [slot] = merge(real, virtual, games)
    expect([slot.start_time, slot.end_time]).toEqual(['18:00', '19:45'])
  })
})
