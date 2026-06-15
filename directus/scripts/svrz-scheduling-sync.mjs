/**
 * SVRZ game-scheduling sync — bulk fetch of games + Spielplaner contacts
 * from volleymanager.volleyball.ch into Directus `svrz_games` and
 * `svrz_spielplaner_contacts` collections.
 *
 * See docs/superpowers/specs/2026-04-22-game-scheduling-per-verein-invites-design.md
 */

import { vmLogin, csrfFromPage, VM_BASE, UA } from './vm-client.mjs';

/**
 * Build the URL-encoded POST body for the SVRZ /search endpoint.
 * Supports text, boolean, and values[] property filters.
 */
export function buildSearchBody({ properties = [], propertyFilters = [], offset = 0, limit = 200, csrf }) {
  const p = new URLSearchParams();
  propertyFilters.forEach((f, i) => {
    p.set(`searchConfiguration[propertyFilters][${i}][propertyName]`, f.propertyName);
    if (f.text !== undefined) p.set(`searchConfiguration[propertyFilters][${i}][text]`, String(f.text));
    if (f.boolean !== undefined) p.set(`searchConfiguration[propertyFilters][${i}][boolean]`, String(f.boolean));
    if (Array.isArray(f.values)) {
      f.values.forEach((v, j) => p.set(`searchConfiguration[propertyFilters][${i}][values][${j}]`, String(v)));
    }
  });
  p.set('searchConfiguration[customFilters]', '');
  p.set('searchConfiguration[propertyOrderings]', '');
  p.set('searchConfiguration[offset]', String(offset));
  p.set('searchConfiguration[limit]', String(limit));
  p.set('searchConfiguration[textSearchOperator]', 'AND');
  properties.forEach((pr, i) => p.set(`propertyRenderConfiguration[${i}]`, pr));
  p.set('__csrfToken', csrf);
  return p.toString();
}

/**
 * Fetch all pages from an SVRZ /search endpoint. Iterates offset until
 * totalItemsCount is reached. `ctx` comes from csrfFromPage().
 */
export async function fetchAllPaged(jar, ctx, resourcePath, { properties = [], propertyFilters = [], referer, batchSize = 200, maxBatches = 100 } = {}) {
  const base = `${VM_BASE}${resourcePath}/search`;
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'text/plain;charset=UTF-8',
    Accept: '*/*',
    Origin: VM_BASE,
    Referer: `${VM_BASE}${referer}`,
    Cookie: jar.header(),
  };
  if (ctx.wuid) headers['Window-Unique-Id'] = ctx.wuid;
  const all = [];
  let total = Infinity, offset = 0, batches = 0;
  while (offset < total && batches < maxBatches) {
    const body = buildSearchBody({ properties, propertyFilters, offset, limit: batchSize, csrf: ctx.csrf });
    const r = await fetch(base, { method: 'POST', headers, body });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`${resourcePath}: HTTP ${r.status} — ${text.slice(0, 300)}`);
    }
    const j = await r.json();
    total = j.totalItemsCount ?? 0;
    const items = j.items ?? [];
    if (items.length === 0) break;
    all.push(...items);
    offset += items.length;
    batches += 1;
  }
  return { total, items: all };
}

/**
 * Curated property paths for the SVRZ games entity (api\game).
 * Verified against live dry-run on 2026-04-22; updated 2026-05-23 after SVRZ
 * renamed the resource api\gamewithresult → api\game and dropped isForfeitGame.
 */
export const GAME_PROPERTIES = [
  'number',
  'status',
  'displayName',
  'shortDisplayName',
  'startingDateTime',
  'playingWeekday',
  'encounter.teamHome.club.identifier',
  'encounter.teamHome.club.name',
  'encounter.teamHome.name',
  'encounter.teamHomeName',
  'encounter.teamAway.club.identifier',
  'encounter.teamAway.club.name',
  'encounter.teamAway.name',
  'encounter.teamAwayName',
  'encounter.teamHome.leagueCategory.name',
  'encounter.teamAway.leagueCategory.name',
  'group.phase.league.season.name',
  'group.phase.league.displayName',
  'group.phase.league.gender',
  'group.phase.name',
  'group.name',
];

