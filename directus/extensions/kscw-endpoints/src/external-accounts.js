/**
 * The ONE switch that decides whether this Directus instance may use the club's
 * external accounts — the shared VolleyManager login and the club's Basketplan
 * login.
 *
 * WHY. The dev container (directus-kscw-dev) runs the same code against a nightly
 * clone of prod and holds the same credentials. VolleyManager has no staging and
 * keeps the active role per ACCOUNT, so a dev cron logging in at the same minute as
 * prod (or as svrz_rc, on another host) makes one of them read under the other's
 * role — a 200 with the WRONG rows, not an error — and a dev "confirm" would write a
 * real fixture / result / Einsatzliste into the real Swiss Volley system.
 * `claimVmAccount` cannot help: it only serialises jobs inside ONE process.
 * (CLAUDE.md + INFRA.md → "The shared VolleyManager account".)
 *
 * FAIL CLOSED. Enabled ONLY when PUBLIC_URL parses to exactly `directus.kscw.ch`
 * (prod), or when KSCW_ALLOW_EXTERNAL_ON_DEV=1 is set for a supervised dev test.
 * Unset, unparsable, the dev host, localhost, a look-alike host → disabled. The old
 * guards sniffed `DB_DATABASE` / `PUBLIC_URL` for "dev" and so failed OPEN when the
 * variable was missing or renamed.
 *
 * WRITES are a second key. A spawned writer (scripts/vm-push-*.mjs) writes for real
 * only when its spawner passes KSCW_EXTERNAL_WRITES=1 — otherwise it runs as a dry
 * run — and the spawner passes it only via `externalWritesEnv()`: always on prod; on
 * dev only with the override AND the writer's own `*_ALLOW_DEV_WRITE=1`, so turning
 * on dev logins for a supervised read test never arms every writer at once.
 */

export const PROD_HOST = 'directus.kscw.ch'
export const DEV_OVERRIDE_ENV = 'KSCW_ALLOW_EXTERNAL_ON_DEV'
export const EXTERNAL_WRITES_ENV = 'KSCW_EXTERNAL_WRITES'
export const EXTERNAL_DISABLED_CODE = 'external_disabled_on_dev'

/** True only when PUBLIC_URL is an http(s) URL whose host is exactly directus.kscw.ch. */
export function isProdInstance(env = process.env) {
  const raw = String(env?.PUBLIC_URL ?? '').trim()
  if (!raw) return false
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return url.hostname.toLowerCase() === PROD_HOST
  } catch {
    return false
  }
}

/** May this instance log in to VolleyManager / Basketplan at all? */
export function externalAccountsEnabled(env = process.env) {
  return isProdInstance(env) || env?.[DEV_OVERRIDE_ENV] === '1'
}

/**
 * May a writer started from this instance write for real?
 * @param {string|null} devWriteVar  the writer's own dev opt-in (e.g. 'VM_RESULT_ALLOW_DEV_WRITE')
 */
export function externalWritesEnabled(devWriteVar, env = process.env) {
  if (isProdInstance(env)) return true
  return env?.[DEV_OVERRIDE_ENV] === '1' && !!devWriteVar && env?.[devWriteVar] === '1'
}

/** Spread into a spawned writer's env: `{ KSCW_EXTERNAL_WRITES: '1' }` or nothing. */
export function externalWritesEnv(devWriteVar, env = process.env) {
  return externalWritesEnabled(devWriteVar, env) ? { [EXTERNAL_WRITES_ENV]: '1' } : {}
}

// One info line per job per process start — a per-minute cron must not log every tick.
const announced = new Set()

/**
 * For crons and background jobs: true when the caller must skip because this is not
 * prod. Logs the skip once per job name per process.
 */
export function skipExternalJob(job, log, env = process.env) {
  if (externalAccountsEnabled(env)) return false
  if (!announced.has(job)) {
    announced.add(job)
    const msg = `[external-accounts] ${job} disabled: not the production instance (PUBLIC_URL host is not ${PROD_HOST}; set ${DEV_OVERRIDE_ENV}=1 for a supervised test)`
    if (typeof log?.info === 'function') log.info(msg)
    else console.log(msg)
  }
  return true
}

/**
 * For on-demand endpoints: answers 503 { code: 'external_disabled_on_dev' } and
 * returns true when the caller must stop.
 */
export function refuseExternalOnDev(res, env = process.env) {
  if (externalAccountsEnabled(env)) return false
  res.status(503).json({
    error: 'VolleyManager / Basketplan are only used from the production server',
    code: EXTERNAL_DISABLED_CODE,
  })
  return true
}

/** Test hook: forget which skips were already logged. */
export function _resetAnnouncedForTests() {
  announced.clear()
}
