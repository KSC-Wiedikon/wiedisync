import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterSchedulableGames, gameToSvrzRow } from '../svrz-scheduling-sync.mjs';
import { buildSearchBody, GAME_PROPERTIES } from '../svrz-scheduling-sync.mjs';
import { contactToSvrzRow, CONTACT_PROPERTIES } from '../svrz-scheduling-sync.mjs';
const contactsFixture = JSON.parse(readFileSync(new URL('./fixtures/contacts-sample.json', import.meta.url)));

const fixture = JSON.parse(readFileSync(new URL('./fixtures/games-sample.json', import.meta.url)));

test('filterSchedulableGames keeps open + waitingForApproval, drops approved', () => {
  const out = filterSchedulableGames(fixture, { cutoffDate: new Date('1970-01-01') });
  assert.ok(out.length > 0, 'fixture should contain at least one schedulable game');
  assert.ok(out.every(g => ['open', 'waitingForApproval'].includes(g.status)));
});

test('filterSchedulableGames with future cutoff keeps null-date rows, drops dated rows', () => {
  const cutoff = new Date('2200-01-01');
  const out = filterSchedulableGames(fixture, { cutoffDate: cutoff });
  // Must have at least one surviving row — the null-date one
  assert.ok(out.length > 0, 'null-startingDateTime row should survive future cutoff');
  // Every survivor: status is schedulable AND (startingDateTime is null OR >= cutoff)
  out.forEach(g => {
    assert.ok(['open', 'waitingForApproval'].includes(g.status));
    if (g.startingDateTime !== null) {
      assert.ok(new Date(g.startingDateTime) >= cutoff, `game ${g.number} survived but starts ${g.startingDateTime} which is before cutoff`);
    }
  });
  // At least one of the survivors had a null startingDateTime — proves the null branch worked
  assert.ok(out.some(g => g.startingDateTime === null), 'expected at least one null-date survivor to prove null-path coverage');
});

test('gameToSvrzRow extracts all fields, club identifier as string', () => {
  const game = fixture[0];
  const row = gameToSvrzRow(game);
  assert.equal(row.svrz_persistence_id, game.persistenceObjectIdentifier);
  assert.equal(row.svrz_number, game.number);
  assert.equal(row.status, game.status);
  assert.equal(row.display_name, game.displayName);
  assert.equal(row.starting_date_time, game.startingDateTime);
  assert.equal(typeof row.home_club_id, 'string', 'home_club_id must be string (preserves leading zeros if SVRZ used them)');
  assert.equal(row.home_club_id, String(game.encounter.teamHome.club.identifier));
  assert.equal(row.home_club_name, game.encounter.teamHome.club.name);
  assert.equal(row.home_team_name, game.encounter.teamHome.name);
  assert.equal(row.away_club_id, String(game.encounter.teamAway.club.identifier));
  assert.equal(row.league_short, game.encounter.teamHome.leagueCategory.name);
  assert.equal(row.gender, game.group.phase.league.gender);
  assert.equal(row.season_name, game.group.phase.league.season.name);
  // raw should contain the full original game
  assert.equal(row.raw.number, game.number);
  // Full key set — catches schema drift
  const EXPECTED_KEYS = [
    'svrz_persistence_id', 'svrz_number', 'status',
    'display_name', 'short_display_name', 'starting_date_time', 'playing_weekday',
    'home_club_id', 'home_club_name', 'home_team_name',
    'away_club_id', 'away_club_name', 'away_team_name',
    'league_name', 'league_short', 'gender', 'season_name', 'raw',
  ];
  assert.deepEqual(Object.keys(row).sort(), [...EXPECTED_KEYS].sort(), 'row must have exactly the 18 expected keys');
});

test('gameToSvrzRow falls back to __identity when persistenceObjectIdentifier absent (new api\\game shape)', () => {
  // The renamed api\game model exposes identity as __identity (no
  // persistenceObjectIdentifier). Same UUID — must still key the upsert.
  const g = { __identity: 'uuid-from-new-endpoint', number: 5, status: 'open' };
  const row = gameToSvrzRow(g);
  assert.equal(row.svrz_persistence_id, 'uuid-from-new-endpoint');
});

test('GAME_PROPERTIES excludes isForfeitGame (removed from the renamed api\\game model)', () => {
  assert.ok(!GAME_PROPERTIES.includes('isForfeitGame'),
    'isForfeitGame no longer exists on the new Game model and 500s the search');
});