// KSC Wiedikon's SVRZ club UUID (Persistence_Object_Identifier; numeric
// identifier 912530). Env-overridable for other deployments.
export const VM_CLUB_UUID = process.env.VM_CLUB_UUID || '956158d5-806f-4af9-8378-e7a9e19adeff';

const GAME_RESOURCE = '/api/sportmanager.indoorvolleyball/api%5cgame';

export async function fetchAllGames(jar, ctx) {
  // SVRZ renamed api\gamewithresult → api\game around 2026-05-20 (old path now
  // 403s) AND the new resource is the GLOBAL game list (~212k), whereas
  // gamewithresult was intrinsically scoped to our club. Replicate that scope
  // by filtering both sides of the encounter on KSCW's club UUID and merging
  // (a game counts if KSCW is home OR away — the search ANDs filters, so one
  // query per side). Verified live 2026-05-23: home=1492, union≈2970 = the
  // pre-break stored set. Confirmed via capture of the live UI request.
  const opts = { properties: GAME_PROPERTIES, referer: '/sportmanager.indoorvolleyball/game/index', batchSize: 200 };
  const home = await fetchAllPaged(jar, ctx, GAME_RESOURCE, {
    ...opts, propertyFilters: [{ propertyName: 'encounter.teamHome.club.Persistence_Object_Identifier', values: [VM_CLUB_UUID] }],
  });
  const away = await fetchAllPaged(jar, ctx, GAME_RESOURCE, {
    ...opts, propertyFilters: [{ propertyName: 'encounter.teamAway.club.Persistence_Object_Identifier', values: [VM_CLUB_UUID] }],
  });
  const byId = new Map();
  for (const g of [...home.items, ...away.items]) byId.set(g.__identity ?? g.persistenceObjectIdentifier, g);
  const items = [...byId.values()];
  return { total: items.length, items };
}

/**
 * Curated property paths for the SVRZ Spielplaner contacts entity
 * (api\playingscheduleresponsibleaddressviewer). Requires a season filter
 * at fetch time or the endpoint 500s.
 * Verified against live dry-run on 2026-04-22.
 */
export const CONTACT_PROPERTIES = [
  'person.lastName',
  'person.firstName',
  'person.primaryEmailAddress.emailAddress',
  'person.primaryPhoneNumber.normalizedLocalNumber',
  'club.identifier',
  'club.name',
  'club.teams.*.leagueCategory.name',
  'club.teams.*.leagueCategory.displayNameWithManagingAssociationShortName',
  'club.teams.*.gender',
  'club.teams.*.leagueCategory.sorting',
];

/**
 * Fetch all Spielplaner contacts for a given SVRZ season.
 * `seasonUuid` is the `Persistence_Object_Identifier` of the season (per SVRZ).
 */
export async function fetchAllContacts(jar, ctx, seasonUuid) {
  return fetchAllPaged(jar, ctx, '/api/sportmanager.indoorvolleyball/api%5cplayingscheduleresponsibleaddressviewer', {
    properties: CONTACT_PROPERTIES,
    propertyFilters: [{ propertyName: 'club.teams.season.Persistence_Object_Identifier', values: [seasonUuid] }],
    referer: '/sportmanager.indoorvolleyball/playingscheduleresponsibleaddressviewer/index',
    batchSize: 200,
  });
}

/**
 * Map a contact record to the flat row shape for Directus.
 * Dedupes + sorts `club_league_categories` and `club_team_genders`.
 */
