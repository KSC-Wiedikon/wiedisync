/**
 * vm-push-nomination.mjs — file ONE game's Einsatzliste (nomination list) into
 * VolleyManager from our confirmed RSVPs.
 *
 * Spawned fire-and-forget by the T-60 cron (kscw-hooks) and by the manual
 * "push now" endpoint. Self-contained: authenticates to Directus with the sync
 * service account and to VM with VM_USERNAME/VM_PASSWORD.
 *
 * Env:
 *   VM_USERNAME, VM_PASSWORD      — VolleyManager login
 *   DIRECTUS_URL                  — http://127.0.0.1:8055
 *   DIRECTUS_SYNC_EMAIL/PASSWORD  — sync admin (mints a bearer token)
 *   GAME_ID                       — games.id to file
 *   DRY_RUN=1                     — build + log the payload, write NOTHING
 *   NO_CLOSE=1                    — fill but never close, even if validation is clean
 *
 * Writes back onto the game: vm_nomination_status / _list_id / _count /
 * _pushed_at / _error.
 *
 * ─── Two things about this file that are load-bearing ───────────────────────
 *
 * 1. THERE IS NO VM STAGING. Every write here hits the real Swiss Volley
 *    production system, on both dev and prod. DRY_RUN is the only safe rehearsal.
 *
 * 2. SAVE AND CLOSE ARE THE SAME `PUT api\nominationlist`, distinguished only by
 *    `isClosedForTeam`. Closing files an official document, and VM's own validation
 *    marks a too-short or coachless list as `isFineable: true` — so an unconditional
 *    auto-close would quietly earn the club fines on thin-RSVP weeks. We therefore
 *    fill first, re-read VM's server-side validation, and close ONLY if no unresolved
 *    fineable issue remains. `assertNotClosing()` guards the fill payload so a close
 *    can never happen by accident — it is one boolean away at all times.
 */
import { pathToFileURL } from 'node:url';
import { vmLogin, csrfFromPage, registerWindow, VM_BASE, UA } from './vm-client.mjs';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://127.0.0.1:8055';
const KSCW_SVRZ_CLUB_ID = process.env.KSCW_SVRZ_CLUB_ID || '912530';
const GAME_ID = process.env.GAME_ID;
const NO_CLOSE = !!process.env.NO_CLOSE;

const log = (...a) => console.log(new Date().toISOString(), '[vm-nom]', ...a);

// There is no VolleyManager staging: dev and prod both authenticate against the REAL
// Swiss Volley system with the same club credentials. So a dev cron left armed would
// file real Einsatzlisten for real games — indistinguishable from prod doing it.
//
// Refuse to write from the dev database. `DB_DATABASE` is 'directus_kscw_dev' on dev
// and 'postgres' on prod, and the hook forwards it to us. Set
// VM_NOMINATION_ALLOW_DEV_WRITE=1 to deliberately override for a supervised test.
const IS_DEV_DB = /dev/i.test(process.env.DB_DATABASE || '');
const DEV_WRITE_ALLOWED = !!process.env.VM_NOMINATION_ALLOW_DEV_WRITE;
const FORCED_DRY = IS_DEV_DB && !DEV_WRITE_ALLOWED;
const DRY_RUN = !!process.env.DRY_RUN || FORCED_DRY;

/** Exposed so the guard above is actually testable rather than merely asserted in a comment. */
export const isDryRun = () => DRY_RUN;
const idOf = (x) => (x && typeof x === 'object' ? (x.__identity || x.persistenceObjectIdentifier || '') : '');

