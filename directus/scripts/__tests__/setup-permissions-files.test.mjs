// Website audit 2026-09-28 — the permission-script + migration half of
// F-03 / F-07 / F-37 / F-38 / F-61.
//
// setup-permissions.mjs runs main() (and exits without credentials) on import,
// so these read its SOURCE. Each assertion pins one grant that the audit showed
// was wrong; a regression reintroducing it fails here instead of on prod.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(`${dir}/setup-permissions.mjs`, 'utf8');
// Code only — comments quote the removed grants on purpose.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const constList = (name) => {
  const m = code.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`));
  assert.ok(m, `${name} not found`);
  return m[1];
};
const publicCalls = (collection) => code
  .split('\n')
  .filter((l) => l.includes('PUBLIC_POLICY') && l.includes(`'${collection}'`));

// F-01 / F-02 (private folders, anonymous uploads) are the deep audit's design
// (migrations 387/388, ANON_UPLOAD_FOLDERS, OWN_UPLOAD_READBACK_FOLDERS) and are
// pinned by its own tests. This file pins only what the website audit adds on top.

test('F-03: both Public directus_files reads are field-scoped', () => {
  const j = code.indexOf("setPerm(PUBLIC_POLICY, 'directus_files', 'create'");
  assert.ok(j > 0);
  const block = code.slice(code.indexOf("setPermRead(PUBLIC_POLICY, 'directus_files'"), j);
  const reads = block.split("setPermRead(PUBLIC_POLICY, 'directus_files'").slice(1);
  assert.equal(reads.length, 2, 'the Public images row and the anonymous read-back row');
  for (const r of reads) assert.match(r, /PUBLIC_FILE_FIELDS\)/);
  const fields = constList('PUBLIC_FILE_FIELDS');
  for (const f of ['id', 'type', 'filename_download', 'modified_on']) assert.ok(fields.includes(`'${f}'`), f);
  for (const f of ['uploaded_by', 'metadata', 'title', 'description', 'location', 'tags', 'folder']) {
    assert.ok(!fields.includes(`'${f}'`), `${f} must not be public`);
  }
});

test('F-07: Public news requires is_published and can filter on it', () => {
  const i = code.indexOf("PUBLIC_POLICY, 'news'");
  assert.ok(i > 0);
  assert.match(code.slice(i, i + 250), /is_published: \{ _eq: true \}/);
  assert.ok(constList('PUBLIC_NEWS_FIELDS').includes("'is_published'"));
});

test('F-38: no Public read on events', () => {
  assert.deepEqual(publicCalls('events'), []);
});

test('F-61: hall_slots and halls are field-scoped and never expose notes', () => {
  assert.match(publicCalls('hall_slots').find((l) => !l.includes('hall_slots_teams')), /PUBLIC_HALL_SLOT_FIELDS/);
  assert.match(publicCalls('halls')[0], /PUBLIC_HALL_FIELDS/);
  for (const name of ['PUBLIC_HALL_SLOT_FIELDS', 'PUBLIC_HALL_FIELDS']) assert.ok(!constList(name).includes("'notes'"), name);
  // The website filters youth slots on sport + slot_type: a filter on an
  // unreadable field 403s the whole query, so both must stay readable.
  for (const f of ['sport', 'slot_type', 'day_of_week', 'start_time', 'end_time', 'label', 'hall', 'valid_from', 'valid_until', 'indefinite', 'teams']) {
    assert.ok(constList('PUBLIC_HALL_SLOT_FIELDS').includes(`'${f}'`), f);
  }
  for (const f of ['name', 'address', 'city']) assert.ok(constList('PUBLIC_HALL_FIELDS').includes(`'${f}'`), f);
});

test('migration 391 backfills NULL is_published only, transactional + idempotent', () => {
  const file = readdirSync(dir).find((f) => f.startsWith('391-'));
  assert.ok(file, 'migration 391 missing');
  const sql = readFileSync(`${dir}/${file}`, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /UPDATE news SET is_published = true\s+WHERE is_published IS NULL\s+AND published_at IS NOT NULL;/);
  assert.doesNotMatch(sql, /directus_files|directus_folders/, 'folders are 387/388\'s job');
  assert.doesNotMatch(sql, /directus_permissions/, 'permissions belong in setup-permissions.mjs');
});

test('migration 392 drops the one-token-per-user constraint (F-37), transactional + idempotent', () => {
  const file = readdirSync(dir).find((f) => f.startsWith('392-'));
  assert.ok(file, 'migration 392 missing');
  const sql = readFileSync(`${dir}/${file}`, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS password_reset_tokens_user_unique/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS \w+\s+ON password_reset_tokens \("user"\)/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM/i, 'schema-only: no token rows are touched');
});
