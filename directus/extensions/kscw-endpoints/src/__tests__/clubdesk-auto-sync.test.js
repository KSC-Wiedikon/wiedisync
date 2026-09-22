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
import { autoSyncRegistrationToClubdesk, enqueueClubdeskUp } from '../clubdesk-update.js'

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
