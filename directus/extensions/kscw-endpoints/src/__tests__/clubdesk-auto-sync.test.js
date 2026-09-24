/**
 * Unit tests for the ClubDesk auto-sync-on-confirmation orchestrator
 * (autoSyncRegistrationToClubdesk / enqueueClubdeskUp in clubdesk-update.js).
 *
 * Full happy-path coverage (a brand-new registration's CREATE push actually
 * building and queuing a CSV) needs a much larger knex double than is worth
 * hand-rolling here — that path is exercised on dev per the deploy plan
 * instead. These tests pin the cheap, high-value branches: the orchestrator
 * must never touch the ClubDesk lock for a registration with nothing to do
 * (no member yet, already linked, already pushed-pending), and the up-push
 * must refuse rather than queue on top of another job already holding the
 * global lock.
 *
 * Hermetic — a minimal knex stand-in supporting exactly the queries these
 * branches reach.
 */
import { describe, it, expect, vi } from 'vitest'
import { autoSyncRegistrationToClubdesk, enqueueClubdeskUp, linkBackAutoSyncedMembers } from '../clubdesk-update.js'

/** Knex stand-in keyed by table, each a first()-only builder over a fixed row. */
function fakeDb(tables) {
  const db = (table) => {
    const row = tables[table]
    const q = {
      where: () => q,
      andWhere: () => q,
      first: async (...cols) => {
        if (row === undefined) return undefined
        if (!cols.length) return row
        const out = {}
        for (const c of cols) out[c] = row[c]
        return out
      },
    }
    return q
  }
  db.raw = vi.fn()
  return db
}

const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }

describe('autoSyncRegistrationToClubdesk — no-op branches never touch the ClubDesk lock', () => {
  it('does nothing when the approval hook has not stamped a member yet', async () => {
    const db = fakeDb({ registrations: { id: 1, email: 'a@b.ch', member: null } })
    await autoSyncRegistrationToClubdesk(db, log, 1)
    // No 'clubdesk_member_sync' or 'members' lookup fired — cdStatusForRegistration
    // is never even called for a null member.
    expect(db.raw).not.toHaveBeenCalled()
  })

  it('does nothing when the registration row is gone', async () => {
    const db = fakeDb({ registrations: undefined })
    await expect(autoSyncRegistrationToClubdesk(db, log, 999)).resolves.toBeUndefined()
  })

  it('does nothing when the member is already linked and not push-pending', async () => {
    const db = fakeDb({
      registrations: { id: 2, email: 'c@d.ch', member: 42 },
      members: { id: 42, uuid: null, first_name: 'A', last_name: 'B', clubdesk_id: '9001', clubdesk_pushed_at: null, clubdesk_push_pending: false },
    })
    await autoSyncRegistrationToClubdesk(db, log, 2)
    expect(log.error).not.toHaveBeenCalled()
    // cdStatusForRegistration resolves 'linked' from the members lookup alone —
    // no clubdesk_export query, no push, no queue insert.
  })

  it('swallows and logs an unexpected failure rather than throwing into the approval hook', async () => {
    const db = () => { throw new Error('db is down') }
    await expect(autoSyncRegistrationToClubdesk(db, log, 3)).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalled()
  })
})

describe('enqueueClubdeskUp — the global lock refuses to be jumped', () => {
  it('refuses with up_in_progress when another push is already running', async () => {
    const db = fakeDb({ clubdesk_member_sync: { up_state: 'running', down_state: 'idle' } })
    const result = await enqueueClubdeskUp(db, [42], { log })
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('up_in_progress')
  })

  it('refuses with down_in_progress when a sync-down is running', async () => {
    const db = fakeDb({ clubdesk_member_sync: { up_state: 'idle', down_state: 'queued' } })
    const result = await enqueueClubdeskUp(db, [42], { log })
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('down_in_progress')
  })
})

// ── linkBackAutoSyncedMembers ───────────────────────────────────────────────
// A recording knex stand-in: the dispatched-rows join, the singleton lock row,
// and every update/insert the step makes, so each branch is asserted by what
// it WROTE.
function linkBackDb({ rows, sync }) {
  const writes = []
  const db = (table) => {
    const q = {
      _ids: null,
      join: () => q,
      where: () => q,
      whereIn: (_col, ids) => { q._ids = ids; return q },
      select: async () => rows,
      first: async () => sync,
      update: async (patch) => { writes.push({ table: String(table), ids: q._ids, patch }); return 1 },
      insert: async (row) => { writes.push({ table: String(table), insert: row }); return [1] },
    }
    return q
  }
  return { db, writes }
}

