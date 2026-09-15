/**
 * vm-team-players.mjs — put our roster's players onto their VolleyManager team.
 *
 * VolleyManager keeps, per team and season, the list of "Spieler Volleyball"
 * a club may nominate for that team's games. The club fills it by hand, one
 * team at a time, from the players whose licence is ACTIVATED for the season
 * — anyone else is simply not offered. This module does that click-work from
 * our own rosters: for every active volleyball team with a VM counterpart
 * (`teams.team_id` = `vb_<staticTeamIdentifier>`), the `member_teams` players
 * (guest_level 0) with a `license_nr` who are not yet on the VM team and whose
 * licence VM offers get assigned in one call per team.
 *
 * The call sequence is the browser's, captured in a HAR on 2026-09-15:
 *
 *   POST api\team/search                                (season.active = true)
 *   POST api\teamaddressorganisationmember/search       (team.__identity = …)
 *   GET  api\indoorplayer/search                        (activated licence,
 *          excludeAlreadyAssignedTeamPlayers = <team.addressOrganisation>,
 *          includePlayersForTeam = <team>)
 *   POST api\indoorplayer/assignPlayersToTeam           (indoorPlayers[i][__identity], team)
 *
 * Three things that are load-bearing:
 *
 * 1. THERE IS NO VM STAGING. Every write here hits the real Swiss Volley
 *    production system. `dryRun` is the only rehearsal; it performs every read
 *    and no write.
 *
 * 2. ADD ONLY, NEVER REMOVE. A player on the VM team who is not on our roster
 *    is reported (`extraOnVm`) and left alone — VM may hold a reason we do not
 *    (double licence, a loan, a coach who also plays).
 *
 * 3. VM DECIDES WHO IS ASSIGNABLE. We never fabricate an assignment: the
 *    candidate list is VM's own `indoorplayer/search` for that team, and a
 *    roster player missing from it (`licencePending`) means VM will not offer
 *    them — normally because the licence is not activated for the season yet.
 *    Re-running later picks them up once it is; that is the whole point of the
 *    admin button.
 *
 * Pure with respect to Directus: the caller supplies `wanted` (our rosters) and
 * reads the result. The CLI at the bottom loads rosters through Directus REST
 * or from a JSON file; the admin endpoint (kscw-endpoints/src/vm-team-assign.js)
 * builds them through knex and calls `runTeamAssignment` in-process.
 */
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { vmLogin, csrfFromPage, registerWindow, VM_BASE, UA } from './vm-client.mjs';

const TEAM_INDEX = '/sportmanager.indoorvolleyball/team/index';
const API = `${VM_BASE}/api/sportmanager.indoorvolleyball`;
const PAGE = 200;
const CALL_TIMEOUT_MS = 45_000;

const idOf = (x) => (x && typeof x === 'object' ? (x.__identity || x.persistenceObjectIdentifier || '') : '');

// ─── Roster shape ────────────────────────────────────────────────────
/**
 * `wanted` — what OUR side says each VM team should hold. One entry per
 * wiedisync team with a real VM id; players with an empty licence number are
 * carried along so the report can name them, but never sent to VM.
 *
 * @typedef {{ memberId: number, licenseNr: string|null, name: string }} WantedPlayer
 * @typedef {{ teamDbId: number, staticId: number, teamName: string, players: WantedPlayer[] }} WantedTeam
 */

/**
 * `teams.team_id` → VM staticTeamIdentifier. VM ids are plain integers; a
 * zero-padded one (`vb_00001`, DU20) is OUR placeholder for a team that is
 * not registered in VolleyManager at all, so it maps to null, not to team #1.
 */
/** `members.license_nr` → VM associationId as a decimal string, or null. */
export function normalizeLicenceNr(value) {
  const s = String(value ?? '').trim();
  return /^[0-9]+$/.test(s) ? String(BigInt(s)) : null;
}

