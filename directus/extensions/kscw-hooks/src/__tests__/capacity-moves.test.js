/**
 * Waiting-list notifications (migration 437). The seat rule is SQL (tested on dev
 * against the real triggers); this pins what gets announced from the queue.
 */
import { describe, it, expect, vi } from 'vitest'
import { movesToAnnounce, capacityMessageKeys, drainCapacityMoves } from '../capacity-moves.js'

const status = (pairs) => new Map(Object.entries(pairs))

describe('movesToAnnounce', () => {
  it('announces a move that is still true', () => {
    const out = movesToAnnounce([{ id: 1, participation: 10, move: 'waitlisted' }], status({ 10: 'waitlisted' }))
    expect(out.map((m) => m.id)).toEqual([1])
  })

  it('says nothing when the RSVP has moved on since (declined after being bumped)', () => {
    expect(movesToAnnounce([{ id: 1, participation: 10, move: 'waitlisted' }], status({ 10: 'declined' }))).toEqual([])
  })

  it('says nothing when the moves cancel out (bumped, then promoted back)', () => {
    const moves = [{ id: 2, participation: 10, move: 'confirmed' }, { id: 1, participation: 10, move: 'waitlisted' }]
    expect(movesToAnnounce(moves, status({ 10: 'confirmed' }))).toEqual([])
  })

  it('keeps the latest of an odd chain', () => {
    const moves = [
      { id: 1, participation: 10, move: 'waitlisted' },
      { id: 2, participation: 10, move: 'confirmed' },
      { id: 3, participation: 10, move: 'waitlisted' },
    ]
    expect(movesToAnnounce(moves, status({ 10: 'waitlisted' })).map((m) => m.id)).toEqual([3])
  })

  it('handles several RSVPs independently and skips rows without one', () => {
    const moves = [
      { id: 1, participation: 10, move: 'confirmed' },
      { id: 2, participation: 11, move: 'waitlisted' },
      { id: 3, participation: null, move: 'confirmed' },
    ]
    expect(movesToAnnounce(moves, status({ 10: 'confirmed', 11: 'waitlisted' })).map((m) => m.id)).toEqual([1, 2])
  })
})

describe('capacityMessageKeys', () => {
  it('maps a move to the bell and push keys', () => {
    expect(capacityMessageKeys('waitlisted', 'training')).toEqual({
      bell: 'waitlist_bumped_training', pushTitle: 'waitlistBumped.title', pushBody: 'waitlistBumped.training',
    })
    expect(capacityMessageKeys('confirmed', 'event')).toEqual({
      bell: 'waitlist_promoted_event', pushTitle: 'waitlistPromoted.title', pushBody: 'waitlistPromoted.event',
    })
  })
})

/** knex stand-in for exactly the calls drainCapacityMoves makes. */
function makeDb({ claimed, participations, trainings = [], events = [] }) {
  const inserted = []
  const db = (table) => ({
    whereIn(_col, ids) {
      return { select: async () => participations.filter((p) => ids.includes(p.id)) }
    },
    insert: async (rows) => { inserted.push(...rows.map((r) => ({ table, ...r }))) },
  })
  db.raw = vi.fn(async (sql) => {
    if (sql.includes('UPDATE participation_capacity_moves')) return { rows: claimed }
    if (sql.includes('FROM trainings')) return { rows: trainings }
    if (sql.includes('FROM events')) return { rows: events }
    throw new Error(`unexpected raw: ${sql}`)
  })
  return { db, inserted }
}

