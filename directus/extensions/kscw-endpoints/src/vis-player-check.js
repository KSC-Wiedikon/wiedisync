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
 * now?" short of waiting for the next month. (That cron went WEEKLY — Mondays —
 * on 2026-08-05 once the run was actually measured; see below.)
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
 * filters, see the script). Measured on 2026-08-05: 24 federations, ~464
 * members, 3.8s end to end — so the async shape is not about the average case.
 * It is that this is one HTTP round trip per federation against a third party
 * we do not control, on a route behind a Cloudflare tunnel that will cut a held
 * request at ~100s. A slow VIS day must show a spinner, not a 524.
 *
 * ⚠ That measurement is what retired the cron's stated rationale ("30 federation
 * rosters is a heavy read"). It is not heavy, so the guard in vis-sync.sh moved
 * from the 1st of the month to every Monday on 2026-08-05.
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

/**
 * The whole name as a SORTED token bag, so it no longer matters which side of
 * the first/last split a middle name or a compound surname landed on.
 *
 * Real case that forced this (2026-08-05): member 729 is `Paula Fiorella` /
 * `Farina`; VIS #243491 in the ARG index is `Paula` / `Fiorella Farina`. Same
 * three tokens, opposite split — so the exact key misses AND the prefix
 * fallback below never fires, because that one requires the SURNAME to be
 * exact. She read as "not in VIS" while sitting in the roster all along.
 * Hispanic and Italian compound surnames make this a class, not a one-off.
 *
 * ⚠ Splits BEFORE stripping punctuation — `norm()` would fuse "Fiorella Farina"
 * into one token and defeat the whole point.
 */
const nameTokens = (...parts) => parts
  .flatMap((p) => String(p || '').split(/[^\p{L}]+/u))
  .map((t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''))
  .filter(Boolean)
  .sort()
const tokenKey = (first, last) => nameTokens(first, last).join(' ')

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
 * One federation roster, indexed every way the cascade needs it.
 *
 * ⚠ `byTokens` holds a SET per key, not a single number: the token bag
 * deliberately collapses name variants, so two DIFFERENT players can land on
 * one key. Where that happens the match is refused rather than guessed.
 *
 * ⚠ MIRROR of `buildRosterIndex` in `directus/scripts/vis-player-check.mjs`,
 * which is where the unit test for it lives — change both together.
 */
function buildRosterIndex(visRows) {
  const roster = new Map()
  const byTokens = new Map()
  const players = []
  // Player number → VIS's own spelling, so a hand-set link (migration 312) can
  // be CONFIRMED against the index rather than trusted.
  const byNo = new Map()
  for (const p of visRows || []) {
    if (!p.person) continue
    byNo.set(Number(p.no), `${p.person.firstName ?? ''} ${p.person.lastName ?? ''}`.trim())
    roster.set(`${norm(p.person.lastName)}|${norm(p.person.firstName)}`, p.no)
    const tk = tokenKey(p.person.firstName, p.person.lastName)
    if (!tk) continue
    if (!byTokens.has(tk)) byTokens.set(tk, new Set())
    byTokens.get(tk).add(p.no)
    players.push({
      no: p.no,
      tokens: new Set(nameTokens(p.person.firstName, p.person.lastName)),
      lastTokens: new Set(nameTokens(p.person.lastName)),
    })
  }
  return { roster, byTokens, players, byNo }
}

/**
 * Resolve ONE member against ONE federation index → `{ no, manualName }`.
 *
 * The cascade, in order, each step firing only if the previous found nothing:
 *   1. exact `lastname|firstname`
 *   2. equal token bags — the same name split differently across first/last
 *   3. surname exact + first-name prefix (VIS stores full legal given names)
 *   4. member tokens a strict SUBSET of one player's, surname on the surname
 * …then the hand-set link, which overrides all four when it is CONFIRMED.
 *
 * ⚠ MIRROR of `matchMember` in `directus/scripts/vis-player-check.mjs` — the
 * unit test lives there and covers this logic by proxy, so a drift here is
 * INVISIBLE to CI. Change both in the same commit.
 */