test('gameToSvrzRow tolerates missing encounter/club fields gracefully', () => {
  const empty = { persistenceObjectIdentifier: 'x', number: 0, status: 'open' };
  const row = gameToSvrzRow(empty);
  assert.equal(row.home_club_id, '');
  assert.equal(row.home_club_name, '');
  assert.equal(row.league_short, '');
});

test('buildSearchBody encodes properties + propertyFilters (values array) + csrf', () => {
  const body = buildSearchBody({
    properties: ['number', 'status'],
    propertyFilters: [{ propertyName: 'team.season.Persistence_Object_Identifier', values: ['uuid-1', 'uuid-2'] }],
    offset: 0, limit: 100, csrf: 'csrf-x',
  });
  assert.match(body, /propertyRenderConfiguration(?:%5B|\[)0(?:%5D|\])=number/);
  assert.match(body, /propertyRenderConfiguration(?:%5B|\[)1(?:%5D|\])=status/);
  assert.match(body, /propertyFilters(?:%5D|\])(?:%5B|\[)0(?:%5D|\])(?:%5B|\[)propertyName(?:%5D|\])=team\.season\.Persistence_Object_Identifier/);
  assert.match(body, /values(?:%5D|\])(?:%5B|\[)0(?:%5D|\])=uuid-1/);
  assert.match(body, /values(?:%5D|\])(?:%5B|\[)1(?:%5D|\])=uuid-2/);
  assert.match(body, /offset(?:%5D|\])=0/);
  assert.match(body, /limit(?:%5D|\])=100/);
  assert.match(body, /textSearchOperator(?:%5D|\])=AND/);
  assert.match(body, /__csrfToken=csrf-x/);
});

test('buildSearchBody encodes text + boolean filter variants', () => {
  const body = buildSearchBody({
    properties: ['x'],
    propertyFilters: [
      { propertyName: 'person.deceased', boolean: false },
      { propertyName: 'club.name', text: 'Wiedikon' },
    ],
    offset: 0, limit: 50, csrf: 'c',
  });
  assert.match(body, /boolean(?:%5D|\])=false/);
  assert.match(body, /text(?:%5D|\])=Wiedikon/);
});

test('GAME_PROPERTIES is a non-empty array including encounter club ids + status', () => {
  assert.ok(Array.isArray(GAME_PROPERTIES));
  assert.ok(GAME_PROPERTIES.length > 10);
  assert.ok(GAME_PROPERTIES.includes('encounter.teamHome.club.identifier'));
  assert.ok(GAME_PROPERTIES.includes('encounter.teamAway.club.identifier'));
  assert.ok(GAME_PROPERTIES.includes('status'));
  assert.ok(GAME_PROPERTIES.includes('number'));
  assert.ok(GAME_PROPERTIES.includes('startingDateTime'));
});

test('CONTACT_PROPERTIES includes club.identifier, person email, and teams leagueCategory wildcard', () => {
  assert.ok(Array.isArray(CONTACT_PROPERTIES));
  assert.ok(CONTACT_PROPERTIES.includes('club.identifier'));
  assert.ok(CONTACT_PROPERTIES.includes('club.name'));
  assert.ok(CONTACT_PROPERTIES.includes('person.primaryEmailAddress.emailAddress'));
  assert.ok(CONTACT_PROPERTIES.some(p => p.includes('club.teams.*.leagueCategory.name')));
  assert.ok(CONTACT_PROPERTIES.some(p => p.includes('club.teams.*.gender')));
});

test('contactToSvrzRow maps person + club + dedups/sorts league categories', () => {
  const c = contactsFixture[0];
  const row = contactToSvrzRow(c, 'dcafddfe-8139-4e02-baad-d3f88ec00cd0', '2025/2026');
  assert.equal(row.svrz_persistence_id, c.__identity);
  assert.equal(row.season_uuid, 'dcafddfe-8139-4e02-baad-d3f88ec00cd0');
  assert.equal(row.season_name, '2025/2026');
  assert.equal(row.club_id, String(c.club.identifier));
  assert.equal(row.club_name, c.club.name);
  assert.equal(row.person_first_name, c.person.firstName);
  assert.equal(row.person_last_name, c.person.lastName);
  assert.equal(row.contact_name, `${c.person.firstName} ${c.person.lastName}`);
  assert.equal(row.contact_email, c.person.primaryEmailAddress.emailAddress.toLowerCase());
  assert.equal(row.contact_phone, c.person.primaryPhoneNumber.normalizedLocalNumber);
  assert.ok(Array.isArray(row.club_league_categories));
  // Must be deduped + sorted
  assert.deepEqual(row.club_league_categories, [...new Set(row.club_league_categories)].sort());
  assert.ok(Array.isArray(row.club_team_genders));
});

