import { describe, it, expect } from 'vitest'
import {
  resolveSessionTargets,
  statusWrites,
  noteWrites,
  uniformValue,
  allConfirmed,
} from './participationSessions'
import type { Participation } from '../types'

const row = (over: Partial<Participation>): Participation => ({
  id: '1',
  member: 'm1',
  activity_type: 'event',
  activity_id: '2',
  status: 'confirmed',
  note: '',
  session_id: '',
  guest_count: 0,
  is_staff: false,
  waitlisted_at: '',
  ...over,
} as Participation)

const SESSIONS = [{ id: '1' }, { id: '2' }]

describe('resolveSessionTargets', () => {
  it('returns one unscoped target for a non-session activity', () => {
    const mine = row({ id: '10', session_id: '' })
    const targets = resolveSessionTargets('m1', [mine], { isOverall: false, activeSessionId: null })
    expect(targets).toEqual([{ sessionId: null, row: mine }])
  })

  it('scopes to the open day tab and ignores other days', () => {
    const fri = row({ id: '10', session_id: '1', status: 'confirmed' })
    const sat = row({ id: '11', session_id: '2', status: 'declined' })
    const targets = resolveSessionTargets('m1', [fri, sat], { isOverall: false, activeSessionId: '2' })
    expect(targets).toEqual([{ sessionId: '2', row: sat }])
  })

  it('never hands back another day\'s row when the open day has none', () => {
    // The club-wide fetch is not session-filtered, so this is the case that
    // used to silently update the wrong day.
    const fri = row({ id: '10', session_id: '1' })
    const targets = resolveSessionTargets('m1', [fri], { isOverall: false, activeSessionId: '2' })
    expect(targets).toEqual([{ sessionId: '2', row: null }])
  })

  it('fans out to every day on the Overall tab', () => {
    const fri = row({ id: '10', session_id: '1', status: 'confirmed' })
    const targets = resolveSessionTargets('m1', [fri], {
      isOverall: true, activeSessionId: null, sessions: SESSIONS,
    })
    expect(targets).toEqual([
      { sessionId: '1', row: fri },
      { sessionId: '2', row: null },
    ])
  })

  it('matches session ids across the int/text boundary', () => {
    // event_sessions.id is an int PK, participations.session_id is varchar.
    const fri = row({ id: '10', session_id: '1' })
    const targets = resolveSessionTargets('m1', [fri], {
      isOverall: true, activeSessionId: null, sessions: [{ id: 1 as unknown as string }],
    })
    expect(targets[0].row).toBe(fri)
  })

  it('does not mix up members', () => {
    const theirs = row({ id: '10', member: 'm2', session_id: '1' })
    const targets = resolveSessionTargets('m1', [theirs], {
      isOverall: true, activeSessionId: null, sessions: [{ id: '1' }],
    })
    expect(targets[0].row).toBeNull()
  })

  it('ignores a legacy session-less row when a day tab is open', () => {
    // Rows written before the session_id fix. They must never be adopted as
    // "the row for Friday" — that would resurrect the invisible-orphan bug.
    const orphan = row({ id: '10', session_id: '' })
    const targets = resolveSessionTargets('m1', [orphan], { isOverall: false, activeSessionId: '1' })
    expect(targets[0].row).toBeNull()
  })
})

describe('statusWrites', () => {
  const targets = (...statuses: Array<Participation['status'] | null>) =>
    statuses.map((s, i) => ({
      sessionId: String(i + 1),
      row: s === null ? null : row({ id: String(10 + i), session_id: String(i + 1), status: s }),
    }))

  it('is a no-op when every day already says it', () => {
    expect(statusWrites(targets('confirmed', 'confirmed'), 'confirmed')).toEqual([])
  })

  it('is a no-op when clearing a member with no rows', () => {
    expect(statusWrites(targets(null, null), '')).toEqual([])
  })

  it('writes only the days that disagree', () => {
    const t = targets('confirmed', 'declined')
    expect(statusWrites(t, 'confirmed')).toEqual([t[1]])
  })

  it('creates for days with no row yet', () => {
    const t = targets('confirmed', null)
    expect(statusWrites(t, 'confirmed')).toEqual([t[1]])
    expect(statusWrites(t, 'confirmed')[0].sessionId).toBe('2')
  })

  it('clears every day that has a row', () => {
    const t = targets('confirmed', null)
    expect(statusWrites(t, '')).toEqual([t[0]])
  })
})

describe('noteWrites', () => {
  it('writes an empty string over a never-set note (suppresses the absence fallback)', () => {
    const t = [{ sessionId: '1', row: row({ note: undefined as unknown as string }) }]
    expect(noteWrites(t, '')).toHaveLength(1)
  })

  it('is a no-op when the note is already explicitly empty', () => {
    expect(noteWrites([{ sessionId: '1', row: row({ note: '' }) }], '')).toEqual([])
  })

  it('is a no-op on a byte-identical note', () => {
    expect(noteWrites([{ sessionId: '1', row: row({ note: 'Injured' }) }], 'Injured')).toEqual([])
  })

  it('does not create a row for an empty note on a never-RSVPed member', () => {
    expect(noteWrites([{ sessionId: '1', row: null }], '')).toEqual([])
  })

  it('creates a row when a note is actually typed', () => {
    expect(noteWrites([{ sessionId: '1', row: null }], 'Out for the season')).toHaveLength(1)
  })
})

describe('uniformValue', () => {
  it('returns the shared status when every day agrees', () => {
    const t = [
      { sessionId: '1', row: row({ status: 'declined' }) },
      { sessionId: '2', row: row({ status: 'declined' }) },
    ]
    expect(uniformValue(t, 'status')).toBe('declined')
  })

  it('returns blank when the days disagree', () => {
    const t = [
      { sessionId: '1', row: row({ status: 'confirmed' }) },
      { sessionId: '2', row: row({ status: 'declined' }) },
    ]
    expect(uniformValue(t, 'status')).toBe('')
  })

  it('returns blank when only one day carries a note', () => {
    // Prefilling here would copy that note onto every day on blur.
    const t = [
      { sessionId: '1', row: row({ note: 'Late' }) },
      { sessionId: '2', row: null },
    ]
    expect(uniformValue(t, 'note')).toBe('')
  })

  it('treats a missing row as blank', () => {
    expect(uniformValue([{ sessionId: '1', row: null }], 'status')).toBe('')
  })
})

describe('allConfirmed', () => {
  it('is true only when every day is confirmed', () => {
    expect(allConfirmed([
      { sessionId: '1', row: row({ status: 'confirmed' }) },
      { sessionId: '2', row: row({ status: 'confirmed' }) },
    ])).toBe(true)
  })

  it('is false when one day is not confirmed — the late-signin prompt must still pop', () => {
    expect(allConfirmed([
      { sessionId: '1', row: row({ status: 'confirmed' }) },
      { sessionId: '2', row: null },
    ])).toBe(false)
  })

  it('is false for an empty target list', () => {
    expect(allConfirmed([])).toBe(false)
  })
})
