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
 * ⓘ Known gap, stated rather than hidden: the weekly cron sync-down (Sat 22:00
 * UTC) has no browser to make this call, so its conflicts appear at the next
 * UI-triggered sync down. Every route into the decision queue goes through this
 * page anyway, and the sync path's own step 1 is a sync down.
 */
export async function detectClubdeskConflicts(): Promise<number> {
  const r = await kscwApi<{ staged: number }>(
    '/clubdesk-sync/proposals/detect', { method: 'POST' },
  )
  return Number(r?.staged) || 0
}