test('contactToSvrzRow lowercases email and trims whitespace', () => {
  const c = { __identity: 'x', club: { identifier: '1', name: 'X', teams: [] }, person: { firstName: 'A', lastName: 'B', primaryEmailAddress: { emailAddress: '  Jane.DOE@Example.CH  ' } } };
  const row = contactToSvrzRow(c, 'uuid', 'name');
  assert.equal(row.contact_email, 'jane.doe@example.ch');
});

test('contactToSvrzRow handles missing person.primaryPhoneNumber / primaryEmailAddress gracefully', () => {
  const c = { __identity: 'y', club: { identifier: '2', name: 'Y', teams: [] }, person: { firstName: 'A', lastName: 'B' } };
  const row = contactToSvrzRow(c, 'uuid', 'name');
  assert.equal(row.contact_email, '');
  assert.equal(row.contact_phone, '');
});

import { runSync } from '../svrz-scheduling-sync.mjs';
import { VM_ROLE_CLUB, VM_ROLE_SPIELPLANER } from '../vm-client.mjs';

test('runSync GETs the contacts viewer index (module scope) before the contacts /search', async () => {
  process.env.VM_USERNAME = 'u'; process.env.VM_PASSWORD = 'p';
  const csrfPaths = [];
  const io = {
    login: async () => ({}),
    useRole: async () => true,
    csrf: async (_jar, path) => { csrfPaths.push(path); return { csrf: 'c', wuid: 'w' }; },
    getGames: async () => ({ items: [{ __identity: 'g1', number: 1, status: 'open' }], total: 1 }),
    getContacts: async () => ({ items: [{ __identity: 'c1', club: { identifier: '1', name: 'X', teams: [] }, person: { firstName: 'A', lastName: 'B' } }], total: 1 }),
    upsert: async (_c, rows) => ({ created: rows.length, updated: 0, seen_count: rows.length }),
  };
  const result = await runSync({ seasonUuid: 'uuid', seasonName: '2025/2026' }, io);
  // Must GET game/index (games scope + session CSRF) AND the contacts viewer
  // index. The latter establishes the contacts-module scope server-side; the
  // 2026-05-23 build dropped it, which made /search 403 (session CSRF is valid
  // but the module was never entered). Order: games first, contacts second.
  assert.deepEqual(csrfPaths, [
    '/sportmanager.indoorvolleyball/game/index',
    '/sportmanager.indoorvolleyball/playingscheduleresponsibleaddressviewer/index',
  ]);
  assert.equal(result.games.created, 1);
  assert.equal(result.contacts.created, 1);
});

test('runSync claims the Spielplaner role for contacts, then restores the club role', async () => {
  process.env.VM_USERNAME = 'u'; process.env.VM_PASSWORD = 'p';
  // The account is shared with svrz_rc and VM keeps ONE active role per
  // account, so the contacts step must claim its own role and hand the session
  // back. Under the club role the address viewer answers 200 with zero rows —
  // it never 403s — so a lost switch here is silent.
  const roles = [];
  const io = {
    login: async () => ({}),
    useRole: async (_jar, role) => { roles.push(role); return true; },
    csrf: async () => ({ csrf: 'c', wuid: 'w' }),
    getGames: async () => ({ items: [{ __identity: 'g1', number: 1, status: 'open' }], total: 1 }),
    getContacts: async () => ({ items: [{ __identity: 'c1', club: { identifier: '1', name: 'X', teams: [] }, person: { firstName: 'A', lastName: 'B' } }], total: 1 }),
    upsert: async (_c, rows) => ({ created: rows.length, updated: 0, seen_count: rows.length }),
  };
  await runSync({ seasonUuid: 'uuid', seasonName: '2025/2026' }, io);
  assert.deepEqual(roles, [VM_ROLE_SPIELPLANER, VM_ROLE_CLUB]);
});

