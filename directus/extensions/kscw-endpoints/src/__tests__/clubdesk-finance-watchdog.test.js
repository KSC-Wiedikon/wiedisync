/**
 * Watchdog of the nightly ClubDesk finance sync (VPS host cron, sync_runs source
 * `clubdesk_finance`). It failed silently twice — 82 nights in June–Sept and
 * 11.–14.10.2026 — so every way the heartbeat can look wrong must come out as a
 * problem, and a healthy night must not.
 */
import { describe, it, expect } from 'vitest'
import { FINANCE_SYNC_STALE_HOURS, financeSyncProblem, financeSyncAlertMail } from '../clubdesk-finance-watchdog.js'

const NOW = Date.parse('2026-10-15T05:15:00Z')
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString()

describe('financeSyncProblem', () => {
  it('is quiet after a good night', () => {
    expect(financeSyncProblem({ status: 'ok', last_run_at: hoursAgo(3) }, NOW)).toBeNull()
  })

  it('flags a missing heartbeat row', () => {
    expect(financeSyncProblem(undefined, NOW)).toMatchObject({ problem: 'no heartbeat recorded yet' })
  })

  it('flags a failed run with its stage', () => {
    const p = financeSyncProblem({ status: 'error', last_run_at: hoursAgo(3), error_message: 'exit 1 during scrape' }, NOW)
    expect(p.problem).toBe('last run failed: exit 1 during scrape')
    expect(p.ageHours).toBe(3)
  })

  it('flags a run that stopped reporting (cron dead, host down, heartbeat write failed)', () => {
    expect(financeSyncProblem({ status: 'ok', last_run_at: hoursAgo(FINANCE_SYNC_STALE_HOURS - 1) }, NOW)).toBeNull()
    expect(financeSyncProblem({ status: 'ok', last_run_at: hoursAgo(52) }, NOW))
      .toEqual({ problem: 'no successful run for 52 h', ageHours: 52 })
  })

  it('treats an unreadable timestamp as stale, never as fresh', () => {
    expect(financeSyncProblem({ status: 'ok', last_run_at: null }, NOW)?.problem).toMatch(/no successful run/)
    expect(financeSyncProblem({ status: 'ok', last_run_at: 'garbage' }, NOW)?.problem).toMatch(/no successful run/)
  })
})

describe('financeSyncAlertMail', () => {
  it('says what broke, where to look and that the mirror is stale', () => {
    const m = financeSyncAlertMail({ problem: 'last run failed: exit 1 during apply', ageHours: 3 }, { frontendUrl: 'https://wiedisync.kscw.ch' })
    expect(m.subject).toBe('ClubDesk finance sync: last run failed: exit 1 during apply')
    expect(m.text).toContain('https://wiedisync.kscw.ch/admin/infra')
    expect(m.text).toContain('/opt/clubdesk-sync/finance-last-run.log')
  })

  it('still reads without a frontend URL', () => {
    const m = financeSyncAlertMail({ problem: 'no heartbeat recorded yet', ageHours: null }, {})
    expect(m.text).not.toContain('undefined')
  })
})
