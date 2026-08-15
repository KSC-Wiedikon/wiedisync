import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// import-clubdesk-csv.mjs is a CLI script (no exports) — exercise it end-to-end
// via --emit-sql on a small CP1252 fixture and assert structural invariants of
// the emitted psql payload. This guards the pass CHAIN (order, guards, balance),
// not the SQL semantics — those are covered by the scratch-DB rehearsal
// documented in the create-pass comment (2026-07-07).
// The fixture is generated inline (repo .gitignore blocks *.csv to keep real
// member exports out — synthetic rows only; latin1 bytes == CP1252 for ü/ä).
const script = fileURLToPath(new URL('../import-clubdesk-csv.mjs', import.meta.url));
const fixture = join(tmpdir(), `clubdesk-export-test-${process.pid}.csv`);
const rows = [
  'Nachname;Vorname;E-Mail;E-Mail Alternativ;Status;Eintritt;Austritt;Sektion;Beitragskategorie;Geschlecht;Geburtsdatum;[Gruppen];[Rolle];[Id]',
  'Müller;Petra;petra@example.ch;;Passivmitglied;01.08.2020;;KSCW;Passivmitglied;weiblich;03.05.1975;Passivmitglieder;Standard Benutzer;1000001',
  'Meier;Hans;hans@example.ch;;Kein Mitglied;;;;;männlich;;;Gast (kein Login);1000002',
  'Weber;Anna;anna@example.ch;;Aktivmitglied;01.08.2019;30.06.2026;Volleyball;VB Erwerbstätige;weiblich;12.12.1990;VB D2 (Spieler*in);Standard Benutzer;1000003',
];
writeFileSync(fixture, Buffer.from(rows.join('\r\n') + '\r\n', 'latin1'));

const r = spawnSync('node', [script, 'prod', fixture, '--emit-sql'], { encoding: 'utf-8' });
rmSync(fixture, { force: true });
const sql = r.stdout;

test('emit-sql exits 0 and produces the staging load', () => {
  assert.equal(r.status, 0, r.stderr);
  assert.ok(sql.includes('TRUNCATE clubdesk_export RESTART IDENTITY;'));
  // \copy column list must match the staging columns of migrations 064+065
  // (+ wiedisync_id, added 2026-07-07 for the round-trip linker; + js_id, added
  // 2026-07-08 (migration 195) for the J+S Personennummer down-sync;
  // + federation_of_origin, added 2026-07-25 (migration 223) for the
  // transfer-certificate federation down-sync; + gast, added 2026-07-27
  // (migration 244) so drift detection can see the register's copy of the
  // guest flag wiedisync pushes; + trainer_lizenz, added 2026-08-03 (migration
  // 275) for the two-way coaching-education sync).
  const copyLine = sql.split('\n').find((l) => l.startsWith('\\copy clubdesk_export('));
  assert.ok(copyLine, 'missing \\copy line');
  assert.equal(copyLine.slice(copyLine.indexOf('(') + 1, copyLine.indexOf(')')).split(',').length, 67);
  assert.ok(copyLine.includes('wiedisync_id'), 'wiedisync_id missing from staging load');
  assert.ok(copyLine.includes('js_id'), 'js_id missing from staging load');
  assert.ok(copyLine.includes('federation_of_origin'), 'federation_of_origin missing from staging load');
  assert.ok(copyLine.includes('gast'), 'gast missing from staging load');
  assert.ok(copyLine.includes('trainer_lizenz'), 'trainer_lizenz missing from staging load');
});

// The create pass STAGES a proposal now (migration 321) instead of inserting the
// member itself, so these anchor on the proposal INSERT. The guards below did
// not move and are still the hard part — see the create-pass comment in the
// script: they are what keeps 447 departed contacts and every married-name
// re-registration out of the queue. Staging a bad create is cheaper than
// inserting one, but only because a human then has to judge it; a guard that
// stopped working would bury the real proposals in noise.
const CREATE_INSERT = "INSERT INTO clubdesk_sync_proposals (member_id, clubdesk_id, field, current_value, proposed_value, rule, payload)";

