#!/usr/bin/env node
/**
 * FIVB VIS → `vis_transfers` staging (migration 237).
 *
 * VIS is the only system that knows whether an international transfer has
 * actually completed. Swiss Volley validates the licence when the ITC arrives —
 * "vorher ist die Lizenz/der Einsatz nicht gültig" — so `licence_validated` is a
 * useful downstream proxy, but it is one-way: good for confirming done, useless
 * for diagnosing why something is stuck. This reads the real status.
 *
 * ⚠⚠ READ-ONLY BY CONSTRUCTION. The same proxy serves SaveVolleyTransfer,
 * SignVolleyTransfer, ConfirmVolleyTransfer, ReleaseVolleyTransfer and
 * CancelVolleyTransfer — a wrong request type here does not fetch the wrong data,
 * it alters a real player's eligibility in a federation system. So the request
 * type is not a parameter: it is a hardcoded constant, asserted against a
 * read-verb allowlist before every call, and there is no code path that builds a
 * request type from input.
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
 *   VIS_USER=… VIS_PASS=… node vis-transfer-sync.mjs <dev|prod> [--season N] [--dry-run]
 *
 * Credentials: rbw get 'FIVB VIS - KSC Wiedikon' --folder services/fivb-vis
 */
import { spawnSync } from 'node:child_process'

const PROXY = 'https://proxy.app.fivb.com'
/** KSC Wiedikon's VIS club number. */
const CLUB_NO = 13021
/** VIS season 16 = 2025/26. GetVolleySeasonList maps these; bump per season. */
const DEFAULT_SEASON = 16

/** The ONLY request type this script may ever send. */
const REQUEST_TYPE = 'GetVolleyTransferList'
if (!/^(Get|Check|Export|List)/.test(REQUEST_TYPE)) {
  throw new Error(`refusing to run: ${REQUEST_TYPE} is not a read-only VIS verb`)
}

const ENVS = {
  dev: { container: 'kscw-postgres', database: 'directus_kscw_dev', user: 'supabase_admin' },
  prod: { container: 'kscw-postgres', database: 'postgres', user: 'supabase_admin' },
}

function psql(env, sql) {
  const cmd = ['ssh', 'hetzner', 'sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database, '-X', '-v', 'ON_ERROR_STOP=1']
  const r = spawnSync(cmd[0], cmd.slice(1), { input: sql, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`psql failed:\n${r.stderr || r.stdout}`)
  return r.stdout
}

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
async function fetchTransfers(cookie, season) {
  const body =
    `<Request Type="${REQUEST_TYPE}" Properties="No DeletedAt StartOn EndOn NoBySeason NoSeason Status Type IsPlayerMinor GlobalPercentageCompleted IsPlayerBlocked">` +
    `<Filter Statuses="10 12 20 100 130 200 210 215 220 239 240 255" NoSeason="${season}" NoClub="${CLUB_NO}" Version="0"/>` +
    `<Relation Name="Cache" Properties="TeamToName TeamToDivisionName TeamToDivisionLevel"/>` +
    `<Relation Name="Tasks" Properties="Type PercentageCompleted"/>` +
    `<Relation Name="Contract" Properties="No NoPlayer NoClubTo">` +
    `<Relation Name="ClubTo" Properties="No Name NoFederation"/>` +
    `<Relation Name="Cache" Properties="PlayerFirstName PlayerLastName NoPlayerFederation"/>` +
    `<Relation Name="Player" Properties="No NoCev Version"><Relation Name="Person" Properties="Gender"/></Relation>` +
    `<Relation Name="Tasks" Properties="Type PercentageCompleted"/>` +
    `<Relation Name="Transfers" Properties="No"/>` +
    `</Relation></Request>`

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
  if (!r.ok) throw new Error(`VIS ${REQUEST_TYPE} failed: ${r.status} ${text.slice(0, 300)}`)
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`VIS returned non-JSON: ${text.slice(0, 300)}`) }
  if (json.errors) throw new Error(`VIS error: ${JSON.stringify(json.errors).slice(0, 300)}`)
  if (!Array.isArray(json.data)) throw new Error(`VIS response has no data array: ${text.slice(0, 300)}`)
  return json.data
}

/** VIS status codes seen on the club view. 200 = Ended (the ITC is issued). */
const STATUS_LABEL = {
  10: 'draft', 12: 'draft', 20: 'submitted', 100: 'in progress', 130: 'in progress',
  200: 'ended', 210: 'ended', 215: 'ended', 220: 'ended', 239: 'cancelled',
  240: 'cancelled', 255: 'refused',
}

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

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((a) => a === 'dev' || a === 'prod')
  const dryRun = args.includes('--dry-run')
  const si = args.indexOf('--season')
  const season = si >= 0 ? Number(args[si + 1]) : DEFAULT_SEASON

  for (const k of ['VIS_USER', 'VIS_PASS']) if (!process.env[k]) throw new Error(`missing env ${k}`)
  if (!dryRun && !target) throw new Error('specify dev or prod (or --dry-run)')

  const cookie = await login()
  console.log('[vis] authenticated')
  const raw = await fetchTransfers(cookie, season)
  const rows = raw.map(flatten)
  console.log(`[vis] season ${season}: ${rows.length} transfer(s) for club ${CLUB_NO}`)
  for (const r of rows) {
    console.log(`  #${r.no_by_season} ${r.player_last_name}, ${r.player_first_name} — ${r.status_label} ${r.percent_complete}%`)
  }

  if (dryRun) { console.log(JSON.stringify(rows, null, 1)); return }

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
  const sql = `BEGIN;
DELETE FROM vis_transfers WHERE season_no = ${season};
${rows.length ? `INSERT INTO vis_transfers
  (vis_no, season_no, no_by_season, status_code, status_label, percent_complete,
   is_player_minor, is_player_blocked, start_on, end_on, player_no,
   player_first_name, player_last_name, from_federation_no, to_club_no,
   to_club_name, to_team_name, to_division_name, deleted_at)
VALUES
${values};` : '-- no transfers this season'}
COMMIT;
SELECT 'vis_transfers' AS t, count(*) AS n FROM vis_transfers;`
  psql(ENVS[target], sql)
  console.log(`[vis] staged ${rows.length} row(s) into vis_transfers (${target})`)
}

main().catch((e) => { console.error('[vis] FAILED:', e.message); process.exit(1) })
