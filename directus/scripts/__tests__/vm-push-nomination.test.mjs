import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toPairs, assertNotClosing, fineableBlockers } from '../vm-push-nomination.mjs';

// The whole point of these tests: in VolleyManager, saving a nomination list and
// FILING it officially are the same PUT, one boolean apart. A list that is closed
// while too short or coachless is fineable. So the two things worth testing are
// "a fill can never close" and "we only close on a clean validation".

describe('assertNotClosing — the fill payload can never file the list', () => {
  test('passes a payload with every close flag explicitly cleared', () => {
    const pairs = [
      ['nominationList[__identity]', 'abc'],
      ['nominationList[isClosedForTeam]', 'false'],
      ['nominationList[closed]', 'false'],
      ['nominationList[closedAt]', ''],
      ['nominationList[closedBy]', ''],
    ];
    assert.deepEqual(assertNotClosing(pairs), pairs);
  });

  test('throws when isClosedForTeam would file the list', () => {
    assert.throws(
      () => assertNotClosing([['nominationList[isClosedForTeam]', 'true']]),
      /refusing to send a fill payload that would CLOSE the list/,
    );
  });

  test('throws when `closed` is set', () => {
    assert.throws(() => assertNotClosing([['nominationList[closed]', 'true']]), /CLOSE/);
  });

  test('throws when closedAt/closedBy carry a value', () => {
    assert.throws(() => assertNotClosing([['nominationList[closedAt]', '2026-03-22T20:43:26+00:00']]), /CLOSE/);
    assert.throws(() => assertNotClosing([['nominationList[closedBy]', 'luca_canepa']]), /CLOSE/);
  });

  test('throws when the referee review flags are touched', () => {
    // `checked` is the REFEREE's review, not ours. We must never write it.
    assert.throws(() => assertNotClosing([['nominationList[checkedBy]', 'someone']]), /CLOSE/);
  });

  test('a real fill payload built by toPairs passes', () => {
    const list = {
      __identity: 'd6cdf56a', persistenceObjectIdentifier: 'd6cdf56a',
      closed: false, closedAt: null, closedBy: null, isClosedForTeam: false,
      game: { __identity: 'a388606f' }, team: { __identity: 'c2e77d88' },
    };
    assert.doesNotThrow(() => assertNotClosing(toPairs(list, 'nominationList')));
  });
});

describe('dev-database write guard', () => {
  // VolleyManager has no staging: dev and prod authenticate against the same real Swiss
  // Volley system. An armed dev cron would file real Einsatzlisten for real games. The
  // worker therefore forces DRY_RUN whenever DB_DATABASE looks like the dev database.
  // Re-imported per case because the flag is computed at module load.
  const loadWith = async (env) => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    // Cache-bust so the module re-evaluates its top-level constants.
    const mod = await import(`../vm-push-nomination.mjs?dev-guard=${encodeURIComponent(JSON.stringify(env))}`);
    process.env = saved;
    return mod;
  };

  test('the dev database name trips the guard', async () => {
    const m = await loadWith({ DB_DATABASE: 'directus_kscw_dev', VM_NOMINATION_ALLOW_DEV_WRITE: '' });
    assert.equal(m.isDryRun(), true, 'dev DB must force DRY_RUN');
  });

  test('the prod database name does not', async () => {
    const m = await loadWith({ DB_DATABASE: 'postgres', VM_NOMINATION_ALLOW_DEV_WRITE: '', DRY_RUN: '' });
    assert.equal(m.isDryRun(), false, 'prod DB must be allowed to write');
  });

  test('an explicit override unlocks a supervised dev write', async () => {
    const m = await loadWith({ DB_DATABASE: 'directus_kscw_dev', VM_NOMINATION_ALLOW_DEV_WRITE: '1', DRY_RUN: '' });
    assert.equal(m.isDryRun(), false, 'the override must be honoured');
  });

  test('an unset DB_DATABASE does not trip the guard (prod-shaped default)', async () => {
    const m = await loadWith({ DB_DATABASE: '', VM_NOMINATION_ALLOW_DEV_WRITE: '', DRY_RUN: '' });
    assert.equal(m.isDryRun(), false);
  });
});

