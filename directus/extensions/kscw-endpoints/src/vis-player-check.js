/**
 * On-demand FIVB VIS player-presence check — the button behind /admin/transfers.
 *
 * WHY THIS EXISTS (2026-08-05)
 * ────────────────────────────
 * `members.in_vis` / `vis_player_no` / `in_vis_checked_at` (migration 240) were
 * written by exactly one thing: `vis-player-check.mjs`, run by the VPS cron
 * `/opt/vis-sync/vis-sync.sh` on the 1st of the month only. So for 30 days of
 * every 31 the Transfers page showed a fixed answer, and its "Refresh" button —
 * a plain react-query refetch of `members` — could not change it. An admin who
 * has just asked a federation to enter a player had no way to ask "are they in
 * now?" short of waiting for the next month.
 *
 * ⚠ THIS IS A MIRROR of `directus/scripts/vis-player-check.mjs`. The VIS
 * protocol quirks, the ISO→FIVB code map, the who-is-checked rule and the
 * name-matching cascade are duplicated here ON PURPOSE: the script runs on the
 * VPS host and reaches Postgres through `sudo docker exec … psql`, which does
 * not exist inside the Directus container, and the extension bundle must not
 * import across the `scripts/` bind-mount (a separate deploy unit — CLAUDE.md
 * §4). The monthly cron stays the belt-and-braces run; this is the same check on
 * demand. **If you change the matching, the cohort or the write rule in one,
 * change it in the other** — a drifted mirror reports confident nonsense.
 *
 * ⚠ READ-ONLY against VIS, by construction: the request types are hardcoded
 * constants asserted against a read-verb allowlist at module load. The same
 * proxy serves Save/Sign/Confirm/Release/CancelVolleyTransfer, so a wrong type
 * here would not fetch wrong data — it would alter a real player's eligibility.
 *
 * SHAPE — 202 + poll, like /admin/vm-sync. A full run pulls one whole federation
 * roster per federation of origin present in the cohort (VIS ignores name
 * filters, see the script), Swiss Volley's being the largest, so it takes
 * minutes: far past what a Cloudflare-tunnelled request will hold open.
 *
 *   POST /kscw/admin/vis-player-check → 202 { status: 'started' }
 *                                       409 { status: 'skipped', reason }
 *   GET  /kscw/admin/vis-player-check → { running, startedAt, result, last }
 *
 * Writes go through knex (raw SQL), which bypasses Directus' activity trail, so
 * the trigger is actor-logged explicitly per CLAUDE.md → "Audit logging".
 */

import { logCronRun } from './error-log.js'
import { writeUserLog } from './activity-log.js'

const PROXY = 'https://proxy.app.fivb.com'
const SYNC_SOURCE = 'vis_player_check'

const REQUEST_TYPE = 'GetPlayerList'
const FED_LIST_TYPE = 'GetFederationList'
for (const t of [REQUEST_TYPE, FED_LIST_TYPE]) {
  if (!/^(Get|Check|Export|List)/.test(t)) throw new Error(`refusing to run: ${t} is not a read-only VIS verb`)
}

/** Hard ceiling on one run, so a stalled VIS can never wedge the in-flight guard. */
const RUN_TIMEOUT_MS = 900_000
/** Per-call ceiling. A federation roster is a few thousand rows; 2 min is generous. */
const CALL_TIMEOUT_MS = 120_000

/**
 * ISO 3166-1 alpha-2 → FIVB 3-letter federation code. FIVB codes are IOC-style
 * and NOT derivable from ISO (DE→GER, NL→NED, LK→SRI, IR→IRI), so they are
 * mapped explicitly. An unmapped country is reported and skipped — never guessed.
 *
 * ⚠ Mirror of ISO2FIVB in `vis-player-check.mjs` — add countries to both.
 */
