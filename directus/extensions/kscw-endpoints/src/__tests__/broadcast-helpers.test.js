/**
 * Unit tests for broadcast-helpers.js (Plan 01 / Phase B / Task B3).
 *
 * Hermetic — no real DB or network. Knex is mocked via a chainable shim.
 *
 * Style mirrors the project's other vitest test files (`src/modules/messaging/
 * __tests__/*.test.ts`): a single `describe` per helper, one `it` per scenario,
 * `expect(...).toThrow()` / `rejects.toThrow()` patterns.
 */
import { describe, it, expect } from 'vitest'
import {
  BroadcastError,
  validateBroadcastPayload,
  checkRateLimit,
  resolveAudience,
  findOrCreateActivityConversation,
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
    body.channels = { email: false, push: false, inApp: false }
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

  it('accepts channels.inApp=true alone (Plan 02)', () => {
    const body = validBody()
    // inApp is now a real channel — subject not required unless email=true.
    body.channels = { email: false, push: false, inApp: true }
    delete body.subject
    expect(() => validateBroadcastPayload(body)).not.toThrow()
  })

  it('accepts channels.inApp=true combined with email+push', () => {
    const body = validBody()
    body.channels = { email: true, push: true, inApp: true }
    expect(() => validateBroadcastPayload(body)).not.toThrow()
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

// ─── 4. findOrCreateActivityConversation ─────────────────────────────────────

/**
 * Mock ItemsService that records createOne calls. `throwOnce` lets us simulate
 * a 23505 unique-constraint race on the first createOne call only.
 */
function makeItemsServiceMock(opts = {}) {
  const calls = []
  const throwOnce = opts.throwOnce ?? null
  let threw = false
  class ItemsService {
    constructor(collection) { this.collection = collection }
    async createOne(payload) {
      calls.push({ collection: this.collection, payload })
      if (throwOnce && !threw) {
        threw = true
        throw throwOnce
      }
      return payload.id
    }
  }
  return { services: { ItemsService }, calls }
}

/** Scripted DB: every `.first()` invocation on `conversations` pops from `convFirstQueue`. */
function makeConvScriptedDb(convFirstQueue) {
  const queue = [...convFirstQueue]
  return () => {
    const chain = {
      where: () => chain,
      andWhere: () => chain,
      first: () => Promise.resolve(queue.shift()),
      then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
    }
    return chain
  }
}

describe('findOrCreateActivityConversation', () => {
  const activity = { type: 'event', id: 42, title: 'Sommerfest 2026' }
  const sender = { id: 7 }

  it('rejects non-event activities with 400 broadcast/inapp_events_only', async () => {
    const db = makeDb({})
    const { services } = makeItemsServiceMock()
    await expect(
      findOrCreateActivityConversation(db, services, {}, { ...activity, type: 'training' }, sender)
    ).rejects.toThrow(BroadcastError)
  })

  it('returns the existing row without calling createOne when one exists', async () => {
    const existing = { id: 'conv-existing', type: 'activity_chat', activity_type: 'event', activity_id: 42 }
    const db = makeConvScriptedDb([existing])
    const { services, calls } = makeItemsServiceMock()
    const row = await findOrCreateActivityConversation(db, services, {}, activity, sender)
    expect(row).toBe(existing)
    expect(calls).toHaveLength(0)
  })

  it('creates a new row via ItemsService when none exists', async () => {
    // 1st .first() → undefined (no existing). 2nd .first() → the newly inserted row.
    const newRow = { id: 'conv-new', type: 'activity_chat', activity_type: 'event', activity_id: 42 }
    const db = makeConvScriptedDb([undefined, newRow])
    const { services, calls } = makeItemsServiceMock()
    const row = await findOrCreateActivityConversation(db, services, {}, activity, sender)
    expect(row).toEqual(newRow)
    expect(calls).toHaveLength(1)
    expect(calls[0].collection).toBe('conversations')
    expect(calls[0].payload.type).toBe('activity_chat')
    expect(calls[0].payload.activity_type).toBe('event')
    expect(calls[0].payload.activity_id).toBe(42)
    expect(calls[0].payload.title).toBe('Sommerfest 2026')
    expect(calls[0].payload.created_by).toBe(7)
  })

  it('recovers from 23505 race by re-selecting the winner', async () => {
    const winner = { id: 'conv-winner', type: 'activity_chat', activity_type: 'event', activity_id: 42 }
    // 1st .first() → undefined. createOne → throws 23505. 2nd .first() → winner.
    const db = makeConvScriptedDb([undefined, winner])
    const raceErr = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    const { services } = makeItemsServiceMock({ throwOnce: raceErr })
    const row = await findOrCreateActivityConversation(db, services, {}, activity, sender)
    expect(row).toBe(winner)
  })

  it('propagates non-duplicate errors from createOne', async () => {
    const db = makeConvScriptedDb([undefined])
    const fatal = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
    const { services } = makeItemsServiceMock({ throwOnce: fatal })
    await expect(
      findOrCreateActivityConversation(db, services, {}, activity, sender)
    ).rejects.toThrow('connection refused')
  })
})