test('runSync restores the club role even when the contacts step throws', async () => {
  process.env.VM_USERNAME = 'u'; process.env.VM_PASSWORD = 'p';
  const roles = [];
  const io = {
    login: async () => ({}),
    useRole: async (_jar, role) => { roles.push(role); return true; },
    csrf: async (_jar, path) => {
      if (path.includes('playingscheduleresponsibleaddressviewer')) throw new Error('HTTP 403');
      return { csrf: 'c', wuid: 'w' };
    },
    getGames: async () => ({ items: [{ __identity: 'g1', number: 1, status: 'open' }], total: 1 }),
    getContacts: async () => { throw new Error('unreachable'); },
    upsert: async (_c, rows) => ({ created: rows.length, updated: 0, seen_count: rows.length }),
  };
  await runSync({ seasonUuid: 'uuid', seasonName: '2025/2026' }, io);
  // Leaving the session on the Spielplaner role would 403 the per-team
  // responsible pass that runs straight after.
  assert.deepEqual(roles, [VM_ROLE_SPIELPLANER, VM_ROLE_CLUB]);
});

test('runSync still syncs games when the contacts-page GET itself 403s (decoupled)', async () => {
  process.env.VM_USERNAME = 'u'; process.env.VM_PASSWORD = 'p';
  const upserted = [];
  const io = {
    login: async () => ({}),
    useRole: async () => true,
    // game/index CSRF succeeds; the contacts index GET throws (e.g. 403).
    csrf: async (_jar, path) => {
      if (path.includes('playingscheduleresponsibleaddressviewer')) throw new Error('csrfFromPage contacts → HTTP 403');
      return { csrf: 'c', wuid: 'w' };
    },
    getGames: async () => ({ items: [{ __identity: 'g1', number: 1, status: 'open' }], total: 1 }),
    getContacts: async () => { throw new Error('should not reach getContacts when the page GET fails'); },
    upsert: async (collection, rows) => { upserted.push(collection); return { created: rows.length, updated: 0, seen_count: rows.length }; },
  };
  const result = await runSync({ seasonUuid: 'uuid', seasonName: '2025/2026' }, io);
  assert.equal(result.games.created, 1, 'games must still upsert despite a contacts-page GET failure');
  assert.ok(upserted.includes('svrz_games'));
  assert.ok(!upserted.includes('svrz_spielplaner_contacts'));
  assert.equal(result.contacts.skipped, true);
  assert.match(result.contacts.error, /403/);
});

test('runSync still syncs games when the contacts fetch fails (decoupled)', async () => {
  process.env.VM_USERNAME = 'u'; process.env.VM_PASSWORD = 'p';
  const upserted = [];
  const io = {
    login: async () => ({}),
    useRole: async () => true,
    csrf: async () => ({ csrf: 'c', wuid: 'w' }),
    getGames: async () => ({ items: [{ __identity: 'g1', number: 1, status: 'open' }], total: 1 }),
    getContacts: async () => { throw new Error('contacts endpoint HTTP 403'); },
    upsert: async (collection, rows) => { upserted.push(collection); return { created: rows.length, updated: 0, seen_count: rows.length }; },
  };
  const result = await runSync({ seasonUuid: 'uuid', seasonName: '2025/2026' }, io);
  assert.equal(result.games.created, 1, 'games must still upsert despite a contacts failure');
  assert.ok(upserted.includes('svrz_games'));
  assert.ok(!upserted.includes('svrz_spielplaner_contacts'), 'contacts must not upsert when its fetch fails');
  assert.equal(result.contacts.skipped, true);
  assert.match(result.contacts.error, /403/);
});

test('runSync syncs both games and contacts when both pages are reachable', async () => {
  process.env.VM_USERNAME = 'u'; process.env.VM_PASSWORD = 'p';
  const io = {
    login: async () => ({}),
    useRole: async () => true,
    csrf: async () => ({ csrf: 'c', wuid: 'w' }),
    getGames: async () => ({ items: [{ persistenceObjectIdentifier: 'g1' }], total: 1 }),
    getContacts: async () => ({ items: [{ __identity: 'c1', club: { identifier: '1', name: 'X', teams: [] }, person: { firstName: 'A', lastName: 'B' } }], total: 1 }),
    upsert: async (_c, rows) => ({ created: rows.length, updated: 0, seen_count: rows.length }),
  };
  const result = await runSync({ seasonUuid: 'uuid', seasonName: '2025/2026' }, io);
  assert.equal(result.games.created, 1);
  assert.equal(result.contacts.created, 1);
  assert.ok(!result.contacts.skipped);
});

import { planUpsert } from '../svrz-scheduling-sync.mjs';