const ISO2FIVB = {
  CH: 'SUI',
  DE: 'GER', IT: 'ITA', FR: 'FRA', AF: 'AFG', ES: 'ESP', PL: 'POL', US: 'USA',
  SE: 'SWE', LK: 'SRI', AT: 'AUT', PT: 'POR', ET: 'ETH', RU: 'RUS', FI: 'FIN',
  BG: 'BUL', CZ: 'CZE', NL: 'NED', NZ: 'NZL', PE: 'PER', RS: 'SRB', AL: 'ALB',
  SI: 'SLO', MX: 'MEX', BR: 'BRA', GB: 'GBR', GR: 'GRE', HU: 'HUN', IQ: 'IRQ',
  IR: 'IRI', CO: 'COL', TR: 'TUR', UA: 'UKR', HR: 'CRO', BE: 'BEL', DK: 'DEN',
  NO: 'NOR', JP: 'JPN', CN: 'CHN', KR: 'KOR', AR: 'ARG', CA: 'CAN', CU: 'CUB',
  DO: 'DOM', EG: 'EGY', TN: 'TUN', MA: 'MAR', IN: 'IND', TH: 'THA', RO: 'ROU',
  SK: 'SVK', EE: 'EST', LV: 'LAT', LT: 'LTU', BA: 'BIH', MK: 'MKD', ME: 'MNE',
  IE: 'IRL', IS: 'ISL', LU: 'LUX', ZA: 'RSA', KE: 'KEN', NG: 'NGR', VE: 'VEN',
  CL: 'CHI', UY: 'URU', PY: 'PAR', EC: 'ECU', BO: 'BOL',
}

/** Accent- and punctuation-insensitive, so "Krawczyński" matches "Krawczynski". */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')

