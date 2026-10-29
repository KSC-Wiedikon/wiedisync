/**
 * Unit tests for broadcast-helpers.js (Plan 01 / Phase B / Task B3).
 *
 * Hermetic — no real DB or network. Knex is mocked via a chainable shim.
 *
 * Style mirrors the project's other vitest test files: a single `describe`
 * per helper, one `it` per scenario,
 * `expect(...).toThrow()` / `rejects.toThrow()` patterns.
 */
import { describe, it, expect } from 'vitest'
import {
  BroadcastError,
  validateBroadcastPayload,
  checkRateLimit,
  resolveAudience,
  resolveUnansweredMembers,
} from '../broadcast-helpers.js'

// ─── Knex mock helpers ───────────────────────────────────────────────────────
//
// The helpers under test build query chains like:
//   db('table').where(...).andWhere(...).whereIn(...).orderBy(...).limit(...).select(...)
//   db('table as p').join(...).where(...).whereIn(...).distinct(...).select(...)
//
// Knex query builders are *thenable* — `await` on the chain resolves with rows.
// Our mock returns a chain object whose `.then` resolves with the configured
// rows; every other method returns `this` so chaining keeps working.
//
// To support multi-table fixtures we build a `makeDb(tableMap)` where keys are
// table names (or `"table as alias"` strings) and values are the rows to return.

function makeChain(rows) {
  const chain = {
    select: () => chain,
    where: () => chain,
    andWhere: () => chain,
    whereIn: () => chain,
    whereNotNull: () => chain,
    whereRaw: () => chain,
    orWhere: () => chain,
    orWhereNull: () => chain,
    join: () => chain,
    leftJoin: () => chain,
    distinct: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    count: () => chain,
    first: () => Promise.resolve(rows?.[0]),
    then: (resolve, reject) => Promise.resolve(rows ?? []).then(resolve, reject),
    catch: (reject) => Promise.resolve(rows ?? []).catch(reject),
  }
  return chain
}

/** Build a knex-shaped mock from a `{ tableKey: rows }` map. */
function makeDb(tableMap) {
  return (table) => {
    if (Object.prototype.hasOwnProperty.call(tableMap, table)) {
      return makeChain(tableMap[table])
    }
    // Default to empty result set when an unknown table is queried.
    return makeChain([])
  }
}

// ─── 1. validateBroadcastPayload ─────────────────────────────────────────────

describe('validateBroadcastPayload', () => {
  const validBody = () => ({
    channels: { email: true, push: true },
    subject: 'Heads up',
    message: 'Practice moved to 19:00.',
    audience: { statuses: ['confirmed', 'tentative'], includeExternals: false },
  })

  it('accepts a valid full payload (email + push, audience, subject, message) without throwing', () => {
    expect(() => validateBroadcastPayload(validBody())).not.toThrow()
  })

  it('throws 400 with field=message when message is missing', () => {
    const body = validBody()
    delete body.message
    try {
      validateBroadcastPayload(body)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError)
      expect(err.status).toBe(400)
      expect(err.details?.field).toBe('message')
    }
  })

  it('throws 400 with field=channels when all channels are false', () => {
    const body = validBody()
    body.channels = { email: false, push: false }
    try {
      validateBroadcastPayload(body)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError)
      expect(err.status).toBe(400)
      expect(err.details?.field).toBe('channels')
    }
  })

  it('throws 400 with field=subject when channels.email=true and subject is missing', () => {
    const body = validBody()
    delete body.subject
    try {
      validateBroadcastPayload(body)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError)
      expect(err.status).toBe(400)
      expect(err.details?.field).toBe('subject')
    }
  })

  it('throws 400 when subject length is 2 (too short)', () => {
    const body = validBody()
    body.subject = 'ab'
    try {
      validateBroadcastPayload(body)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError)
      expect(err.status).toBe(400)
      expect(err.details?.field).toBe('subject')
    }
  })

  it('throws 400 when subject length is 201 (too long)', () => {
    const body = validBody()
    body.subject = 'x'.repeat(201)
    try {
      validateBroadcastPayload(body)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError)
      expect(err.status).toBe(400)
      expect(err.details?.field).toBe('subject')
    }
  })

  it('throws 400 when message has 0 chars (empty after trim)', () => {
    const body = validBody()
    body.message = '   '
    try {
      validateBroadcastPayload(body)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError)
      expect(err.status).toBe(400)
      expect(err.details?.field).toBe('message')
    }
  })

  it('throws 400 when message has 2001 chars (too long)', () => {
    const body = validBody()
    body.message = 'a'.repeat(2001)
    try {
      validateBroadcastPayload(body)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError)
      expect(err.status).toBe(400)
      expect(err.details?.field).toBe('message')
    }
  })

  it('throws 400 when audience.statuses is empty', () => {
    const body = validBody()
    body.audience.statuses = []
    try {
      validateBroadcastPayload(body)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError)
      expect(err.status).toBe(400)
      expect(err.details?.field).toBe('audience.statuses')
    }
  })

  it('throws 400 when audience.statuses contains an invalid status', () => {
    const body = validBody()
    body.audience.statuses = ['confirmed', 'foobar']
    try {
      validateBroadcastPayload(body)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BroadcastError)
      expect(err.status).toBe(400)
      expect(err.details?.field).toBe('audience.statuses')
    }
  })

})