test('planUpsert splits rows into toCreate + toUpdate based on known persistence ids', () => {
  const existing = new Map([['persist-1', 'directus-id-1'], ['persist-2', 'directus-id-2']]);
  const rows = [
    { svrz_persistence_id: 'persist-1', foo: 'updated' },
    { svrz_persistence_id: 'persist-2', foo: 'also-updated' },
    { svrz_persistence_id: 'persist-3', foo: 'new' },
  ];
  const plan = planUpsert(existing, rows);
  assert.equal(plan.toCreate.length, 1);
  assert.equal(plan.toCreate[0].svrz_persistence_id, 'persist-3');
  assert.equal(plan.toUpdate.length, 2);
  // Existing rows get their Directus id attached
  const updateIds = plan.toUpdate.map(r => r.__existing_id).sort();
  assert.deepEqual(updateIds, ['directus-id-1', 'directus-id-2']);
});

test('planUpsert adds last_synced_at to every planned row', () => {
  const existing = new Map();
  const rows = [{ svrz_persistence_id: 'x', foo: 'y' }];
  const plan = planUpsert(existing, rows);
  assert.ok(plan.toCreate[0].last_synced_at);
  assert.match(plan.toCreate[0].last_synced_at, /^\d{4}-\d{2}-\d{2}T/); // ISO
});

test('planUpsert returns the seen persistence ids for downstream soft-delete', () => {
  const existing = new Map([['persist-1', 'id-1']]);
  const rows = [
    { svrz_persistence_id: 'persist-1', x: 1 },
    { svrz_persistence_id: 'persist-2', x: 2 },
  ];
  const plan = planUpsert(existing, rows);
  assert.deepEqual([...plan.seenIds].sort(), ['persist-1', 'persist-2']);
});

import { fetchTeamResponsibles } from '../svrz-scheduling-sync.mjs';

// gameRow shaped like gameToSvrzRow output (flat fields + raw original game).
function trGameRow({ id, awayClubId, awayTeamName, awayStaticId }) {
  return {
    svrz_persistence_id: id,
    status: 'open',
    home_club_id: '912530', // KSCW (KSCW_CLUB_NUMERIC default)
    home_club_name: 'KSC Wiedikon',
    home_team_name: 'KSC Wiedikon H1',
    away_club_id: String(awayClubId),
    away_club_name: 'Opp Club',
    away_team_name: awayTeamName,
    raw: { encounter: { teamAway: awayStaticId == null ? {} : { staticTeamIdentifier: awayStaticId } } },
  };
}

test('fetchTeamResponsibles keys a team responsible by the opponent staticTeamIdentifier', async () => {
  const rows = await fetchTeamResponsibles(null, null, {
    gameRows: [trGameRow({ id: 'g1', awayClubId: 42, awayTeamName: 'Opp H1', awayStaticId: 777 })],
    seasonUuid: 'uuid', seasonName: '2026/2027',
    getContacts: async () => ({ teamAway: [{ firstName: 'Tina', lastName: 'Resp', primaryEmailAddress: 'TINA@opp.ch ', addressOrganisationMemberFunctionTitle: 'Teamverantwortlicher' }] }),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].svrz_persistence_id, 'tr:t777:tina@opp.ch'); // team-keyed + lowercased
  assert.equal(rows[0].team_identifier, '777');
  assert.equal(rows[0].club_id, '42');
  assert.equal(rows[0].contact_email, 'tina@opp.ch');
});

test('fetchTeamResponsibles falls back to club scope (team_identifier null) when raw lacks the id', async () => {
  const rows = await fetchTeamResponsibles(null, null, {
    gameRows: [trGameRow({ id: 'g2', awayClubId: 42, awayTeamName: 'Opp H1', awayStaticId: null })],
    seasonUuid: 'uuid', seasonName: '2026/2027',
    getContacts: async () => ({ teamAway: [{ firstName: 'Max', lastName: 'X', primaryEmailAddress: 'max@opp.ch', addressOrganisationMemberFunctionTitle: 'Teamverantwortlicher' }] }),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].svrz_persistence_id, 'tr:c42:max@opp.ch'); // club-scoped fallback
  assert.equal(rows[0].team_identifier, null);
});

