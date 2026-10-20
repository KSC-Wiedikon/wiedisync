/**
 * The up dispatcher queues the read-back sync-down after a COMMITTED push, and
 * only then (20.10.2026).
 *
 * WHY THIS EXISTS
 * ---------------
 * A push leaves work only a later sync-down can reveal: a CREATE is linked
 * back there, and the conflicts staged after it are the ones the push itself
 * produced. That down used to be the operator's step 4 on Data health, so a
 * tab closed after the push (or an auto-sync push with no operator at all)
 * left it owed. clubdesk-member-up-dispatch.sh now queues it itself — and the
 * cases where it must NOT are the ones that matter: a dry-run wrote nothing, a
 * dev run can never write, a failed commit leaves its members flagged for the
 * next push, and a down that already holds the lock must not be stacked on.
 *
 * The script is EXECUTED here, not grepped: `docker` is a fake on PATH that
 * records every SQL statement and answers the few that steer the run, and
 * CLUBDESK_SYNC_DIR points the dispatcher at a temp dir instead of
 * /opt/clubdesk-sync. Nothing reaches a database or ClubDesk.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(HERE, '..', 'clubdesk-member-up-dispatch.sh')

const haveTools = ['bash', 'flock', 'iconv'].every(
  (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0,
)

// The fake docker. `exec … psql … -tAc <sql>` logs the SQL (NUL-separated, the
// statements span lines) and answers the steering queries; `run …` is a scrape
// and prints the scraper's JSON result line for preview/commit.
const FAKE_DOCKER = `#!/usr/bin/env bash
if [ "$1" = exec ]; then
  sql=''; prev=''
  for a in "$@"; do [ "$prev" = -tAc ] && sql="$a"; prev="$a"; done
  printf '%s\\0' "$sql" >> "$FAKE_LOG"
  case "$sql" in
    *information_schema.columns*) echo 1 ;;
    *"SET up_state='running'"*) echo 1 ;;
    *"COALESCE(up_csv,'')"*) printf '[Id];E-Mail\\n42;a@example.ch\\n' ;;
    *"COALESCE(up_csv_create,'')"*) : ;;
    *"SET down_state='queued'"*) echo "\${FAKE_READBACK:-1}" ;;
  esac
  exit 0
fi
if [ "$1" = run ]; then
  case " $* " in
    *" preview "*) echo '{"total":1,"neu":0,"veraendert":1,"unveraendert":0}' ;;
    *" commit "*)
      if [ "\${FAKE_COMMIT_FAIL:-0}" = 1 ]; then echo '{"total":1,"committed":false,"error":"boom"}'
      else echo '{"total":1,"neu":0,"veraendert":1,"unveraendert":0,"committed":true}'; fi ;;
  esac
  exit 0
fi
exit 0
`

function run(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cd-up-dispatch-'))
  try {
    mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'bin', 'docker'), FAKE_DOCKER)
    chmodSync(join(dir, 'bin', 'docker'), 0o755)
    writeFileSync(join(dir, '.env'), '')
    const log = join(dir, 'sql.log')
    const baseEnv = { ...process.env }
    delete baseEnv.DB // an explicit DB that disagrees with CLUBDESK_ENV is fatal
    delete baseEnv.CLUBDESK_UP_COMMIT
    const r = spawnSync('bash', [SCRIPT], {
      encoding: 'utf-8',
      env: {
        ...baseEnv,
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        CLUBDESK_SYNC_DIR: dir,
        CLUBDESK_ENV: 'prod',
        FAKE_LOG: log,
        ...env,
      },
    })
    const sql = existsSync(log) ? readFileSync(log, 'utf-8').split('\0').filter(Boolean) : []
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, sql }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const isReadback = (q) => q.includes("SET down_state='queued'")
const isUpWriteBack = (q) => /SET up_state='(done|failed)'/.test(q)

test('a committed push queues the read-back down after writing the up result', { skip: !haveTools }, () => {
  const r = run({ CLUBDESK_UP_COMMIT: '1' })
  assert.equal(r.status, 0, r.stderr)
  const done = r.sql.findIndex((q) => q.includes("SET up_state='done'"))
  const rb = r.sql.findIndex(isReadback)
  assert.ok(done >= 0, 'up_state=done was never written')
  assert.ok(rb > done, 'the read-back must be queued AFTER the up write-back (enqueue refuses while up is busy)')
  assert.match(r.stdout, /read-back sync-down queued/)
})

test('the read-back mirrors enqueueClubdeskDown and audits itself', { skip: !haveTools }, () => {
  const q = run({ CLUBDESK_UP_COMMIT: '1' }).sql.find(isReadback)
  assert.ok(q)
  // Same fields enqueueClubdeskDown writes, progress trio included.
  for (const frag of ['down_requested_at=now()', 'down_message=NULL', 'down_finished_at=NULL',
    'down_phase=NULL', 'down_progress=0', 'down_log=NULL']) {
    assert.ok(q.includes(frag), `missing ${frag}`)
  }
  // Same lock rule: never over a busy down or a group fix.
  assert.match(q, /COALESCE\(down_state,'idle'\) NOT IN \('queued','running'\)/)
  assert.match(q, /COALESCE\(grp_state,'idle'\) NOT IN \('queued','running'\)/)
  // One statement: the audit row exists exactly when the queue took.
  assert.match(q, /INSERT INTO user_logs \(action, collection_name, record_id, data, "user", date_created\)/)
  assert.match(q, /FROM q RETURNING 1/)
  const data = JSON.parse(q.match(/'(\{[^']*\})'::json/)[1])
  assert.deepEqual(data, { kind: 'clubdesk_member_sync_request', direction: 'down', source: 'up_readback' })
})

test('a dry-run never queues a read-back', { skip: !haveTools }, () => {
  const r = run() // CLUBDESK_UP_COMMIT unset
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.sql.some((q) => q.includes('Dry-run OK')), 'expected the dry-run write-back')
  assert.equal(r.sql.filter(isReadback).length, 0)
})

test('dev is forced to dry-run and never queues a read-back', { skip: !haveTools }, () => {
  const r = run({ CLUBDESK_ENV: 'dev', CLUBDESK_UP_COMMIT: '1' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.sql.filter(isReadback).length, 0)
})

test('a failed commit never queues a read-back', { skip: !haveTools }, () => {
  const r = run({ CLUBDESK_UP_COMMIT: '1', FAKE_COMMIT_FAIL: '1' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.sql.some((q) => q.includes("SET up_state='failed'")), 'expected the failure write-back')
  assert.equal(r.sql.filter(isReadback).length, 0)
  assert.equal(r.sql.filter(isUpWriteBack).length, 1)
})

test('a down already holding the lock is reported, not stacked on', { skip: !haveTools }, () => {
  const r = run({ CLUBDESK_UP_COMMIT: '1', FAKE_READBACK: '0' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.sql.filter(isReadback).length, 1)
  assert.match(r.stdout, /read-back sync-down NOT queued/)
  assert.match(r.stdout, /=== up-dispatch: done/)
})
