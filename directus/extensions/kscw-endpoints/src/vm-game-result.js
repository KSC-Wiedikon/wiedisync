/**
 * Volleymanager result reports for one game — READ ONLY, in-process.
 *
 * After a match each team files a "Resultatmeldung" (gameResultReport) in VM. In
 * 'bothteams' leagues VM makes the result official the moment the two reports agree;
 * in 'hometeam' leagues only the home team reports. This module reads what VM holds
 * so the game modal (game-result.js) can show the opponent's report, prefill our form
 * from it and offer "Confirm result" — the write itself is the spawned worker's job
 * (`scripts/vm-push-result.mjs`), never this file's.
 *
 * Two calls, both GETs, taken from a recorded browser session (2026-09-28):
 *   - `api\game/showWithNestedObjects` with a propertyRenderConfiguration that renders
 *     every report (+ its validation and updatedAt), the league's notification system
 *     and number of win sets, and `result` — VM's OFFICIAL result, null until official.
 *     Whether WE may still report comes from the game's party flags (partyMayReport),
 *     not from `_permissions` alone — that bit is create:true on every property of the
 *     recorded response, so it says nothing about this game.
 *   - `api\gameresultreport/getReportingPartyTypeOfActiveParty` → "hometeam" /
 *     "awayteam": which side WE are. Asked rather than derived from games.type, for the
 *     same reason vm-nomination-list.js takes VM's word over our own home/away flag.
 * GETs carry `Window-Unique-Id` and no csrf token.
 *
 * Set balls are `homeTeamSet{1..5}Balls` / `awayTeamSet{1..5}Balls` on a report AND on
 * `result`; null = set not played. `reportToSets` converts either.
 */

import { claimVmAccount, vmAccountHeldBy } from './vm-account-lock.js'

// Absolute container path: `directus/scripts/` is a separate bind-mount, deployed
// via `npm run scripts:deploy:*`, not by `ext:deploy`. Same import as vm-nomination-list.js.
const VM_CLIENT = '/directus/scripts/vm-client.mjs'

// A VM login is 4 HTTP hops; reuse the session across modal opens.
const SESSION_TTL_MS = 15 * 60 * 1000

// The member is looking at the modal. Fail fast to the stored state rather than hang.
const VM_TIMEOUT_MS = 8000

// Several teammates open the same game after the match; one read a minute is plenty.
const READ_CACHE_TTL_MS = 60 * 1000

const GAME_PAGE = '/sportmanager.indoorvolleyball/game/index'

const RENDER_CONFIG = [
  'gameResultReports.*.gameResultReportValidation',
  'gameResultReports.*.updatedAt',
  'encounter.*',
  'group.phase.league.resultNotificationSystem.identifier',
  'result',
  'group.phase.league.numberOfWinSets',
]

const PARTIES = new Set(['hometeam', 'awayteam', 'referee', 'championship_owner'])

let session = null
const readCache = new Map() // uuid → { at, value }

/**
 * VM report / result object → { sets: [{home, away}], home, away } (home/away = sets
 * won), or null when no set was entered. A set counts once BOTH sides have balls.
 */
export function reportToSets(obj) {
  if (!obj || typeof obj !== 'object') return null
  const sets = []
  for (let i = 1; i <= 5; i++) {
    const h = obj[`homeTeamSet${i}Balls`]
    const a = obj[`awayTeamSet${i}Balls`]
    if (h == null || a == null || h === '' || a === '') continue
    const home = Number(h)
    const away = Number(a)
    if (!Number.isFinite(home) || !Number.isFinite(away)) continue
    sets.push({ home, away })
  }
  if (!sets.length) return null
  return {
    sets,
    home: sets.filter((s) => s.home > s.away).length,
    away: sets.filter((s) => s.away > s.home).length,
  }
}

/**
 * May our party (still) file a report? VM's own flags, per party, all present in the
 * default showWithNestedObjects response:
 *   - `<home|away>TeamGameResultReportDeadlineExceeded` — our reporting deadline is past;
 *   - `isGameResultReported` without an official result — the reporting round is closed
 *     (e.g. awaiting the championship owner), there is nothing left for a team to file.
 * The `_permissions` bit stays as an extra AND: when it does say no, it means it.
 * `ownParty` unknown → only the party-independent checks apply.
 */
export function partyMayReport(game, ownParty, official) {
  if (game?._permissions?.properties?.gameResultReports?.create !== true) return false
  if (ownParty === 'hometeam' && game.homeTeamGameResultReportDeadlineExceeded === true) return false
  if (ownParty === 'awayteam' && game.awayTeamGameResultReportDeadlineExceeded === true) return false
  if (game.isGameResultReported === true && !official) return false
  return true
}

const neededFromLeague = (v) => (v === 'two_win_sets' ? 2 : v === 'three_win_sets' ? 3 : null)

/**
 * Pure: the two VM answers → the shape readVmGameResult returns. Exported for tests.
 * @param {object} showBody   showWithNestedObjects response ({ game })
 * @param {unknown} partyBody getReportingPartyTypeOfActiveParty response ("awayteam")
 */