test('create-proposal pass sits between the linker and the duplicate report', () => {
  const linker = sql.indexOf("'members_linked_clubdesk'");
  const create = sql.indexOf(CREATE_INSERT);
  const dupes = sql.indexOf("'clubdesk_contact_suspected_duplicate'");
  assert.ok(linker > 0 && create > linker && dupes > create,
    `order broken: linker=${linker} create=${create} dupes=${dupes}`);
  // Linking must precede it, or every already-linked member looks missing.
  assert.equal(sql.split(CREATE_INSERT).length - 1, 1, 'exactly one create pass');
  assert.ok(sql.indexOf("'clubdesk_create_proposals'") > create, 'create metric missing');
});

test('create-proposal pass carries all four same-person guards and the scope filters', () => {
  const at = sql.indexOf(CREATE_INSERT);
  const pass = sql.slice(sql.lastIndexOf('WITH cd AS (', at), at);
  assert.ok(pass.includes("btrim(status) IN ('Aktivmitglied','Passivmitglied','Ehrenmitglied','Zwischenjahr')"), 'status scope');
  assert.ok(pass.includes("NULLIF(btrim(austritt),'') IS NULL"), 'austritt scope');
  assert.ok(pass.includes('length(btrim(clubdesk_id)) <= 64'), 'cdid length cap');
  assert.ok(pass.includes('email_alt_l'), 'G1/G3 must consider email_alternativ');
  assert.ok(pass.includes('FROM cd c2'), 'G4 within-batch dedup');
  assert.match(pass, /\(length\(c2\.cdid\), c2\.cdid\) < \(length\(cd\.cdid\), cd\.cdid\)/, 'numeric-safe twin ordering');
});

test('a refused create proposal is never re-proposed', () => {
  const at = sql.indexOf(CREATE_INSERT);
  const pass = sql.slice(at, sql.indexOf("'clubdesk_create_proposals'"));
  // ON CONFLICT covers the PENDING partial unique; the refused one is a
  // DIFFERENT index, so without this NOT EXISTS a refusal would be re-raised on
  // every run and refusing would stop being a durable decision.
  assert.ok(pass.includes('ON CONFLICT DO NOTHING'), 're-run guard missing');
  assert.match(pass, /NOT EXISTS[\s\S]*status = 'refused'/, 'refused tombstone not honoured');
});

test('suspected-duplicate report and public_stats refresh are emitted after the create pass', () => {
  const create = sql.indexOf(CREATE_INSERT);
  assert.ok(create > 0, 'create pass missing entirely');
  assert.ok(sql.indexOf("'clubdesk_contact_suspected_duplicate'") > create, 'skip report missing');
  const stats = sql.indexOf("to_regclass('public.public_stats')");
  assert.ok(stats > create, 'public_stats refresh missing');
  assert.ok(sql.indexOf("'members_active_total'") > stats, 'final active-count metric missing');
});

// The whole point of migration 321: the sync-down PROPOSES and does not write.
// Linking is the one deliberate exception — `clubdesk_id` is identity, not data,
// and it only ever fills an empty cell. If a data column ever reappears in an
// UPDATE here, a correction made in wiedisync can be silently reverted by the
// next weekly cron, which is the defect the review queue exists to remove.
test('the sync-down writes nothing to members except the clubdesk_id link', () => {
  assert.equal(sql.split('INSERT INTO members').length - 1, 0, 'sync-down must not insert members');
  const updates = sql.match(/UPDATE members[^\n]*\n?[^\n]*/g) ?? [];
  assert.ok(updates.length > 0, 'the linker passes disappeared');
  for (const u of updates) {
    assert.match(u, /SET clubdesk_id =/, `sync-down writes a data column: ${u.trim()}`);
  }
});

test('emitted SQL is parenthesis-balanced (guards against pass-editing slips)', () => {
  // Strip string literals ('' escapes included) and line comments, then count.
  const stripped = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    assert.ok(depth >= 0, 'closing paren without opener');
  }
  assert.equal(depth, 0, `unbalanced parens: depth ${depth} at EOF`);
});