export function staticIdFromTeamId(teamId) {
  const m = /^vb_([1-9]\d*)$/.exec(String(teamId ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * Build `wanted` from flat rows — one per (team, player) — so knex and the
 * Directus REST path shape their input the same way.
 * @param {Array<{team_db_id:number, team_id:string, team_name:string, member_id:number, license_nr:string|null, first_name:string|null, last_name:string|null}>} rows
 * @returns {WantedTeam[]}
 */
export function buildWanted(rows) {
  const byTeam = new Map();
  for (const r of rows) {
    const staticId = staticIdFromTeamId(r.team_id);
    if (!staticId) continue;
    let t = byTeam.get(staticId);
    if (!t) {
      t = { teamDbId: Number(r.team_db_id), staticId, teamName: r.team_name, players: [] };
      byTeam.set(staticId, t);
    }
    // VM keys players by the integer associationId; `members.license_nr` is a
    // varchar that keeps ClubDesk's leading zeros ('038514'). Compare as the
    // integer's decimal string, and treat a non-numeric placeholder as "no
    // licence number" (2026-09-15).
    const licenseNr = normalizeLicenceNr(r.license_nr);
    if (t.players.some((p) => p.memberId === Number(r.member_id))) continue;
    t.players.push({
      memberId: Number(r.member_id),
      licenseNr,
      name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `#${r.member_id}`,
    });
  }
  return [...byTeam.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
}

// ─── VM calls ────────────────────────────────────────────────────────
function vmHeaders(session) {
  return {
    'User-Agent': UA,
    'Content-Type': 'text/plain;charset=UTF-8',
    Accept: '*/*',
    Cookie: session.jar.header(),
    Origin: VM_BASE,
    Referer: `${VM_BASE}${TEAM_INDEX}`,
    ...(session.ctx.wuid ? { 'Window-Unique-Id': session.ctx.wuid } : {}),
  };
}

/** Flow's bracket-notation search body. Shared by the three searches. */
function searchParams({ propertyFilters = [], customFilters = [], orderings = [], render = [], offset = 0, limit = PAGE }) {
  const p = new URLSearchParams();
  propertyFilters.forEach((f, i) => {
    p.set(`searchConfiguration[propertyFilters][${i}][propertyName]`, f.propertyName);
    if (f.boolean !== undefined) p.set(`searchConfiguration[propertyFilters][${i}][boolean]`, String(f.boolean));
    if (f.values) f.values.forEach((v, j) => p.set(`searchConfiguration[propertyFilters][${i}][values][${j}]`, String(v)));
  });
  if (customFilters.length) {
    customFilters.forEach((f, i) => {
      p.set(`searchConfiguration[customFilters][${i}][name]`, f.name);
      f.values.forEach((v, j) => p.set(`searchConfiguration[customFilters][${i}][values][${j}]`, String(v)));
    });
  } else {
    p.set('searchConfiguration[customFilters]', '');
  }
  if (orderings.length) {
    orderings.forEach((o, i) => {
      p.set(`searchConfiguration[propertyOrderings][${i}][propertyName]`, o.propertyName);
      p.set(`searchConfiguration[propertyOrderings][${i}][descending]`, String(!!o.descending));
    });
  } else {
    p.set('searchConfiguration[propertyOrderings]', '');
  }
  p.set('searchConfiguration[offset]', String(offset));
  p.set('searchConfiguration[limit]', String(limit));
  p.set('searchConfiguration[textSearchOperator]', 'AND');
  render.forEach((r, i) => p.set(`propertyRenderConfiguration[${i}]`, r));
  return p;
}

/**
 * Paginated search. `method` is what the browser uses for that resource —
 * team + roster are POST, indoorplayer is GET with the same params in the
 * query string. Both carry the csrf token.
 */
async function vmSearch(session, resource, method, config) {
  const out = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const p = searchParams({ ...config, offset });
    p.set('__csrfToken', session.ctx.csrf);
    const url = `${API}/api%5c${resource}/search${method === 'GET' ? `?${p}` : ''}`;
    const r = await fetch(url, {
      method,
      headers: vmHeaders(session),
      body: method === 'GET' ? undefined : p.toString(),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${resource}/search HTTP ${r.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    const items = json.items ?? [];
    total = json.totalItemsCount ?? items.length;
    out.push(...items);
    if (!items.length) break;
    offset += items.length;
  }
  return out;
}

/** The club's teams in the active season, keyed by staticTeamIdentifier. */
export async function vmFetchTeams(session) {
  const items = await vmSearch(session, 'team', 'POST', {
    propertyFilters: [{ propertyName: 'season.active', boolean: true }],
    render: ['staticTeamIdentifier', 'identifier', 'name', 'displayName', 'gender', 'active',
      'leagueCategory.name', 'addressOrganisation.number', 'addressOrganisation.name',
      'teamRegistrationStatus'],
  });
  const byStaticId = new Map();
  for (const t of items) {
    const sid = Number(t.staticTeamIdentifier);
    if (!sid || !idOf(t)) continue;
    byStaticId.set(sid, {
      id: idOf(t),
      staticId: sid,
      // The German translation carries the club's suffix ("KSC Wiedikon D1");
      // the bare `name` is "KSC Wiedikon" for every one of them.
      name: t.translations?.de?.name || t.name,
      league: t.leagueCategory?.name ?? null,
      gender: t.gender ?? null,
      active: t.active !== false,
      // The "already on this team" filter of the player search keys on the
      // team's ADDRESS ORGANISATION, not on the team itself.
      addressOrganisationId: idOf(t.addressOrganisation),
      registrationStatus: t.teamRegistrationStatus ?? null,
    });
  }
  return byStaticId;
}

/**
 * Everyone attached to a VM team — players AND staff — as
 * `{ licenseNr, name, functionType }`. `functionType === 'player'` is the
 * stable key; the title is localised ("Giocatore Pallavolo" in the HAR).
 */
export async function vmFetchTeamMembers(session, teamId) {
  const items = await vmSearch(session, 'teamaddressorganisationmember', 'POST', {
    propertyFilters: [
      { propertyName: 'team.__identity', values: [teamId] },
      { propertyName: 'person.deceased', boolean: false },
      { propertyName: 'person.isAnonymized', boolean: false },
    ],
    render: ['person.associationId', 'person.lastName', 'person.firstName',
      'addressOrganisationMemberFunction.title', 'addressOrganisationMemberFunction.type',
      'team.staticTeamIdentifier'],
  });
  return items.map((m) => ({
    licenseNr: m.person?.associationId != null ? String(m.person.associationId) : null,
    name: `${m.person?.firstName ?? ''} ${m.person?.lastName ?? ''}`.trim(),
    functionType: m.addressOrganisationMemberFunction?.type ?? null,
    functionTitle: m.addressOrganisationMemberFunction?.title ?? null,
  }));
}

/**
 * The players VM would let us add to this team right now: activated licence,
 * not already on the team. Keyed by licence number (= person.associationId).
 */
export async function vmFetchAssignablePlayers(session, team) {
  const items = await vmSearch(session, 'indoorplayer', 'GET', {
    propertyFilters: [{ propertyName: 'currentLicense.activatedInCurrentSeason', boolean: true }],
    customFilters: [
      { name: 'excludeAlreadyAssignedTeamPlayers', values: [team.addressOrganisationId] },
      { name: 'includePlayersForTeam', values: [team.id] },
    ],
    orderings: [
      { propertyName: 'person.lastName' },
      { propertyName: 'person.firstName' },
    ],
    render: ['person.associationId', 'person.lastName', 'person.firstName', 'person.gender',
      'currentLicense.activatedInCurrentSeason'],
  });
  const byLicence = new Map();
  for (const p of items) {
    const lic = p.person?.associationId;
    if (lic == null || !idOf(p)) continue;
    byLicence.set(String(lic), {
      indoorPlayerId: idOf(p),
      licenseNr: String(lic),
      name: `${p.person?.firstName ?? ''} ${p.person?.lastName ?? ''}`.trim(),
      gender: p.person?.gender ?? null,
    });
  }
  return byLicence;
}

/**
 * THE WRITE. One call per team, all players at once — exactly the browser's
 * `assignPlayersToTeam`. VM answers `null` with 200 on success.
 */
export async function vmAssignPlayersToTeam(session, teamId, indoorPlayerIds) {
  if (!indoorPlayerIds.length) return;
  const p = new URLSearchParams();
  indoorPlayerIds.forEach((id, i) => p.set(`indoorPlayers[${i}][__identity]`, id));
  p.set('team', teamId);
  p.set('__csrfToken', session.ctx.csrf);
  const r = await fetch(`${API}/api%5cindoorplayer/assignPlayersToTeam`, {
    method: 'POST',
    headers: vmHeaders(session),
    body: p.toString(),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`assignPlayersToTeam HTTP ${r.status}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
}

// ─── Planning (pure) ─────────────────────────────────────────────────
/**
 * Split one team's wanted players against what VM holds and offers.
 *
 * @param {WantedTeam} wanted
 * @param {Array<{licenseNr:string|null, name:string, functionType:string|null}>} vmMembers
 * @param {Map<string, {indoorPlayerId:string, licenseNr:string, name:string}>} assignable
 */
export function planTeam(wanted, vmMembers, assignable) {
  const onTeam = new Map();
  for (const m of vmMembers) if (m.functionType === 'player' && m.licenseNr) onTeam.set(m.licenseNr, m);

  const noLicenceNr = [];
  const alreadyOnTeam = [];
  const toAssign = [];
  const licencePending = [];
  for (const p of wanted.players) {
    if (!p.licenseNr) { noLicenceNr.push(p); continue; }
    if (onTeam.has(p.licenseNr)) { alreadyOnTeam.push(p); continue; }
    const cand = assignable.get(p.licenseNr);
    if (cand) toAssign.push({ ...p, indoorPlayerId: cand.indoorPlayerId, vmName: cand.name });
    else licencePending.push(p);
  }

  const wantedLicences = new Set(wanted.players.map((p) => p.licenseNr).filter(Boolean));
  const extraOnVm = [...onTeam.values()]
    .filter((m) => !wantedLicences.has(m.licenseNr))
    .map((m) => ({ licenseNr: m.licenseNr, name: m.name }));

  return { noLicenceNr, alreadyOnTeam, toAssign, licencePending, extraOnVm, vmPlayerCount: onTeam.size };
}

// ─── The run ─────────────────────────────────────────────────────────
/**
 * Log in, diff every wanted team against VM, assign what VM offers.
 *
 * @param {object} o
 * @param {string} o.username
 * @param {string} o.password
 * @param {WantedTeam[]} o.wanted
 * @param {boolean} [o.dryRun=true]     read everything, write nothing
 * @param {(line:string)=>void} [o.log]
 * @param {(progress:{done:number,total:number,team:string})=>void} [o.onProgress]
 */
export async function runTeamAssignment({ username, password, wanted, dryRun = true, log = () => {}, onProgress = () => {} }) {
  const startedAt = new Date().toISOString();
  const result = { dryRun, startedAt, finishedAt: null, teams: [], skipped: [], totals: { assigned: 0, pending: 0, already: 0, noLicenceNr: 0, extra: 0, failed: 0 } };

  const jar = await vmLogin({ username, password });
  const ctx = await csrfFromPage(jar, TEAM_INDEX);
  const session = { jar, ctx };
  log(`logged in${dryRun ? ' (DRY RUN — no writes)' : ''}`);

  const vmTeams = await vmFetchTeams(session);
  log(`VM: ${vmTeams.size} team(s) in the active season`);

  // Writes need a LIVE registered window (socket.io) or VM answers 403 — see
  // vm-client.registerWindow. Opened once, held across every assign, closed at
  // the end. Not needed for a dry run, which never writes.
  let rw = null;
  try {
    if (!dryRun) {
      try { rw = await registerWindow(jar, ctx.wuid); }
      catch (e) { log(`WARN: registerWindow failed (${e.message}) — writes will likely 403`); }
    }

    let done = 0;
    for (const w of wanted) {
      const team = vmTeams.get(w.staticId);
      if (!team) {
        result.skipped.push({ teamDbId: w.teamDbId, staticId: w.staticId, teamName: w.teamName, reason: 'no_vm_team' });
        log(`${w.teamName}: no VM team #${w.staticId} in the active season — skipped`);
        continue;
      }
      const entry = {
        teamDbId: w.teamDbId, staticId: w.staticId, teamName: w.teamName,
        vmTeamName: team.name, vmTeamId: team.id, league: team.league,
        assigned: [], alreadyOnTeam: [], licencePending: [], noLicenceNr: [], extraOnVm: [],
        vmPlayersBefore: 0, vmPlayersAfter: null, error: null,
      };
      result.teams.push(entry);
      onProgress({ done, total: wanted.length, team: w.teamName });
      try {
        const members = await vmFetchTeamMembers(session, team.id);
        const assignable = await vmFetchAssignablePlayers(session, team);
        const plan = planTeam(w, members, assignable);
        entry.vmPlayersBefore = plan.vmPlayerCount;
        entry.alreadyOnTeam = plan.alreadyOnTeam;
        entry.licencePending = plan.licencePending;
        entry.noLicenceNr = plan.noLicenceNr;
        entry.extraOnVm = plan.extraOnVm;

        const names = (arr) => arr.map((p) => `${p.name} (${p.licenseNr ?? '—'})`).join(', ');
        log(`${w.teamName} → ${team.name}: ${plan.vmPlayerCount} on VM, ${plan.alreadyOnTeam.length} already, `
          + `${plan.toAssign.length} to assign, ${plan.licencePending.length} not offered, ${plan.noLicenceNr.length} without licence nr, ${plan.extraOnVm.length} extra on VM`);
        if (plan.toAssign.length) log(`  assign: ${names(plan.toAssign)}`);
        if (plan.licencePending.length) log(`  not offered (licence not activated?): ${names(plan.licencePending)}`);
        if (plan.extraOnVm.length) log(`  extra on VM (left alone): ${names(plan.extraOnVm)}`);

        if (plan.toAssign.length && !dryRun) {
          await vmAssignPlayersToTeam(session, team.id, plan.toAssign.map((p) => p.indoorPlayerId));
          // Verify against VM, never against our own intent.
          const after = await vmFetchTeamMembers(session, team.id);
          const nowOn = new Set(after.filter((m) => m.functionType === 'player').map((m) => m.licenseNr));
          entry.vmPlayersAfter = nowOn.size;
          const landed = plan.toAssign.filter((p) => nowOn.has(p.licenseNr));
          const lost = plan.toAssign.filter((p) => !nowOn.has(p.licenseNr));
          entry.assigned = landed.map(({ indoorPlayerId: _i, ...p }) => p);
          if (lost.length) {
            entry.error = `VM accepted the call but ${lost.length} player(s) did not land: ${names(lost)}`;
            entry.licencePending.push(...lost.map(({ indoorPlayerId: _i, vmName: _v, ...p }) => p));
          }
          log(`  assigned ${landed.length}/${plan.toAssign.length} — team now holds ${nowOn.size} player(s)`);
        } else {
          entry.assigned = plan.toAssign.map(({ indoorPlayerId: _i, ...p }) => p);
        }
      } catch (e) {
        entry.error = e.message;
        result.totals.failed++;
        log(`${w.teamName}: FAILED — ${e.message}`);
      }
      result.totals.assigned += entry.assigned.length;
      result.totals.pending += entry.licencePending.length;
      result.totals.already += entry.alreadyOnTeam.length;
      result.totals.noLicenceNr += entry.noLicenceNr.length;
      result.totals.extra += entry.extraOnVm.length;
      done++;
    }
    onProgress({ done, total: wanted.length, team: '' });
  } finally {
    try { rw?.ws?.close(); } catch { /* best effort */ }
  }
  result.finishedAt = new Date().toISOString();
  log(`done: ${result.totals.assigned} ${dryRun ? 'would be ' : ''}assigned, ${result.totals.pending} pending, `
    + `${result.totals.already} already on VM, ${result.totals.failed} team(s) failed`);
  return result;
}

// ─── CLI ─────────────────────────────────────────────────────────────
// node vm-team-players.mjs
//   VM_USERNAME / VM_PASSWORD            VolleyManager login
//   DRY_RUN=1                            (default when unset — pass DRY_RUN=0 to write)
//   ROSTER_FILE=/path/rows.json          flat rows (see buildWanted) — skips Directus
//   DIRECTUS_URL + DIRECTUS_TOKEN        or DIRECTUS_SYNC_EMAIL / DIRECTUS_SYNC_PASSWORD
//   TEAM_IDS=80,94                       restrict to these wiedisync team ids
//
// ⚠ Runs OUTSIDE the Directus process, so it cannot take `claimVmAccount`. Only
// run it by hand in a quiet window (INFRA.md → "The shared VolleyManager
// account"); the admin endpoint is the guarded path.
const IS_ENTRYPOINT = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

async function loadRowsFromDirectus() {
  const base = process.env.DIRECTUS_URL || 'http://127.0.0.1:8055';
  let token = process.env.DIRECTUS_TOKEN;
  if (!token) {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.DIRECTUS_SYNC_EMAIL, password: process.env.DIRECTUS_SYNC_PASSWORD }),
    });
    if (!r.ok) throw new Error(`Directus login failed: HTTP ${r.status}`);
    token = (await r.json())?.data?.access_token;
  }
  const get = async (path) => {
    const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`GET ${path} → HTTP ${r.status}`);
    return (await r.json())?.data ?? [];
  };
  const teams = await get('/items/teams?filter[sport][_eq]=volleyball&filter[active][_eq]=true&fields=id,name,team_id&limit=-1');
  const teamById = new Map(teams.map((t) => [Number(t.id), t]));
  const rows = await get('/items/member_teams?filter[guest_level][_eq]=0'
    + `&filter[team][_in]=${teams.map((t) => t.id).join(',')}`
    + '&fields=team,member.id,member.license_nr,member.first_name,member.last_name&limit=-1');
  return rows
    .filter((r) => r.member && teamById.has(Number(typeof r.team === 'object' ? r.team?.id : r.team)))
    .map((r) => {
      const t = teamById.get(Number(typeof r.team === 'object' ? r.team?.id : r.team));
      return { team_db_id: t.id, team_id: t.team_id, team_name: t.name, member_id: r.member.id,
        license_nr: r.member.license_nr, first_name: r.member.first_name, last_name: r.member.last_name };
    });
}

