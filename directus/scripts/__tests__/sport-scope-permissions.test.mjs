// 2026-10-11 audit M7 — sport admins confined to their sport at the policy layer.
// Pins the section-policy rows (sport-scope-permissions.mjs) and that
// setup-permissions.mjs no longer grants any of that data club-wide.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SPORT_POLICIES, SPORT_SCOPED_COLLECTIONS, VORSTAND_SPORT_DATA, sportScopedPermissions,
} from '../sport-scope-permissions.mjs';

const CTX = {
  memberReadFields: ['id', 'iban', 'ahv_number', 'permissions_section'],
  memberWriteFields: ['id', 'iban', 'ahv_number'],
  eventWriteFields: ['id', 'title'],
  refereeUnpaid: { payout: { _null: true } },
};
const VB = sportScopedPermissions('volleyball', CTX);
const BB = sportScopedPermissions('basketball', CTX);

// Every key a filter may walk: scalars, or an M2O hop. An O2M/M2M alias
// (`teams`, `member_teams`, `coach`, `invited_members` …) walked from a policy
// silently empties a frontend query through the same junction (CLAUDE.md).
const ALLOWED_KEYS = new Set([
  '_and', '_or', '_eq', '_in', '_nin', '_null',
  'sport', 'permissions_section', 'membership_type', 'anonymous', 'payout',
  'team', 'teams_id', 'kscw_team', 'claimed_by_team', 'game', 'member', 'event', 'events_id', 'poll',
]);
function keysOf(node, out = new Set()) {
  if (Array.isArray(node)) { for (const n of node) keysOf(n, out); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { out.add(k); keysOf(v, out); }
  }
  return out;
}

test('two section policies, one per sport admin flag', () => {
  assert.deepEqual(SPORT_POLICIES.map((p) => [p.sport, p.appRole]), [['volleyball', 'vb_admin'], ['basketball', 'bb_admin']]);
  assert.deepEqual(new Set(SPORT_POLICIES.map((p) => p.name)).size, 2);
});

test('every sport-scoped collection is granted to the volleyball section', () => {
  const granted = new Set(VB.map((r) => r.collection));
  for (const c of SPORT_SCOPED_COLLECTIONS) assert.ok(granted.has(c), c);
});

test('basketball has no Swiss Volley licence mirror; otherwise the same rows', () => {
  assert.ok(!BB.some((r) => r.collection === 'sv_vm_check'));
  const shape = (rows) => rows.filter((r) => r.collection !== 'sv_vm_check').map((r) => `${r.collection}.${r.action}`);
  assert.deepEqual(shape(BB), shape(VB));
});

test('read/update/delete rows carry a filter naming their own sport', () => {
  for (const [sport, rows] of [['volleyball', VB], ['basketball', BB]]) {
    const other = sport === 'volleyball' ? 'basketball' : 'volleyball';
    for (const r of rows) {
      if (r.action === 'create' || r.collection === 'sv_vm_check') continue;
      assert.ok(r.permissions, `${r.collection}.${r.action} has no filter`);
      const json = JSON.stringify(r.permissions);
      assert.ok(json.includes(`"${sport}"`), `${r.collection}.${r.action} does not name ${sport}`);
      // The registrations filter names both sports only to exclude them.
      if (r.collection !== 'registrations') assert.ok(!json.includes(`"${other}"`), `${r.collection}.${r.action} names ${other}`);
    }
  }
});

test('create rows carry no filter (Directus has no row to match on create)', () => {
  for (const r of VB.filter((x) => x.action === 'create')) assert.equal(r.permissions, null, r.collection);
});

test('no filter walks an O2M/M2M alias', () => {
  for (const r of [...VB, ...BB]) {
    for (const k of keysOf(r.permissions)) assert.ok(ALLOWED_KEYS.has(k), `${r.collection}.${r.action} walks "${k}"`);
  }
});

test("'both' members and events are in either section", () => {
  const read = (c) => VB.find((r) => r.collection === c && r.action === 'read').permissions;
  assert.deepEqual(read('members'), { permissions_section: { _in: ['volleyball', 'both'] } });
  assert.deepEqual(read('events'), { permissions_section: { _in: ['volleyball', 'both'] } });
  assert.deepEqual(read('absences'), { member: { permissions_section: { _in: ['volleyball', 'both'] } } });
});

test('members: read and update only, with the given field lists; no create or delete', () => {
  const m = VB.filter((r) => r.collection === 'members');
  assert.deepEqual(m.map((r) => r.action).sort(), ['read', 'update']);
  assert.deepEqual(m.find((r) => r.action === 'read').fields, CTX.memberReadFields);
  assert.deepEqual(m.find((r) => r.action === 'update').fields, CTX.memberWriteFields);
});

test('referee fees stay editable only while unpaid; anonymous poll votes stay unreadable', () => {
  const ref = VB.filter((r) => r.collection === 'referee_expenses');
  for (const a of ['update', 'delete']) {
    assert.match(JSON.stringify(ref.find((r) => r.action === a).permissions), /"payout":\{"_null":true\}/);
  }
  const pv = VB.find((r) => r.collection === 'poll_votes' && r.action === 'read');
  assert.match(JSON.stringify(pv.permissions), /"anonymous":\{"_eq":false\}/);
});

// ── setup-permissions.mjs no longer grants the same data club-wide ──
const dir = fileURLToPath(new URL('..', import.meta.url));
const code = readFileSync(`${dir}/setup-permissions.mjs`, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const constList = (name) => {
  const m = code.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`));
  assert.ok(m, `${name} not found`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

test('the shared Sport Admin list holds no sport-scoped collection', () => {
  const list = constList('SPORT_ADMIN_FULL_CRUD');
  for (const c of SPORT_SCOPED_COLLECTIONS) assert.ok(!list.includes(c), c);
  for (const c of ['games', 'members', 'events', 'referee_expenses', 'poll_votes', 'sv_vm_check']) {
    assert.doesNotMatch(code, new RegExp(`\\(SPORT_ADMIN_POLICY, '${c}', '(read|update|delete)'`), c);
    assert.doesNotMatch(code, new RegExp(`setPermRead\\(SPORT_ADMIN_POLICY, '${c}'`), c);
  }
});

test('the board policy reads no sport data club-wide', () => {
  const list = constList('VORSTAND_READ_ALL');
  for (const c of VORSTAND_SPORT_DATA) assert.ok(!list.includes(c), c);
  for (const c of VORSTAND_SPORT_DATA) {
    assert.doesNotMatch(code, new RegExp(`setPermRead\\(VORSTAND_POLICY, '${c}'`), c);
  }
});

test('the section policies are reconciled per user and audited as such', () => {
  assert.match(code, /ROLE_POLICY_BACKFILLS = \[[\s\S]*SPORT_SECTION_POLICIES\.map/);
  assert.match(code, /PER_USER_POLICIES = new Set\(\[[\s\S]*SPORT_POLICIES\.map/);
});
