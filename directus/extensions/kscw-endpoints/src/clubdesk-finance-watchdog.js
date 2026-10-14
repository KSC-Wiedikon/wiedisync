/**
 * Watchdog for the nightly ClubDesk finance sync.
 *
 * The sync runs on the VPS host (/opt/clubdesk-sync/clubdesk-finance-sync.sh, cron
 * 02:00 UTC), outside Directus, and writes its own `sync_runs` heartbeat (source
 * `clubdesk_finance`). It failed silently twice — 82 nights in June–Sept and
 * 11.–14.10.2026 — so the kscw-hooks cron (05:15 UTC, prod only) reads the heartbeat
 * with `financeSyncProblem` and, on a problem, writes the error log + Sentry and
 * mails the owner `financeSyncAlertMail`.
 */

/** A good run is daily; past this the job is dead even if its last run was ok. */
export const FINANCE_SYNC_STALE_HOURS = 30

/**
 * @param {{ status?: string, last_run_at?: string|Date|null, error_message?: string|null }|undefined} row
 * @param {number} [now]
 * @returns {{ problem: string, ageHours: number|null }|null} null when healthy
 */
export function financeSyncProblem(row, now = Date.now()) {
  if (!row) return { problem: 'no heartbeat recorded yet', ageHours: null }
  const ts = row.last_run_at ? new Date(row.last_run_at).getTime() : NaN
  const ageHours = Number.isFinite(ts) ? Math.round((now - ts) / 3600000) : null
  if (row.status === 'error') return { problem: `last run failed: ${row.error_message || 'unknown error'}`, ageHours }
  // An unreadable timestamp counts as stale — never as fresh.
  if (ageHours == null) return { problem: 'no successful run for an unknown time', ageHours }
  if (ageHours > FINANCE_SYNC_STALE_HOURS) return { problem: `no successful run for ${ageHours} h`, ageHours }
  return null
}

/** Plain-text alert for the owner mailbox (OWNER_EMAIL). */
export function financeSyncAlertMail({ problem, ageHours }, { frontendUrl } = {}) {
  const lines = [
    `The nightly ClubDesk finance sync needs attention: ${problem}.`,
    '',
    ageHours == null ? 'Last heartbeat: none.' : `Last heartbeat: ${ageHours} h ago.`,
    'Until it runs again, the ClubDesk invoices and bookings in Wiedisync are not up to date.',
    '',
    'Where to look:',
    '- VPS log: /opt/clubdesk-sync/finance-last-run.log (cron 02:00 UTC)',
    '- Error log: GET /kscw/admin/error-logs (cron clubdesk_finance_sync)',
  ]
  if (frontendUrl) lines.push(`- Infra Health ("Run now" re-runs it): ${frontendUrl.replace(/\/$/, '')}/admin/infra`)
  lines.push('', 'This check runs daily at 05:15 UTC and repeats until the sync is healthy again.')
  return { subject: `ClubDesk finance sync: ${problem}`, text: lines.join('\n') }
}