function matchMember(m, { roster, byTokens, players, byNo }) {
  let no = roster.get(`${norm(m.ln)}|${norm(m.fn)}`)
  if (!no) {
    // Same tokens, split differently across first/last (see nameTokens). Only
    // when it identifies exactly ONE player — a tie is left unmatched.
    const cands = byTokens.get(tokenKey(m.fn, m.ln))
    if (cands && cands.size === 1) no = [...cands][0]
  }
  if (!no) {
    // VIS stores full legal given names ("Kacper Jan"); accept a prefix match
    // on the first name when the surname is exact.
    for (const [k, v] of roster) {
      const [ln, fn] = k.split('|')
      if (ln === norm(m.ln) && (fn.startsWith(norm(m.fn)) || norm(m.fn).startsWith(fn))) { no = v; break }
    }
  }
  if (!no) {
    // VIS keeps EVERY legal given name, and the one a member goes by is not
    // always the first: member 34 is `Christiane` / `Clüver`, VIS #243602 in
    // the GER index is `Dorothea Christiane` / `Clüver`. A prefix cannot reach
    // a second given name, and step 2 needs the bags EQUAL.
    // ⚠ Measured over the whole prod cohort 2026-08-13 (430 members, 416 then
    // unmatched): this adds exactly ONE match — #243602 — with zero ties. Do
    // NOT relax it toward a bare surname match: the surname-only near-hits are
    // different people (`Linda Imhof` → `Stefan Imhof`).
    const mTokens = nameTokens(m.fn, m.ln)
    const mLast = nameTokens(m.ln)
    const cands = players.filter((p) => p.tokens.size > mTokens.length
      && mTokens.every((t) => p.tokens.has(t))
      && mLast.every((t) => p.lastTokens.has(t)))
    if (cands.length === 1) no = cands[0].no
  }
  // A CONFIRMED hand-set link (migration 312) wins over name matching — that is
  // what the column is for: the mismatches the cascade cannot reach (a married
  // name, a transliteration) are exactly the ones a human resolves.
  // ⚠ An UNCONFIRMED one wins nothing. `in_vis` is read as eligibility
  // evidence, so a typo'd number must never assert presence; it is recorded
  // with a NULL name and the Transfers page flags it.
  const manualName = m.manual != null ? (byNo.get(m.manual) ?? null) : null
  if (manualName) no = m.manual
  return { no: no ?? null, manualName }
}

/**
 * WHO IS CHECKED — mirror of the SELECT in `vis-player-check.mjs`.
 *   • Everyone who has answered the federation-of-origin question, INCLUDING
 *     'CH': Swiss Volley is a VIS federation with its own player index (no. 189
 *     / SUI) exactly like the others, and the Transfers page groups our
 *     Swiss-origin members under it. Their `in_vis = false` blocks nothing.
 *     Since migration 342 every answer is a federation — a member whose first
 *     licence is issued here answers 'CH', so nobody is excluded by their
 *     answer any more.
 *   • GUESTS STAY OUT. A member whose every `member_teams` row has
 *     `guest_level > 0` trains with a team without being licensed by the club, so
 *     there is no eligibility to establish. Kept in step with the page, which
 *     drops them for the same reason.
 */