describe('toPairs — Flow bracket-notation round-trip', () => {
  test('collapses a related entity to its __identity', () => {
    const pairs = toPairs({ game: { __identity: 'g1', name: 'ignored' } }, 'nominationList');
    assert.deepEqual(pairs, [['nominationList[game][__identity]', 'g1']]);
  });

  test('falls back to persistenceObjectIdentifier when __identity is absent', () => {
    const pairs = toPairs({ team: { persistenceObjectIdentifier: 't1' } }, 'nominationList');
    assert.deepEqual(pairs, [['nominationList[team][__identity]', 't1']]);
  });

  test('nulls become empty strings — Flow reads "" as unset', () => {
    assert.deepEqual(toPairs({ closedAt: null }, 'nominationList'), [['nominationList[closedAt]', '']]);
  });

  test('indexes arrays', () => {
    const pairs = toPairs({ xs: [{ __identity: 'a' }, { __identity: 'b' }] }, 'n');
    assert.deepEqual(pairs, [['n[xs][0][__identity]', 'a'], ['n[xs][1][__identity]', 'b']]);
  });
});

describe('fineableBlockers — we only close on a clean validation', () => {
  // Shapes taken verbatim from the live API (probe, 2026-07-13).
  const issue = (identifier, { fineable = true, resolved = false, severity = 'warning' } = {}) => ({
    number: 1160772, isFineable: fineable, isResolved: resolved,
    validationIssueConfiguration: { identifier, severity, isFineable: fineable },
  });

  test('no validation at all → nothing blocks the close', () => {
    assert.deepEqual(fineableBlockers(null), []);
    assert.deepEqual(fineableBlockers({ nominationListValidationIssues: [] }), []);
  });

  test('a too-short list blocks the close (this is the fine we are avoiding)', () => {
    const blockers = fineableBlockers({
      nominationListValidationIssues: [issue('nominationList_hasTooFewNominations')],
    });
    assert.deepEqual(blockers, ['nominationList_hasTooFewNominations']);
  });

  test('a missing coach blocks the close', () => {
    const blockers = fineableBlockers({
      nominationListValidationIssues: [issue('nominationList_isMissingCoachPerson')],
    });
    assert.deepEqual(blockers, ['nominationList_isMissingCoachPerson']);
  });

  test('a RESOLVED fineable issue does not block — a human already dealt with it', () => {
    // Seen live on the D2 away list: hasNominationsWithIssues, fineable, isResolved=true.
    assert.deepEqual(fineableBlockers({
      nominationListValidationIssues: [issue('nominationList_hasNominationsWithIssues', { resolved: true })],
    }), []);
  });

  test('a non-fineable info issue does not block', () => {
    assert.deepEqual(fineableBlockers({
      nominationListValidationIssues: [
        issue('indoorPlayerNomination_hasRLLicenseNominationInOtherRL', { fineable: false, severity: 'info' }),
      ],
    }), []);
  });

  test('falls back to the config when the issue itself omits isFineable', () => {
    assert.deepEqual(fineableBlockers({
      nominationListValidationIssues: [{
        number: 37, isResolved: false,
        validationIssueConfiguration: { identifier: 'nominationList_hasTooFewNominations', isFineable: true },
      }],
    }), ['nominationList_hasTooFewNominations']);
  });

  test('reports every blocker, not just the first', () => {
    assert.deepEqual(
      fineableBlockers({
        nominationListValidationIssues: [
          issue('nominationList_hasTooFewNominations'),
          issue('nominationList_isMissingCoachPerson'),
        ],
      }),
      ['nominationList_hasTooFewNominations', 'nominationList_isMissingCoachPerson'],
    );
  });
});