test('fetchTeamResponsibles ignores non-responsible roles and skips KSCW + missing clubs', async () => {
  const rows = await fetchTeamResponsibles(null, null, {
    gameRows: [
      trGameRow({ id: 'g3', awayClubId: 42, awayTeamName: 'Opp H1', awayStaticId: 777 }),
      trGameRow({ id: 'g4', awayClubId: 912530, awayTeamName: 'KSC Wiedikon H3', awayStaticId: 1 }), // intra-club
      trGameRow({ id: 'g5', awayClubId: '', awayTeamName: '', awayStaticId: null }), // no club
    ],
    seasonUuid: 'uuid', seasonName: '2026/2027',
    getContacts: async () => ({ teamAway: [
      { firstName: 'Ref', lastName: 'Ee', primaryEmailAddress: 'ref@opp.ch', addressOrganisationMemberFunctionTitle: 'Schiedsrichter' }, // not a responsible
      { firstName: 'Tina', lastName: 'Resp', primaryEmailAddress: 'tina@opp.ch', addressOrganisationMemberFunctionTitle: 'Teamverantwortlicher' },
    ] }),
  });
  // Only the one external opponent team, only its Teamverantwortlicher.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contact_email, 'tina@opp.ch');
});

// ── One summary audit row per run ──────────────────────────────────────
//
// The audit hook no longer logs `svrz_games` / `svrz_spielplaner_contacts`
// (SKIP_COLLECTIONS in kscw-hooks/src/audit.js), because `upsertByPersistenceId`
// PATCHes one row at a time and so produced one audit row per fixture — 388,901
// of them on prod, 584 MB. `writeSyncSummary` is what replaces that, so these
// tests are the only thing standing between a silent drop and an untracked cron.
//
// ⚠ eslint has `no-undef` OFF for directus/scripts/, so an unbound identifier in
//   here would not fail the lint gate — EXECUTING every branch is the gate.

import { writeSyncSummary } from '../svrz-scheduling-sync.mjs';

test('runSync writes exactly ONE summary row, after the upserts', async () => {
  process.env.VM_USERNAME = 'u'; process.env.VM_PASSWORD = 'p';
  const calls = [];
  const io = {
    login: async () => ({}),
    useRole: async () => true,
    csrf: async () => ({ csrf: 'c', wuid: 'w' }),
    getGames: async () => ({ items: [{ __identity: 'g1', number: 1, status: 'open' }], total: 1 }),
    getContacts: async () => ({ items: [] }),
    upsert: async (c, rows) => { calls.push(`upsert:${c}`); return { created: rows.length, updated: 2, seen_count: rows.length }; },
    logSummary: async (r) => { calls.push('summary'); return { logged: true, got: r }; },
  };
  const result = await runSync({ seasonUuid: 'uuid', seasonName: '2025/2026' }, io);

  const summaries = calls.filter(c => c === 'summary');
  assert.equal(summaries.length, 1, 'exactly one summary row per run — not one per fixture');
  assert.equal(calls[calls.length - 1], 'summary', 'summary must be the LAST thing the run does');
  assert.ok(calls.some(c => c.startsWith('upsert:')), 'sanity: the upserts still happened');
  // The run still returns its result unchanged — logging must not alter it.
  assert.equal(result.games.created, 1);
  assert.equal(result.games.updated, 2);
});

test('writeSyncSummary no-ops without a token instead of throwing', async () => {
  const prev = process.env.DIRECTUS_TOKEN;
  delete process.env.DIRECTUS_TOKEN;
  try {
    // Module read DIRECTUS_TOKEN at import time, so this asserts the shape the
    // test environment actually hits: no token configured -> a clean skip.
    const out = await writeSyncSummary({ games: { created: 1, updated: 2 } });
    assert.equal(out.logged, false);
    assert.equal(out.skipped, 'no_token');
  } finally {
    if (prev !== undefined) process.env.DIRECTUS_TOKEN = prev;
  }
});

test('a failing summary write never fails the sync that produced it', async () => {
  process.env.VM_USERNAME = 'u'; process.env.VM_PASSWORD = 'p';
  const io = {
    login: async () => ({}),
    useRole: async () => true,
    csrf: async () => ({ csrf: 'c', wuid: 'w' }),
    getGames: async () => ({ items: [{ __identity: 'g1', number: 1, status: 'open' }], total: 1 }),
    getContacts: async () => ({ items: [] }),
    upsert: async (_c, rows) => ({ created: rows.length, updated: 0, seen_count: rows.length }),
    // The real one swallows its own errors; this proves runSync survives even a
    // logger that does NOT — the fixtures are already written by this point and
    // an audit row must never be able to undo them. The hook that spawns this
    // script treats a non-zero exit as "sync failed" and alerts on it, so a
    // propagating audit error would raise a false alarm about live schedule data.
    logSummary: async () => { throw new Error('directus 500'); },
  };
  const result = await runSync({ seasonUuid: 'uuid', seasonName: '2025/2026' }, io);
  assert.equal(result.games.created, 1, 'the sync completed and returned its real result');
});