export function contactToSvrzRow(c, seasonUuid, seasonName = '') {
  const club = c.club || {};
  const person = c.person || {};
  const teams = club.teams || [];
  return {
    svrz_persistence_id: c.__identity,
    season_uuid: seasonUuid,
    season_name: seasonName,
    club_id: club.identifier == null ? '' : String(club.identifier),
    club_name: club.name || '',
    person_first_name: person.firstName || '',
    person_last_name: person.lastName || '',
    contact_name: `${person.firstName || ''} ${person.lastName || ''}`.trim(),
    contact_email: (person.primaryEmailAddress?.emailAddress || '').toLowerCase().trim(),
    contact_phone: person.primaryPhoneNumber?.normalizedLocalNumber || '',
    club_league_categories: [...new Set(teams.map(t => t.leagueCategory?.name).filter(Boolean))].sort(),
    club_team_genders: [...new Set(teams.map(t => t.gender).filter(Boolean))].sort(),
    raw: c,
  };
}

// KSCW's numeric club identifier (the `identifier` on svrz_games rows, NOT the
// UUID). Used to tell our side from the opponent's.
export const KSCW_CLUB_NUMERIC = process.env.KSCW_SVRZ_CLUB_ID || '912530';

/**
 * Per-game contact info (live). The /search bulk feed only exposes
 * Spielplanverantwortliche; this per-game endpoint additionally exposes the
 * "Teamverantwortlicher", which we use as a fallback for clubs that never
 * registered a Spielplan contact. Returns { teamHome:[...], teamAway:[...] }
 * or null. Needs the game-module session context (gamesCtx).
 */
