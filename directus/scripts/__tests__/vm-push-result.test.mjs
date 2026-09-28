import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildReportPairs, buildValidatePairs, buildShowPairs, encodePairs,
  reportToSets, setsEqual, setsWon, decideAction, officialFromGame, parseReports,
  isSvrzRcBlackout, reportingClosed, partyOf, makeFinish, WATCHDOG_MS,
} from '../vm-push-result.mjs';
import { isSvrzRcBlackout as extensionBlackout } from '../../extensions/kscw-endpoints/src/vm-windows.js';

// A result report is an attestation: in a 'bothteams' league VM makes the result
// official the moment two equal reports exist, and creates NONE when they differ.
// So the things worth testing are "the body is exactly what VM's own form sends",
// "a differing score is never filed without FORCE", and "dev never writes".

const GAME = 'f723415e-e056-4e05-95b9-3895bd277a00';
const SETS = [
  { home: 25, away: 27 }, { home: 25, away: 21 }, { home: 25, away: 18 },
  { home: 20, away: 25 }, { home: 15, away: 12 },
];

describe('request shapes — byte-for-byte against the VM UI (HAR 2026-09-28)', () => {
  test('create POST body matches HAR entry 51 (csrf redacted)', () => {
    const har = 'gameResultReport%5BupdatedAt%5D=&gameResultReport%5Bgame%5D%5B__identity%5D=f723415e-e056-4e05-95b9-3895bd277a00'
      + '&gameResultReport%5BgameResultReportValidation%5D%5B__identity%5D=213ec535-fc97-4b52-8962-b570595df85f'
      + '&gameResultReport%5BreportingPartyType%5D='
      + '&gameResultReport%5BhomeTeamSet1Balls%5D=25&gameResultReport%5BawayTeamSet1Balls%5D=27'
      + '&gameResultReport%5BhomeTeamSet2Balls%5D=25&gameResultReport%5BawayTeamSet2Balls%5D=21'
      + '&gameResultReport%5BhomeTeamSet3Balls%5D=25&gameResultReport%5BawayTeamSet3Balls%5D=18'
      + '&gameResultReport%5BhomeTeamSet4Balls%5D=20&gameResultReport%5BawayTeamSet4Balls%5D=25'
      + '&gameResultReport%5BhomeTeamSet5Balls%5D=15&gameResultReport%5BawayTeamSet5Balls%5D=12'
      + '&gameResultReport%5BhomeTeamGoldenSetBalls%5D=&gameResultReport%5BawayTeamGoldenSetBalls%5D='
      + '&__csrfToken=REDACTED';
    const body = encodePairs(buildReportPairs({
      gameUuid: GAME, validationId: '213ec535-fc97-4b52-8962-b570595df85f', sets: SETS, csrf: 'REDACTED',
    }));
    assert.equal(body, har);
  });

  test('update PUT puts our __identity first and carries our updatedAt', () => {
    const pairs = buildReportPairs({
      gameUuid: GAME, validationId: 'v1', sets: SETS.slice(0, 3), csrf: 'c',
      own: { id: 'own-1', updated_at: '2026-09-28T22:31:15.619290+00:00' },
    });
    assert.deepEqual(pairs.slice(0, 3), [
      ['gameResultReport[__identity]', 'own-1'],
      ['gameResultReport[updatedAt]', '2026-09-28T22:31:15.619290+00:00'],
      ['gameResultReport[game][__identity]', GAME],
    ]);
    assert.deepEqual(pairs.at(-1), ['__csrfToken', 'c']);
  });

  test('unplayed sets are sent as empty strings, never dropped', () => {
    const pairs = buildReportPairs({ gameUuid: GAME, validationId: 'v', sets: SETS.slice(0, 3), csrf: 'c' });
    const m = new Map(pairs);
    assert.equal(m.get('gameResultReport[homeTeamSet3Balls]'), '25');
    assert.equal(m.get('gameResultReport[homeTeamSet4Balls]'), '');
    assert.equal(m.get('gameResultReport[awayTeamSet5Balls]'), '');
    assert.equal(pairs.length, 4 + 12 + 1);
  });

  test('never carries a game status or anything outside the report', () => {
    const pairs = buildReportPairs({ gameUuid: GAME, validationId: 'v', sets: SETS, csrf: 'c' });
    for (const [k] of pairs) assert.match(k, /^(gameResultReport\[|__csrfToken$)/);
    assert.ok(!pairs.some(([k]) => /status/i.test(k)));
  });

  test('validate query matches HAR entry 50', () => {
    const har = 'gameResultReport%5B__identity%5D=&gameResultReport%5BupdatedAt%5D='
      + '&gameResultReport%5Bgame%5D%5B__identity%5D=f723415e-e056-4e05-95b9-3895bd277a00'
      + '&gameResultReport%5BgameResultReportValidation%5D=&gameResultReport%5BreportingPartyType%5D='
      + '&gameResultReport%5BhomeTeamSet1Balls%5D=25&gameResultReport%5BawayTeamSet1Balls%5D=27'
      + '&gameResultReport%5BhomeTeamSet2Balls%5D=25&gameResultReport%5BawayTeamSet2Balls%5D=21'
      + '&gameResultReport%5BhomeTeamSet3Balls%5D=25&gameResultReport%5BawayTeamSet3Balls%5D=18'
      + '&gameResultReport%5BhomeTeamSet4Balls%5D=20&gameResultReport%5BawayTeamSet4Balls%5D=25'
      + '&gameResultReport%5BhomeTeamSet5Balls%5D=15&gameResultReport%5BawayTeamSet5Balls%5D=12'
      + '&gameResultReport%5BhomeTeamGoldenSetBalls%5D=&gameResultReport%5BawayTeamGoldenSetBalls%5D=';
    assert.equal(encodePairs(buildValidatePairs({ gameUuid: GAME, sets: SETS })), har);
  });

  test('show query is HAR entry 48 plus numberOfWinSets, game identity last', () => {
    const har = 'propertyRenderConfiguration%5B0%5D=gameResultReports.*.gameResultReportValidation'
      + '&propertyRenderConfiguration%5B1%5D=gameResultReports.*.updatedAt'
      + '&propertyRenderConfiguration%5B2%5D=encounter.*'
      + '&propertyRenderConfiguration%5B3%5D=group.phase.league.resultNotificationSystem.identifier'
      + '&propertyRenderConfiguration%5B4%5D=result'
      + '&propertyRenderConfiguration%5B5%5D=group.phase.league.numberOfWinSets'
      + '&game%5B__identity%5D=f723415e-e056-4e05-95b9-3895bd277a00';
    assert.equal(encodePairs(buildShowPairs(GAME)), har);
  });
});

describe('reportToSets / setsWon / setsEqual', () => {
  const report = {
    homeTeamSet1Balls: 25, awayTeamSet1Balls: 27, homeTeamSet2Balls: 25, awayTeamSet2Balls: 21,
    homeTeamSet3Balls: 25, awayTeamSet3Balls: 18, homeTeamSet4Balls: null, awayTeamSet4Balls: null,
    homeTeamSet5Balls: null, awayTeamSet5Balls: null,
  };

  test('null balls mark an unplayed set', () => {
    assert.deepEqual(reportToSets(report), SETS.slice(0, 3));
    assert.deepEqual(reportToSets(null), []);
  });

  test('sets won per side', () => {
    assert.deepEqual(setsWon(SETS), { home: 3, away: 2 });
  });

  test('equal only on the same sets in the same order', () => {
    assert.equal(setsEqual(SETS, SETS.map((s) => ({ ...s }))), true);
    assert.equal(setsEqual(SETS, [...SETS].reverse()), false);
    assert.equal(setsEqual(SETS, SETS.slice(0, 4)), false);
    assert.equal(setsEqual(SETS, [{ home: 25, away: 26 }, ...SETS.slice(1)]), false);
  });

  test('numeric strings and a JSON string compare by value', () => {
    assert.equal(setsEqual(JSON.stringify(SETS), SETS.map((s) => ({ home: String(s.home), away: String(s.away) }))), true);
  });

  test('two empty scores are not an agreement', () => {
    assert.equal(setsEqual([], []), false);
    assert.equal(setsEqual(null, SETS), false);
  });
});

describe('parseReports / officialFromGame — the live showWithNestedObjects shape', () => {
  test('flattens a report (HAR entry 48)', () => {
    const [r] = parseReports({ gameResultReports: [{
      __identity: 'da6fd364', reportingPartyType: 'hometeam', updatedAt: '2026-09-28T21:57:24.000000+00:00',
      deletedAt: null, wonSetsHomeTeam: 3, wonSetsAwayTeam: 2,
      ...Object.fromEntries(SETS.flatMap((s, i) => [[`homeTeamSet${i + 1}Balls`, s.home], [`awayTeamSet${i + 1}Balls`, s.away]])),
    }] });
    assert.deepEqual(r, { id: 'da6fd364', party: 'hometeam', sets: SETS, home: 3, away: 2,
      updated_at: '2026-09-28T21:57:24.000000+00:00' });
  });

  test('a deleted report is ignored', () => {
    assert.deepEqual(parseReports({ gameResultReports: [{ __identity: 'x', deletedAt: '2026-01-01' }] }), []);
  });

  test('no result → null', () => {
    assert.equal(officialFromGame({ result: null }), null);
  });
});

describe('decideAction — the one place that decides', () => {
  const opp = (sets) => ({ id: 'opp', party: 'hometeam', sets });
  const mine = (sets) => ({ id: 'own', party: 'awayteam', sets });
  const base = { official: null, reports: [], ownParty: 'awayteam', notificationSystem: 'bothteams', reportable: true, ours: SETS };
  const pick = (d) => { const { own, opponent, ...rest } = d; return rest; };
  const OTHER = [{ home: 25, away: 20 }, { home: 25, away: 20 }, { home: 25, away: 20 }];

  const table = [
    ['official result already in VM', { official: { sets: SETS, home: 3, away: 2 } }, { skip: 'not_reportable' }],
    ['hometeam league, we are away', { notificationSystem: 'hometeam' }, { skip: 'home_team_reports' }],
    ['hometeam league, we are home', { notificationSystem: 'hometeam', ownParty: 'hometeam' }, { write: 'create' }],
    ['VM names no reporting party for us', { ownParty: null }, { skip: 'not_reportable' }],
    ['not reportable and no own report', { reportable: false }, { skip: 'not_reportable' }],
    ['no reports yet → create', {}, { write: 'create' }],
    ['opponent equal → create (the confirm)', { reports: [opp(SETS)] }, { write: 'create' }],
    ['opponent differs → conflict', { reports: [opp(OTHER)] }, { conflict: true }],
    ['opponent differs + FORCE → create', { reports: [opp(OTHER)], force: true }, { write: 'create' }],
    ['own equal, no opponent → noop reported', { reports: [mine(SETS)] }, { noop: 'reported' }],
    ['own equal + opponent equal → noop confirmed', { reports: [mine(SETS), opp(SETS)] }, { noop: 'confirmed' }],
    ['own differs → update', { reports: [mine(OTHER)] }, { write: 'update' }],
    ['own differs, not reportable → still update', { reports: [mine(OTHER)], reportable: false }, { write: 'update' }],
    ['own differs + opponent differs → conflict', { reports: [mine(OTHER), opp([{ home: 1, away: 25 }])] }, { conflict: true }],
    ['referee report is not the opponent', { reports: [{ id: 'r', party: 'referee', sets: OTHER }] }, { write: 'create' }],
    // Reporting closed for our party (deadline / round over) — even with the
    // permission bit set, which VM sends as create:true on everything.
    ['closed, nothing of ours → skip', { closed: true }, { skip: 'not_reportable' }],
    ['closed, own differs → skip, never an update', { closed: true, reports: [mine(OTHER)] }, { skip: 'not_reportable' }],
    ['closed, own equal → noop reported', { closed: true, reports: [mine(SETS)] }, { noop: 'reported' }],
    ['closed, own + opponent equal → noop confirmed', { closed: true, reports: [mine(SETS), opp(SETS)] }, { noop: 'confirmed' }],
  ];
  for (const [name, over, want] of table) {
    test(name, () => assert.deepEqual(pick(decideAction({ ...base, ...over })), want));
  }

  test('carries the matching reports for the caller', () => {
    const d = decideAction({ ...base, reports: [mine(OTHER), opp(SETS)] });
    assert.equal(d.own.id, 'own');
    assert.equal(d.opponent.id, 'opp');
  });
});

describe('reportingClosed — our party\'s flags, not _permissions', () => {
  // HAR entry 48 carries all three flags by default; _permissions says create:true on
  // every property, so it cannot tell a closed round from an open one.
  const g = (over = {}) => ({
    homeTeamGameResultReportDeadlineExceeded: false, awayTeamGameResultReportDeadlineExceeded: false,
    isGameResultReported: false, ...over,
  });
  test('open in the recorded response', () => {
    assert.equal(reportingClosed(g(), 'awayteam', null), false);
  });
  test('our own deadline closes it, the other side\'s does not', () => {
    assert.equal(reportingClosed(g({ awayTeamGameResultReportDeadlineExceeded: true }), 'awayteam', null), true);
    assert.equal(reportingClosed(g({ homeTeamGameResultReportDeadlineExceeded: true }), 'awayteam', null), false);
    assert.equal(reportingClosed(g({ homeTeamGameResultReportDeadlineExceeded: true }), 'hometeam', null), true);
  });
  test('"reported" without an official result closes it', () => {
    assert.equal(reportingClosed(g({ isGameResultReported: true }), 'hometeam', null), true);
    assert.equal(reportingClosed(g({ isGameResultReported: true }), 'hometeam', { sets: SETS, home: 3, away: 2 }), false);
  });
});

test('partyOf accepts only the two team parties', () => {
  assert.equal(partyOf('awayteam'), 'awayteam');
  assert.equal(partyOf(' hometeam\n'), 'hometeam');
  assert.equal(partyOf('referee'), null);
  assert.equal(partyOf({ html: 'login' }), null);
});

describe('svrz_rc window — inline copy of vm-windows.js', () => {
  const at = (h, m) => new Date(Date.UTC(2026, 8, 29, h, m));
  test('the nightly games-sync hours and the refresh slots', () => {
    for (const [h, m] of [[22, 0], [23, 59], [0, 30], [10, 5], [11, 30], [14, 17], [15, 5]]) {
      assert.equal(isSvrzRcBlackout(at(h, m)), true, `${h}:${m}`);
    }
    for (const [h, m] of [[21, 59], [1, 0], [10, 4], [10, 31], [12, 15], [16, 10]]) {
      assert.equal(isSvrzRcBlackout(at(h, m)), false, `${h}:${m}`);
    }
  });
  test('never drifts from the extension\'s definition', () => {
    for (let min = 0; min < 24 * 60; min++) {
      const d = new Date(Date.UTC(2026, 8, 29, 0, min));
      assert.equal(isSvrzRcBlackout(d), extensionBlackout(d), d.toISOString());
    }
  });
});

describe('finish — writes only a row that is still pending', () => {
  const harness = (status, { readThrows = false } = {}) => {
    const out = { patches: [], exits: [] };
    const finish = makeFinish({
      readStatus: async () => { if (readThrows) throw new Error('down'); return status; },
      patch: async (p) => { out.patches.push(p); },
      exit: (c) => out.exits.push(c),
    });
    return { finish, out };
  };
  test('pending → journal written, lease cleared, failed exits 1', async () => {
    const { finish, out } = harness('pending');
    await finish('failed', { error: 'timeout' });
    assert.equal(out.patches.length, 1);
    assert.deepEqual([out.patches[0].vm_result_status, out.patches[0].vm_result_error, out.patches[0].vm_result_claimed_at], ['failed', 'timeout', null]);
    assert.deepEqual(out.exits, [1]);
  });
  test('resolved elsewhere (reclaim / exit handler / a new submit) → left alone', async () => {
    for (const current of ['failed', 'reported', 'skipped']) {
      const { finish, out } = harness(current);
      await finish('reported', { reportId: 'r' });
      assert.equal(out.patches.length, 0, current);
      assert.deepEqual(out.exits, [0]);
    }
  });
  test('a failed re-read still writes — a stranded pending is worse', async () => {
    const { finish, out } = harness(undefined, { readThrows: true });
    await finish('failed', { error: 'x' });
    assert.equal(out.patches.length, 1);
  });
  test('a queued hand-back stays pending with no lease and exits 0', async () => {
    const { finish, out } = harness('pending');
    await finish('pending', { error: 'queued_window' });
    assert.deepEqual([out.patches[0].vm_result_status, out.patches[0].vm_result_error, out.patches[0].vm_result_claimed_at], ['pending', 'queued_window', null]);
    assert.deepEqual(out.exits, [0]);
  });
  test('only the first call counts (watchdog racing main)', async () => {
    const { finish, out } = harness('pending');
    await Promise.all([finish('failed', { error: 'timeout' }), finish('reported')]);
    assert.equal(out.patches.length, 1);
    assert.equal(out.patches[0].vm_result_status, 'failed');
  });
});

describe('the run itself (source checks — main() needs VM, which tests never touch)', () => {
  const src = readFileSync(new URL('../vm-push-result.mjs', import.meta.url), 'utf8');
  test('files the SETS_JSON it was spawned with, never re-reads provisional_sets_json', () => {
    assert.match(src, /normaliseSets\(process\.env\.SETS_JSON\)/);
    assert.doesNotMatch(src, /fields=[^`]*provisional_sets_json/);
  });
  test('every fetch carries a timeout', () => {
    const fetches = src.match(/await fetch\(/g).length;
    const timeouts = src.match(/signal: AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/g).length;
    assert.equal(timeouts, fetches);
  });
  test('the watchdog ends the run inside the endpoint\'s 10-minute lease', () => {
    assert.ok(WATCHDOG_MS < 10 * 60 * 1000);
  });
  test('re-checks the party and the svrz_rc window between validate and write', () => {
    const write = src.indexOf("await vmWrite(");
    const party = src.lastIndexOf('party_changed', write);
    const window = src.lastIndexOf('isSvrzRcBlackout()', write);
    const validate = src.indexOf('validateGameResultReport', src.indexOf('async function main'));
    assert.ok(validate < party && party < write, 'party re-read before the write');
    assert.ok(validate < window && window < write, 'window re-check before the write');
    assert.ok(src.indexOf('isSvrzRcBlackout()', src.indexOf('async function main')) < src.indexOf('await vmLogin('), 'window check before login');
  });
});

describe('dev-database write guard', () => {
  // VolleyManager has no staging: dev and prod authenticate against the same real Swiss
  // Volley system. A dev "Report result" would file a real report. The worker therefore
  // forces DRY_RUN whenever DB_DATABASE looks like the dev database.
  // Re-imported per case because the flag is computed at module load.
  const loadWith = async (env) => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    const mod = await import(`../vm-push-result.mjs?dev-guard=${encodeURIComponent(JSON.stringify(env))}`);
    process.env = saved;
    return mod;
  };

  test('the dev database name trips the guard', async () => {
    const m = await loadWith({ DB_DATABASE: 'directus_kscw_dev', VM_RESULT_ALLOW_DEV_WRITE: '', DRY_RUN: '' });
    assert.equal(m.isDryRun(), true, 'dev DB must force DRY_RUN');
  });

  test('the prod database name does not', async () => {
    const m = await loadWith({ DB_DATABASE: 'postgres', VM_RESULT_ALLOW_DEV_WRITE: '', DRY_RUN: '' });
    assert.equal(m.isDryRun(), false, 'prod DB must be allowed to write');
  });

  test('an explicit override unlocks a supervised dev write', async () => {
    const m = await loadWith({ DB_DATABASE: 'directus_kscw_dev', VM_RESULT_ALLOW_DEV_WRITE: '1', DRY_RUN: '' });
    assert.equal(m.isDryRun(), false, 'the override must be honoured');
  });

  test('the nomination override does NOT unlock result writes', async () => {
    const m = await loadWith({ DB_DATABASE: 'directus_kscw_dev', VM_RESULT_ALLOW_DEV_WRITE: '', VM_NOMINATION_ALLOW_DEV_WRITE: '1', DRY_RUN: '' });
    assert.equal(m.isDryRun(), true);
  });

  test('DRY_RUN=1 on prod is honoured', async () => {
    const m = await loadWith({ DB_DATABASE: 'postgres', VM_RESULT_ALLOW_DEV_WRITE: '', DRY_RUN: '1' });
    assert.equal(m.isDryRun(), true);
  });
});