if (IS_ENTRYPOINT) {
  (async () => {
    const dryRun = process.env.DRY_RUN !== '0';
    const rows = process.env.ROSTER_FILE
      ? JSON.parse(readFileSync(process.env.ROSTER_FILE, 'utf8'))
      : await loadRowsFromDirectus();
    let wanted = buildWanted(rows);
    if (process.env.TEAM_IDS) {
      const keep = new Set(process.env.TEAM_IDS.split(',').map((s) => Number(s.trim())));
      wanted = wanted.filter((w) => keep.has(w.teamDbId));
    }
    console.log(`[vm-team-players] ${wanted.length} team(s), ${wanted.reduce((n, w) => n + w.players.length, 0)} roster player(s)${dryRun ? ' — DRY RUN' : ' — WRITING'}`);
    const result = await runTeamAssignment({
      username: process.env.VM_USERNAME, password: process.env.VM_PASSWORD,
      wanted, dryRun, log: (l) => console.log(`[vm-team-players] ${l}`),
    });
    if (process.env.RESULT_FILE) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.RESULT_FILE, JSON.stringify(result, null, 2));
    }
    process.exit(result.totals.failed ? 1 : 0);
  })().catch((e) => { console.error(`[vm-team-players] ERROR: ${e.message}`); process.exit(1); });
}
