/**
 * vm-push-game.mjs — push ONE confirmed home game's date/time/hall into
 * VolleyManager (volleymanager.volleyball.ch).
 *
 * Spawned fire-and-forget by the Terminplanung confirm-home / manual-booking /
 * vm-push endpoints. Self-contained: authenticates to Directus with the sync
 * service account and to VM with VM_USERNAME/VM_PASSWORD.
 *
 * Env:
 *   VM_USERNAME, VM_PASSWORD          — VolleyManager login
 *   VM_CLUB_UUID                      — KSCW club uuid (default below)
 *   DIRECTUS_URL                      — http://127.0.0.1:8055
 *   DIRECTUS_SYNC_EMAIL/PASSWORD      — sync admin (mints a bearer token)
 *   BOOKING_ID                        — game_scheduling_bookings.id to push
 *   FORCE_SVRZ_ID                     — (optional) svrz_persistence_id to push,
 *                                       bypassing fixture auto-match (manual pick)
 *
 * Writes back onto the booking: vm_game_id, vm_pushed_at, vm_push_status,
 * vm_push_error. NEVER changes game status / finalizes (no validateGames).
 */
import { vmLogin, csrfFromPage, VM_BASE, UA } from './vm-client.mjs';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://127.0.0.1:8055';
const VM_CLUB_UUID = process.env.VM_CLUB_UUID || '956158d5-806f-4af9-8378-e7a9e19adeff';
const KSCW_SVRZ_CLUB_ID = process.env.KSCW_SVRZ_CLUB_ID || '912530';
const BOOKING_ID = process.env.BOOKING_ID;
const FORCE_SVRZ_ID = process.env.FORCE_SVRZ_ID || null;

