import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// clubdesk-group-fix-outcome.sh — the dispatcher judges a "Fix groups" run by the
// ROWS it wrote (20.10.2026: two previews and two commits with 17/17
// skip_filter_failed were each stored as done, "preview: 16 add, 1 remove").
//
// grp_outcome_judge is pure bash and always tested. grp_outcome_sql needs a
// Postgres; set GRP_OUTCOME_TEST_PG to a running postgres container name to run
// that part, e.g.
//   docker run -d --rm --name grp-outcome-pg -e POSTGRES_PASSWORD=x postgres:16
//   GRP_OUTCOME_TEST_PG=grp-outcome-pg node --test directus/scripts/__tests__/clubdesk-group-fix-outcome.test.mjs

const HELPER = fileURLToPath(new URL('../clubdesk-group-fix-outcome.sh', import.meta.url));
const DISPATCH = fileURLToPath(new URL('../clubdesk-group-fix-dispatch.sh', import.meta.url));

function bash(script, env = {}) {
  return execFileSync('bash', ['-c', `set -uo pipefail; . "$HELPER"; ${script}`], {
    env: { ...process.env, HELPER, ...env },
    encoding: 'utf8',
  });
}

/** grp_outcome_judge → [state, message] */
function judge(mode, total, ok, att, tally = '', fatal = '', held = '') {
  const out = bash('grp_outcome_judge "$M" "$T" "$O" "$A" "$TA" "$F" "$H"', {
    M: mode, T: String(total), O: String(ok), A: String(att), TA: tally, F: fatal, H: String(held),
  });
  return out.replace(/\n$/, '').split('\n');
}

test('ok set: assigned / previewed / removed', () => {
  assert.equal(bash('printf %s "$GRP_OK_STATUSES"'), 'assigned previewed removed');
});

test('the 20.10.2026 preview: 0 of 17 writable is FAILED, with the reason', () => {
  assert.deepEqual(judge('preview', 17, 0, 17, '17 skip_filter_failed'), [
    'failed', 'preview: 0 of 17 writable — 17 skip_filter_failed',
  ]);
});

test('a commit that wrote nothing is FAILED', () => {
  assert.deepEqual(judge('commit', 17, 0, 17, '17 skip_filter_failed'), [
    'failed', 'commit: 0 of 17 written — 17 skip_filter_failed',
  ]);
});

test('a partial commit is done, and says what was not written', () => {
  assert.deepEqual(judge('commit', 17, 12, 17, '4 skip_ok_disabled, 1 error'), [
    'done', 'commit: 12 of 17 written — 4 skip_ok_disabled, 1 error',
  ]);
});

test('a clean preview is done', () => {
  assert.deepEqual(judge('preview', 3, 3, 3), ['done', 'preview: 3 of 3 writable']);
});

test('a tool that died early: the gap is "not attempted", its message is appended', () => {
  assert.deepEqual(judge('preview', 17, 0, 0, '', 'ClubDesk contact grid has no "Wiedisync ID" column'), [
    'failed', 'preview: 0 of 17 writable — 17 not attempted — ClubDesk contact grid has no "Wiedisync ID" column',
  ]);
  assert.deepEqual(judge('commit', 5, 2, 3, '1 error'), [
    'done', 'commit: 2 of 5 written — 1 error, 2 not attempted',
  ]);
});

test('rows held back from a commit are named, so 12 of 12 is not the whole story', () => {
  assert.deepEqual(judge('commit', 12, 12, 12, '', '', 5), [
    'done', 'commit: 12 of 12 written — 5 held back (skipped in the preview)',
  ]);
  assert.deepEqual(judge('commit', 5, 2, 3, '1 error', '', 4), [
    'done', 'commit: 2 of 5 written — 1 error, 2 not attempted, 4 held back (skipped in the preview)',
  ]);
  // absent / garbage = none
  assert.deepEqual(judge('commit', 3, 3, 3, '', '', 'x'), ['done', 'commit: 3 of 3 written']);
});

