/**
 * vm-push-result.mjs — file OUR team's game-result report for ONE game into
 * VolleyManager, from the provisional score a member entered in wiedisync.
 *
 * Spawned fire-and-forget by spawnResultPush (kscw-endpoints/src/game-result.js) —
 * from POST /kscw/game-result/:gameId, or from the :35 sweep for a submit that was
 * queued inside an svrz_rc window. Either way the provisional score is stored,
 * vm_result_status is 'pending', and the shared VM account and the row lease are
 * taken; the account is released when this process exits. Self-contained:
 * authenticates to Directus with the sync service account and to VM with
 * VM_USERNAME/VM_PASSWORD.
 *
 * Env:
 *   VM_USERNAME, VM_PASSWORD      — VolleyManager login
 *   DIRECTUS_URL                  — http://127.0.0.1:8055
 *   DIRECTUS_SYNC_EMAIL/PASSWORD  — sync admin (mints a bearer token)
 *   GAME_ID                       — games.id to report
 *   SETS_JSON                     — the score to file, `[{home, away}]`, as the spawner
 *                                   stored it (NOT re-read from provisional_sets_json: a
 *                                   submit landing mid-run must not change what we file)
 *   FORCE=1                       — report ours even though the opponent's report differs
 *   DRY_RUN=1                     — every read + VM's validation, never the POST/PUT
 *
 * Writes back onto the game: vm_result_status / _error / _pushed_at / _report_id /
 * _checked_at, vm_opponent_report, and clears vm_result_claimed_at (the lease).
 *
 * ─── Three things about this file that are load-bearing ─────────────────────
 *
 * 1. THERE IS NO VM STAGING. Every write here hits the real Swiss Volley
 *    production system, on both dev and prod. DRY_RUN is the only safe rehearsal.
 *
 * 2. A REPORT IS AN ATTESTATION. In a 'bothteams' league VM makes the result
 *    official the moment the second team's report equals the first, and when the
 *    two differ it creates NO result at all — SVRZ then takes the score from the
 *    paper match sheet. So a differing report is never sent unless a human asked
 *    for it (FORCE=1, behind the "Report ours anyway" confirm), and nothing here
 *    ever confirms on anyone's behalf: the endpoint only spawns us on a tap.
 *
 * 3. WE ONLY EVER TOUCH `api\gameresultreport`. Never a `game[status]`, never
 *    validateGames, never a finalize — the result itself is VM's to derive.
 *
 * And one about the SHARED VM account: svrz_rc logs in to it from another host, and
 * its windows are ours to stay out of. The endpoint queues a submit made inside one,
 * but a run can still START just before a window or be dispatched late, so we check
 * again before the login and right before the write — and hand the row back to the
 * queue ('pending' / 'queued_window') rather than write.
 */
import { pathToFileURL } from 'node:url';
import { vmLogin, csrfFromPage, registerWindow, VM_BASE, UA } from './vm-client.mjs';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://127.0.0.1:8055';
const GAME_ID = process.env.GAME_ID;
const FORCE = process.env.FORCE === '1';

// Every HTTP call gets one — a hung socket must end in 'failed', not in a row stuck at
// 'pending' with the shared VM account held until the lease runs out.
const FETCH_TIMEOUT_MS = 20_000;
// Whole-run cap. Below the endpoint's 10-minute row lease, so a new submit can never
// take the row while this run could still write to it.
export const WATCHDOG_MS = 8 * 60 * 1000;

const log = (...a) => console.log(new Date().toISOString(), '[vm-result]', ...a);

// There is no VolleyManager staging: dev and prod both authenticate against the REAL
// Swiss Volley system with the same club credentials. So a dev "Report result" would
// file a real report for a real game — and in a 'bothteams' league possibly make a
// real result official.
//
// Refuse to write from the dev database. `DB_DATABASE` is 'directus_kscw_dev' on dev
// and 'postgres' on prod, and the endpoint forwards it to us. Set
// VM_RESULT_ALLOW_DEV_WRITE=1 to deliberately override for a supervised test.
const IS_DEV_DB = /dev/i.test(process.env.DB_DATABASE || '');
const DEV_WRITE_ALLOWED = !!process.env.VM_RESULT_ALLOW_DEV_WRITE;
const FORCED_DRY = IS_DEV_DB && !DEV_WRITE_ALLOWED;
const DRY_RUN = !!process.env.DRY_RUN || FORCED_DRY;