const log = (...a) => console.log(new Date().toISOString(), '[vm-push]', ...a);
const idOf = (x) => (x && typeof x === 'object' ? (x.__identity || x.persistenceObjectIdentifier || '') : '');
const normName = (s) => String(s || '').trim().toLowerCase();
if (!BOOKING_ID) { console.error('[vm-push] BOOKING_ID required'); process.exit(1); }

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
async function dPatchBooking(patch) {
  const r = await fetch(`${DIRECTUS_URL}/items/game_scheduling_bookings/${BOOKING_ID}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${DTOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) log(`WARN: write-back PATCH failed HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
const finish = async (status, { vmGameId = null, error = null } = {}) => {
  await dPatchBooking({
    vm_push_status: status,
    vm_game_id: vmGameId,
    vm_push_error: error,
    vm_pushed_at: status === 'pushed' || status === 'pushed_no_hall' ? new Date().toISOString() : null,
  });
  log(`done → ${status}${error ? ` (${String(error).slice(0, 160)})` : ''}`);
  process.exit(0);
};

// ─── Europe/Zurich wall-clock → UTC ISO (DST-correct) ────────────────
function zurichToUtcIso(ymd, hm) {
  const [Y, Mo, D] = String(ymd).slice(0, 10).split('-').map(Number);
  const [h, mi] = String(hm).split(':').map(Number);
  const tz = 'Europe/Zurich';
  const offset = (ms) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).reduce((a, x) => (a[x.type] = x.value, a), {});
    return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  const wall = Date.UTC(Y, Mo - 1, D, h, mi, 0);
  let utc = wall - offset(wall);
  utc = wall - offset(utc); // refine across a DST boundary
  const d = new Date(utc), p2 = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:00.000000+00:00`;
}

// ─── VM game read/validate/update (proven 2026-06-10) ────────────────
const RENDER = [
  'number', 'status', 'startingDateTime', 'playingWeekday', 'displayName', 'shortDisplayName',
  'gameDayIndex', 'hasNominationListOfTeamOfActiveParty',
  'group.name', 'gameValidation.hasValidationIssues', 'refereeGame.activeFirstHeadRefereeName',
  'gameDay.gameDayIndex', 'hall.name',
  'encounter.teamHome.name', 'encounter.teamAway.name',
  'encounter.teamHomeName', 'encounter.teamHomeDisplayName', 'encounter.teamHomeDefinedBy', 'encounter.teamHomeDefinitive', 'encounter.teamHomeGroupRankDisplayName',
  'encounter.teamAwayName', 'encounter.teamAwayDisplayName', 'encounter.teamAwayDefinedBy', 'encounter.teamAwayDefinitive', 'encounter.teamAwayGroupRankDisplayName',
];
let jar, ctx, wuidHdr;
async function vmSearchHome() {
  // KSCW has 1500+ home games all-time; a single limit-500 page silently drops
  // the current-season fixtures (they sort after a decade of history), which made
  // the push fail with "not found among home fixtures". Paginate through all.
  const PAGE = 500;
  const all = [];
  for (let offset = 0; offset <= 20000; offset += PAGE) {
    const p = new URLSearchParams();
    p.set('searchConfiguration[propertyFilters][0][propertyName]', 'encounter.teamHome.club.Persistence_Object_Identifier');
    p.set('searchConfiguration[propertyFilters][0][values][0]', VM_CLUB_UUID);
    p.set('searchConfiguration[customFilters]', '');
    p.set('searchConfiguration[propertyOrderings]', '');
    p.set('searchConfiguration[offset]', String(offset));
    p.set('searchConfiguration[limit]', String(PAGE));
    p.set('searchConfiguration[textSearchOperator]', 'AND');
    RENDER.forEach((pr, i) => p.set(`propertyRenderConfiguration[${i}]`, pr));
    p.set('__csrfToken', ctx.csrf);
    const r = await fetch(`${VM_BASE}/api/sportmanager.indoorvolleyball/api%5cgame/search`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'text/plain;charset=UTF-8', Accept: '*/*', Origin: VM_BASE, Referer: `${VM_BASE}/sportmanager.indoorvolleyball/game/index`, Cookie: jar.header(), ...wuidHdr },
      body: p.toString(),
    });
    if (!r.ok) throw new Error(`vm search HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const items = (await r.json()).items || [];
    all.push(...items);
    if (items.length < PAGE) break;
  }
  return all;
}
function gameToPairs(g, startingDateTime, hallId) {
  const e = g.encounter || {};
  const pairs = [
    ['game[__identity]', g.__identity || g.persistenceObjectIdentifier],
    ['game[startingDateTime]', startingDateTime],
    ['game[group][__identity]', idOf(g.group)],
    ['game[status]', g.status],
    ['game[encounter][__identity]', idOf(e)],
    ['game[encounter][teamHome][__identity]', idOf(e.teamHome)],
    ['game[encounter][teamAway][__identity]', idOf(e.teamAway)],
    ['game[encounter][teamHomeDefinedBy]', e.teamHomeDefinedBy ?? 'team'],
    ['game[encounter][teamHomeGroup]', e.teamHomeGroup ?? ''],
    ['game[encounter][teamHomeRank]', e.teamHomeRank ?? ''],
    ['game[encounter][teamAwayDefinedBy]', e.teamAwayDefinedBy ?? 'team'],
    ['game[encounter][teamAwayGroup]', e.teamAwayGroup ?? ''],
    ['game[encounter][teamAwayRank]', e.teamAwayRank ?? ''],
    ['game[encounter][teamHomeDefinitive]', String(e.teamHomeDefinitive ?? true)],
    ['game[encounter][teamAwayDefinitive]', String(e.teamAwayDefinitive ?? true)],
    ['game[encounter][teamHomeName]', e.teamHomeName ?? ''],
    ['game[encounter][teamHomeDisplayName]', e.teamHomeDisplayName ?? ''],
    ['game[encounter][teamHomeGroupRankDisplayName]', e.teamHomeGroupRankDisplayName ?? ''],
    ['game[encounter][teamAwayName]', e.teamAwayName ?? ''],
    ['game[encounter][teamAwayDisplayName]', e.teamAwayDisplayName ?? ''],
    ['game[encounter][teamAwayGroupRankDisplayName]', e.teamAwayGroupRankDisplayName ?? ''],
    ['game[number]', g.number],
    ['game[gameValidation][__identity]', idOf(g.gameValidation)],
    ['game[nominationListOfTeamHome]', ''],
    ['game[nominationListOfTeamAway]', ''],
    ['game[scoresheet]', ''],
    ['game[gameDayIndex]', g.gameDayIndex],
    ['game[refereeGame][__identity]', idOf(g.refereeGame)],
    ['game[result]', ''],
    ['game[bestOfSeriesResult]', ''],
  ];
  if (hallId) pairs.push(['game[hall][__identity]', hallId]);
  else pairs.push(['game[hall]', '']);
  pairs.push(
    ['game[lastPostponement]', ''],
    ['game[playingWeekday]', g.playingWeekday ?? ''],
    ['game[hasNominationListOfTeamOfActiveParty]', String(g.hasNominationListOfTeamOfActiveParty ?? false)],
    ['game[displayName]', g.displayName ?? ''],
    ['game[shortDisplayName]', g.shortDisplayName ?? ''],
    ['game[pointSystem]', ''],
    ['game[gameDay][__identity]', idOf(g.gameDay)],
  );
  return pairs.filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]);
}
async function vmValidate(pairs) {
  const qs = new URLSearchParams();
  for (const [k, v] of pairs) if (!/^game\[encounter\]\[team(Home|Away)\]/.test(k) || /__identity/.test(k)) qs.set(k, v);
  qs.set('ignoreValidationIssueConfigurationRestrictions', 'true');
  const r = await fetch(`${VM_BASE}/api/sportmanager.indoorvolleyball/api%5cgame/validateGame?${qs.toString()}`, {
    headers: { 'User-Agent': UA, Accept: '*/*', Referer: `${VM_BASE}/sportmanager.indoorvolleyball/game/index`, Cookie: jar.header(), ...wuidHdr },
  });
  const text = await r.text();
  return [...new Set((text.match(/\b16\d{11}\b/g) || []))]; // soft-conflict issue codes to ignore
}
async function vmUpdate(pairs, codes) {
  const body = new URLSearchParams(pairs);
  codes.forEach((c, i) => body.set(`ignoredErrorCodes[${i}]`, c));
  body.set('__csrfToken', ctx.csrf);
  const r = await fetch(`${VM_BASE}/api/sportmanager.indoorvolleyball/api%5cgame/updateGameAndIgnoreErrorCodes`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'text/plain;charset=UTF-8', Accept: '*/*', Origin: VM_BASE, Referer: `${VM_BASE}/sportmanager.indoorvolleyball/game/index`, Cookie: jar.header(), ...wuidHdr },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`updateGame HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ─── main ────────────────────────────────────────────────────────────
async function main() {
 try {
  await dlogin();
  const booking = await dGet(`/items/game_scheduling_bookings/${BOOKING_ID}?fields=*,opponent.*,slot.*`);
  if (!booking) throw new Error('booking not found');
  if (booking.type !== 'home_slot_pick') return finish('failed', { error: 'not a home booking' });
  if (booking.status !== 'confirmed') return finish('failed', { error: 'booking not confirmed' });
  const opp = booking.opponent;
  const slot = booking.slot;
  if (!opp?.team_name) return finish('failed', { error: 'opponent has no team_name' });
  if (!slot?.date || !slot?.start_time) return finish('failed', { error: 'slot missing date/time' });

  // Target hall → VM hall uuid
  let vmHallId = null;
  if (slot.hall) {
    const hall = await dGet(`/items/halls/${slot.hall}?fields=id,name,vm_hall_id`);
    vmHallId = hall?.vm_hall_id || null;
    if (!vmHallId) log(`hall "${hall?.name}" has no vm_hall_id — will push date/time only`);
  }

  // Candidate KSCW-home fixtures vs this opponent (status open), from svrz_games:
  // home_club_id=KSCW + away_team_name=opponent. Then narrow to OUR team by the
  // stable staticTeamIdentifier (teams.team_id `vb_<id>`), NOT the name — two
  // KSCW teams can share an opponent name (e.g. D1 & D2 both face "… D2"), and
  // VM↔SVRZ names drift on a Stärkeklasse move. Matching the home side by id is
  // the same drift-proof key the rest of the scheduler uses.
  let svrzId = FORCE_SVRZ_ID;
  if (!svrzId) {
    const team = await dGet(`/items/teams/${opp.kscw_team}?fields=id,name,team_id`);
    const ourStatic = String(team?.team_id || '').replace(/^vb_/, '');
    const filter = encodeURIComponent(JSON.stringify({
      home_club_id: { _eq: KSCW_SVRZ_CLUB_ID },
      away_team_name: { _eq: opp.team_name },
      status: { _eq: 'open' },
    }));
    let cands = await dGet(`/items/svrz_games?filter=${filter}&fields=svrz_persistence_id,svrz_number,display_name,starting_date_time,home_team_name,raw&sort=starting_date_time&limit=20`) || [];
    if (ourStatic) {
      cands = cands.filter((c) => String(c?.raw?.encounter?.teamHome?.staticTeamIdentifier || '') === ourStatic);
    } else if (team?.name) {
      cands = cands.filter((c) => normName(c.home_team_name) === normName(`KSC Wiedikon ${team.name}`));
    }
    if (cands.length === 0) return finish('no_fixture', { error: `No open VM home fixture for ${team?.name || ''} vs ${opp.team_name}` });
    if (cands.length > 1) {
      const list = cands.map((c) => ({ id: c.svrz_persistence_id, label: c.display_name || `#${c.svrz_number}`, date: c.starting_date_time }));
      return finish('needs_pick', { error: JSON.stringify({ needs_pick: list }) });
    }
    svrzId = cands[0].svrz_persistence_id;
  }

  // Load the full VM game object, mutate date+hall, validate, update.
  await dPatchBooking({ vm_push_status: 'queued', vm_push_error: null });
  jar = await vmLogin({ username: process.env.VM_USERNAME, password: process.env.VM_PASSWORD });
  ctx = await csrfFromPage(jar, '/sportmanager.indoorvolleyball/game/index');
  wuidHdr = ctx.wuid ? { 'Window-Unique-Id': ctx.wuid } : {};

  const games = await vmSearchHome();
  const g = games.find((x) => (x.__identity || x.persistenceObjectIdentifier) === svrzId);
  if (!g) return finish('failed', { error: `VM game ${svrzId} not found among home fixtures (finalized?)`, vmGameId: svrzId });
  if (g.status !== 'open') return finish('failed', { error: `VM game status is "${g.status}", not open`, vmGameId: svrzId });

  // Weekday (Mon-Fri) home games always start at 20:00 — the slot is just the
  // hall window (e.g. 19:30-21:30), the game itself is at 20:00. Weekend slots
  // (Spielsamstag / junior Sunday) keep their actual start time.
  const slotDow = new Date(`${String(slot.date).slice(0, 10)}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  const gameStart = slotDow >= 1 && slotDow <= 5 ? '20:00' : String(slot.start_time).slice(0, 5);
  const startingDateTime = zurichToUtcIso(slot.date, gameStart);
  const pairs = gameToPairs(g, startingDateTime, vmHallId);

  // DRY_RUN: prove match + payload + datetime + hall + validate WITHOUT writing.
  // validateGame is a read-only GET, so it's safe to call. No write-back.
  if (process.env.DRY_RUN) {
    const codes = await vmValidate(pairs);
    log(`DRY_RUN: would push #${g.number} ${g.encounter?.teamHomeName} vs ${g.encounter?.teamAwayName}`);
    log(`DRY_RUN:   svrz ${svrzId}  ${g.startingDateTime} → ${startingDateTime}  hall ${g.hall?.name || '(unset)'} → ${vmHallId || '(unmapped)'}`);
    log(`DRY_RUN:   validate issue codes [${codes.join(', ') || 'none'}], status=${g.status}`);
    process.exit(0);
  }

  const codes = await vmValidate(pairs);
  await vmUpdate(pairs, codes);

  // Verify
  const after = (await vmSearchHome()).find((x) => (x.__identity || x.persistenceObjectIdentifier) === svrzId);
  const okTime = after?.startingDateTime && new Date(after.startingDateTime).getTime() === new Date(startingDateTime).getTime();
  const okStatus = after?.status === 'open';
  if (!okTime || !okStatus) {
    return finish('failed', { error: `Verify failed (time ${okTime ? 'ok' : 'BAD'}, status ${after?.status})`, vmGameId: svrzId });
  }
  log(`pushed #${g.number} ${g.encounter?.teamHomeName} vs ${g.encounter?.teamAwayName} → ${startingDateTime}, hall ${after?.hall?.name || '(unset)'}`);
  return finish(vmHallId ? 'pushed' : 'pushed_no_hall', { vmGameId: svrzId });
 } catch (err) {
  log(`ERROR: ${err.message}`);
  try { await finish('failed', { error: err.message }); } catch { process.exit(1); }
 }
}
main();