export async function fetchGameContacts(jar, ctx, gameUuid) {
  const url = `${VM_BASE}/api/sportmanager.indoorvolleyball/api%5cgame/getTeamContactInfosByGame?game=${gameUuid}`;
  const headers = {
    'User-Agent': UA, Accept: '*/*', Cookie: jar.header(),
    Referer: `${VM_BASE}/sportmanager.indoorvolleyball/game/index`,
  };
  if (ctx?.wuid) headers['Window-Unique-Id'] = ctx.wuid;
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * staticTeamIdentifier on a side ('home'|'away') of an svrz game row, read from
 * the stored raw payload (the original VM game object). null if absent.
 */
function rawSideStaticId(rawGame, side) {
  let raw = rawGame;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
  const enc = raw && raw.encounter;
  const team = enc && (side === 'home' ? enc.teamHome : enc.teamAway);
  const v = team && team.staticTeamIdentifier;
  return v == null ? null : Number(v);
}

/**
 * Harvest the "Teamverantwortlicher" (team responsible) for EVERY KSCW opponent
 * team from the live per-game contact feed, returning rows shaped like
 * svrz_spielplaner_contacts. Unlike the bulk Spielplanverantwortliche (club-level
 * calendar responsibles) these are per TEAM, so they are keyed by the opponent
 * team's staticTeamIdentifier (synthetic persistence id `tr:t<staticId>:<email>`,
 * and `team_identifier` set to that id). When a game's raw lacks the id we fall
 * back to club scope (`tr:c<clubId>:<email>`, `team_identifier` NULL = club-wide).
 * One game per opponent team is enough (the responsible is the same across that
 * team's fixtures). These are MERGED downstream with the calendar responsibles —
 * NOT used as an either/or fallback. Best-effort: a game whose contacts can't be
 * fetched just yields nothing for that team.
 */
export async function fetchTeamResponsibles(jar, ctx, { gameRows = [], seasonUuid, seasonName = '', getContacts = fetchGameContacts } = {}) {
  // One game per distinct opponent TEAM (prefer the stable staticTeamIdentifier;
  // fall back to club+name when raw lacks it).
  const oppTeamGame = new Map(); // teamKey -> { gameUuid, isHomeKscw, clubId, clubName, staticId }
  for (const g of gameRows) {
    if (g.status !== 'open' && g.status !== 'waitingForApproval') continue;
    const isHomeKscw = String(g.home_club_id || '') === KSCW_CLUB_NUMERIC;
    const clubId = isHomeKscw ? String(g.away_club_id || '') : String(g.home_club_id || '');
    if (!clubId || clubId === KSCW_CLUB_NUMERIC) continue;
    const teamName = isHomeKscw ? (g.away_team_name || '') : (g.home_team_name || '');
    const staticId = rawSideStaticId(g.raw, isHomeKscw ? 'away' : 'home');
    const teamKey = staticId != null ? `t${staticId}` : `c${clubId}:${teamName}`;
    if (oppTeamGame.has(teamKey)) continue;
    oppTeamGame.set(teamKey, {
      gameUuid: g.svrz_persistence_id, isHomeKscw, clubId,
      clubName: isHomeKscw ? g.away_club_name : g.home_club_name, staticId,
    });
  }
  const rows = [];
  for (const [, info] of oppTeamGame) {
    const resp = await getContacts(jar, ctx, info.gameUuid);
    if (!resp) continue;
    const pool = info.isHomeKscw ? (resp.teamAway || []) : (resp.teamHome || []);
    const idKey = info.staticId != null ? `t${info.staticId}` : `c${info.clubId}`;
    for (const c of pool) {
      if (!/spielplan|teamverantwort/i.test(c.addressOrganisationMemberFunctionTitle || '')) continue;
      const email = (c.primaryEmailAddress || '').toLowerCase().trim();
      if (!email) continue;
      rows.push({
        svrz_persistence_id: `tr:${idKey}:${email}`,
        season_uuid: seasonUuid, season_name: seasonName,
        club_id: String(info.clubId), club_name: info.clubName || '',
        team_identifier: info.staticId != null ? String(info.staticId) : null,
        person_first_name: c.firstName || '', person_last_name: c.lastName || '',
        contact_name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        contact_email: email, contact_phone: c.primaryPhoneNumber || '',
        club_league_categories: [], club_team_genders: [],
        raw: { source: 'team_responsible', title: c.addressOrganisationMemberFunctionTitle || '' },
      });
    }
  }
  return rows;
}

/**
 * Filter games down to those that are schedulable — i.e. status is "open" or
 * "waitingForApproval", AND either has no start date yet or starts on/after cutoff.
 */
export function filterSchedulableGames(games, { cutoffDate = new Date('1970-01-01') } = {}) {
  return games.filter(g => {
    if (!['open', 'waitingForApproval'].includes(g.status)) return false;
    const d = g.startingDateTime ? new Date(g.startingDateTime) : null;
    return d === null || d >= cutoffDate;
  });
}

// ─── Directus integration ──────────────────────────────────────────────

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus-dev.kscw.ch';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

async function directusFetch(pathQ, init = {}) {
  if (!DIRECTUS_TOKEN) throw new Error('DIRECTUS_TOKEN env var required');
  const r = await fetch(`${DIRECTUS_URL}${pathQ}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Directus ${pathQ}: HTTP ${r.status} — ${text.slice(0, 300)}`);
  }
  return r.status === 204 ? null : r.json();
}

async function fetchExistingPersistenceIds(collection) {
  const existing = new Map();
  for (let page = 1; ; page++) {
    const resp = await directusFetch(`/items/${collection}?fields=id,svrz_persistence_id&limit=200&page=${page}`);
    const data = resp?.data || [];
    if (data.length === 0) break;
    for (const r of data) existing.set(r.svrz_persistence_id, r.id);
    if (data.length < 200) break;
  }
  return existing;
}

/**
 * Pure planning: given the currently-known persistence→directus-id map and a
 * list of incoming rows, produce (toCreate, toUpdate, seenIds).
 * Adds last_synced_at to every planned row. Update rows carry __existing_id
 * so the executor knows which PATCH URL to hit.
 */