/** Exposed so the guard above is actually testable rather than merely asserted in a comment. */
export const isDryRun = () => DRY_RUN;
const idOf = (x) => (x && typeof x === 'object' ? (x.__identity || x.persistenceObjectIdentifier || '') : '');

// Run only when invoked as a script. The builders below are imported by the unit
// tests, and a bare `main()` here would fire (and exit) on import.
const IS_ENTRYPOINT = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// ─── Pure helpers (unit-tested) ──────────────────────────────────────

/**
 * svrz_rc's VM windows — an INLINE COPY of kscw-endpoints/src/vm-windows.js
 * (isSvrzRcBlackout): this file runs from the scripts bind-mount and cannot import the
 * extension tree. Change both. 22:00–00:59 UTC (svrz_rc's games sync) and :05–:30 at
 * 10/11/14/15 UTC (its refresh, summer + winter).
 */
export function isSvrzRcBlackout(date = new Date()) {
  const h = date.getUTCHours();
  const m = date.getUTCMinutes();
  if (h === 22 || h === 23 || h === 0) return true;
  return [10, 11, 14, 15].includes(h) && m >= 5 && m <= 30;
}
//
// Deliberately NOT imported from kscw-endpoints/src/vm-game-result.js: this file runs
// from the `directus/scripts/` bind-mount as a detached child, and the extension tree
// is a separate deploy. Keep the two converters in step by hand.

const ball = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A VM report (or `game.result`) → `[{ home, away }]`. VM carries the balls as
 * `homeTeamSet{1..5}Balls` / `awayTeamSet{1..5}Balls`, null for an unplayed set.
 * Stops at the first unplayed set — a hole mid-match is not a score.
 */
export function reportToSets(obj) {
  const sets = [];
  if (!obj || typeof obj !== 'object') return sets;
  for (let i = 1; i <= 5; i++) {
    const home = ball(obj[`homeTeamSet${i}Balls`]);
    const away = ball(obj[`awayTeamSet${i}Balls`]);
    if (home === null || away === null) break;
    sets.push({ home, away });
  }
  return sets;
}

/** Normalise our own `[{home, away}]` (provisional_sets_json may arrive as a JSON string). */
export function normaliseSets(sets) {
  let arr = sets;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => ({ home: ball(s?.home), away: ball(s?.away) }))
    .filter((s) => s.home !== null && s.away !== null);
}

/** Sets won per side. */
export function setsWon(sets) {
  let home = 0; let away = 0;
  for (const s of normaliseSets(sets)) {
    if (s.home > s.away) home += 1;
    else if (s.away > s.home) away += 1;
  }
  return { home, away };
}

/** Same sets, same balls, same order. Two empty scores are not "equal" — there is nothing to agree on. */
export function setsEqual(a, b) {
  const x = normaliseSets(a);
  const y = normaliseSets(b);
  if (!x.length || x.length !== y.length) return false;
  return x.every((s, i) => s.home === y[i].home && s.away === y[i].away);
}

const TEAM_PARTIES = new Set(['hometeam', 'awayteam']);

/** VM's getReportingPartyTypeOfActiveParty answer → 'hometeam' | 'awayteam' | null. */
export const partyOf = (v) => (typeof v === 'string' && TEAM_PARTIES.has(v.trim()) ? v.trim() : null);

/**
 * Is reporting closed for OUR party? From the game's own per-party flags, which the
 * default showWithNestedObjects response carries — `_permissions` alone cannot say it:
 * it is create:true on every property of the recorded response. Mirrors
 * partyMayReport in kscw-endpoints/src/vm-game-result.js; keep the two in step.
 *   - our `<home|away>TeamGameResultReportDeadlineExceeded`;
 *   - `isGameResultReported` while no official result was parsed — the reporting round
 *     is over and the result is someone else's call now.
 */
