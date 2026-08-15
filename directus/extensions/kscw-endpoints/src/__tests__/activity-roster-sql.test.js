/**
 * Unit tests for the auto-RSVP eligibility set (activity-roster-sql.js) and the
 * two sweeps built on it.
 *
 * The bug these lock down (2026-08-15): every auto-confirm writer joined
 * `member_teams`, which is the PLAYER roster. Coaches and team responsibles
 * live in `teams_coaches` / `teams_responsibles` and never get a roster row, so
 * the team toggle, the per-activity override and the member's OWN
 * `auto_confirm_*` opt-in all silently skipped them — DU23-1's coach had the
 * toggle on, his flag on, and no row on 57 of 58 upcoming trainings.
 *
 * These are SQL-shape tests, not execution tests: there is no Postgres here.
 * They exist to catch the regression that actually happened — a writer that
 * reaches for `member_teams` directly — plus the three invariants that make the
 * widened set safe (staff-only marking, the `min_participants` contract, and
 * the guest trigger that RAISES rather than skips). The statements themselves
 * were verified against prod/dev in a rolled-back transaction.
 */
import { describe, it, expect } from 'vitest'
import { teamPeopleSql, notGuestAnywhereSql } from '../activity-roster-sql.js'
import { sweepTrainingAutoConfirm } from '../training-auto-confirm-sweep.js'
import { sweepGameAutoConfirm } from '../game-auto-confirm-sweep.js'

/** Captures the SQL a sweep hands to knex. */
function captureSql(sweep) {
  const seen = []
  const db = { raw: async (sql) => { seen.push(sql); return { rowCount: 0 } } }
  const log = { info() {}, error() {} }
  return sweep(db, log).then(() => seen.join('\n'))
}

// Collapse whitespace so assertions don't depend on template-literal indenting.
const flat = (s) => s.replace(/\s+/g, ' ')

describe('teamPeopleSql — players ∪ staff', () => {
  it('reads BOTH staff junctions, not just the player roster', () => {
    const sql = flat(teamPeopleSql('tr.team'))
    expect(sql).toContain('FROM member_teams mt')
    expect(sql).toContain('FROM teams_coaches')
    expect(sql).toContain('FROM teams_responsibles')
  })

  it('scopes every branch to the team expression it was given', () => {
    const sql = flat(teamPeopleSql('g.kscw_team'))
    expect(sql).toContain('WHERE mt.team = g.kscw_team')
    expect(sql).toContain('WHERE s.teams_id = g.kscw_team')
  })

  it('marks staff rows is_staff=true and player rows is_staff=false', () => {
    const sql = flat(teamPeopleSql('tr.team'))
    // The player branch is the one selecting from member_teams.
    expect(sql).toContain('COALESCE(mt.guest_level, 0) AS guest_level, false AS is_staff')
    // The staff branch carries guest_level 0 — guest level is a roster property
    // and a staff-only person has no roster row to read one from.
    expect(sql).toContain('0 AS guest_level, true AS is_staff')
  })

  it('yields ONE row for somebody who is both coach and player, as a player', () => {
    // The staff branch excludes anyone holding a roster row on the same team —
    // this NOT EXISTS is what mirrors the frontend's isStaffOnly() and what
    // stops a coach-who-plays from getting a second, is_staff row.
    const sql = flat(teamPeopleSql('tr.team'))
    expect(sql).toContain(flat(`AND NOT EXISTS (
        SELECT 1 FROM member_teams mt2
        WHERE mt2.team = s.teams_id AND mt2.member = s.members_id
      )`))
  })

  it('dedupes a person who is BOTH coach and team responsible (UNION, not UNION ALL)', () => {
    const sql = flat(teamPeopleSql('tr.team'))
    expect(sql).toContain('FROM teams_coaches UNION SELECT teams_id, members_id FROM teams_responsibles')
    expect(sql).not.toContain('UNION ALL')
  })
})

