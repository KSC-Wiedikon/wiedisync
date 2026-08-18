#!/usr/bin/env node
/**
 * FIVB VIS → `vis_transfers` staging (migration 237), then `members.transfer_status`.
 *
 * VIS is the only system that knows whether an international transfer has
 * actually completed. Swiss Volley validates the licence when the ITC arrives —
 * "vorher ist die Lizenz/der Einsatz nicht gültig" — so `licence_validated` is a
 * useful downstream proxy, but it is one-way: good for confirming done, useless
 * for diagnosing why something is stuck. This reads the real status.
 *
 * Two jobs, in order:
 *   1. STAGE   — mirror the club's transfers into `vis_transfers`.
 *   2. RECONCILE — write the club's own workflow marker, `members.transfer_status`,
 *                  from what VIS says. See `reconcileDecisions` for the rules.
 *
 * ⚠⚠ READ-ONLY AGAINST VIS BY CONSTRUCTION. The same proxy serves
 * SaveVolleyTransfer, SignVolleyTransfer, ConfirmVolleyTransfer,
 * ReleaseVolleyTransfer and CancelVolleyTransfer — a wrong request type here does
 * not fetch the wrong data, it alters a real player's eligibility in a federation
 * system. So the request type is not a parameter: every one is a hardcoded
 * constant, asserted against a read-verb allowlist at module load, and there is
 * no code path that builds a request type from input. The writes this script
 * performs are to OUR OWN database and nothing else.
 *
 * No browser. The web app is a thin client over an XML-in/JSON-out proxy, so this
 * replays the exact documented request with fetch. Far more robust than driving
 * an SPA — and it means the only thing that can break is the request contract,
 * which fails loudly rather than silently returning nothing.
 *
 * ⚠ Swiss Volley warns the tool changes yearly ("aufgrund von jährlich
 * Änderungen"), so every failure here is FATAL and visible. A transfer sync that
 * silently returns zero rows would read as "no transfers pending", which is the
 * one wrong answer that matters.
 *
 * Usage:
 *   VIS_USER=… VIS_PASS=… node vis-transfer-sync.mjs <dev|prod> [--season N]
 *                                                    [--dry-run] [--no-reconcile]
 *
 * Credentials: rbw get 'FIVB VIS - KSC Wiedikon' --folder services/fivb-vis
 */
import { spawnSync } from 'node:child_process'

const PROXY = 'https://proxy.app.fivb.com'
/** KSC Wiedikon's VIS club number. */
const CLUB_NO = 13021

/**
 * The ONLY request types this script may ever send.
 *
 * ⚠ Asserted at module load, not at call time: a read verb that slipped through
 * review must fail before a session is even opened, not on the one branch that
 * happens to execute.
 */
const REQ_TRANSFERS = 'GetVolleyTransferList'
const REQ_SEASONS = 'GetVolleySeasonList'
for (const rt of [REQ_TRANSFERS, REQ_SEASONS]) {
  if (!/^(Get|Check|Export|List)/.test(rt)) {
    throw new Error(`refusing to run: ${rt} is not a read-only VIS verb`)
  }
}

/** Written into `members.transfer_done_by_name` so the page can say who decided.
 *  It renders as "Done on 18.08.2026 by FIVB VIS" — deliberately not a person. */
export const VIS_ACTOR = 'FIVB VIS'

const ENVS = {
  dev: { container: 'kscw-postgres', database: 'directus_kscw_dev', user: 'supabase_admin' },
  prod: { container: 'kscw-postgres', database: 'postgres', user: 'supabase_admin' },
}