async function loadCohort(database) {
  const { rows } = await database.raw(`
    SELECT m.id, m.first_name, m.last_name, m.federation_of_origin, m.vis_player_no_manual
      FROM members m
     WHERE m.federation_of_origin IS NOT NULL
       AND m.kscw_membership_active
       -- ⚠ CURRENT season: join teams and require active. Unqualified, this
       -- answered "is this member a licensed player?" from EVERY season ever, so
       -- a past-season full player who is a guest today (or on no roster at all)
       -- was still pushed into the FIVB VIS index as club-licensed — and in_vis
       -- is read back as eligibility evidence.
       AND EXISTS (SELECT 1 FROM member_teams mt
                    JOIN teams t ON t.id = mt.team AND t.active
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
  const staging = []
  for (const iso of [...new Set(members.map((m) => m.federation_of_origin))]) {
    const fed = byCode.get(ISO2FIVB[iso])
    if (!fed) { unmapped.push(iso); log?.warn?.(`[vis] ${iso}: no VIS federation mapped — skipped`); continue }
    const j = await visPost(cookie,
      `<Request Type="${REQUEST_TYPE}" Properties="No"><Filter NoFederation="${fed.no}"/>` +
      `<Relation Name="Person" Properties="FirstName LastName"/></Request>`)
    const index = buildRosterIndex(j.data)
    rosters.set(iso, index)
    // Staged below (migration 313). ⚠ MIRROR of the same block in
    // `directus/scripts/vis-player-check.mjs` — change both.
    for (const p of j.data || []) {
      if (!p.person) continue
      const no = Number(p.no)
      if (!Number.isInteger(no)) continue
      staging.push({
        federation_iso: iso,
        player_no: no,
        federation_code: fed.code ?? null,
        federation_no: Number.isFinite(Number(fed.no)) ? Number(fed.no) : null,
        first_name: p.person.firstName ?? null,
        last_name: p.person.lastName ?? null,
      })
    }
    log?.info?.(`[vis] ${iso} (${fed.code}): ${index.roster.size} players`)
  }

  const found = []
  const notFound = []
  for (const m of members) {
    const index = rosters.get(m.federation_of_origin)
    if (!index) continue // unmapped federation — leave the row untouched, not false
    const { no, manualName } = matchMember(
      { fn: m.first_name, ln: m.last_name, manual: m.vis_player_no_manual == null ? null : Number(m.vis_player_no_manual) },
      index,
    )
    ;(no ? found : notFound).push({ ...m, no, manualName })
  }

  // Only rows we actually evaluated are written; an unmapped federation leaves
  // in_vis NULL rather than asserting a false negative.
  const evaluated = [...found, ...notFound]
  if (evaluated.length) {
    const values = evaluated.map(() => '(?::int, ?::boolean, ?::int, ?::text)').join(',')
    const bindings = evaluated.flatMap((m) => [m.id, !!m.no, m.no ?? null, m.manualName ?? null])
    await database.raw(
      `UPDATE members m SET in_vis = v.f, vis_player_no = v.n, vis_manual_vis_name = v.mn,
              in_vis_checked_at = now()
         FROM (VALUES ${values}) AS v(id, f, n, mn) WHERE m.id = v.id`,
      bindings,
    )
  }

  // Stage the rosters we just downloaded (migration 313). Derived data written
  // last and in its own transaction: the members UPDATE above IS the job, so a
  // staging failure warns and reports `staged: null` rather than failing a run
  // whose verdicts already committed.
  // ⚠ MIRROR of `writeVisPlayerStaging` in `directus/scripts/vis-player-check.mjs`.
  // Full replace, so the table means "the last successful download" and a
  // federation nobody claims any more cannot linger. Skipped when empty — that
  // means every federation was unmapped, never that VIS is empty.
  let staged = null
  if (staging.length) {
    try {
      await database.transaction(async (trx) => {
        await trx('vis_players').del()
        for (let i = 0; i < staging.length; i += 1000) {
          await trx('vis_players')
            .insert(staging.slice(i, i + 1000))
            .onConflict(['federation_iso', 'player_no'])
            .ignore()
        }
      })
      staged = staging.length
      log?.info?.(`[vis] staged ${staged} roster row(s) from ${rosters.size} federation(s)`)
    } catch (e) {
      log?.warn?.(`[vis] roster staging FAILED — verdicts are unaffected: ${e.message}`)
    }
  } else {
    log?.warn?.('[vis] nothing downloaded — leaving vis_players untouched')
  }

  return {
    checked: evaluated.length,
    inVis: found.length,
    notFound: notFound.length,
    unmapped,
    federations: rosters.size,
    staged,
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