export function planUpsert(existingMap, rows) {
  const now = new Date().toISOString();
  const toCreate = [], toUpdate = [];
  const seenIds = new Set();
  for (const row of rows) {
    seenIds.add(row.svrz_persistence_id);
    const id = existingMap.get(row.svrz_persistence_id);
    if (id) toUpdate.push({ __existing_id: id, ...row, last_synced_at: now });
    else toCreate.push({ ...row, last_synced_at: now });
  }
  return { toCreate, toUpdate, seenIds };
}

export async function upsertByPersistenceId(collection, rows) {
  const existing = await fetchExistingPersistenceIds(collection);
  const { toCreate, toUpdate, seenIds } = planUpsert(existing, rows);

  // Batch creates in chunks of 10 — games carry a full `raw` JSON blob (~5 KB each),
  // so a batch of 50 was hitting Directus's request-entity-too-large limit.
  for (let i = 0; i < toCreate.length; i += 10) {
    await directusFetch(`/items/${collection}`, { method: 'POST', body: JSON.stringify(toCreate.slice(i, i + 10)) });
  }
  // Updates must go one-by-one (Directus PATCH /items/<coll>/<id>)
  for (const row of toUpdate) {
    const { __existing_id, ...patch } = row;
    await directusFetch(`/items/${collection}/${__existing_id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  return { created: toCreate.length, updated: toUpdate.length, seen_count: seenIds.size };
}

/**
 * Prune svrz_games rows VM no longer lists. When VM renumbers a fixture it gets a
 * fresh persistence id, so the old row is never matched on upsert and lingers as a
 * stale duplicate (same matchup+datetime, old last_synced_at) — which then shows up
 * twice in the fixture picker. This removes those orphans, but ONLY within the
 * season(s) THIS run actually covered, and ONLY when a sane fraction is affected, so
 * a partial/failed scrape can never wipe the live schedule. Genuine multi-round
 * duplicates (HU/DU teams play an opponent 2-3×) are all present in VM → "seen" →
 * never pruned.
 */
export async function pruneOrphanedGames(gameRows) {
  const seenIds = new Set(gameRows.map((r) => r.svrz_persistence_id).filter(Boolean));
  const seasonNames = [...new Set(gameRows.map((r) => r.season_name).filter(Boolean))];
  if (seenIds.size === 0 || seasonNames.length === 0) return { pruned: 0, skipped: 'nothing_seen' };

  const orphanIds = [];
  let inScope = 0;
  for (let page = 1; ; page++) {
    const filter = encodeURIComponent(JSON.stringify({ season_name: { _in: seasonNames } }));
    const resp = await directusFetch(`/items/svrz_games?fields=id,svrz_persistence_id&filter=${filter}&limit=200&page=${page}`);
    const data = resp?.data || [];
    if (data.length === 0) break;
    for (const r of data) { inScope++; if (!seenIds.has(r.svrz_persistence_id)) orphanIds.push(r.id); }
    if (data.length < 200) break;
  }
  // Safety: never delete a large slice (>25%) — that signals a scope/fetch mismatch,
  // not genuine orphans (renumbered duplicates are always a handful). Log + skip.
  if (inScope > 0 && orphanIds.length / inScope > 0.25) {
    console.warn(`[svrz-sync]   prune: REFUSED — ${orphanIds.length}/${inScope} (>25%) flagged; skipping for safety`);
    return { pruned: 0, skipped: 'over_threshold', candidates: orphanIds.length, in_scope: inScope };
  }
  for (let i = 0; i < orphanIds.length; i += 50) {
    await directusFetch('/items/svrz_games', { method: 'DELETE', body: JSON.stringify(orphanIds.slice(i, i + 50)) });
  }
  if (orphanIds.length) console.log(`[svrz-sync]   prune: removed ${orphanIds.length} orphaned game(s) in season(s) [${seasonNames.join(', ')}]`);
  return { pruned: orphanIds.length, in_scope: inScope };
}

// ─── Main ──────────────────────────────────────────────────────────────

/**
 * Run a full bulk sync for the given season.
 * Fetches games (all statuses, filter happens later in the preview endpoint
 * that calls this — we store everything so admins can debug "why didn't X show up").
 * Fetches Spielplaner contacts filtered to the season.
 */
export async function runSync({ seasonUuid, seasonName = '' }, io = {}) {
  // IO seam — defaults to the real network/DB functions; tests inject fakes.
  const {
    login = vmLogin,
    csrf = csrfFromPage,
    getGames = fetchAllGames,
    getContacts = fetchAllContacts,
    getGameContacts = fetchGameContacts,
    upsert = upsertByPersistenceId,
    prune = pruneOrphanedGames,
  } = io;

  const username = process.env.VM_USERNAME;
  const password = process.env.VM_PASSWORD;
  if (!username || !password) throw new Error('VM_USERNAME/VM_PASSWORD env vars required');

  console.log('[svrz-sync] Logging into volleymanager...');
  const jar = await login({ username, password });

  // Games first — the primary dataset (schedules + results powering the
  // website + app). If games fail the run legitimately failed, so let it throw.
  console.log('[svrz-sync] Fetching games...');
  const gamesCtx = await csrf(jar, '/sportmanager.indoorvolleyball/game/index');
  const games = await getGames(jar, gamesCtx);
  const gameRows = games.items.map(gameToSvrzRow);
  console.log(`[svrz-sync]   → ${gameRows.length}/${games.total} games`);
  const gamesResult = await upsert('svrz_games', gameRows);
  console.log(`[svrz-sync]   games upsert: created=${gamesResult.created} updated=${gamesResult.updated}`);

  // Remove fixtures VM no longer lists (renumbered/cancelled) — ONLY on a
  // COMPLETE fetch, so a partial scrape never deletes live schedule rows.
  let pruneResult = { pruned: 0, skipped: 'incomplete_fetch' };
  if (gameRows.length > 0 && gameRows.length === games.total) {
    pruneResult = await prune(gameRows);
    if (pruneResult.skipped) console.warn(`[svrz-sync]   prune: ${pruneResult.skipped}`);
  } else {
    console.warn(`[svrz-sync]   prune: skipped — incomplete fetch (${gameRows.length}/${games.total})`);
  }

  // Contacts second — an independent dataset (Spielplaner responsible
  // addresses). The /search endpoint requires the session to have *entered*
  // the contacts module: Neos Flow sets the current package/controller scope
  // server-side when its index page is GETed. The session-wide CSRF (same
  // token across the whole session, incl. gamesCtx) is necessary but NOT
  // sufficient — without this page GET, /search 403s. So fetch the contacts
  // index page here, exactly like the games path does for game/index.
  // Verified 2026-05-24 via live browser capture: the game/index CSRF works
  // on contacts /search ONLY once the contacts index page has been loaded.
  // (Reverts the 2026-05-23 shortcut that reused gamesCtx and skipped the GET,
  // which left /search unscoped → 403.)
  // Still wrapped in try/catch so any future contacts breakage stays isolated
  // and never blocks the games sync.
  let contactsResult;
  let contactRows = [];
  try {
    console.log('[svrz-sync] Fetching contacts...');
    const contactsCtx = await csrf(jar, '/sportmanager.indoorvolleyball/playingscheduleresponsibleaddressviewer/index');
    const contacts = await getContacts(jar, contactsCtx, seasonUuid);
    contactRows = contacts.items.map(c => contactToSvrzRow(c, seasonUuid, seasonName));
    console.log(`[svrz-sync]   → ${contactRows.length}/${contacts.total} contacts`);
    const upserted = await upsert('svrz_spielplaner_contacts', contactRows);
    console.log(`[svrz-sync]   contacts upsert: created=${upserted.created} updated=${upserted.updated}`);
    contactsResult = { ...upserted, total_fetched: contacts.items.length };
  } catch (err) {
    console.warn(`[svrz-sync] ⚠ contacts sync skipped (games sync unaffected): ${err.message}`);
    contactsResult = { skipped: true, error: err.message, created: 0, updated: 0, total_fetched: 0 };
  }

  // Third pass — the per-team "Teamverantwortlicher" for EVERY opponent team,
  // merged downstream with the bulk Spielplanverantwortliche (calendar + team
  // responsibles, not an either/or fallback). One live per-game contact call per
  // opponent team. Isolated so any breakage never blocks games/contacts.
  let teamResponsibleResult = { created: 0, updated: 0, total_fetched: 0 };
  try {
    console.log('[svrz-sync] Team responsibles (per opponent team)...');
    const trRows = await fetchTeamResponsibles(jar, gamesCtx, { gameRows, seasonUuid, seasonName, getContacts: getGameContacts });
    if (trRows.length) {
      const up = await upsert('svrz_spielplaner_contacts', trRows);
      console.log(`[svrz-sync]   team responsibles: ${trRows.length} found, created=${up.created} updated=${up.updated}`);
      teamResponsibleResult = { ...up, total_fetched: trRows.length };
    } else {
      console.log('[svrz-sync]   team responsibles: none found');
    }
  } catch (err) {
    console.warn(`[svrz-sync] ⚠ team responsibles skipped: ${err.message}`);
    teamResponsibleResult = { skipped: true, error: err.message, created: 0, updated: 0, total_fetched: 0 };
  }

  return {
    games: { ...gamesResult, total_fetched: games.items.length },
    prune: pruneResult,
    contacts: contactsResult,
    teamResponsibles: teamResponsibleResult,
  };
}

// ─── CLI ───────────────────────────────────────────────────────────────

// Only run if invoked directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  const seasonUuid = process.env.SVRZ_SEASON_UUID || 'dcafddfe-8139-4e02-baad-d3f88ec00cd0';
  const seasonName = process.env.SVRZ_SEASON_NAME || '2025/2026';
  runSync({ seasonUuid, seasonName })
    .then(r => { console.log('\n=== Result ==='); console.log(JSON.stringify(r, null, 2)); })
    .catch(e => { console.error('[svrz-sync] FAILED:', e.message); console.error(e.stack); process.exit(1); });
}

/**
 * Map a SVRZ game JSON record to a flat row for the `svrz_games` Directus collection.
 * Club identifiers are stringified to preserve any leading zeros SVRZ may use.
 */
export function gameToSvrzRow(g) {
  const enc = g.encounter || {};
  const home = enc.teamHome || {};
  const away = enc.teamAway || {};
  const homeClub = home.club || {};
  const awayClub = away.club || {};
  const league = g.group?.phase?.league || {};
  return {
    // api\game returns identity as __identity (same UUID the old
    // api\gamewithresult exposed as persistenceObjectIdentifier), so the
    // fallback keeps existing rows deduping correctly across the rename.
    svrz_persistence_id: g.persistenceObjectIdentifier ?? g.__identity,
    svrz_number: g.number,
    status: g.status,
    display_name: g.displayName,
    short_display_name: g.shortDisplayName,
    starting_date_time: g.startingDateTime,
    playing_weekday: g.playingWeekday,
    home_club_id: homeClub.identifier == null ? '' : String(homeClub.identifier),
    home_club_name: homeClub.name || '',
    home_team_name: home.name || enc.teamHomeName || '',
    away_club_id: awayClub.identifier == null ? '' : String(awayClub.identifier),
    away_club_name: awayClub.name || '',
    away_team_name: away.name || enc.teamAwayName || '',
    league_name: league.displayName || '',
    league_short: home.leagueCategory?.name || away.leagueCategory?.name || '',
    gender: league.gender || '',
    season_name: league.season?.name || '',
    raw: g,
  };
}
