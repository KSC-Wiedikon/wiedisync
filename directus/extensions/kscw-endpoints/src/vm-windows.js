/**
 * svrz_rc's VolleyManager windows, as seen from wiedisync.
 *
 * wiedisync and svrz_rc share ONE VolleyManager login, and VM keeps the active role
 * per ACCOUNT — so a job here that logs in while svrz_rc's jobs run can make them read
 * club-scoped resources under our role (a 200 with the wrong rows, not a 403). svrz_rc's
 * own lock lives on another host and cannot see ours, so the only guard is to stay out
 * of its windows (INFRA.md → "The shared VolleyManager account", mirrored in
 * ~/repos/svrz_rc/infrastructure.md):
 *   - 22:00–00:59 UTC: svrz_rc's games sync runs at 23:00 / 00:00 UTC;
 *   - :05–:30 at 10 / 11 / 14 / 15 UTC: its refresh (summer + winter time).
 *
 * Imported by game-result.js and by the result sweep in kscw-hooks. The spawned
 * worker (`scripts/vm-push-result.mjs`) cannot import from the extension tree — a
 * separate bind-mount and deploy — and keeps an inline copy: change both.
 */

const REFRESH_HOURS = [10, 11, 14, 15]

/** True while svrz_rc may be using the shared VM account. */
export function isSvrzRcBlackout(date = new Date()) {
  const h = date.getUTCHours()
  const m = date.getUTCMinutes()
  if (h === 22 || h === 23 || h === 0) return true
  return REFRESH_HOURS.includes(h) && m >= 5 && m <= 30
}