// ─── 2. checkRateLimit ───────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  it('returns { allowed:true } when there are 0 broadcasts in the past hour', async () => {
    const db = makeDb({ broadcasts: [] })
    const result = await checkRateLimit(db, 'event', 42)
    expect(result).toEqual({ allowed: true })
  })

  it('returns { allowed:true } when there are 2 past-hour broadcasts and last was 30 min ago', async () => {
    const now = Date.now()
    const rows = [
      { sent_at: new Date(now - 30 * 60 * 1000).toISOString() }, // most recent
      { sent_at: new Date(now - 50 * 60 * 1000).toISOString() },
    ]
    const db = makeDb({ broadcasts: rows })
    const result = await checkRateLimit(db, 'event', 42)
    expect(result).toEqual({ allowed: true })
  })

  it('returns { allowed:false, retryAfterSec>0 } when there are 3 past-hour broadcasts', async () => {
    const now = Date.now()
    const rows = [
      { sent_at: new Date(now - 5 * 60 * 1000).toISOString() },
      { sent_at: new Date(now - 25 * 60 * 1000).toISOString() },
      { sent_at: new Date(now - 55 * 60 * 1000).toISOString() }, // oldest
    ]
    const db = makeDb({ broadcasts: rows })
    const result = await checkRateLimit(db, 'event', 42)
    expect(result.allowed).toBe(false)
    expect(typeof result.retryAfterSec).toBe('number')
    expect(result.retryAfterSec).toBeGreaterThan(0)
  })

  it('returns { allowed:false, retryAfterSec>0 } when 1 broadcast was sent 5 min ago', async () => {
    const now = Date.now()
    const rows = [
      { sent_at: new Date(now - 5 * 60 * 1000).toISOString() },
    ]
    const db = makeDb({ broadcasts: rows })
    const result = await checkRateLimit(db, 'event', 42)
    expect(result.allowed).toBe(false)
    expect(typeof result.retryAfterSec).toBe('number')
    expect(result.retryAfterSec).toBeGreaterThan(0)
  })
})

// ─── 3. resolveAudience ──────────────────────────────────────────────────────

