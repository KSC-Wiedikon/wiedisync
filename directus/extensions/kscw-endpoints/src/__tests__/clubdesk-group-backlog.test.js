/**
 * The ClubDesk group backlog on GET /clubdesk-member-sync (20.10.2026).
 *
 * Between 02.10 and 20.10.2026 the group worklist grew to 16 adds while every
 * "Fix groups" run skipped all rows, and nothing outside the Fix groups dialog
 * said so. The status poll now carries the count, and these tests pin the two
 * things that make it trustworthy:
 *   • it is the SAME predicate computeGroupChecks().missing uses — the query is
 *     built by groupMissingSql(), never a second copy;
 *   • it never breaks the poll it rides on — busy pipeline or failed query is
 *     null ("not counted"), never 0 and never a throw.
 *
 * Hermetic — `database.raw` is a spy; no SQL runs.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  GROUP_DEPARTED_GUARD_SQL, GROUP_TEAM_CTE, countGroupMissingMembers, groupBacklogWhenIdle, groupMissingSql,
} from '../clubdesk-update.js'

const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }

function rawDb(result) {
  const db = () => { throw new Error('no table builder expected') }
  db.raw = vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
  return db
}

describe('groupMissingSql — the one copy of the "missing group" predicate', () => {
  const sql = groupMissingSql()

  it('reads active mapped teams through the shared CTE', () => {
    expect(sql).toContain(GROUP_TEAM_CTE)
    expect(GROUP_TEAM_CTE).toMatch(/t\.active/)
  })

  it('keeps the departed guard (no group adds for members who left)', () => {
    expect(sql).toContain(GROUP_DEPARTED_GUARD_SQL)
    expect(GROUP_DEPARTED_GUARD_SQL).toMatch(/kscw_membership_active/)
    expect(GROUP_DEPARTED_GUARD_SQL).toMatch(/'Kein Mitglied'/)
  })

  it('only considers linked members and expects the guest / player Funktion', () => {
    expect(sql).toMatch(/m\.clubdesk_id IS NOT NULL/)
    expect(sql).toMatch(/' \(Guest\)'/)
    expect(sql).toMatch(/' \(Spieler\*in\)'/)
    expect(sql).toMatch(/NOT \(e\.grp = ANY\(string_to_array\(COALESCE\(ce\.groups_bracketed, ''\), ', '\)\)\)/)
  })
})

describe('countGroupMissingMembers', () => {
  it('counts distinct members over groupMissingSql (matching the per-member fold)', async () => {
    const db = rawDb({ rows: [{ n: 16 }] })
    await expect(countGroupMissingMembers(db)).resolves.toBe(16)
    const [q] = db.raw.mock.calls[0]
    expect(q).toContain('count(DISTINCT gm.member_id)')
    expect(q).toContain(groupMissingSql())
  })

  it('reads an empty result as zero', async () => {
    await expect(countGroupMissingMembers(rawDb({ rows: [] }))).resolves.toBe(0)
  })
})

describe('groupBacklogWhenIdle — never blinds the lock poll', () => {
  const idle = { down_state: 'done', up_state: 'done', grp_state: 'idle' }

  it('counts when nothing holds the ClubDesk lock', async () => {
    const db = rawDb({ rows: [{ n: 3 }] })
    await expect(groupBacklogWhenIdle(db, idle, log)).resolves.toBe(3)
  })

  it.each([
    ['a queued down', { down_state: 'queued' }],
    ['a running down', { down_state: 'running' }],
    ['a running up', { up_state: 'running' }],
    ['a queued group fix', { grp_state: 'queued' }],
  ])('is null (not counted) during %s', async (_, busy) => {
    const db = rawDb({ rows: [{ n: 3 }] })
    await expect(groupBacklogWhenIdle(db, { ...idle, ...busy }, log)).resolves.toBeNull()
    expect(db.raw).not.toHaveBeenCalled()
  })

  it('is null, not a throw, when the query fails', async () => {
    const db = rawDb(new Error('relation "clubdesk_export" does not exist'))
    await expect(groupBacklogWhenIdle(db, idle, log)).resolves.toBeNull()
    expect(log.warn).toHaveBeenCalled()
  })

  it('treats a missing status row as idle', async () => {
    await expect(groupBacklogWhenIdle(rawDb({ rows: [{ n: 0 }] }), undefined, log)).resolves.toBe(0)
  })
})
