import { describe, it, expect } from 'vitest'
import type {
  Game,
  Training,
  HallEvent,
  HallSlot,
  HallClosure,
  Hall,
  Team,
  SlotClaim,
} from '../../../../types'
import {
  gameToVirtualSlots,
  trainingToVirtualSlot,
  hallEventToVirtualSlots,
  mergeVirtualSlots,
} from '../virtualSlots'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Week of Mon 2026-04-20 .. Sun 2026-04-26 (local dates).
// day_of_week: 0=Mon .. 6=Sun. We mostly use Wed (2026-04-22, dow 2).
const weekDays: Date[] = Array.from({ length: 7 }, (_, i) => new Date(2026, 3, 20 + i))
const WED = '2026-04-22'

const hallA: Hall = { id: 'h-a', name: 'KWI A', address: '', city: '', courts: 1, notes: '', maps_url: '', homologation: false, sv_hall_id: '' }
const hallB: Hall = { id: 'h-b', name: 'KWI B', address: '', city: '', courts: 1, notes: '', maps_url: '', homologation: false, sv_hall_id: '' }
const hallC: Hall = { id: 'h-c', name: 'KWI C', address: '', city: '', courts: 1, notes: '', maps_url: '', homologation: false, sv_hall_id: '' }
const halls: Hall[] = [hallA, hallB, hallC]

const teamVB = { id: '1', name: 'D1', sport: 'volleyball' } as unknown as Team
const teamBB = { id: '2', name: 'BB1', sport: 'basketball' } as unknown as Team
const teams: Team[] = [teamVB, teamBB]

function mkRealSlot(o: Partial<HallSlot>): HallSlot {
  return {
    id: '',
    collectionId: '',
    collectionName: 'hall_slots',
    created: '',
    updated: '',
    hall: hallA.id,
    team: [],
    day_of_week: 2,
    start_time: '00:00',
    end_time: '00:00',
    slot_type: 'training',
    recurring: false,
    valid_from: '',
    valid_until: '',
    indefinite: false,
    label: '',
    notes: '',
    ...o,
  } as HallSlot
}

function mkGame(o: Partial<Game>): Game {
  return {
    id: 'g1',
    game_id: '',
    home_team: 'KSCW',
    away_team: 'Opp',
    kscw_team: '1',
    hall: hallA.id,
    date: WED,
    time: '20:00',
    league: 'NLA',
    round: '',
    season: '',
    type: 'home',
    status: 'scheduled',
    ...o,
  } as unknown as Game
}

function mkTraining(o: Partial<Training>): Training {
  return {
    id: 't1',
    team: '1',
    hall_slot: '',
    date: WED,
    start_time: '18:00',
    end_time: '20:00',
    hall: hallA.id,
    hall_name: '',
    coach: '',
    notes: '',
    cancelled: false,
    cancel_reason: '',
    ...o,
  } as unknown as Training
}

function mkEvent(o: Partial<HallEvent>): HallEvent {
  return {
    id: 'e1',
    uid: '',
    title: '',
    date: WED,
    start_time: '19:00',
    end_time: '21:00',
    location: '',
    hall: [hallA.id],
    all_day: false,
    source: 'gcal',
    ...o,
  } as unknown as HallEvent
}

function mkClaim(o: Partial<SlotClaim>): SlotClaim {
  return {
    id: 'c1',
    hall_slot: '',
    hall: hallA.id,
    date: WED,
    start_time: '',
    end_time: '',
    claimed_by_team: '',
    claimed_by_member: '',
    freed_reason: 'cancelled_training',
    freed_source_id: '',
    notes: '',
    status: 'active',
    ...o,
  } as unknown as SlotClaim
}

function mkClosure(o: Partial<HallClosure>): HallClosure {
  return {
    id: 'cl1',
    hall: hallA.id,
    start_date: WED,
    end_date: WED,
    reason: '',
    source: 'admin',
    ...o,
  } as unknown as HallClosure
}