describe('resolveAudience', () => {
  it('event with statuses=[confirmed]: returns memberIds from participations only', async () => {
    const db = makeDb({
      'participations as p': [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ],
    })
    const result = await resolveAudience(db, 'event', 99, { statuses: ['confirmed'] })
    expect(result.memberIds).toEqual([1, 2, 3])
    expect(result.externals).toEqual([])
  })

  it('event with statuses=[confirmed,tentative] + includeExternals=true: returns memberIds + externals', async () => {
    const db = makeDb({
      'participations as p': [{ id: 7 }, { id: 8 }],
      event_signups: [
        { id: 'ext-1', email: 'guest@example.com', name: 'Guest One', language: 'de' },
        { id: 'ext-2', email: 'guest2@example.com', name: 'Guest Two', language: null },
      ],
    })
    const result = await resolveAudience(db, 'event', 99, {
      statuses: ['confirmed', 'tentative'],
      includeExternals: true,
    })
    expect(result.memberIds).toEqual([7, 8])
    expect(result.externals).toHaveLength(2)
    expect(result.externals[0]).toEqual({
      id: 'ext-1', email: 'guest@example.com', name: 'Guest One', language: 'de',
    })
    expect(result.externals[1].language).toBe(null)
  })

  it('event with includeExternals=true but no signups: externals=[]', async () => {
    const db = makeDb({
      'participations as p': [{ id: 11 }],
      event_signups: [],
    })
    const result = await resolveAudience(db, 'event', 99, {
      statuses: ['confirmed'],
      includeExternals: true,
    })
    expect(result.memberIds).toEqual([11])
    expect(result.externals).toEqual([])
  })

  it('game with statuses=[confirmed] (no externals concept): returns memberIds only', async () => {
    const db = makeDb({
      'participations as p': [{ id: 21 }, { id: 22 }],
      // event_signups should not be queried for games — but configure anyway as
      // a tripwire: if the impl ever wires it for games, this list would leak.
      event_signups: [
        { id: 'ext-x', email: 'shouldnotappear@example.com', name: 'X', language: 'en' },
      ],
    })
    const result = await resolveAudience(db, 'game', 555, {
      statuses: ['confirmed'],
      includeExternals: true, // even with this flag, games should ignore externals
    })
    expect(result.memberIds).toEqual([21, 22])
    expect(result.externals).toEqual([])
  })
})

describe('resolveUnansweredMembers', () => {
  /** A db whose `.raw` records the SQL + binds and returns the given ids. */
  function makeRawDb(ids, { teamCount = 1, memberCount = 0 } = {}) {
    const calls = []
    const db = makeDb({
      events_teams: [{ c: teamCount }],
      events_members: [{ c: memberCount }],
    })
    db.raw = async (sql, binds) => {
      calls.push({ sql, binds })
      return { rows: ids.map(id => ({ id: String(id) })) }
    }
    return { db, calls }
  }

  // Staff (coaches / team responsibles) hold no member_teams row; a bare
  // member_teams join silently meant "players only" (2026-10-28).
  const expectsTeamPeople = (sql) => {
    expect(sql).toContain('teams_coaches')
    expect(sql).toContain('teams_responsibles')
    expect(sql).not.toMatch(/JOIN member_teams mt ON mt\.team = /)
  }

  it('training: team people (players ∪ staff), excluded_guest_levels still applies', async () => {
    const { db, calls } = makeRawDb([226, 272])
    const ids = await resolveUnansweredMembers(db, 'training', 2873)
    expect(ids).toEqual([226, 272])
    expect(calls).toHaveLength(1)
    expectsTeamPeople(calls[0].sql)
    expect(calls[0].sql).toContain('excluded_guest_levels')
    expect(calls[0].binds).toEqual([2873, '2873'])
  })

  it('game: guest_level = 0, staff additionally guarded by notGuestAnywhere', async () => {
    const { db, calls } = makeRawDb([336])
    const ids = await resolveUnansweredMembers(db, 'game', 691)
    expect(ids).toEqual([336])
    expectsTeamPeople(calls[0].sql)
    expect(calls[0].sql).toContain('e.guest_level = 0')
    expect(calls[0].sql).toMatch(/e\.is_staff = false OR NOT EXISTS/)
    expect(calls[0].binds).toEqual([691, '691'])
  })

  it('team-scoped event: the events_teams arm uses team people too', async () => {
    const { db, calls } = makeRawDb([5])
    const ids = await resolveUnansweredMembers(db, 'event', 22)
    expect(ids).toEqual([5])
    expectsTeamPeople(calls[0].sql)
    expect(calls[0].sql).toContain('events_members')
    expect(calls[0].binds).toEqual([22, 22, '22'])
  })
})