describe('drainCapacityMoves', () => {
  it('writes one bell row per member and one push per activity and move', async () => {
    const { db, inserted } = makeDb({
      claimed: [
        { id: 1, participation: 10, member: 100, activity_type: 'training', activity_id: '7', move: 'waitlisted' },
        { id: 2, participation: 11, member: 101, activity_type: 'training', activity_id: '7', move: 'confirmed' },
        { id: 3, participation: 12, member: 102, activity_type: 'training', activity_id: '7', move: 'confirmed' },
        { id: 4, participation: 13, member: 103, activity_type: 'event', activity_id: '9', move: 'confirmed' },
      ],
      participations: [
        { id: 10, status: 'waitlisted' }, { id: 11, status: 'confirmed' },
        { id: 12, status: 'confirmed' }, { id: 13, status: 'confirmed' },
      ],
      trainings: [{ id: 7, team: 3, team_name: 'Damen 1', date: '06.11.2026', time: '20:00', upcoming: true }],
      events: [{ id: 9, title: 'Turnier', date: '14.11.2026', time: '09:00', upcoming: true }],
    })
    const push = vi.fn(async () => {})
    const res = await drainCapacityMoves(db, { push, frontendUrl: 'https://app', log: console })

    expect(res).toEqual({ claimed: 4, notified: 4 })
    expect(inserted.map((r) => [r.member, r.title, r.activity_id, r.team])).toEqual([
      [100, 'waitlist_bumped_training', '7', 3],
      [101, 'waitlist_promoted_training', '7', 3],
      [102, 'waitlist_promoted_training', '7', 3],
      [103, 'waitlist_promoted_event', '9', null],
    ])
    expect(JSON.parse(inserted[0].body)).toEqual({ team: 'Damen 1', date: '06.11.2026', time: '20:00' })
    expect(push.mock.calls).toEqual([
      [[100], 'waitlistBumped.title', 'waitlistBumped.training', { team: 'Damen 1', date: '06.11.2026', time: '20:00' }, 'https://app/trainings/7', 'waitlist-training-7'],
      [[101, 102], 'waitlistPromoted.title', 'waitlistPromoted.training', { team: 'Damen 1', date: '06.11.2026', time: '20:00' }, 'https://app/trainings/7', 'waitlist-training-7'],
      [[103], 'waitlistPromoted.title', 'waitlistPromoted.event', { title: 'Turnier', date: '14.11.2026', time: '09:00' }, 'https://app/events/9', 'waitlist-event-9'],
    ])
  })

  it('stays quiet about a past or cancelled activity', async () => {
    const { db, inserted } = makeDb({
      claimed: [{ id: 1, participation: 10, member: 100, activity_type: 'training', activity_id: '7', move: 'confirmed' }],
      participations: [{ id: 10, status: 'confirmed' }],
      trainings: [{ id: 7, team: 3, team_name: 'Damen 1', date: '01.10.2026', time: '20:00', upcoming: false }],
    })
    const push = vi.fn()
    expect(await drainCapacityMoves(db, { push, frontendUrl: 'https://app', log: console })).toEqual({ claimed: 1, notified: 0 })
    expect(inserted).toEqual([])
    expect(push).not.toHaveBeenCalled()
  })

  it('does nothing when the queue is empty', async () => {
    const { db } = makeDb({ claimed: [], participations: [] })
    const push = vi.fn()
    expect(await drainCapacityMoves(db, { push, frontendUrl: 'https://app', log: console })).toEqual({ claimed: 0, notified: 0 })
    expect(db.raw).toHaveBeenCalledTimes(1)
  })

  it('a failed push does not lose the bell rows or stop the other pushes', async () => {
    const { db, inserted } = makeDb({
      claimed: [
        { id: 1, participation: 10, member: 100, activity_type: 'event', activity_id: '9', move: 'confirmed' },
        { id: 2, participation: 11, member: 101, activity_type: 'event', activity_id: '9', move: 'waitlisted' },
      ],
      participations: [{ id: 10, status: 'confirmed' }, { id: 11, status: 'waitlisted' }],
      events: [{ id: 9, title: 'Turnier', date: '14.11.2026', time: '09:00', upcoming: true }],
    })
    const push = vi.fn().mockRejectedValueOnce(new Error('worker down')).mockResolvedValueOnce(undefined)
    const log = { warn: vi.fn() }
    await drainCapacityMoves(db, { push, frontendUrl: 'https://app', log })
    expect(inserted).toHaveLength(2)
    expect(push).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledTimes(1)
  })
})
