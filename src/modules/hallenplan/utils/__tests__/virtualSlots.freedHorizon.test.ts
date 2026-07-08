import { describe, it, expect } from 'vitest'
import type { HallSlot, Hall, Team, Training, HallClosure, Game, SlotClaim } from '../../../../types'
import { mergeVirtualSlots, trainingToVirtualSlot } from '../virtualSlots'

// Week of Mon 2026-04-20 .. Sun 2026-04-26. Wed = 2026-04-22 (day_of_week 2).
const weekDays: Date[] = Array.from({ length: 7 }, (_, i) => new Date(2026, 3, 20 + i))

const hallA: Hall = { id: 'h-a', name: 'KWI A', address: '', city: '', courts: 1, notes: '', maps_url: '', homologation: false, sv_hall_id: '' }
const halls: Hall[] = [hallA]
const teams: Team[] = [{ id: '1', name: 'D1', sport: 'volleyball' } as unknown as Team]
const noClaims: SlotClaim[] = []
const noClosures: HallClosure[] = []
const noGames: Game[] = []

function mkRealSlot(o: Partial<HallSlot>): HallSlot {
  return {
    id: '', collectionId: '', collectionName: 'hall_slots', created: '', updated: '',
    hall: hallA.id, team: [], day_of_week: 2, start_time: '00:00', end_time: '00:00',
    slot_type: 'training', recurring: false, valid_from: '', valid_until: '', indefinite: false,
    label: '', notes: '', ...o,
  } as HallSlot
}

function mkTraining(o: Partial<Training>): Training {
  return {
    id: 't1', team: '1', hall_slot: '', date: '2026-04-22', start_time: '18:00', end_time: '20:00',
    hall: hallA.id, hall_name: '', coach: '', notes: '', cancelled: false, cancel_reason: '', ...o,
  } as unknown as Training
}

describe('freed-slot generation horizon', () => {
  const recurringTemplate = () =>
    mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], start_time: '18:00', end_time: '20:00' })

  it('within the horizon: a surviving template is freed/claimable (green)', () => {
    // horizon well after the displayed Wed 2026-04-22 → genuine free slot
    const result = mergeVirtualSlots([recurringTemplate()], [], noClaims, noClosures, noGames, weekDays, halls, teams, '2026-12-31')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('freed-recurring-rs1-2')
    expect(result[0]._virtual?.isFreed).toBe(true)
    expect(result[0]._virtual?.isTemplateFreed).toBe(true)
  })

  it('beyond the horizon: the template stays an occupied (planned) training, not free', () => {
    // horizon before the displayed Wed → training not generated yet → NOT claimable
    const result = mergeVirtualSlots([recurringTemplate()], [], noClaims, noClosures, noGames, weekDays, halls, teams, '2026-04-01')
    expect(result).toHaveLength(1)
    // Original real slot passes through unchanged — no freed/virtual annotation
    expect(result[0].id).toBe('rs1')
    expect(result[0].collectionName).toBe('hall_slots')
    expect(result[0]._virtual).toBeUndefined()
  })

  it('no horizon passed (undefined) preserves legacy freed behaviour', () => {
    const result = mergeVirtualSlots([recurringTemplate()], [], noClaims, noClosures, noGames, weekDays, halls, teams)
    expect(result[0].id).toBe('freed-recurring-rs1-2')
    expect(result[0]._virtual?.isTemplateFreed).toBe(true)
  })
})

describe('trainingToVirtualSlot — hall-less trainings', () => {
  it('returns null for a training with no hall (cannot be placed on the Hallenplan)', () => {
    expect(trainingToVirtualSlot(mkTraining({ hall: null as unknown as string }), weekDays)).toBeNull()
    expect(trainingToVirtualSlot(mkTraining({ hall: undefined as unknown as string }), weekDays)).toBeNull()
    expect(trainingToVirtualSlot(mkTraining({ hall: '' }), weekDays)).toBeNull()
  })

  it('still emits a slot for a training that has a hall', () => {
    const vs = trainingToVirtualSlot(mkTraining({ hall: hallA.id }), weekDays)
    expect(vs).not.toBeNull()
    expect(vs!.hall).toBe(hallA.id)
  })
})
