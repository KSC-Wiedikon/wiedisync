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
 *
 * Writes back onto the game: vm_nomination_status / _list_id / _count /
 * _pushed_at / _error.
 *
 * ─── Two things about this file that are load-bearing ───────────────────────
 *
 * 1. THERE IS NO VM STAGING. Every write here hits the real Swiss Volley
 *    production system, on both dev and prod. DRY_RUN is the only safe rehearsal.
 *
 * 2. WE SAVE, THE REFEREE CLOSES. The club's part is saving the list (players +
 *    C/AC1/AC2) before kickoff; the referee closes it after the game (game #406208:
 *    `closedBy: "referee"` the next day). Closing is VM's separate `finalize` action
 *    and answers 403 to the club role (live, game #406201) — so we never call it,
 *    and 'saved' is our success state. `assertNotClosing()` still guards every save
 *    payload, so no flag can ever file or reopen the referee's document by accident.
 *    A save VM flags as fineable (too few players, no coach) ends 'filled' (amber)
 *    for the coach to fix before kickoff.
 */
import { pathToFileURL } from 'node:url';
import { vmLogin, csrfFromPage, registerWindow, VM_BASE, UA } from './vm-client.mjs';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://127.0.0.1:8055';
const KSCW_SVRZ_CLUB_ID = process.env.KSCW_SVRZ_CLUB_ID || '912530';
const GAME_ID = process.env.GAME_ID;

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

async function vmCall(method, resource, pairs, pkg = 'sportmanager.indoorvolleyball') {
  const body = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&')
    + `&__csrfToken=${encodeURIComponent(ctx.csrf)}`;
  const r = await fetch(`${VM_BASE}/api/${pkg}/${resource}`, {
    method, headers: vmHeaders(), body,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${resource} HTTP ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return null; }
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

// ─── Officials (C / AC1 / AC2) ───────────────────────────────────────
//
// The Einsatzliste names up to three officials — VM's coachPerson,
// firstAssistantCoachPerson, secondAssistantCoachPerson — and a list without a
// coach is fineable (#33), so without these the push could never close a list on
// its own. Who fills which slot, in order of precedence:
//   1. the coach's per-game match sheet (`game_roster_officials`, migration 372) —
//      a SNAPSHOT: once it assigns any of C/AC1/AC2 it is the officials, so a slot with no row is
//      deliberately empty, and a row with no member is a VM-named official we hold
//      no member for (left exactly as VM has it);
//   2. the team default, `teams.features_enabled.nomination_officials`
//      ({ coach, assistant_coach_1, assistant_coach_2 } → member id), set in the
//      roster editor; an unset slot there has no opinion;
//   3. whatever VM already has. We never clear a slot we have no opinion on, so an
//      official a human entered in Volleymanager survives our push.
export const OFFICIAL_SLOTS = [
  ['coach', 'coachPerson'],
  ['assistant_coach_1', 'firstAssistantCoachPerson'],
  ['assistant_coach_2', 'secondAssistantCoachPerson'],
];
const SLOT_ROLES = OFFICIAL_SLOTS.map(([r]) => r);

/**
 * role → member id (a number), null (empty this slot) or undefined (no opinion —
 * keep VM's). Pure; mirrored by the preview in kscw-endpoints/src/nomination-push.js.
 */
export function pickOfficials(savedRows, teamDefault) {
  const out = {};
  const rows = (savedRows ?? []).filter(Boolean);
  // A snapshot only has an opinion on the slots once it assigns at least one of
  // them — rows with role NULL are the unlabelled teams_coaches fallback, and a
  // coach who only added a physio has not said "this game has no coach".
  if (rows.some((r) => SLOT_ROLES.includes(r.role))) {
    for (const role of SLOT_ROLES) {
      const row = rows.find((r) => r.role === role);
      if (!row) out[role] = null;
      else out[role] = row.member == null ? undefined : Number(typeof row.member === 'object' ? row.member.id : row.member);
    }
    return { source: 'game', slots: out };
  }
  for (const role of SLOT_ROLES) {
    const id = teamDefault?.[role];
    out[role] = id == null || id === '' ? undefined : Number(id);
  }
  return { source: 'team', slots: out };
}

/**
 * The three person relations to send. `resolved[role]` is a VM person
 * ({__identity}), null (clear) or undefined (keep `existing`'s). An empty AC1
 * with an AC2 moves up, exactly as VM's own form does before it saves.
 */
export function officialsPayload(existing, resolved) {
  const out = {};
  for (const [role, key] of OFFICIAL_SLOTS) {
    const r = resolved?.[role];
    out[key] = r === undefined ? (existing?.[key] ?? null) : r;
  }
  if (!out.firstAssistantCoachPerson && out.secondAssistantCoachPerson) {
    out.firstAssistantCoachPerson = out.secondAssistantCoachPerson;
    out.secondAssistantCoachPerson = null;
  }
  return out;
}

/** VM person by licence number — the same Elasticsearch search VM's person picker uses. */
async function findVmPerson(licence) {
  const res = await vmCall('POST', 'api%5celasticsearchperson/search', [
    ['searchConfiguration[propertyFilters][0][propertyName]', 'associationId'],
    ['searchConfiguration[propertyFilters][0][text]', String(licence)],
    ['searchConfiguration[customFilters]', ''],
    ['searchConfiguration[propertyOrderings]', ''],
    ['searchConfiguration[offset]', '0'],
    ['searchConfiguration[limit]', '10'],
    ['propertyRenderConfiguration[0]', 'associationId'],
  ], 'sportmanager.core');
  const hits = (res?.items ?? []).filter((p) => String(p.associationId) === String(licence));
  return hits.length === 1 && idOf(hits[0]) ? { __identity: idOf(hits[0]) } : null;
}

/**
 * The PUT body for one save of OUR list — every property spelled out, nothing
 * round-tripped by reflection.
 *
 * ⚠ This replaced `toPairs({...list}, 'nominationList')` (2026-10-02). toPairs
 * collapses any object carrying an `__identity` to that identity — right for a
 * related entity, wrong for the ROOT, which has one too. So both PUTs went out as
 * `nominationList[__identity]` + nominations and nothing else: the close never
 * carried `isClosedForTeam=true`, and no official could ever be sent. (It would not
 * have filed anyway — closing is the separate `finalize` action, see the header.)
 *
 * `nominations` are VM candidates (getPossibleIndoorPlayerNominationsForNominationList);
 * `officials` is officialsPayload()'s output. The body is always an OPEN list: VM's
 * form posts the same open object to `finalize`, which is what files it.
 */
export function buildListPairs(list, { nominations, officials }) {
  const P = 'nominationList';
  const rel = (k, v) => [`${P}[${k}][__identity]`, idOf(v)];
  const pairs = [
    [`${P}[__identity]`, idOf(list)],
    rel('game', list?.game),
    rel('team', list?.team),
    ...nominations.flatMap((c, i) => [
      [`${P}[indoorPlayerNominations][${i}][indoorPlayer][__identity]`, idOf(c.indoorPlayer)],
      [`${P}[indoorPlayerNominations][${i}][indoorPlayerLicenseCategory][__identity]`, idOf(c.indoorPlayerLicenseCategory)],
    ]),
    // A human may have added someone VM could not find — never drop their entry.
    ...(list?.notFoundButNominatedPersons ?? []).filter((x) => idOf(x))
      .map((x, i) => [`${P}[notFoundButNominatedPersons][${i}][__identity]`, idOf(x)]),
  ];
  for (const [, key] of OFFICIAL_SLOTS) {
    pairs.push(officials?.[key] && idOf(officials[key]) ? rel(key, officials[key]) : [`${P}[${key}]`, '']);
  }
  if (idOf(list?.nominationListValidation)) pairs.push(rel('nominationListValidation', list.nominationListValidation));
  pairs.push([`${P}[isSubsequentGameForTeamInTournamentGroup]`, String(!!list?.isSubsequentGameForTeamInTournamentGroup)]);
  pairs.push([`${P}[isClosedForTeam]`, 'false'], [`${P}[closedAt]`, ''], [`${P}[closedBy]`, '']);
  return assertNotClosing(pairs);
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
  // Shown to the coach under the status (vm_nomination_error) even on success —
  // "filed" must not hide that someone who said yes is not on the list.
  const notes = [];
  if (unlicensed.length) {
    // Never silently drop a player who said yes — they simply cannot be nominated.
    const names = unlicensed.map((m) => `${m.first_name} ${m.last_name}`).join(', ');
    log(`WARN: ${unlicensed.length} confirmed player(s) have no licence_nr and cannot be nominated: ${names}`);
    notes.push(`no licence number: ${names}`);
  }
  if (!licensed.length) {
    return finish('skipped', { error: `no licensed confirmed players (${playing.length} confirmed, ${unlicensed.length} unlicensed)` });
  }
  const wantLicences = new Set(licensed.map((m) => String(m.license_nr)));
  log(`game ${GAME_ID} (${side.toLowerCase()} #${number}): ${licensed.length} licensed / ${playing.length} confirmed`);

  // ── Officials (C / AC1 / AC2): per-game match sheet, else the team default.
  const [savedOfficials, teamRow] = await Promise.all([
    dGet(`/items/game_roster_officials?filter[game][_eq]=${GAME_ID}&fields=member,role&limit=-1`),
    dGet(`/items/teams/${game.kscw_team}?fields=features_enabled`),
  ]);
  const picked = pickOfficials(savedOfficials ?? [], teamRow?.features_enabled?.nomination_officials);
  const officialIds = [...new Set(Object.values(picked.slots).filter((v) => typeof v === 'number'))];
  const officialMembers = officialIds.length
    ? await dGet(`/items/members?filter[id][_in]=${officialIds.join(',')}&fields=id,first_name,last_name,license_nr&limit=-1`) ?? []
    : [];

  // ── VM session
  jar = await vmLogin({ username: process.env.VM_USERNAME, password: process.env.VM_PASSWORD });
  ctx = await csrfFromPage(jar, '/sportmanager.indoorvolleyball/game/index');

  // Idempotency: the getter tells us whether a list already exists (→ update it)
  // or not (→ create one). Always ask; never assume from our own journal.
  const got = await vmCall('POST', 'api%5cgame/getNominationListOrTeamForActivePartyByGame',
    [['game', svrz.svrz_persistence_id]]);
  const items = got?.items ?? got ?? {};
  let list = items[`nominationListTeam${side}`] ?? null;

  // ── A closed list is the REFEREE's — they close it after the game. Never touch
  // it: a save would reopen their document (assertNotClosing forces the flag
  // false). The endpoint already refuses after kickoff; this is the backstop.
  if (list?.closed || list?.isClosedForTeam) {
    return finish('closed', { listId: idOf(list), count: (list.indoorPlayerNominations ?? []).length,
      error: 'closed by the referee in Volleymanager — nothing was changed' });
  }

  // ── Officials → VM persons. Read-only lookups, so done before registerWindow.
  const ROLE_LABEL = { coach: 'C', assistant_coach_1: 'AC1', assistant_coach_2: 'AC2' };
  const resolvedOfficials = {};
  for (const [role] of OFFICIAL_SLOTS) {
    const want = picked.slots[role];
    if (want == null) { resolvedOfficials[role] = want; continue; }   // null = clear, undefined = keep VM's
    const m = officialMembers.find((x) => Number(x.id) === want);
    const name = m ? `${m.first_name} ${m.last_name}` : `member ${want}`;
    resolvedOfficials[role] = undefined;   // anything that fails below keeps VM's value
    if (!m?.license_nr) { notes.push(`${ROLE_LABEL[role]} ${name} has no licence number`); continue; }
    try {
      const person = await findVmPerson(m.license_nr);
      if (person) resolvedOfficials[role] = person;
      else notes.push(`${ROLE_LABEL[role]} ${name} (${m.license_nr}) not found in Volleymanager`);
    } catch (e) {
      notes.push(`${ROLE_LABEL[role]} ${name}: lookup failed`);
      log(`WARN: person lookup for ${m.license_nr} failed: ${e.message}`);
    }
  }
  log(`officials (${picked.source}): ` + OFFICIAL_SLOTS.map(([r]) => {
    const v = resolvedOfficials[r];
    return `${ROLE_LABEL[r]}=${v === undefined ? 'keep' : v === null ? 'clear' : idOf(v)}`;
  }).join(' '));

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
    if (notes.length) log(`DRY_RUN: notes: ${notes.join('; ')}`);
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
      // The create response's relations are unprobed; we know both, so never send ''.
      list = { ...list, game: idOf(list.game) ? list.game : { __identity: svrz.svrz_persistence_id },
               team: idOf(list.team) ? list.team : teamForNew };
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
      const byLicence = new Map(licensed.map((m) => [String(m.license_nr), `${m.first_name} ${m.last_name}`]));
      notes.push(`not eligible in Volleymanager: ${missing.map((l) => byLicence.get(l) || l).join(', ')}`);
    }
    if (!matched.length) {
      return finish('skipped', { listId: idOf(list), count: 0,
        error: [`none of the ${wantLicences.size} confirmed licence(s) are nominatable in VM`, ...notes].join('; ') });
    }

    // Fill: our nominations + officials, every close flag explicitly false (this is
    // also what reopens a filed list on an amend).
    const officials = officialsPayload(list, resolvedOfficials);
    const fill = buildListPairs(list, { nominations: matched, officials });

    const saved = await vmCall('PUT', 'api%5cnominationlist', fill);
    const savedList = saved?.nominationList ?? saved?.items?.nominationList ?? saved;
    const count = (savedList?.indoorPlayerNominations ?? matched).length;
    log(`filled ${count} player(s) onto list ${idOf(list)}`);

    // Done. The club SAVES the list; the REFEREE closes it, after the game
    // (game #406208: closedBy "referee" the next day; our `finalize` under the club
    // role is 403). So a save is the success state — 'saved' — and 'filled' (amber)
    // is kept for a save VM flags as fineable (too few players, no coach), which
    // the coach must fix before kickoff.
    const blockers = fineableBlockers(savedList?.nominationListValidation);
    if (blockers.length) {
      log(`saved, but ${blockers.length} unresolved fineable issue(s): ${blockers.join(', ')}`);
      return finish('filled', { listId: idOf(list), count,
        error: [`Volleymanager flags: ${blockers.join(', ')}`, ...notes].join('; ') });
    }
    return finish('saved', { listId: idOf(list), count, error: notes.length ? notes.join('; ') : null });
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