test('the dispatcher carries held_back, names a silent tool, and patches the mirror before publishing the state', () => {
  const src = readFileSync(DISPATCH, 'utf8');
  assert.match(src, /grp_worklist->>'held_back'/);
  assert.match(src, /"held_back":%s/);
  assert.match(src, /grp_outcome_judge [^\n]*"\$HELD"/);
  // a tool given rows that printed nothing is "not attempted", never a null half
  assert.match(src, /no_output "\$N_ADD"/);
  assert.match(src, /no_output "\$N_REM"/);
  // the mirror patch lands before grp_state is published
  const patchAt = src.indexOf('cd_mirror_patch "$RESULT"');
  const stateAt = src.indexOf('SET grp_state=\\$s\\$$STATE');
  assert.ok(patchAt > 0 && stateAt > 0, 'both writes present');
  assert.ok(patchAt < stateAt, 'mirror patch must run before the state write');
});

test('the dispatcher sources the helper and no longer hard-codes done', () => {
  const src = readFileSync(DISPATCH, 'utf8');
  assert.match(src, /clubdesk-group-fix-outcome\.sh/);
  assert.match(src, /grp_outcome_judge/);
  assert.doesNotMatch(src, /SET grp_state='done'/);
  // the old worklist-sized message is gone
  assert.doesNotMatch(src, /MSG="\$MODE: \$N_ADD add, \$N_REM remove"/);
  // a 0-row commit must not patch the mirror
  assert.match(src, /"\$MODE" = "commit" \] && \[ "\$\{OK_N:-0\}" -gt 0 \]/);
});

const PG = process.env.GRP_OUTCOME_TEST_PG;
test('grp_outcome_sql counts rows by status (needs GRP_OUTCOME_TEST_PG)', { skip: !PG && 'GRP_OUTCOME_TEST_PG not set' }, () => {
  const run = (json) => bash(
    'psqlc() { docker exec -i "$PG" psql -U postgres -X -tAc "$1"; }; grp_outcome "$J"',
    { PG, J: json },
  ).trim();
  const r = (status, extra = {}) => ({ name: 'X', group: 'VB H2', status, ...extra });

  // 20.10.2026 — every row skipped
  const allSkipped = JSON.stringify({
    mode: 'preview',
    add: { count: 16, results: Array.from({ length: 16 }, () => r('skip_filter_failed')) },
    remove: { count: 1, results: [r('skip_filter_failed')] },
  });
  assert.equal(run(allSkipped), '0|17|17 skip_filter_failed|');

  // partial, add-only (remove null), statuses most frequent first
  const partial = JSON.stringify({
    mode: 'commit',
    add: { results: [r('assigned'), r('assigned'), r('error'), r('skip_ok_disabled'), r('skip_ok_disabled')] },
    remove: null,
  });
  assert.equal(run(partial), '2|5|2 skip_ok_disabled, 1 error|');

  // died: no rows, fatal message with a pipe and a newline — stays last, one line
  const died = JSON.stringify({
    mode: 'preview',
    add: { count: 3, results: [], fatal: 'grid has no "Wiedisync ID" column | see\nlog' },
    remove: { count: 1, results: [r('removed')] },
  });
  assert.equal(run(died), '1|1||grid has no "Wiedisync ID" column | see log');

  // the IFS='|' read the dispatcher does keeps the pipe inside FATAL
  const fields = bash(
    'psqlc() { docker exec -i "$PG" psql -U postgres -X -tAc "$1"; }; IFS="|" read -r OK ATT TALLY FATAL <<< "$(grp_outcome "$J")"; printf "%s\\n" "$OK" "$ATT" "$TALLY" "$FATAL"',
    { PG, J: died },
  ).split('\n');
  assert.deepEqual(fields.slice(0, 4), ['1', '1', '', 'grid has no "Wiedisync ID" column | see log']);

  // a row with no status is never ok
  assert.equal(run(JSON.stringify({ add: { results: [{ name: 'x' }] }, remove: null })), '0|1|1 error|');
});