function psqlBase(env, extra) {
  // KSCW_LOCAL_PSQL=1 when running ON the VPS — `ssh hetzner` from the VPS would
  // just loop back to itself.
  const local = process.env.KSCW_LOCAL_PSQL === '1'
  const base = ['sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database, ...extra, '-X', '-v', 'ON_ERROR_STOP=1']
  return local ? base : ['ssh', 'hetzner', ...base]
}

function run(cmd, sql) {
  const r = spawnSync(cmd[0], cmd.slice(1), { input: sql, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`psql failed:\n${r.stderr || r.stdout}`)
  return r.stdout
}

const psql = (env, sql) => run(psqlBase(env, []), sql)

/**
 * Row-returning psql. `-tA` gives untitled, unaligned, `|`-separated output.
 *
 * ⚠ Never pass a `|` inside an ssh argv — ssh joins args into a REMOTE SHELL
 * string, so it becomes a pipe. `-tA` already defaults to `|`, so -F is not
 * needed. (Cost a silent zero-row result once, in vis-player-check.)
 */
const psqlRows = (env, sql) => run(psqlBase(env, ['-tA']), sql)
  .trim().split('\n').filter(Boolean).map((l) => l.split('|'))

const lit = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 'NULL' : String(Number(v)))
const bool = (v) => (v === null || v === undefined ? 'NULL' : v ? 'true' : 'false')

async function login() {
  const r = await fetch(`${PROXY}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.VIS_USER, password: process.env.VIS_PASS }),
  })
  const body = await r.text()
  if (!r.ok || !/authenticated/.test(body)) throw new Error(`VIS login failed: ${r.status} ${body.slice(0, 200)}`)
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('VIS login returned no session cookie')
  return cookie
}

/**
 * ⚠ `accept: application/json` and `origin` are REQUIRED — without them the proxy
 * answers 406 InvalidRequestFormat even though the body is byte-identical. Cost
 * an hour to find; do not trim these headers.
 */
async function visRequest(cookie, requestType, body) {
  const r = await fetch(`${PROXY}/proxy`, {
    method: 'POST',
    headers: {
      'content-type': 'application/xml',
      accept: 'application/json',
      origin: 'https://app.fivb.com',
      cookie,
      'x-fivb-env': 'production',
      'x-fivb-version': 'VISSharp',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    },
    body,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`VIS ${requestType} failed: ${r.status} ${text.slice(0, 300)}`)
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`VIS returned non-JSON: ${text.slice(0, 300)}`) }
  if (json.errors) throw new Error(`VIS error: ${JSON.stringify(json.errors).slice(0, 300)}`)
  if (!Array.isArray(json.data)) throw new Error(`VIS response has no data array: ${text.slice(0, 300)}`)
  return json.data
}

const fetchSeasons = (cookie) =>
  visRequest(cookie, REQ_SEASONS, `<Request Type="${REQ_SEASONS}" Properties="No Name"/>`)

const fetchTransfers = (cookie, season) => visRequest(cookie, REQ_TRANSFERS,
  `<Request Type="${REQ_TRANSFERS}" Properties="No DeletedAt StartOn EndOn NoBySeason NoSeason Status Type IsPlayerMinor GlobalPercentageCompleted IsPlayerBlocked">` +
  `<Filter Statuses="10 12 20 100 130 200 210 215 220 239 240 255" NoSeason="${season}" NoClub="${CLUB_NO}" Version="0"/>` +
  `<Relation Name="Cache" Properties="TeamToName TeamToDivisionName TeamToDivisionLevel"/>` +
  `<Relation Name="Tasks" Properties="Type PercentageCompleted"/>` +
  `<Relation Name="Contract" Properties="No NoPlayer NoClubTo">` +
  `<Relation Name="ClubTo" Properties="No Name NoFederation"/>` +
  `<Relation Name="Cache" Properties="PlayerFirstName PlayerLastName NoPlayerFederation"/>` +
  `<Relation Name="Player" Properties="No NoCev Version"><Relation Name="Person" Properties="Gender"/></Relation>` +
  `<Relation Name="Tasks" Properties="Type PercentageCompleted"/>` +
  `<Relation Name="Transfers" Properties="No"/>` +
  `</Relation></Request>`)

/**
 * Resolve the live VIS season number from VIS's own list, instead of pinning it.
 *
 * ⚠⚠ This used to be `DEFAULT_SEASON = 16`, and by 2026-08-18 that constant was
 * a season out of date: `vis_transfers` held ONE stale 2025/26 row while the
 * club's actual worklist — 16 transfers for 2026/27 — was never fetched at all.
 * A yearly hand-edit is not a maintenance cost anybody remembers to pay, and the
 * failure is silent in the worst possible direction: an empty transfer list
 * reads as "nothing pending".
 *
 * Season numbers happen to run sequentially from 2010/11 = 1, but that is an
 * observation about today's data, not a contract, so the mapping is READ and the
 * NAME is what is matched. Names are `YYYY/YY` ("2026/27").
 *
 * The rollover is July: the 2026/27 transfers were already being worked in
 * August with `start_on` in mid-September, so keying on the playing season's
 * start date would leave the whole summer pointing at the season just ended.
 */
export function currentSeasonNo(seasons, today = new Date()) {
  const startYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1
  const wanted = String(startYear)
  const hit = seasons.find((s) => String(s.name || '').startsWith(`${wanted}/`))
  if (!hit) {
    throw new Error(`VIS season list has no season starting ${wanted} (got: ${seasons.map((s) => s.name).join(', ')})`)
  }
  return hit.no
}

/** VIS status codes seen on the club view. 200 = Ended (the ITC is issued). */
const STATUS_LABEL = {
  10: 'draft', 12: 'draft', 20: 'submitted', 100: 'in progress', 130: 'in progress',
  200: 'ended', 210: 'ended', 215: 'ended', 220: 'ended', 239: 'cancelled',
  240: 'cancelled', 255: 'refused',
}

/** Cancelled / refused. These are not evidence of anything and are ignored by
 *  the reconciliation entirely — they must never mark a transfer done, and they
 *  must never drag a done transfer back to pending either. */
export const DEAD_STATUS_CODES = new Set([239, 240, 255])
/** The ITC exists. */
export const ENDED_STATUS_CODES = new Set([200, 210, 215, 220])

function flatten(t) {
  const c = t.contract || {}
  const cc = c.cache || {}
  return {
    vis_no: t.no,
    season_no: t.noSeason,
    no_by_season: t.noBySeason,
    status_code: t.status,
    status_label: STATUS_LABEL[t.status] || `unknown(${t.status})`,
    percent_complete: t.globalPercentageCompleted,
    is_player_minor: t.isPlayerMinor,
    is_player_blocked: t.isPlayerBlocked,
    start_on: t.startOn || null,
    end_on: t.endOn || null,
    player_no: c.noPlayer ?? null,
    player_first_name: cc.playerFirstName ?? null,
    player_last_name: cc.playerLastName ?? null,
    from_federation_no: cc.noPlayerFederation ?? null,
    to_club_no: c.noClubTo ?? null,
    to_club_name: c.clubTo?.name ?? null,
    to_team_name: t.cache?.teamToName ?? null,
    to_division_name: t.cache?.teamToDivisionName ?? null,
    deleted_at: t.deletedAt || null,
  }
}

/**
 * What VIS says about one player's transfer this season.
 *
 * ⚠ "Complete" is `percent_complete === 100` OR an ended status — NOT "ended"
 * alone. On 2026-08-18 all seven transfers the club had already cleared by hand
 * sat at status 130 / 100%, and not one had reached 200: `ended` only arrives
 * once the season itself starts (14.09.2026). Waiting for it would mean the page
 * showed nothing done for another month, which is precisely the state a human
 * had already overruled seven times.
 *
 * A player can hold more than one live row (a resubmission), so the MOST
 * advanced one wins — anything else would let a fresh draft mask a finished ITC.
 */
export function visStateOf(rows) {
  const live = rows.filter((r) => !r.deleted_at && !DEAD_STATUS_CODES.has(r.status_code))
  if (!live.length) return { state: 'none', row: null }
  const complete = live.filter((r) => r.percent_complete === 100 || ENDED_STATUS_CODES.has(r.status_code))
  if (complete.length) {
    // Prefer a genuinely ended row over a merely 100% one when both exist.
    const best = complete.find((r) => ENDED_STATUS_CODES.has(r.status_code)) || complete[0]
    return { state: 'complete', row: best }
  }
  const best = live.reduce((a, b) => ((b.percent_complete ?? 0) > (a.percent_complete ?? 0) ? b : a))
  return { state: 'in_progress', row: best }
}

/**
 * Decide what `members.transfer_status` should become, from VIS.
 *
 * Matching is by VIS player number ONLY — `vis_player_no_manual` (the hand-set
 * link, migration 312) ahead of `vis_player_no` (name-matched by
 * vis-player-check). Names are deliberately not used: this writes to a column
 * that decides whether somebody is eligible to play, and a name collision that
 * cleared the wrong person's transfer is the one failure that actually matters.
 *
 *   VIS complete    + NULL / pending  → 'done'    (+ actor + timestamp)
 *   VIS in progress + NULL            → 'pending' (open the worklist item)
 *   VIS in progress + 'done'          → 'pending' (revert — see below)
 *   VIS anything    + 'not_needed'    → untouched, reported as a conflict
 *   no live VIS row + anything        → untouched
 *
 * ⚠⚠ The revert makes VIS authoritative in BOTH directions, and it will fight a
 * human who disagrees: mark somebody done while VIS still shows 0% and the next
 * nightly run puts them back to pending. That is the point — a `done` whose ITC
 * has not landed asserts an eligibility the player does not have, and fielding
 * an unvalidated licence is sanctionable (FIVB Disciplinary Regulations Art.
 * 11.4). The escape hatch for a transfer genuinely settled outside VIS is
 * `not_needed`, which this never touches.
 *
 * ⚠ A member is never touched when VIS has no live row for them. Last season's
 * completed transfer must not clear this season's — on 2026-08-18 Ivo Teixeira
 * held exactly that pair (2025/26 ended, 2026/27 at 20%).
 */
export function reconcileDecisions(visRows, members) {
  const changes = []
  const conflicts = []
  const ambiguous = []
  const unmatched = []

  // Fail closed on a duplicated link rather than picking one: two members
  // resolving to the same VIS player means the name match is wrong somewhere,
  // and a wrong write here is not recoverable by looking at the row.
  const byPlayerNo = new Map()
  for (const m of members) {
    const no = m.vis_player_no_manual ?? m.vis_player_no
    if (no == null) continue
    if (!byPlayerNo.has(no)) byPlayerNo.set(no, [])
    byPlayerNo.get(no).push(m)
  }

  const rowsByPlayer = new Map()
  for (const r of visRows) {
    if (r.player_no == null) continue
    if (!rowsByPlayer.has(r.player_no)) rowsByPlayer.set(r.player_no, [])
    rowsByPlayer.get(r.player_no).push(r)
  }

  for (const [playerNo, rows] of rowsByPlayer) {
    const visName = `${rows[0].player_last_name}, ${rows[0].player_first_name}`
    const matched = byPlayerNo.get(playerNo) || []
    if (matched.length === 0) { unmatched.push({ playerNo, visName, rows }); continue }
    if (matched.length > 1) {
      ambiguous.push({ playerNo, visName, members: matched })
      continue
    }
    const m = matched[0]
    const { state, row } = visStateOf(rows)
    if (state === 'none') continue

    const name = `${m.last_name}, ${m.first_name}`
    const detail = `#${row.no_by_season ?? row.vis_no} ${row.status_label} ${row.percent_complete ?? 0}%`

    if (m.transfer_status === 'not_needed') {
      conflicts.push({ memberId: m.id, name, status: m.transfer_status, visState: state, detail })
      continue
    }
    if (state === 'complete' && m.transfer_status !== 'done') {
      changes.push({ memberId: m.id, name, from: m.transfer_status, to: 'done', detail, visNo: row.vis_no, percent: row.percent_complete })
    } else if (state === 'in_progress' && m.transfer_status !== 'pending') {
      changes.push({ memberId: m.id, name, from: m.transfer_status, to: 'pending', detail, visNo: row.vis_no, percent: row.percent_complete })
    }
  }
  return { changes, conflicts, ambiguous, unmatched }
}

/**
 * Apply the decisions. One transaction, and every write also lands in
 * `user_logs` — this is a cron writing raw SQL, so Directus records nothing on
 * its own and the audit-log page would otherwise show member records changing
 * with no explanation at all (CLAUDE.md → "Audit logging (actor capture)").
 * `user` is NULL because no person acted, which is how every other automated
 * sync already appears there (sv_vm_check: 4,898 rows, all NULL).
 */
function applyChanges(env, changes) {
  if (!changes.length) return
  const doneIds = changes.filter((c) => c.to === 'done').map((c) => c.memberId)
  const pendingIds = changes.filter((c) => c.to === 'pending').map((c) => c.memberId)

  const logs = changes.map((c) => `(${[
    lit('update'), lit('members'), lit(String(c.memberId)),
    lit(JSON.stringify({
      transfer_status: c.to,
      from: c.from,
      source: 'vis-transfer-sync',
      vis_no: c.visNo,
      vis_percent: c.percent ?? null,
    })) + '::json',
    'NULL', 'now()',
  ].join(', ')})`).join(',\n')

  // ⚠ "user" MUST stay quoted — a bare `user` in Postgres is the CURRENT_USER
  // keyword, not this column.
  const sql = `BEGIN;
${doneIds.length ? `UPDATE members SET transfer_status = 'done', transfer_done_at = now(), transfer_done_by_name = ${lit(VIS_ACTOR)}
 WHERE id IN (${doneIds.join(', ')});` : ''}
${pendingIds.length ? `UPDATE members SET transfer_status = 'pending', transfer_done_at = NULL, transfer_done_by_name = NULL
 WHERE id IN (${pendingIds.join(', ')});` : ''}
INSERT INTO user_logs (action, collection_name, record_id, data, "user", date_created) VALUES
${logs};
COMMIT;`
  psql(env, sql)
}

function stage(env, season, rows) {
  const values = rows.map((r) => `(${[
    num(r.vis_no), num(r.season_no), num(r.no_by_season), num(r.status_code), lit(r.status_label),
    num(r.percent_complete), bool(r.is_player_minor), bool(r.is_player_blocked),
    r.start_on ? lit(r.start_on) + '::date' : 'NULL', r.end_on ? lit(r.end_on) + '::date' : 'NULL',
    num(r.player_no), lit(r.player_first_name), lit(r.player_last_name),
    num(r.from_federation_no), num(r.to_club_no), lit(r.to_club_name),
    lit(r.to_team_name), lit(r.to_division_name),
    r.deleted_at ? lit(r.deleted_at) + '::timestamptz' : 'NULL',
  ].join(', ')})`).join(',\n')

  // No rows is a legitimate answer (a season with no transfers), but it must not
  // silently wipe the table — so only DELETE rows for the season we actually read.
  psql(env, `BEGIN;
DELETE FROM vis_transfers WHERE season_no = ${season};
${rows.length ? `INSERT INTO vis_transfers
  (vis_no, season_no, no_by_season, status_code, status_label, percent_complete,
   is_player_minor, is_player_blocked, start_on, end_on, player_no,
   player_first_name, player_last_name, from_federation_no, to_club_no,
   to_club_name, to_team_name, to_division_name, deleted_at)
VALUES
${values};` : '-- no transfers this season'}
COMMIT;`)
}

const readMembers = (env) => psqlRows(env, `SELECT id, coalesce(first_name,''), coalesce(last_name,''),
       coalesce(transfer_status,''), coalesce(vis_player_no::text,''), coalesce(vis_player_no_manual::text,'')
  FROM members
 WHERE vis_player_no IS NOT NULL OR vis_player_no_manual IS NOT NULL;`)
  .map(([id, first_name, last_name, transfer_status, no, manual]) => ({
    id: Number(id),
    first_name,
    last_name,
    transfer_status: transfer_status || null,
    vis_player_no: no ? Number(no) : null,
    vis_player_no_manual: manual ? Number(manual) : null,
  }))

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((a) => a === 'dev' || a === 'prod')
  const dryRun = args.includes('--dry-run')
  const noReconcile = args.includes('--no-reconcile')
  const si = args.indexOf('--season')
  const seasonArg = si >= 0 ? Number(args[si + 1]) : null

  for (const k of ['VIS_USER', 'VIS_PASS']) if (!process.env[k]) throw new Error(`missing env ${k}`)
  if (!dryRun && !target) throw new Error('specify dev or prod (or --dry-run)')
  const env = target ? ENVS[target] : null

  const cookie = await login()
  console.log('[vis] authenticated')

  const season = seasonArg ?? currentSeasonNo(await fetchSeasons(cookie))
  // The season just ended is staged too, so a transfer that completes after the
  // rollover stays visible instead of vanishing on 1 July. Only the CURRENT
  // season is ever reconciled — see reconcileDecisions.
  const seasons = seasonArg ? [seasonArg] : [season - 1, season]

  let currentRows = []
  for (const s of seasons) {
    const rows = (await fetchTransfers(cookie, s)).map(flatten)
    if (s === season) currentRows = rows
    console.log(`[vis] season ${s}: ${rows.length} transfer(s) for club ${CLUB_NO}${s === season ? ' (current)' : ''}`)
    for (const r of rows) {
      console.log(`  #${r.no_by_season} ${r.player_last_name}, ${r.player_first_name} — ${r.status_label} ${r.percent_complete}%`)
    }
    if (!dryRun) stage(env, s, rows)
  }
  if (!dryRun) console.log(`[vis] staged season(s) ${seasons.join(', ')} into vis_transfers (${target})`)

  if (noReconcile) { console.log('[vis] --no-reconcile: members.transfer_status left alone'); return }
  // A dry run still needs a database to compare against — it reads members and
  // prints the plan, it just never writes. Without a target there is nothing to
  // reconcile against, so the staging dump is the whole answer.
  if (!env) { console.log(JSON.stringify(currentRows, null, 1)); return }

  const members = readMembers(env)
  const { changes, conflicts, ambiguous, unmatched } = reconcileDecisions(currentRows, members)

  for (const a of ambiguous) {
    console.warn(`[vis] ⚠ AMBIGUOUS: VIS player ${a.playerNo} (${a.visName}) matches ${a.members.length} members ` +
      `(${a.members.map((m) => m.id).join(', ')}) — not changed`)
  }
  for (const u of unmatched) {
    console.warn(`[vis] ⚠ UNLINKED: VIS player ${u.playerNo} (${u.visName}) matches no member — ` +
      `set the link on /admin/transfers`)
  }
  for (const c of conflicts) {
    console.warn(`[vis] ⚠ CONFLICT: ${c.name} (member ${c.memberId}) is '${c.status}' but VIS has a live transfer ` +
      `(${c.detail}) — not changed`)
  }
  for (const c of changes) {
    console.log(`[vis] ${dryRun ? 'WOULD SET' : 'SET'} ${c.name} (member ${c.memberId}): ` +
      `${c.from ?? '(none)'} → ${c.to}  [${c.detail}]`)
  }
  if (!changes.length) console.log('[vis] members.transfer_status already agrees with VIS — no changes')

  if (dryRun) { console.log(`[vis] dry run — ${changes.length} change(s) NOT applied`); return }
  applyChanges(env, changes)
  if (changes.length) console.log(`[vis] applied ${changes.length} transfer_status change(s) (${target})`)
}

// Only run as a job when invoked directly — the tests import the pure helpers
// above and must not kick off a VIS session by doing so.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('[vis] FAILED:', e.message); process.exit(1) })
}