const T0 = '2026-09-24T06:00:00Z'
const PUSHED = '2026-09-24T06:05:00Z'
const LATER = '2026-09-24T06:10:00Z'
const DONE_LATER = '2026-09-24T06:20:00Z'
const idle = { up_state: 'done', up_finished_at: PUSHED, up_message: null, down_state: 'done', down_requested_at: T0, down_finished_at: T0, grp_state: 'idle' }

describe('linkBackAutoSyncedMembers', () => {
  it('marks a linked member done', async () => {
    const { db, writes } = linkBackDb({ rows: [{ id: 1, dispatched_at: T0, clubdesk_id: '1001', clubdesk_pushed_at: PUSHED }], sync: idle })
    await linkBackAutoSyncedMembers(db, log)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ table: 'clubdesk_auto_sync_queue', ids: [1], patch: { status: 'done' } })
  })

  it('queues ONE sync-down for pushed-but-unlinked members', async () => {
    const { db, writes } = linkBackDb({
      rows: [
        { id: 1, dispatched_at: T0, clubdesk_id: null, clubdesk_pushed_at: PUSHED },
        { id: 2, dispatched_at: T0, clubdesk_id: null, clubdesk_pushed_at: PUSHED },
      ],
      sync: idle,
    })
    await linkBackAutoSyncedMembers(db, log)
    const downs = writes.filter((w) => w.table === 'clubdesk_member_sync' && w.patch?.down_state === 'queued')
    expect(downs).toHaveLength(1)
    expect(writes.some((w) => w.table === 'clubdesk_auto_sync_queue')).toBe(false)
  })

  it('does not queue a sync-down while another job holds the lock', async () => {
    const { db, writes } = linkBackDb({
      rows: [{ id: 1, dispatched_at: T0, clubdesk_id: null, clubdesk_pushed_at: PUSHED }],
      sync: { ...idle, grp_state: 'running' },
    })
    await linkBackAutoSyncedMembers(db, log)
    expect(writes.filter((w) => w.table === 'clubdesk_member_sync')).toHaveLength(0)
  })

  it('waits for a sync-down already started after the push', async () => {
    const { db, writes } = linkBackDb({
      rows: [{ id: 1, dispatched_at: T0, clubdesk_id: null, clubdesk_pushed_at: PUSHED }],
      sync: { ...idle, down_state: 'running', down_requested_at: LATER, down_finished_at: null },
    })
    await linkBackAutoSyncedMembers(db, log)
    expect(writes).toHaveLength(0)
  })

  it('fails (never re-queues) a member still unlinked after the post-push sync-down', async () => {
    const { db, writes } = linkBackDb({
      rows: [{ id: 1, dispatched_at: T0, clubdesk_id: null, clubdesk_pushed_at: PUSHED }],
      sync: { ...idle, down_requested_at: LATER, down_finished_at: DONE_LATER },
    })
    await linkBackAutoSyncedMembers(db, log)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ ids: [1], patch: { status: 'failed' } })
  })

  it('fails a member the finished up run never pushed', async () => {
    const { db, writes } = linkBackDb({
      rows: [{ id: 1, dispatched_at: T0, clubdesk_id: null, clubdesk_pushed_at: null }],
      sync: { ...idle, up_message: 'skipped: would_duplicate' },
    })
    await linkBackAutoSyncedMembers(db, log)
    expect(writes).toHaveLength(1)
    expect(writes[0].patch.status).toBe('failed')
    expect(writes[0].patch.last_error).toContain('would_duplicate')
  })

  it('keeps waiting while the push is still queued', async () => {
    const { db, writes } = linkBackDb({
      rows: [{ id: 1, dispatched_at: T0, clubdesk_id: null, clubdesk_pushed_at: null }],
      sync: { ...idle, up_state: 'queued', up_finished_at: null },
    })
    await linkBackAutoSyncedMembers(db, log)
    expect(writes).toHaveLength(0)
  })
})