export function reportingClosed(game, ownParty, official) {
  if (ownParty === 'hometeam' && game?.homeTeamGameResultReportDeadlineExceeded === true) return true;
  if (ownParty === 'awayteam' && game?.awayTeamGameResultReportDeadlineExceeded === true) return true;
  return game?.isGameResultReported === true && !official;
}

/**
 * What to do with our score, given what VM holds. Pure, and the one place that decides.
 *
 * @returns {{ skip: string } | { conflict: true } | { noop: 'reported'|'confirmed' } | { write: 'create'|'update' }}
 *   each also carrying `own` / `opponent` (the matching reports, or null) for the caller.
 */
export function decideAction({ official, reports = [], ownParty, notificationSystem, reportable, closed = false, ours, force = false }) {
  const own = ownParty ? (reports.find((r) => r.party === ownParty) ?? null) : null;
  const opponent = reports.find((r) => TEAM_PARTIES.has(r.party) && r.party !== ownParty) ?? null;
  const out = (x) => ({ ...x, own, opponent });

  // VM already derived a result — nothing left for a team to report.
  if (official) return out({ skip: 'not_reportable' });
  // 'hometeam' leagues: only the home team reports. The away side has no say.
  if (notificationSystem === 'hometeam' && ownParty === 'awayteam') return out({ skip: 'home_team_reports' });
  // Not a reporting party at all (VM names none), or VM refuses a new report and we
  // have none to update.
  if (!TEAM_PARTIES.has(ownParty)) return out({ skip: 'not_reportable' });
  // Our deadline passed / the round is closed (reportingClosed): nothing may be filed.
  // A report of ours that already says the same is still worth showing as such.
  if (closed) {
    if (!own || !setsEqual(own.sets, ours)) return out({ skip: 'not_reportable' });
    return out({ noop: opponent && setsEqual(opponent.sets, ours) ? 'confirmed' : 'reported' });
  }
  if (!reportable && !own) return out({ skip: 'not_reportable' });

  const agreesWithOpponent = !!opponent && setsEqual(opponent.sets, ours);
  // Never silently file a score that contradicts the opponent's: VM would then create
  // no result and SVRZ goes to the paper sheet. Only a human's explicit FORCE does it.
  if (opponent && !agreesWithOpponent && !force) return out({ conflict: true });
  if (own && setsEqual(own.sets, ours)) return out({ noop: agreesWithOpponent ? 'confirmed' : 'reported' });
  return out({ write: own ? 'update' : 'create' });
}

// The ten set-ball fields, in the exact order VM's own form sends them: home then
// away per set, sets 1..5, then the (unused) golden set. Unplayed = ''.
function setBallPairs(sets) {
  const s = normaliseSets(sets);
  const pairs = [];
  for (let i = 1; i <= 5; i++) {
    const set = s[i - 1];
    pairs.push([`gameResultReport[homeTeamSet${i}Balls]`, set ? String(set.home) : '']);
    pairs.push([`gameResultReport[awayTeamSet${i}Balls]`, set ? String(set.away) : '']);
  }
  pairs.push(['gameResultReport[homeTeamGoldenSetBalls]', '']);
  pairs.push(['gameResultReport[awayTeamGoldenSetBalls]', '']);
  return pairs;
}

/**
 * The POST (create) / PUT (update) body, byte-for-byte in the order the VM UI sends it
 * (HAR 2026-09-28). An update prepends our report's `__identity` and carries its
 * `updatedAt`; a create leaves both empty. The csrf token is always last.
 */
export function buildReportPairs({ gameUuid, validationId, sets, csrf, own = null }) {
  return [
    ...(own ? [['gameResultReport[__identity]', own.id]] : []),
    ['gameResultReport[updatedAt]', own?.updated_at ?? ''],
    ['gameResultReport[game][__identity]', gameUuid],
    ['gameResultReport[gameResultReportValidation][__identity]', validationId],
    ['gameResultReport[reportingPartyType]', ''],
    ...setBallPairs(sets),
    ['__csrfToken', csrf ?? ''],
  ];
}