/** Projects an output HallSlot to a stable, fully-characterizing summary.
 *  Captures every field mergeVirtualSlots can set/override plus the full
 *  _virtual metadata. sourceRecord is reduced to its id (records flow through
 *  by reference, so id identifies them). */
function summarize(s: HallSlot) {
  return {
    id: s.id,
    collectionName: s.collectionName,
    hall: s.hall,
    team: s.team,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    slot_type: s.slot_type,
    recurring: s.recurring,
    valid_from: s.valid_from,
    valid_until: s.valid_until,
    label: s.label,
    notes: s.notes,
    virtual: s._virtual
      ? {
          source: s._virtual.source,
          sourceId: s._virtual.sourceId,
          sourceRecordId: (s._virtual.sourceRecord as { id?: string } | undefined)?.id,
          isAway: s._virtual.isAway,
          isCancelled: s._virtual.isCancelled,
          isFreed: s._virtual.isFreed,
          isClaimed: s._virtual.isClaimed,
          claimRecordId: s._virtual.claimRecord?.id,
          isTemplateFreed: s._virtual.isTemplateFreed,
          isSpielhalleFreed: s._virtual.isSpielhalleFreed,
          spanHallIds: s._virtual.spanHallIds,
        }
      : undefined,
  }
}

const summ = (rows: HallSlot[]) => rows.map(summarize)
const noClaims: SlotClaim[] = []
const noClosures: HallClosure[] = []
const noGames: Game[] = []

/** Asserts the summarized output equals the captured baseline exactly.
 *  toEqual ignores `undefined` props on the actual side, so the baseline
 *  literals (captured via JSON, which drops undefined) match cleanly. */
function check(result: HallSlot[], expected: unknown) {
  expect(summ(result)).toEqual(expected)
}

