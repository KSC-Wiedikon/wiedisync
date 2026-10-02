import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertNotClosing, fineableBlockers, pickOfficials, officialsPayload, buildListPairs } from '../vm-push-nomination.mjs';

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

describe('pickOfficials — who is C / AC1 / AC2', () => {
  const teamDefault = { coach: 5, assistant_coach_1: '7' };

  test('no per-game sheet → the team default; unset slots have no opinion', () => {
    assert.deepEqual(pickOfficials([], teamDefault), {
      source: 'team',
      slots: { coach: 5, assistant_coach_1: 7, assistant_coach_2: undefined },
    });
  });

  test('no sheet and no default → keep everything VM has', () => {
    assert.deepEqual(pickOfficials([], undefined).slots,
      { coach: undefined, assistant_coach_1: undefined, assistant_coach_2: undefined });
  });

  test('a sheet that assigns a slot is a snapshot: an unassigned slot is CLEARED', () => {
    const rows = [{ member: 9, role: 'coach' }, { member: 3, role: 'physio' }];
    assert.deepEqual(pickOfficials(rows, teamDefault), {
      source: 'game',
      slots: { coach: 9, assistant_coach_1: null, assistant_coach_2: null },
    });
  });

  test('a VM-named official we hold no member for is kept as VM has it', () => {
    const rows = [{ member: null, role: 'coach' }, { member: { id: 4 }, role: 'assistant_coach_2' }];
    assert.deepEqual(pickOfficials(rows, teamDefault).slots,
      { coach: undefined, assistant_coach_1: null, assistant_coach_2: 4 });
  });

  test('a sheet with only unlabelled / physio rows does not override the team default', () => {
    const rows = [{ member: 9, role: null }, { member: 3, role: 'physio' }];
    assert.equal(pickOfficials(rows, teamDefault).source, 'team');
  });
});

describe('officialsPayload — never wipe an official we have no opinion on', () => {
  const existing = {
    coachPerson: { __identity: 'vm-c' },
    firstAssistantCoachPerson: { __identity: 'vm-a1' },
    secondAssistantCoachPerson: null,
  };

  test('undefined keeps VM\'s person — a human-entered official survives our push', () => {
    assert.deepEqual(officialsPayload(existing, {}), existing);
  });

  test('a resolved person replaces, null clears', () => {
    assert.deepEqual(officialsPayload(existing, { coach: { __identity: 'new' }, assistant_coach_1: null }), {
      coachPerson: { __identity: 'new' },
      firstAssistantCoachPerson: null,
      secondAssistantCoachPerson: null,
    });
  });

  test('an AC2 with no AC1 moves up, as VM\'s own form does', () => {
    assert.deepEqual(officialsPayload(null, { assistant_coach_2: { __identity: 'x' } }), {
      coachPerson: null,
      firstAssistantCoachPerson: { __identity: 'x' },
      secondAssistantCoachPerson: null,
    });
  });
});

describe('buildListPairs — the PUT body', () => {
  const list = {
    __identity: 'L1', game: { __identity: 'G1' }, team: { __identity: 'T1' },
    nominationListValidation: { __identity: 'V1', nominationListValidationIssues: [] },
    notFoundButNominatedPersons: [{ __identity: 'NF1' }],
    isClosedForTeam: true, closed: true, closedAt: '2026-10-01T10:00:00+00:00', closedBy: { __identity: 'U1' },
    checkedBy: 'referee',
  };
  const nominations = [{ indoorPlayer: { __identity: 'P1' }, indoorPlayerLicenseCategory: { __identity: 'C1' } }];
  const officials = officialsPayload({ coachPerson: { __identity: 'VMC' } }, { assistant_coach_1: { __identity: 'A1' } });
  const get = (pairs, k) => pairs.find(([key]) => key === k)?.[1];

  test('regression: the ROOT is expanded, not collapsed to its identity', () => {
    const pairs = buildListPairs(list, { nominations, officials });
    assert.equal(get(pairs, 'nominationList[__identity]'), 'L1');
    assert.equal(get(pairs, 'nominationList[game][__identity]'), 'G1');
    assert.equal(get(pairs, 'nominationList[indoorPlayerNominations][0][indoorPlayer][__identity]'), 'P1');
    assert.equal(get(pairs, 'nominationList[notFoundButNominatedPersons][0][__identity]'), 'NF1');
  });

  test('officials are sent: kept, replaced, and empty slots as ""', () => {
    const pairs = buildListPairs(list, { nominations, officials });
    assert.equal(get(pairs, 'nominationList[coachPerson][__identity]'), 'VMC');
    assert.equal(get(pairs, 'nominationList[firstAssistantCoachPerson][__identity]'), 'A1');
    assert.equal(get(pairs, 'nominationList[secondAssistantCoachPerson]'), '');
  });

  test('a fill of a FILED list (amend) reopens it and never re-sends the close or the referee review', () => {
    const pairs = buildListPairs(list, { nominations, officials });
    assert.equal(get(pairs, 'nominationList[isClosedForTeam]'), 'false');
    assert.equal(get(pairs, 'nominationList[closedAt]'), '');
    assert.ok(!pairs.some(([k]) => /checked/.test(k)));
    assert.doesNotThrow(() => assertNotClosing(pairs));
  });

  test('the body is always an OPEN list — filing is the separate finalize action', () => {
    const pairs = buildListPairs(list, { nominations, officials, close: true });
    assert.equal(get(pairs, 'nominationList[isClosedForTeam]'), 'false');
  });
});