/** Query pairs for `validateGameResultReport` — VM's server-side check before the write. */
export function buildValidatePairs({ gameUuid, sets, own = null }) {
  return [
    ['gameResultReport[__identity]', own?.id ?? ''],
    ['gameResultReport[updatedAt]', ''],
    ['gameResultReport[game][__identity]', gameUuid],
    ['gameResultReport[gameResultReportValidation]', ''],
    ['gameResultReport[reportingPartyType]', ''],
    ...setBallPairs(sets),
  ];
}

/** Query pairs for `showWithNestedObjects` — the reports, the league's rules and any result. */
export function buildShowPairs(gameUuid) {
  return [
    ['propertyRenderConfiguration[0]', 'gameResultReports.*.gameResultReportValidation'],
    ['propertyRenderConfiguration[1]', 'gameResultReports.*.updatedAt'],
    ['propertyRenderConfiguration[2]', 'encounter.*'],
    ['propertyRenderConfiguration[3]', 'group.phase.league.resultNotificationSystem.identifier'],
    ['propertyRenderConfiguration[4]', 'result'],
    ['propertyRenderConfiguration[5]', 'group.phase.league.numberOfWinSets'],
    ['game[__identity]', gameUuid],
  ];
}

export const encodePairs = (pairs) =>
  pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&');

/** VM's official result for the game, or null. Shape is `game.result` — the same set-ball fields as a report. */
export function officialFromGame(game) {
  const r = game?.result;
  if (!r || typeof r !== 'object') return null;
  const sets = reportToSets(r);
  const won = setsWon(sets);
  const home = ball(r.wonSetsHomeTeam) ?? (sets.length ? won.home : null);
  const away = ball(r.wonSetsAwayTeam) ?? (sets.length ? won.away : null);
  if (home === null || away === null) return null;
  return { sets, home, away };
}

/** The reports VM shows us, flattened to what we compare. */
export function parseReports(game) {
  const raw = Array.isArray(game?.gameResultReports) ? game.gameResultReports : [];
  return raw
    .filter((r) => r && !r.deletedAt)
    .map((r) => {
      const sets = reportToSets(r);
      const won = setsWon(sets);
      return {
        id: idOf(r),
        party: r.reportingPartyType || null,
        sets,
        home: ball(r.wonSetsHomeTeam) ?? won.home,
        away: ball(r.wonSetsAwayTeam) ?? won.away,
        updated_at: r.updatedAt ?? null,
      };
    });
}

/** `vm_opponent_report` column shape. */
const opponentJson = (r) => (r
  ? { sets: r.sets, home: r.home, away: r.away, reported_at: r.updated_at, party: r.party }
  : null);

/** The provisional_* columns for a score of a given source. */
const provisionalPatch = (sets, source) => {
  const won = setsWon(sets);
  return {
    provisional_sets_json: normaliseSets(sets),
    provisional_home_score: won.home,
    provisional_away_score: won.away,
    provisional_source: source,
    provisional_at: new Date().toISOString(),
  };
};