// Run only when invoked as a script. The payload builders below are imported by the
// unit tests, and a bare `main()` here would fire (and exit) on import.
const IS_ENTRYPOINT = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// ─── Directus REST ───────────────────────────────────────────────────
let DTOKEN = '';
async function dlogin() {
  if (process.env.DIRECTUS_TOKEN) { DTOKEN = process.env.DIRECTUS_TOKEN; return; }
  const r = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.DIRECTUS_SYNC_EMAIL, password: process.env.DIRECTUS_SYNC_PASSWORD }),
  });
  if (!r.ok) throw new Error(`Directus login failed: HTTP ${r.status}`);
  DTOKEN = (await r.json())?.data?.access_token;
  if (!DTOKEN) throw new Error('Directus login: no token');
}
async function dGet(path) {
  const r = await fetch(`${DIRECTUS_URL}${path}`, { headers: { Authorization: `Bearer ${DTOKEN}` } });
  if (!r.ok) throw new Error(`GET ${path} → HTTP ${r.status}`);
  return (await r.json())?.data;
}
async function dPatchGame(patch) {
  const r = await fetch(`${DIRECTUS_URL}/items/games/${GAME_ID}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${DTOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) log(`WARN: write-back PATCH failed HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
const finish = async (status, { listId = null, count = null, error = null } = {}) => {
  if (!DRY_RUN) {
    await dPatchGame({
      vm_nomination_status: status,
      vm_nomination_list_id: listId,
      vm_nomination_count: count,
      vm_nomination_pushed_at: status === 'failed' ? undefined : new Date().toISOString(),
      vm_nomination_error: error ? String(error).slice(0, 900) : null,
    });
  }
  log(`→ ${status}${count != null ? ` (${count} players)` : ''}${error ? `: ${error}` : ''}`);
  process.exit(status === 'failed' ? 1 : 0);
};

// ─── VM calls ────────────────────────────────────────────────────────
let jar = null;
let ctx = { csrf: '', wuid: '' };

const vmHeaders = () => ({
  'Content-Type': 'text/plain;charset=UTF-8',
  Accept: '*/*',
  Cookie: jar.header(),
  Origin: VM_BASE,
  Referer: `${VM_BASE}/sportmanager.indoorvolleyball/game/index`,
  'User-Agent': UA,
  ...(ctx.wuid ? { 'Window-Unique-Id': ctx.wuid } : {}),
});

async function vmCall(method, resource, pairs) {
  const body = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&')
    + `&__csrfToken=${encodeURIComponent(ctx.csrf)}`;
  const r = await fetch(`${VM_BASE}/api/sportmanager.indoorvolleyball/${resource}`, {
    method, headers: vmHeaders(), body,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${resource} HTTP ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Flatten an object into Flow's bracket-notation form pairs, the way the browser
 * round-trips the whole aggregate back on every save. Relations collapse to their
 * `[__identity]`; nulls become empty strings (Flow reads '' as "unset").
 */
export function toPairs(obj, prefix) {
  const out = [];
  const walk = (val, path) => {
    if (val === null || val === undefined) { out.push([path, '']); return; }
    if (Array.isArray(val)) { val.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (typeof val === 'object') {
      // A related entity is passed by identity, never by value.
      const id = idOf(val);
      if (id) { out.push([`${path}[__identity]`, id]); return; }
      for (const [k, v] of Object.entries(val)) walk(v, `${path}[${k}]`);
      return;
    }
    out.push([path, String(val)]);
  };
  walk(obj, prefix);
  return out;
}

/**
 * The close footgun, made loud. A fill payload must NEVER carry a close flag —
 * `isClosedForTeam` is the only thing separating "save the roster" from "file this
 * officially and lock it". Called on every fill payload before it goes over the wire.
 */
export function assertNotClosing(pairs) {
  const bad = pairs.filter(([k, v]) => {
    if (/\[(isClosedForTeam|closed)\]$/.test(k)) return String(v) !== 'false';
    if (/\[(closedAt|closedBy)\]$/.test(k)) return String(v) !== '';
    if (/\[checked(At|By)?\]$/.test(k)) return String(v) !== '' && String(v) !== 'false';
    return false;
  });
  if (bad.length) {
    throw new Error(`refusing to send a fill payload that would CLOSE the list: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  return pairs;
}

/**
 * Would closing this list earn us a fine? VM recomputes `nominationListValidation`
 * server-side on every save; we only ever close on a clean read-back.
 *
 * Observed live: `nominationList_hasTooFewNominations` (#37) and
 * `nominationList_isMissingCoachPerson` (#33) are both `isFineable: true`.
 */
export function fineableBlockers(validation) {
  const issues = validation?.nominationListValidationIssues ?? [];
  return issues
    .filter((i) => {
      const cfg = i.validationIssueConfiguration ?? {};
      const fineable = i.isFineable ?? cfg.isFineable ?? false;
      return fineable && !i.isResolved;
    })
    .map((i) => i.validationIssueConfiguration?.identifier || `issue#${i.number}`);
}

// ─── main ────────────────────────────────────────────────────────────
async function main() {
  if (FORCED_DRY) {
    log('DEV DATABASE — forcing DRY_RUN. VolleyManager has no staging, so a real write from '
      + 'dev would file a real Einsatzliste. Set VM_NOMINATION_ALLOW_DEV_WRITE=1 to override.');
  }
  await dlogin();

  const game = await dGet(`/items/games/${GAME_ID}?fields=id,game_id,type,status,kscw_team,season,date,time`);
  if (!game) return finish('failed', { error: 'game not found' });

  const gid = String(game.game_id ?? '');
  if (!gid.startsWith('vb_')) return finish('skipped', { error: null });   // basketball has no VM

  // Resolve the VM fixture BY GAME NUMBER — games.game_id is `vb_<SwissVolley gameId>`
  // and svrz_games.svrz_number is that same number. 172/172 home + 180/180 away join.
  const number = Number(gid.slice(3));
  const [svrz] = await dGet(`/items/svrz_games?filter[svrz_number][_eq]=${number}&fields=svrz_persistence_id,home_club_id,away_club_id&limit=1`) ?? [];
  if (!svrz?.svrz_persistence_id) return finish('failed', { error: `no VM fixture for game number ${number}` });

  // Which side are we? VM scopes the getter to the "active party", so a home game
  // exposes nominationListTeamHome and an away game nominationListTeamAway — the
  // opponent's half is never readable, and never writable.
  const isHome = String(svrz.home_club_id) === KSCW_SVRZ_CLUB_ID;
  const isAway = String(svrz.away_club_id) === KSCW_SVRZ_CLUB_ID;
  if (!isHome && !isAway) return finish('failed', { error: `game ${number} is not a KSCW fixture` });
  const side = isHome ? 'Home' : 'Away';

  // ── Who is playing: confirmed RSVPs ∩ this season's roster, guests excluded.
  // The intersect is what keeps stale/cross-team participation rows off the list;
  // guest_level = 0 is what keeps the known guest count-drift out of it.
  const parts = await dGet(
    `/items/participations?filter[activity_type][_eq]=game&filter[activity_id][_eq]=${GAME_ID}`
    + `&filter[status][_eq]=confirmed&fields=member&limit=-1`,
  ) ?? [];
  const confirmed = new Set(parts.map((p) => Number(typeof p.member === 'object' ? p.member?.id : p.member)));

  // ⚠ NO season filter. `game.season` is stamped by sv-sync's deliberate SEP-1
  // rule (their calendar), while member_teams.season follows the club's JUN-1
  // cutover — so every fixture played 1 Jun – 31 Aug (summer cup, qualification,
  // early friendlies) matched an empty roster, `playing` came back [], and the
  // script exited "no licensed confirmed players (0 confirmed, 0 unlicensed)",
  // blaming the RSVPs for a season-label mismatch. game.kscw_team already pins
  // the season: the rollover mints a new team id each year.
  const roster = await dGet(
    `/items/member_teams?filter[team][_eq]=${game.kscw_team}`
    + `&filter[guest_level][_eq]=0&fields=member.id,member.license_nr,member.first_name,member.last_name&limit=-1`,
  ) ?? [];

  const playing = roster
    .map((r) => r.member)
    .filter((m) => m && confirmed.has(Number(m.id)));

  const licensed = playing.filter((m) => m.license_nr);
  const unlicensed = playing.filter((m) => !m.license_nr);
  if (unlicensed.length) {
    // Never silently drop a player who said yes — they simply cannot be nominated.
    log(`WARN: ${unlicensed.length} confirmed player(s) have no licence_nr and cannot be nominated: `
      + unlicensed.map((m) => `${m.first_name} ${m.last_name}`).join(', '));
  }
  if (!licensed.length) {
    return finish('skipped', { error: `no licensed confirmed players (${playing.length} confirmed, ${unlicensed.length} unlicensed)` });
  }
  const wantLicences = new Set(licensed.map((m) => String(m.license_nr)));
  log(`game ${GAME_ID} (${side.toLowerCase()} #${number}): ${licensed.length} licensed / ${playing.length} confirmed`);

  // ── VM session
  jar = await vmLogin({ username: process.env.VM_USERNAME, password: process.env.VM_PASSWORD });
  ctx = await csrfFromPage(jar, '/sportmanager.indoorvolleyball/game/index');

  // Idempotency: the getter tells us whether a list already exists (→ update it)
  // or not (→ create one). Always ask; never assume from our own journal.
  const got = await vmCall('POST', 'api%5cgame/getNominationListOrTeamForActivePartyByGame',
    [['game', svrz.svrz_persistence_id]]);
  const items = got?.items ?? got ?? {};
  let list = items[`nominationListTeam${side}`] ?? null;

  if (list?.closed || list?.isClosedForTeam) {
    return finish('closed', { listId: idOf(list), count: (list.indoorPlayerNominations ?? []).length,
      error: null });   // already filed by a human — never reopen someone's filing
  }

  const teamForNew = items[`team${side}ForNewNominationList`];
  if (!list && !teamForNew) return finish('failed', { error: `VM offered neither an existing list nor a team to create one for (side=${side})` });

  // ── Candidates. We never fabricate a nomination: we take VM's own possible
  // nominations and keep the ones whose person.associationId is a licence we want.
  // (associationId IS members.license_nr — verified 8/8 against three real lists.)
  const listId = list ? idOf(list) : null;
  let candidates = [];
  if (listId) {
    candidates = await vmCall('POST', 'api%5cnominationlist/getPossibleIndoorPlayerNominationsForNominationList',
      [['nominationList', listId], ['onlyFromMyTeam', 'true'], ['onlyRelevantGender', 'true']]) ?? [];
  }

  log(`existing list: ${listId || 'none'}; VM candidates: ${candidates.length}`);

  if (DRY_RUN) {
    const matched = candidates.filter((c) => wantLicences.has(String(c.indoorPlayer?.person?.associationId)));
    log(`DRY_RUN: side=${side} vmGame=${svrz.svrz_persistence_id} list=${listId || '(would create)'}`);
    log(`DRY_RUN: want ${[...wantLicences].join(',')}`);
    log(`DRY_RUN: would nominate ${matched.length}/${wantLicences.size}: `
      + matched.map((c) => `${c.indoorPlayer?.person?.lastName}(${c.indoorPlayer?.person?.associationId})`).join(', '));
    if (!listId) log('DRY_RUN: no list exists yet — candidates can only be fetched once it does; run for real to see the full match');
    return finish('skipped', { error: null });
  }

  // ── The write. registerWindow opens a live socket.io WebSocket; VM denies writes
  // from an unregistered window (403) and the socket must stay UP for the duration.
  let rw = null;
  try {
    try { rw = await registerWindow(jar, ctx.wuid); }
    catch (e) { log(`WARN: registerWindow failed (${e.message}) — the write will likely 403`); }

    if (!list) {
      const created = await vmCall('POST', 'api%5cnominationlist', assertNotClosing([
        ['nominationList[game][__identity]', svrz.svrz_persistence_id],
        ['nominationList[team][__identity]', idOf(teamForNew)],
        ['nominationList[indoorPlayerNominations]', ''],
        ['nominationList[notFoundButNominatedPersons]', ''],
        ['nominationList[coachPerson]', ''],
        ['nominationList[firstAssistantCoachPerson]', ''],
        ['nominationList[secondAssistantCoachPerson]', ''],
        ['nominationList[nominationListValidation]', ''],
        ['nominationList[isClosedForTeam]', 'false'],
        ['nominationList[closedAt]', ''],
        ['nominationList[closedBy]', ''],
        ['nominationList[isSubsequentGameForTeamInTournamentGroup]', 'false'],
      ]));
      list = created?.nominationList ?? created?.items?.nominationList ?? created;
      if (!idOf(list)) throw new Error('create returned no list identity');
      log(`created list ${idOf(list)}`);

      candidates = await vmCall('POST', 'api%5cnominationlist/getPossibleIndoorPlayerNominationsForNominationList',
        [['nominationList', idOf(list)], ['onlyFromMyTeam', 'true'], ['onlyRelevantGender', 'true']]) ?? [];
      log(`VM candidates after create: ${candidates.length}`);
    }

    const matched = candidates.filter((c) => wantLicences.has(String(c.indoorPlayer?.person?.associationId)));
    const missing = [...wantLicences].filter(
      (l) => !candidates.some((c) => String(c.indoorPlayer?.person?.associationId) === l));
    if (missing.length) {
      log(`WARN: ${missing.length} confirmed licence(s) are not nominatable in VM (no validated licence for this team?): ${missing.join(', ')}`);
    }
    if (!matched.length) {
      return finish('skipped', { listId: idOf(list), count: 0,
        error: `none of the ${wantLicences.size} confirmed licence(s) are nominatable in VM` });
    }

    // Fill. Round-trip the whole aggregate (Flow's property mapper wants it back),
    // swapping in our nominations. Every close flag stays explicitly false.
    const fill = assertNotClosing([
      ...toPairs({ ...list, indoorPlayerNominations: undefined, nominationListValidation: undefined,
                   coachPerson: undefined, firstAssistantCoachPerson: undefined,
                   secondAssistantCoachPerson: undefined,
                   closed: false, closedAt: null, closedBy: null, isClosedForTeam: false },
                 'nominationList'),
      ['nominationList[nominationListValidation][__identity]', idOf(list.nominationListValidation)],
      ...matched.flatMap((c, i) => [
        [`nominationList[indoorPlayerNominations][${i}][indoorPlayer][__identity]`, idOf(c.indoorPlayer)],
        [`nominationList[indoorPlayerNominations][${i}][indoorPlayerLicenseCategory][__identity]`, idOf(c.indoorPlayerLicenseCategory)],
      ]),
    ]);

    const saved = await vmCall('PUT', 'api%5cnominationlist', fill);
    const savedList = saved?.nominationList ?? saved?.items?.nominationList ?? saved;
    const count = (savedList?.indoorPlayerNominations ?? matched).length;
    log(`filled ${count} player(s) onto list ${idOf(list)}`);

    // Close — but only on a clean read-back. VM recomputed the validation during the
    // save above; a fineable issue here means closing would file a document we can be
    // fined for, so we leave it open for the coach instead.
    if (NO_CLOSE) {
      return finish('filled', { listId: idOf(list), count, error: null });
    }
    const blockers = fineableBlockers(savedList?.nominationListValidation);
    if (blockers.length) {
      log(`NOT closing — ${blockers.length} unresolved fineable issue(s): ${blockers.join(', ')}`);
      return finish('filled', { listId: idOf(list), count,
        error: `left open for review: ${blockers.join(', ')}` });
    }

    await vmCall('PUT', 'api%5cnominationlist', [
      ...toPairs({ ...savedList, indoorPlayerNominations: undefined, nominationListValidation: undefined,
                   isClosedForTeam: true }, 'nominationList'),
      ['nominationList[nominationListValidation][__identity]', idOf(savedList?.nominationListValidation)],
      ...matched.flatMap((c, i) => [
        [`nominationList[indoorPlayerNominations][${i}][indoorPlayer][__identity]`, idOf(c.indoorPlayer)],
        [`nominationList[indoorPlayerNominations][${i}][indoorPlayerLicenseCategory][__identity]`, idOf(c.indoorPlayerLicenseCategory)],
      ]),
    ]);
    log(`closed list ${idOf(list)}`);
    return finish('closed', { listId: idOf(list), count, error: null });
  } finally {
    try { rw?.ws?.close(); } catch { /* best effort */ }
  }
}

if (IS_ENTRYPOINT) {
  if (!GAME_ID) { console.error('[vm-nom] GAME_ID required'); process.exit(1); }
  main().catch(async (e) => {
    log(`ERROR: ${e.message}`);
    await finish('failed', { error: e.message });
  });
}
