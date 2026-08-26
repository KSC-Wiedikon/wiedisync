import { kscwApi } from '../../../lib/api'

/**
 * Stage `conflict` proposals for every live value disagreement (migration 338).
 *
 * ⚠ Must be called after EVERY sync-down the UI triggers, from whichever button
 * ran it. The sync-down's own SQL pass stages fill / overwrite / set_true /
 * create; conflicts are computed in JS off computeClubdeskDrift() — the same
 * function that renders the finding — so they are staged over HTTP afterwards
 * instead. Idempotent: a second call stages 0.
 *
 * ⓘ The cron sync-downs (weekly Sat 22:00 UTC, and any host-run one) have no
 * browser to make this call. They are covered by the scheduled hook instead,
 * which fires on `down_last_success_at` moving past `conflicts_staged_at`
 * (migration 339) — so this call and that hook are the same route, and whichever
 * gets there first closes the window for the other.
 *
 * ⚠ A 404 is not a failure here, it is a DEPLOY WINDOW. Cloudflare Pages ships
 * this page automatically on push while `ext:deploy` is run by hand, so for a
 * few minutes the frontend can be asking for a route the endpoint does not have
 * yet. Alarming the operator about that teaches them to ignore the toast that
 * will one day mean something; the hook stages the same conflicts within 15
 * minutes regardless. Returns null so the caller can stay silent rather than
 * report "0 staged", which would be a different and untrue claim.
 */
export async function detectClubdeskConflicts(): Promise<number | null> {
  try {
    const r = await kscwApi<{ staged: number }>(
      '/clubdesk-sync/proposals/detect', { method: 'POST' },
    )
    return Number(r?.staged) || 0
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null
    throw e
  }
}