// ─── Directus REST ───────────────────────────────────────────────────
let DTOKEN = '';
async function dlogin() {
  if (process.env.DIRECTUS_TOKEN) { DTOKEN = process.env.DIRECTUS_TOKEN; return; }
  const r = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({ email: process.env.DIRECTUS_SYNC_EMAIL, password: process.env.DIRECTUS_SYNC_PASSWORD }),
  });
  if (!r.ok) throw new Error(`Directus login failed: HTTP ${r.status}`);
  DTOKEN = (await r.json())?.data?.access_token;
  if (!DTOKEN) throw new Error('Directus login: no token');
}
async function dGet(path) {
  const r = await fetch(`${DIRECTUS_URL}${path}`, {
    headers: { Authorization: `Bearer ${DTOKEN}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`GET ${path} → HTTP ${r.status}`);
  return (await r.json())?.data;
}
async function dPatchGame(patch) {
  if (!DTOKEN) return;   // failed before login — nothing we can write
  const r = await fetch(`${DIRECTUS_URL}/items/games/${GAME_ID}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${DTOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) log(`WARN: write-back PATCH failed HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/**
 * The run's one exit: write the journal, then end the process ('failed' → exit 1).
 *
 * Unlike the nomination worker, the journal IS written in DRY_RUN: the member who
 * pressed the button is watching the status line, and a dev rehearsal that left it
 * on 'pending' for ever would read as a lost worker. It only ever touches our own DB.
 *
 * Only a row that is STILL 'pending' is written. By the time we finish, the sweep's
 * stale-lease reclaim or the endpoint's exit handler may have resolved it, or a new
 * submit may be queued on it; our late word must not overwrite theirs. Directus's
 * PATCH /items/games/:id takes no filter, so it is a read, then the write — the
 * window in between is covered by the lease (WATCHDOG_MS < the 10-minute lease). If
 * the read itself fails we still try the write: Directus is then most likely down,
 * and a stranded 'pending' is the worse outcome.
 *
 * Idempotent: the watchdog can fire while main() is finishing; the first call wins.
 * Factored out with its I/O injected so the rules above are testable.
 */
export function makeFinish({ readStatus, patch, exit, say = () => {} }) {
  let finishing = false;
  return async (status, { error = null, reportId, opponent, checked = false, pushed = false, claimed = null, extra = {} } = {}) => {
    if (finishing) return;
    finishing = true;
    let current;
    try { current = await readStatus(); } catch (e) { say(`WARN: journal re-read failed (${e.message}) — writing anyway`); }
    if (current !== undefined && current !== 'pending') {
      say(`row is '${current}' by now, not 'pending' — leaving its journal alone`);
    } else {
      await patch({
        vm_result_status: status,
        vm_result_error: error ? String(error).slice(0, 900) : null,
        vm_result_claimed_at: claimed,
        ...(pushed ? { vm_result_pushed_at: new Date().toISOString() } : {}),
        ...(reportId !== undefined ? { vm_result_report_id: reportId } : {}),
        ...(opponent !== undefined ? { vm_opponent_report: opponent } : {}),
        ...(checked ? { vm_result_checked_at: new Date().toISOString() } : {}),
        ...extra,
      });
    }
    say(`→ ${status}${error ? `: ${error}` : ''}`);
    exit(status === 'failed' ? 1 : 0);
  };
}

const finish = makeFinish({
  // Before login there is nothing we can read or write.
  readStatus: async () => (DTOKEN ? (await dGet(`/items/games/${GAME_ID}?fields=vm_result_status`))?.vm_result_status ?? null : undefined),
  patch: dPatchGame,
  exit: (code) => process.exit(code),
  say: log,
});

// ─── VM calls ────────────────────────────────────────────────────────
let jar = null;
let ctx = { csrf: '', wuid: '' };

const vmHeaders = (withBody) => ({
  ...(withBody ? { 'Content-Type': 'text/plain;charset=UTF-8', Origin: VM_BASE } : {}),
  Accept: '*/*',
  Cookie: jar.header(),
  Referer: `${VM_BASE}/sportmanager.indoorvolleyball/game/index`,
  'User-Agent': UA,
  ...(ctx.wuid ? { 'Window-Unique-Id': ctx.wuid } : {}),
});

/** GETs carry no csrf — the VM UI sends only the Window-Unique-Id. */
async function vmGet(resource, pairs) {
  const qs = pairs?.length ? `?${encodePairs(pairs)}` : '';
  const r = await fetch(`${VM_BASE}/api/sportmanager.indoorvolleyball/${resource}${qs}`, {
    method: 'GET', headers: vmHeaders(false), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${resource} HTTP ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return null; }
}

/** POST/PUT with a fully built pair list (buildReportPairs already appends the csrf). */
async function vmWrite(method, resource, pairs) {
  const r = await fetch(`${VM_BASE}/api/sportmanager.indoorvolleyball/${resource}`, {
    method, headers: vmHeaders(true), body: encodePairs(pairs), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${resource} HTTP ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return null; }
}

async function readVmGame(gameUuid) {
  const shown = await vmGet('api%5cgame/showWithNestedObjects', buildShowPairs(gameUuid));
  const game = shown?.game ?? shown;
  if (!game || typeof game !== 'object') throw new Error('showWithNestedObjects returned no game');
  const league = game.group?.phase?.league ?? {};
  return {
    game,
    reports: parseReports(game),
    official: officialFromGame(game),
    // The permission bit only — the per-party flags need our party (reportingClosed).
    reportable: !!game._permissions?.properties?.gameResultReports?.create,
    notificationSystem: league.resultNotificationSystem?.identifier ?? null,
  };
}

// ─── main ────────────────────────────────────────────────────────────
async function main() {
  if (FORCED_DRY) {
    log('DEV DATABASE — forcing DRY_RUN. VolleyManager has no staging, so a real write from '
      + 'dev would file a real result report. Set VM_RESULT_ALLOW_DEV_WRITE=1 to override.');
  }
  await dlogin();

  const game = await dGet(`/items/games/${GAME_ID}?fields=id,game_id,type,status,kscw_team`);
  if (!game) return finish('failed', { error: 'game not found' });

  const ours = normaliseSets(process.env.SETS_JSON);
  if (!ours.length) return finish('failed', { error: 'no result to report (SETS_JSON)' });

  const gid = String(game.game_id ?? '');
  const number = Number(gid.slice(3));
  if (!gid.startsWith('vb_') || !Number.isInteger(number)) return finish('skipped', { error: 'no_vm_game' });

  // Intra-club derby: two games rows share one game_id, and BOTH reports would be
  // ours. We cannot be both parties' independent witness — skip, SVRZ has the sheet.
  const siblings = await dGet(`/items/games?filter[game_id][_eq]=${encodeURIComponent(gid)}&fields=id&limit=2`) ?? [];
  if (siblings.length > 1) return finish('skipped', { error: 'derby' });

  // Resolve the VM fixture BY GAME NUMBER, like the nomination worker.
  const [svrz] = await dGet(`/items/svrz_games?filter[svrz_number][_eq]=${number}&fields=svrz_persistence_id&limit=1`) ?? [];
  const gameUuid = svrz?.svrz_persistence_id;
  if (!gameUuid) return finish('skipped', { error: 'no_vm_game' });

  // Not while svrz_rc may be on the account — back to the queue for the :35 sweep.
  if (isSvrzRcBlackout()) return finish('pending', { error: 'queued_window' });

  // ── VM session
  jar = await vmLogin({ username: process.env.VM_USERNAME, password: process.env.VM_PASSWORD });
  ctx = await csrfFromPage(jar, '/sportmanager.indoorvolleyball/game/index');

  // Idempotency: always ask VM what it holds; never trust our own journal.
  const vm = await readVmGame(gameUuid);
  const ownParty = partyOf(await vmGet('api%5cgameresultreport/getReportingPartyTypeOfActiveParty', [['game', gameUuid]]));
  const closed = reportingClosed(vm.game, ownParty, vm.official);
  const decision = decideAction({
    official: vm.official, reports: vm.reports, ownParty,
    notificationSystem: vm.notificationSystem, reportable: vm.reportable, closed, ours, force: FORCE,
  });
  const opponent = opponentJson(decision.opponent);
  log(`game ${GAME_ID} (#${number}) party=${ownParty} system=${vm.notificationSystem} reportable=${vm.reportable} closed=${closed}`
    + ` reports=${vm.reports.map((r) => r.party).join(',') || 'none'} → ${JSON.stringify({ ...decision, own: undefined, opponent: undefined })}`);

  if (decision.skip) {
    // VM already has the official result the SV feed has not delivered yet — show it.
    const extra = vm.official ? provisionalPatch(vm.official.sets, 'vm_official') : {};
    return finish('skipped', { error: decision.skip, opponent, checked: true, extra });
  }
  if (decision.conflict) {
    return finish('conflict', { error: 'opponent_differs', opponent, checked: true });
  }
  if (decision.noop) {
    return finish(decision.noop, { opponent, checked: true, reportId: decision.own?.id ?? null,
      extra: decision.noop === 'confirmed' ? { provisional_source: 'confirmed' } : {} });
  }

  // ── The write. registerWindow opens a live socket.io WebSocket; VM denies writes
  // from an unregistered window (403) and the socket must stay UP for the duration —
  // only across validate + write, closed in the finally.
  const own = decision.write === 'update' ? decision.own : null;
  let rw = null;
  try {
    try { rw = await registerWindow(jar, ctx.wuid); }
    catch (e) { log(`WARN: registerWindow failed (${e.message}) — the write will likely 403`); }

    const validated = await vmGet('api%5cgameresultreport/validateGameResultReport',
      buildValidatePairs({ gameUuid, sets: ours, own }));
    const validation = validated?.gameResultReportValidation;
    if (!validation) throw new Error('validateGameResultReport returned no validation');
    if (validation.hasValidationIssues) {
      const issues = (validation.allValidationIssues ?? [])
        .map((i) => i?.validationIssueConfiguration?.identifier || i?.identifier || i?.message || JSON.stringify(i));
      return finish('failed', { error: `VM validation: ${issues.join(', ') || 'hasValidationIssues'}`, opponent, checked: true });
    }
    const validationId = idOf(validation);
    if (!validationId) throw new Error('validation carried no __identity');

    // The party decideAction reasoned about must still be the active one: the account
    // is shared, and a role switched under us (svrz_rc, another job) would file THEIR
    // side's report with our score.
    const partyNow = partyOf(await vmGet('api%5cgameresultreport/getReportingPartyTypeOfActiveParty', [['game', gameUuid]]));
    if (partyNow !== ownParty) {
      return finish('failed', { error: `party_changed (${ownParty} → ${partyNow})`, opponent, checked: true });
    }
    // Last chance to stay out of svrz_rc's window: nothing is written yet.
    if (isSvrzRcBlackout()) return finish('pending', { error: 'queued_window' });

    const pairs = buildReportPairs({ gameUuid, validationId, sets: ours, csrf: ctx.csrf, own });
    if (DRY_RUN) {
      log(`DRY_RUN: would ${decision.write === 'update' ? 'PUT' : 'POST'} api\\gameresultreport:`,
        encodePairs(pairs.filter(([k]) => k !== '__csrfToken')));
      return finish('skipped', { error: 'dry_run', opponent, checked: true });
    }

    const saved = await vmWrite(decision.write === 'update' ? 'PUT' : 'POST', 'api%5cgameresultreport', pairs);
    const reportId = idOf(saved?.gameResultReport ?? saved) || own?.id || null;
    log(`${decision.write}d report ${reportId}`);

    // Re-read: in a 'bothteams' league an equal second report makes VM derive the
    // result right now, and that is what "confirmed" means.
    const after = await readVmGame(gameUuid);
    const opp = after.reports.find((r) => TEAM_PARTIES.has(r.party) && r.party !== ownParty) ?? decision.opponent;
    const agreed = !!opp && setsEqual(opp.sets, ours);
    const status = after.official || agreed ? 'confirmed' : 'reported';
    const extra = after.official
      ? provisionalPatch(after.official.sets, 'vm_official')
      : (agreed ? { provisional_source: 'confirmed' } : {});
    return finish(status, { reportId, opponent: opponentJson(opp), checked: true, pushed: true, extra });
  } finally {
    try { rw?.ws?.close(); } catch { /* best effort */ }
  }
}

if (IS_ENTRYPOINT) {
  if (!GAME_ID) { console.error('[vm-result] GAME_ID required'); process.exit(1); }
  // Every fetch has its own timeout, but vm-client's login / registerWindow are not
  // ours to change. The watchdog bounds the whole run; unref'd so it never keeps a
  // finished run alive.
  setTimeout(() => {
    log(`ERROR: watchdog — still running after ${WATCHDOG_MS / 60000} min`);
    finish('failed', { error: 'timeout' }).catch(() => process.exit(1));
  }, WATCHDOG_MS).unref();
  main().catch(async (e) => {
    log(`ERROR: ${e.message}`);
    await finish('failed', { error: e.message });
  });
}