describe('mergeVirtualSlots — characterization', () => {
  it('1: all empty inputs → empty output', () => {
    const result = mergeVirtualSlots([], [], noClaims, noClosures, noGames, weekDays, halls, teams)
    check(result, [])
  })

  it('2: non-recurring real slot passes through unchanged', () => {
    const slot = mkRealSlot({ id: 'rs-nr', recurring: false, start_time: '18:00', end_time: '20:00', label: 'One-off' })
    const result = mergeVirtualSlots([slot], [], noClaims, noClosures, noGames, weekDays, halls, teams)
    check(result, [
      { id: 'rs-nr', collectionName: 'hall_slots', hall: 'h-a', team: [], day_of_week: 2, start_time: '18:00', end_time: '20:00', slot_type: 'training', recurring: false, valid_from: '', valid_until: '', label: 'One-off', notes: '' },
    ])
  })

  it('3: recurring training template with no replacement → freed template', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], start_time: '18:00', end_time: '20:00' })
    const result = mergeVirtualSlots([slot], [], noClaims, noClosures, noGames, weekDays, halls, teams)
    check(result, [
      { id: 'freed-recurring-rs1-2', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '18:00', end_time: '20:00', slot_type: 'training', recurring: true, valid_from: '', valid_until: '', label: '', notes: '', virtual: { source: 'training', sourceId: 'rs1', isFreed: true, isClaimed: false, isTemplateFreed: true } },
    ])
  })

  it('4: recurring template with active claim → freed + claimed', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], start_time: '18:00', end_time: '20:00' })
    const claim = mkClaim({ id: 'cl-a', hall_slot: 'rs1', date: WED, status: 'active' })
    const result = mergeVirtualSlots([slot], [], [claim], noClosures, noGames, weekDays, halls, teams)
    check(result, [
      { id: 'freed-recurring-rs1-2', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '18:00', end_time: '20:00', slot_type: 'training', recurring: true, valid_from: '', valid_until: '', label: '', notes: '', virtual: { source: 'training', sourceId: 'rs1', isFreed: false, isClaimed: true, claimRecordId: 'cl-a', isTemplateFreed: true } },
    ])
  })

  it('5: recurring external booking (label, no team) stays occupied', () => {
    const slot = mkRealSlot({ id: 'rs-ext', recurring: true, team: [], label: 'External renter', start_time: '18:00', end_time: '20:00' })
    const result = mergeVirtualSlots([slot], [], noClaims, noClosures, noGames, weekDays, halls, teams)
    check(result, [
      { id: 'rs-ext', collectionName: 'hall_slots', hall: 'h-a', team: [], day_of_week: 2, start_time: '18:00', end_time: '20:00', slot_type: 'training', recurring: true, valid_from: '', valid_until: '', label: 'External renter', notes: '' },
    ])
  })

  it('6: training virtual linked via hall_slot suppresses the recurring template', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], start_time: '18:00', end_time: '20:00' })
    const training = mkTraining({ id: 't-linked', hall_slot: 'rs1', date: WED, start_time: '18:00', end_time: '20:00' })
    const vs = trainingToVirtualSlot(training, weekDays)!
    const result = mergeVirtualSlots([slot], [vs], noClaims, noClosures, noGames, weekDays, halls, teams)
    check(result, [
      { id: 'training-t-linked', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '18:00', end_time: '20:00', slot_type: 'training', recurring: false, valid_from: '2026-04-22', valid_until: '2026-04-22', label: '', notes: '', virtual: { source: 'training', sourceId: 't-linked', sourceRecordId: 't-linked', isCancelled: false } },
    ])
  })

  it('7: away game frees the team recurring training slot', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], start_time: '18:00', end_time: '20:00' })
    const game = mkGame({ id: 'g-away', type: 'away', kscw_team: '1', date: WED })
    const result = mergeVirtualSlots([slot], [], noClaims, noClosures, [game], weekDays, halls, teams)
    check(result, [
      { id: 'freed-away-g-away-rs1', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '18:00', end_time: '20:00', slot_type: 'training', recurring: true, valid_from: '', valid_until: '', label: '', notes: '', virtual: { source: 'game', sourceId: 'g-away', sourceRecordId: 'g-away', isFreed: true, isClaimed: false } },
    ])
  })

  it('8: home game shortens the preceding recurring slot', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], hall: hallA.id, start_time: '18:00', end_time: '21:00' })
    const game = mkGame({ id: 'g-home', type: 'home', kscw_team: '1', hall: hallA.id, time: '20:00', date: WED })
    const gvs = gameToVirtualSlots(game, weekDays, halls, teams)
    const result = mergeVirtualSlots([slot], gvs, noClaims, noClosures, [game], weekDays, halls, teams)
    check(result, [
      { id: 'game-g-home', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '19:15', end_time: '22:00', slot_type: 'game', recurring: false, valid_from: '2026-04-22', valid_until: '2026-04-22', label: 'KSCW vs Opp', notes: 'NLA', virtual: { source: 'game', sourceId: 'g-home', sourceRecordId: 'g-home' } },
      { id: 'freed-recurring-rs1-2', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '18:00', end_time: '19:15', slot_type: 'training', recurring: true, valid_from: '', valid_until: '', label: '', notes: '', virtual: { source: 'training', sourceId: 'rs1', isFreed: true, isClaimed: false, isTemplateFreed: true } },
    ])
  })

  it('9: home game fully suppresses an overlapping recurring slot', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], hall: hallA.id, start_time: '19:30', end_time: '21:00' })
    const game = mkGame({ id: 'g-home', type: 'home', kscw_team: '1', hall: hallA.id, time: '20:00', date: WED })
    const gvs = gameToVirtualSlots(game, weekDays, halls, teams)
    const result = mergeVirtualSlots([slot], gvs, noClaims, noClosures, [game], weekDays, halls, teams)
    check(result, [
      { id: 'game-g-home', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '19:15', end_time: '22:00', slot_type: 'game', recurring: false, valid_from: '2026-04-22', valid_until: '2026-04-22', label: 'KSCW vs Opp', notes: 'NLA', virtual: { source: 'game', sourceId: 'g-home', sourceRecordId: 'g-home' } },
    ])
  })

  it('10: closure hall event suppresses overlapping recurring slot', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], hall: hallA.id, start_time: '18:00', end_time: '20:00' })
    const event = mkEvent({ id: 'e-closed', title: 'Halle geschlossen', hall: [hallA.id], all_day: true })
    const evs = hallEventToVirtualSlots(event, weekDays, halls)
    const result = mergeVirtualSlots([slot], evs, noClaims, noClosures, noGames, weekDays, halls, teams)
    check(result, [
      { id: 'hall-event-e-closed', collectionName: 'virtual', hall: 'h-a', team: [], day_of_week: 2, start_time: '10:00', end_time: '22:00', slot_type: 'event', recurring: false, valid_from: '2026-04-22', valid_until: '2026-04-22', label: 'Halle geschlossen', notes: '', virtual: { source: 'hall_event', sourceId: 'e-closed', sourceRecordId: 'e-closed' } },
    ])
  })

  it('11: BB game hall event suppresses overlapping recurring slot in spanned hall', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['2'], hall: hallA.id, start_time: '19:30', end_time: '21:00', slot_type: 'training' })
    const event = mkEvent({ id: 'e-bb', title: 'BB Herren 1 vs Gegner', hall: [hallA.id, hallB.id], start_time: '20:00', end_time: '22:00' })
    const evs = hallEventToVirtualSlots(event, weekDays, halls)
    const result = mergeVirtualSlots([slot], evs, noClaims, noClosures, noGames, weekDays, halls, teams)
    check(result, [
      { id: 'hall-event-e-bb', collectionName: 'virtual', hall: 'h-a', team: [], day_of_week: 2, start_time: '19:15', end_time: '22:00', slot_type: 'game', recurring: false, valid_from: '2026-04-22', valid_until: '2026-04-22', label: 'BB Herren 1 vs Gegner', notes: '', virtual: { source: 'hall_event', sourceId: 'e-bb', sourceRecordId: 'e-bb', spanHallIds: ['h-a', 'h-b'] } },
    ])
  })

  it('12: hall_closures record suppresses the recurring slot for that day', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], hall: hallA.id, start_time: '18:00', end_time: '20:00' })
    const closure = mkClosure({ id: 'cl-adm', hall: hallA.id, start_date: WED, end_date: WED, source: 'admin' })
    const result = mergeVirtualSlots([slot], [], noClaims, [closure], noGames, weekDays, halls, teams)
    check(result, [])
  })

  it('13: virtual training overlapping a home game is removed', () => {
    const training = mkTraining({ id: 't-over', date: WED, hall: hallA.id, start_time: '19:30', end_time: '21:00' })
    const tvs = trainingToVirtualSlot(training, weekDays)!
    const game = mkGame({ id: 'g-home', type: 'home', kscw_team: '1', hall: hallA.id, time: '20:00', date: WED })
    const gvs = gameToVirtualSlots(game, weekDays, halls, teams)
    const result = mergeVirtualSlots([], [tvs, ...gvs], noClaims, noClosures, [game], weekDays, halls, teams)
    check(result, [
      { id: 'game-g-home', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '19:15', end_time: '22:00', slot_type: 'game', recurring: false, valid_from: '2026-04-22', valid_until: '2026-04-22', label: 'KSCW vs Opp', notes: 'NLA', virtual: { source: 'game', sourceId: 'g-home', sourceRecordId: 'g-home' } },
    ])
  })

  it('14: cancelled training with hall_slot is annotated as freed', () => {
    const training = mkTraining({ id: 't-cancel', hall_slot: 'someslot', date: WED, cancelled: true, cancel_reason: 'Krank', start_time: '18:00', end_time: '20:00' })
    const tvs = trainingToVirtualSlot(training, weekDays)!
    const result = mergeVirtualSlots([], [tvs], noClaims, noClosures, noGames, weekDays, halls, teams)
    check(result, [
      { id: 'training-t-cancel', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '18:00', end_time: '20:00', slot_type: 'training', recurring: false, valid_from: '2026-04-22', valid_until: '2026-04-22', label: 'Abgesagt: Krank', notes: '', virtual: { source: 'training', sourceId: 't-cancel', sourceRecordId: 't-cancel', isCancelled: true, isFreed: true, isClaimed: false } },
    ])
  })

  it('15: postponed away game does NOT free the slot (falls through to template-freed)', () => {
    const slot = mkRealSlot({ id: 'rs1', recurring: true, team: ['1'], start_time: '18:00', end_time: '20:00' })
    const game = mkGame({ id: 'g-pp', type: 'away', kscw_team: '1', date: WED, status: 'postponed' })
    const result = mergeVirtualSlots([slot], [], noClaims, noClosures, [game], weekDays, halls, teams)
    check(result, [
      { id: 'freed-recurring-rs1-2', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 2, start_time: '18:00', end_time: '20:00', slot_type: 'training', recurring: true, valid_from: '', valid_until: '', label: '', notes: '', virtual: { source: 'training', sourceId: 'rs1', isFreed: true, isClaimed: false, isTemplateFreed: true } },
    ])
  })

  it('16: multi-source combined week (real recurring + training + home game + closure)', () => {
    const rsMon = mkRealSlot({ id: 'rs-mon', recurring: true, team: ['1'], day_of_week: 0, hall: hallA.id, start_time: '18:00', end_time: '20:00' })
    const rsWed = mkRealSlot({ id: 'rs-wed', recurring: true, team: ['1'], day_of_week: 2, hall: hallB.id, start_time: '18:00', end_time: '21:00' })
    const training = mkTraining({ id: 't-mon', hall_slot: 'rs-mon', team: '1', date: '2026-04-20', hall: hallA.id, start_time: '18:00', end_time: '20:00' })
    const tvs = trainingToVirtualSlot(training, weekDays)!
    const game = mkGame({ id: 'g-wed', type: 'home', kscw_team: '1', hall: hallB.id, time: '20:00', date: WED })
    const gvs = gameToVirtualSlots(game, weekDays, halls, teams)
    const result = mergeVirtualSlots([rsMon, rsWed], [tvs, ...gvs], noClaims, noClosures, [game], weekDays, halls, teams)
    check(result, [
      { id: 'training-t-mon', collectionName: 'virtual', hall: 'h-a', team: ['1'], day_of_week: 0, start_time: '18:00', end_time: '20:00', slot_type: 'training', recurring: false, valid_from: '2026-04-20', valid_until: '2026-04-20', label: '', notes: '', virtual: { source: 'training', sourceId: 't-mon', sourceRecordId: 't-mon', isCancelled: false } },
      { id: 'game-g-wed', collectionName: 'virtual', hall: 'h-b', team: ['1'], day_of_week: 2, start_time: '19:15', end_time: '22:00', slot_type: 'game', recurring: false, valid_from: '2026-04-22', valid_until: '2026-04-22', label: 'KSCW vs Opp', notes: 'NLA', virtual: { source: 'game', sourceId: 'g-wed', sourceRecordId: 'g-wed' } },
      { id: 'freed-recurring-rs-wed-2', collectionName: 'virtual', hall: 'h-b', team: ['1'], day_of_week: 2, start_time: '18:00', end_time: '19:15', slot_type: 'training', recurring: true, valid_from: '', valid_until: '', label: '', notes: '', virtual: { source: 'training', sourceId: 'rs-wed', isFreed: true, isClaimed: false, isTemplateFreed: true } },
    ])
  })
})