describe('training sweep', () => {
  it('draws its people from teamPeopleSql, never from member_teams directly', async () => {
    const sql = flat(await captureSql(sweepTrainingAutoConfirm))
    expect(sql).toContain(flat(teamPeopleSql('tr.team')))
    // The only member_teams references may be the ones inside teamPeopleSql —
    // a bare join here is exactly the bug this file exists to prevent.
    const outside = sql.replace(flat(teamPeopleSql('tr.team')), '')
    expect(outside).not.toContain('member_teams')
  })

  it('writes the eligibility set\'s own is_staff, not a hardcoded false', async () => {
    const sql = flat(await captureSql(sweepTrainingAutoConfirm))
    expect(sql).toContain("SELECT e.member, 'training', tr.id::text, 'confirmed', '', 0, e.is_staff")
  })

  it('honours a personal opt-in even when the team default is off', async () => {
    const sql = flat(await captureSql(sweepTrainingAutoConfirm))
    // The OR sits OUTSIDE the COALESCE, so a per-activity `false` suppresses the
    // TEAM default without cancelling somebody's own opt-in (migration 077).
    expect(sql).toContain('false) = true OR m.auto_confirm_trainings = true')
  })

  it('never overwrites an existing answer and survives the insert race', async () => {
    const sql = flat(await captureSql(sweepTrainingAutoConfirm))
    expect(sql).toContain('AND NOT EXISTS ( SELECT 1 FROM participations p')
    // Targetless on purpose — a named conflict target errors when migration
    // 246's partial unique indexes are absent; this form is simply inert.
    expect(sql).toContain('ON CONFLICT DO NOTHING')
    expect(sql).not.toContain('ON CONFLICT (')
  })

  it('skips cancelled and past trainings, and the excluded guest levels', async () => {
    const sql = flat(await captureSql(sweepTrainingAutoConfirm))
    expect(sql).toContain('tr.date::date >= CURRENT_DATE')
    expect(sql).toContain('tr.cancelled = false')
    expect(sql).toContain("NOT (COALESCE(tr.excluded_guest_levels, '[]')::jsonb @> to_jsonb(e.guest_level))")
  })
})

describe('game sweep', () => {
  it('draws its people from teamPeopleSql, never from member_teams directly', async () => {
    const sql = flat(await captureSql(sweepGameAutoConfirm))
    expect(sql).toContain(flat(teamPeopleSql('g.kscw_team')))
    const outside = sql
      .replace(flat(teamPeopleSql('g.kscw_team')), '')
      .replace(flat(notGuestAnywhereSql('e.member')), '')
    expect(outside).not.toContain('member_teams')
  })

  it('guards against trg_participations_guest_block, which RAISES', async () => {
    // The trigger is club-wide, not per-team, and it aborts the whole
    // INSERT...SELECT rather than skipping the offending row. Players are
    // filtered by their own guest_level; staff have no roster row, so a coach
    // guesting for another team would take the entire sweep down without this.
    const sql = flat(await captureSql(sweepGameAutoConfirm))
    expect(sql).toContain(flat(notGuestAnywhereSql('e.member')))
    expect(sql).toContain('AND e.guest_level = 0')
  })

  it('skips finished and abandoned games', async () => {
    const sql = flat(await captureSql(sweepGameAutoConfirm))
    expect(sql).toContain("COALESCE(g.status, '') NOT IN ('completed', 'postponed', 'cancelled')")
  })
})

describe('notGuestAnywhereSql', () => {
  it('asks about ANY team, not the activity\'s team', () => {
    const sql = flat(notGuestAnywhereSql('e.member'))
    expect(sql).toContain('WHERE gmt.member = e.member AND COALESCE(gmt.guest_level, 0) > 0')
    // Deliberately unscoped — it mirrors the trigger, which is unscoped too.
    expect(sql).not.toContain('gmt.team')
  })
})