export function parseGameResult(showBody, partyBody) {
  const game = showBody?.game ?? showBody
  if (!game || typeof game !== 'object') return null
  const league = game.group?.phase?.league ?? null

  const reports = (Array.isArray(game.gameResultReports) ? game.gameResultReports : [])
    .filter((r) => r && !r.deletedAt && PARTIES.has(r.reportingPartyType))
    .map((r) => {
      const s = reportToSets(r)
      return {
        id: r.__identity ?? r.persistenceObjectIdentifier ?? null,
        party: r.reportingPartyType,
        sets: s?.sets ?? [],
        home: s?.home ?? null,
        away: s?.away ?? null,
        updated_at: r.updatedAt ?? r.createdAt ?? null,
      }
    })

  let needed = neededFromLeague(league?.numberOfWinSets)
  if (needed == null) {
    const r = (game.gameResultReports ?? []).find((x) => x?.neededSetsToWin === 2 || x?.neededSetsToWin === 3)
    needed = r ? r.neededSetsToWin : null
  }

  const party = typeof partyBody === 'string' ? partyBody.trim() : null
  const ownParty = party === 'hometeam' || party === 'awayteam' ? party : null
  const official = reportToSets(game.result)

  return {
    reportable: partyMayReport(game, ownParty, official),
    needed_sets: needed,
    notification_system: league?.resultNotificationSystem?.identifier ?? null,
    official,
    reports,
    own_party: ownParty,
  }
}

async function openSession(log, force) {
  if (!force && session && Date.now() - session.at < SESSION_TTL_MS) return session
  if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) {
    log.warn('[vm-result] VM_USERNAME/VM_PASSWORD not set — skipping result read')
    return null
  }
  const vm = await import(VM_CLIENT)
  const jar = await vm.vmLogin({ username: process.env.VM_USERNAME, password: process.env.VM_PASSWORD })
  const ctx = await vm.csrfFromPage(jar, GAME_PAGE)
  session = { jar, ctx, base: vm.VM_BASE, ua: vm.UA, at: Date.now() }
  return session
}

async function getJson(s, path) {
  const res = await fetch(`${s.base}/api/sportmanager.indoorvolleyball/${path}`, {
    method: 'GET',
    headers: {
      'User-Agent': s.ua,
      Accept: '*/*',
      Cookie: s.jar.header(),
      Referer: `${s.base}${GAME_PAGE}`,
      ...(s.ctx.wuid ? { 'Window-Unique-Id': s.ctx.wuid } : {}),
    },
    signal: AbortSignal.timeout(VM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // An expired session answers 200 with the login page — res.json() throws, and the
  // caller retries on a fresh login.
  return res.json()
}

export function showUrlPath(gameUuid) {
  const q = RENDER_CONFIG.map((v, i) => `${encodeURIComponent(`propertyRenderConfiguration[${i}]`)}=${encodeURIComponent(v)}`)
  q.push(`${encodeURIComponent('game[__identity]')}=${encodeURIComponent(gameUuid)}`)
  return `api%5cgame/showWithNestedObjects?${q.join('&')}`
}

async function callVm(s, gameUuid) {
  const show = await getJson(s, showUrlPath(gameUuid))
  // Which side we are is a nicety — the caller falls back to games.type — so a
  // failure here must not throw away the reports we already have.
  let party = null
  try {
    party = await getJson(s, `api%5cgameresultreport/getReportingPartyTypeOfActiveParty?game=${encodeURIComponent(gameUuid)}`)
  } catch { /* fall back to games.type */ }
  return { show, party }
}

/** The last real answer for this game if it is under a minute old, without touching VM. */
export function cachedVmGameResult(gameUuid) {
  const hit = readCache.get(gameUuid)
  return hit && Date.now() - hit.at < READ_CACHE_TTL_MS ? hit.value : null
}

/**
 * Read VM's result state for one game.
 *
 * @param {string} gameUuid  svrz_games.svrz_persistence_id (VM game __identity)
 * @returns {Promise<null | {
 *   reportable: boolean, needed_sets: 2|3|null, notification_system: string|null,
 *   official: { sets, home, away } | null,
 *   reports: Array<{ id, party, sets, home, away, updated_at }>,
 *   own_party: 'hometeam'|'awayteam'|null,
 *   checked_at: string,
 * }>}  null when VM is busy or unusable — the caller shows its stored state.
 */
export async function readVmGameResult(gameUuid, log) {
  const hit = cachedVmGameResult(gameUuid)
  if (hit) return hit

  // The shared VM account (CLAUDE.md → "The shared VolleyManager account"): a login
  // or read while vm_sync / svrz_sync / a push holds it can run under their role.
  // Never wait — a busy account is the "VM unusable" case, and the caller already
  // shows what it stored. Released in `finally`: an in-process call, not a worker.
  const release = claimVmAccount('vm-result:read')
  if (!release) {
    log.info(`[vm-result] ${gameUuid}: shared VM account busy (${vmAccountHeldBy()}) — stored state`)
    return null
  }
  let raw
  try {
    const s = await openSession(log, false)
    if (!s) return null
    try {
      raw = await callVm(s, gameUuid)
    } catch (err) {
      // Most likely an expired session. One retry on a fresh login.
      log.warn(`[vm-result] ${gameUuid}: ${err.message} — retrying with fresh login`)
      const fresh = await openSession(log, true)
      if (!fresh) return null
      raw = await callVm(fresh, gameUuid)
    }
  } catch (err) {
    session = null
    log.warn(`[vm-result] ${gameUuid}: giving up (${err.message})`)
    return null
  } finally {
    release()
  }

  const parsed = parseGameResult(raw.show, raw.party)
  if (!parsed) {
    log.warn(`[vm-result] ${gameUuid}: unexpected response shape`)
    return null
  }
  const value = { ...parsed, checked_at: new Date().toISOString() }
  // Only cache a real answer — a VM hiccup must not pin "no data" for a minute.
  readCache.set(gameUuid, { at: Date.now(), value })
  return value
}