async function visLogin() {
  const r = await fetch(`${PROXY}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.VIS_USER, password: process.env.VIS_PASS }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  const body = await r.text()
  if (!r.ok || !/authenticated/.test(body)) throw new Error(`VIS login failed: ${r.status} ${body.slice(0, 200)}`)
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('VIS login returned no session cookie')
  return cookie
}

/** ⚠ `accept: application/json` AND `origin` are required — else 406. */
const visHeaders = (cookie) => ({
  'content-type': 'application/xml', accept: 'application/json',
  origin: 'https://app.fivb.com', cookie,
  'x-fivb-env': 'production', 'x-fivb-version': 'VISSharp',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
})

async function visPost(cookie, body) {
  const r = await fetch(`${PROXY}/proxy`, {
    method: 'POST', headers: visHeaders(cookie), body,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`VIS request failed: ${r.status} ${text.slice(0, 250)}`)
  const json = JSON.parse(text)
  if (json.errors) throw new Error(`VIS error: ${JSON.stringify(json.errors).slice(0, 250)}`)
  return json
}

/**
 * WHO IS CHECKED — mirror of the SELECT in `vis-player-check.mjs`.
 *   • Everyone with a federation of origin other than 'NONE', INCLUDING 'CH':
 *     Swiss Volley is a VIS federation with its own player index (no. 189 / SUI)
 *     exactly like the others, and the Transfers page groups our Swiss-origin
 *     members under it. Their `in_vis = false` blocks nothing.
 *   • 'NONE' stays out — there is no federation to look them up in.
 *   • GUESTS STAY OUT. A member whose every `member_teams` row has
 *     `guest_level > 0` trains with a team without being licensed by the club, so
 *     there is no eligibility to establish. Kept in step with the page, which
 *     drops them for the same reason.
 */
async function loadCohort(database) {
  const { rows } = await database.raw(`
    SELECT m.id, m.first_name, m.last_name, m.federation_of_origin
      FROM members m
     WHERE m.federation_of_origin IS NOT NULL
       AND m.federation_of_origin <> 'NONE'
       AND m.kscw_membership_active
       AND EXISTS (SELECT 1 FROM member_teams mt
                    WHERE mt.member = m.id AND coalesce(mt.guest_level, 0) = 0)
     ORDER BY m.federation_of_origin, m.last_name`)
  return rows
}

/**
 * The check itself. Resolves to a summary; throws on anything that makes the
 * result untrustworthy (no credentials, VIS down, login rejected) rather than
 * writing a half-run — a detector must get louder, not quieter, when it breaks.
 */
export async function runVisPlayerCheck(database, log) {
  for (const k of ['VIS_USER', 'VIS_PASS']) {
    if (!process.env[k]) throw new Error(`missing env ${k}`)
  }

  const members = await loadCohort(database)
  if (!members.length) return { checked: 0, inVis: 0, notFound: 0, unmapped: [], federations: 0 }

  const cookie = await visLogin()
  const feds = (await visPost(cookie, `<Request Type="${FED_LIST_TYPE}" Properties="No Code Name"/>`)).data
  const byCode = new Map(feds.map((f) => [f.code, f]))

  const rosters = new Map()
  const unmapped = []
  for (const iso of [...new Set(members.map((m) => m.federation_of_origin))]) {
    const fed = byCode.get(ISO2FIVB[iso])
    if (!fed) { unmapped.push(iso); log?.warn?.(`[vis] ${iso}: no VIS federation mapped — skipped`); continue }
    const j = await visPost(cookie,
      `<Request Type="${REQUEST_TYPE}" Properties="No"><Filter NoFederation="${fed.no}"/>` +
      `<Relation Name="Person" Properties="FirstName LastName"/></Request>`)
    const roster = new Map()
    for (const p of j.data || []) if (p.person) roster.set(`${norm(p.person.lastName)}|${norm(p.person.firstName)}`, p.no)
    rosters.set(iso, roster)
    log?.info?.(`[vis] ${iso} (${fed.code}): ${roster.size} players`)
  }

  const found = []
  const notFound = []
  for (const m of members) {
    const roster = rosters.get(m.federation_of_origin)
    if (!roster) continue // unmapped federation — leave the row untouched, not false
    const key = `${norm(m.last_name)}|${norm(m.first_name)}`
    let no = roster.get(key)
    if (!no) {
      // VIS stores full legal given names ("Kacper Jan"); accept a prefix match
      // on the first name when the surname is exact.
      for (const [k, v] of roster) {
        const [ln, fn] = k.split('|')
        if (ln === norm(m.last_name) && (fn.startsWith(norm(m.first_name)) || norm(m.first_name).startsWith(fn))) { no = v; break }
      }
    }
    ;(no ? found : notFound).push({ ...m, no: no ?? null })
  }

  // Only rows we actually evaluated are written; an unmapped federation leaves
  // in_vis NULL rather than asserting a false negative.
  const evaluated = [...found, ...notFound]
  if (evaluated.length) {
    const values = evaluated.map(() => '(?::int, ?::boolean, ?::int)').join(',')
    const bindings = evaluated.flatMap((m) => [m.id, !!m.no, m.no ?? null])
    await database.raw(
      `UPDATE members m SET in_vis = v.f, vis_player_no = v.n, in_vis_checked_at = now()
         FROM (VALUES ${values}) AS v(id, f, n) WHERE m.id = v.id`,
      bindings,
    )
  }

  return {
    checked: evaluated.length,
    inVis: found.length,
    notFound: notFound.length,
    unmapped,
    federations: rosters.size,
  }
}

export function registerVisPlayerCheck(router, { database, logger }) {
  const log = logger.child({ endpoint: 'vis-player-check' })

  // One run at a time, process-wide. Single container, so a module-level flag is
  // the whole story: a second admin pressing the button while a run is in flight
  // gets 409 rather than two concurrent roster pulls racing the same UPDATE.
  let running = false
  let startedAt = null
  let lastResult = null

  /**
   * Mirrors clubdesk-update.js:640 / scorer-vm-check.js. Local by design — the
   * extension has no shared admin guard, and every module closes over its own
   * `database`. `vb_admin` is included because this page IS the volleyball
   * transfer worklist; `bb_admin` is not — basketball has no VIS.
   */
  async function superGate(req) {
    if (req.accountability?.admin) return true
    const userId = req.accountability?.user
    if (!userId) return false
    const m = await database('members').where('user', userId).first('role')
    if (!m) return false
    const roles = Array.isArray(m.role)
      ? m.role
      : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
    return ['superuser', 'admin', 'vb_admin'].some((r) => roles.includes(r))
  }

  async function lastRun() {
    try {
      const row = await database('sync_runs').where('source', SYNC_SOURCE).first()
      if (!row) return null
      return {
        last_run_at: row.last_run_at instanceof Date ? row.last_run_at.toISOString() : row.last_run_at,
        status: row.status,
        rows_changed: row.rows_changed ?? 0,
        duration_ms: row.duration_ms ?? 0,
        error_message: row.error_message ?? null,
      }
    } catch { return null }
  }

  router.get('/admin/vis-player-check', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      res.json({
        running,
        startedAt: startedAt ? new Date(startedAt).toISOString() : null,
        configured: !!(process.env.VIS_USER && process.env.VIS_PASS),
        result: lastResult,
        last: await lastRun(),
      })
    } catch (err) {
      log.error({ msg: `vis-player-check status: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/admin/vis-player-check', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      // Both 409s carry a `code`: they are EXPECTED outcomes (a second admin, a
      // page reload mid-run, an env that was never filled in), and the frontend
      // suppresses coded sub-500s from Sentry rather than filing them as bugs.
      if (running) {
        return res.status(409).json({ status: 'skipped', code: 'vis_check_running', startedAt: new Date(startedAt).toISOString() })
      }
      if (!process.env.VIS_USER || !process.env.VIS_PASS) {
        return res.status(409).json({ status: 'skipped', code: 'vis_credentials_missing' })
      }

      running = true
      startedAt = Date.now()
      lastResult = null

      // Raw-knex writes bypass Directus' activity + revision trail, so the
      // trigger is recorded here (CLAUDE.md → Audit logging). Logged at START:
      // the run outlives the request, and "who pressed it" is the fact worth
      // keeping even if the run then fails.
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'run',
        collection: 'members',
        recordId: null,
        data: { job: SYNC_SOURCE, trigger: 'manual' },
      })

      // Fire and forget: the handler answers 202 immediately and the UI polls
      // the GET above. Every exit path clears `running` and lands a `sync_runs`
      // heartbeat, so the health page and the next caller both see the truth.
      const timer = setTimeout(() => {
        if (running) log.error({ msg: 'vis-player-check exceeded the run timeout', endpoint: 'admin/vis-player-check' })
      }, RUN_TIMEOUT_MS)

      void (async () => {
        try {
          const result = await runVisPlayerCheck(database, log)
          lastResult = { ...result, ok: true, finishedAt: new Date().toISOString() }
          log.info(`[vis] manual check ok — ${result.checked} row(s), ${result.inVis} in VIS, ${result.notFound} not found`)
          await logCronRun(database, SYNC_SOURCE, {
            status: 'ok',
            rowsChanged: result.checked,
            durationMs: Date.now() - startedAt,
            errorMessage: result.unmapped.length ? `unmapped federations: ${result.unmapped.join(', ')}` : null,
          })
        } catch (err) {
          lastResult = { ok: false, error: err.message, finishedAt: new Date().toISOString() }
          log.error({ msg: `vis-player-check failed: ${err.message}`, endpoint: 'admin/vis-player-check', stack: err.stack })
          await logCronRun(database, SYNC_SOURCE, {
            status: 'error',
            durationMs: Date.now() - startedAt,
            errorMessage: err.message.slice(0, 300),
          })
        } finally {
          clearTimeout(timer)
          running = false
        }
      })()

      res.status(202).json({ status: 'started' })
    } catch (err) {
      running = false
      log.error({ msg: `vis-player-check trigger: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
