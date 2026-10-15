import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// import-clubdesk-finance.mjs is a CLI script (no exports) — exercise it
// end-to-end via --emit-sql on small CP1252 fixtures and assert structural
// invariants of the emitted psql payload: the mirror refresh, the provenance
// checksums (migration 254 / FIN-10) and the camt re-link step (FIN-01) that
// keeps finance_payments.clubdesk_guess alive across the delete+reinsert.
// Synthetic rows only (repo .gitignore blocks *.csv to keep real exports out).
const script = fileURLToPath(new URL('../import-clubdesk-finance.mjs', import.meta.url));

const invFixture = join(tmpdir(), `clubdesk-finance-inv-${process.pid}.csv`);
const bkFixture = join(tmpdir(), `clubdesk-finance-bk-${process.pid}.csv`);
// ⚠ Two invoices for the SAME [Id]: that column is the recipient CONTACT's
// ClubDesk id, not an invoice id. Deduping on it dropped 63% of the register
// (see migration 288) — these two rows must both survive.
const invBytes = Buffer.from([
  '[Id];Nummer;Rechnungsdatum;Betreff;Betrag;Status;Mahnstatus;Zahlungsart;Empfänger;E-Mail',
  'CD-1;R-1;01.07.2025;Beitrag;210;Bezahlt;;QR-Rechnung ohne Referenz;Petra Müller;petra@example.ch',
  'CD-1;R-2;01.07.2026;Beitrag;230;Gestellt;2. Mahnung;QR-Rechnung ohne Referenz;Petra Müller;petra@example.ch',
].join('\r\n') + '\r\n', 'latin1');
const bkBytes = Buffer.from([
  'Datum;Soll (Nummer);Soll (Bezeichnung);Haben (Nummer);Haben (Bezeichnung);Betrag (CHF);Typ;Beleg;Text;ID',
  "01.07.2025;1000;Kasse;3000;Ertrag VB;1'234.50;Standard;B-1;Testbuchung;42",
].join('\r\n') + '\r\n', 'latin1');
writeFileSync(invFixture, invBytes);
writeFileSync(bkFixture, bkBytes);
const invSha = createHash('sha256').update(invBytes).digest('hex');
const bkSha = createHash('sha256').update(bkBytes).digest('hex');

const r = spawnSync('node', [script, 'prod', invFixture, bkFixture, '--emit-sql'], { encoding: 'utf-8' });
rmSync(invFixture, { force: true });
rmSync(bkFixture, { force: true });
const sql = r.stdout;

test('emit-sql exits 0 and refreshes both clubdesk mirrors', () => {
  assert.equal(r.status, 0, r.stderr);
  assert.ok(sql.includes("DELETE FROM finance_transactions WHERE source = 'clubdesk';"));
  assert.ok(sql.includes("DELETE FROM finance_invoices WHERE source = 'clubdesk';"));
  assert.ok(sql.includes('1234.50'), 'Swiss amount not normalised');
});

test('every invoice survives — [Id] is the recipient contact, not the invoice', () => {
  // The regression that hid for months: one row per invoice, but both rows share
  // the recipient's [Id], so a dedupe on [Id] keeps only one of them.
  const values = sql.slice(sql.indexOf('-- 5. invoices'), sql.indexOf('-- 5b.'));
  assert.ok(values.includes("'R-1'"), 'first invoice dropped');
  assert.ok(values.includes("'R-2'"), 'second invoice of the same contact dropped');
  // clubdesk_id must be the invoice number; the contact id rides in cd_contact_id.
  assert.ok(values.includes('cd_contact_id'), 'cd_contact_id not written');
  assert.ok(/\('R-2', 'R-2',/.test(values), 'clubdesk_id is not keyed on the invoice Nummer');
  assert.ok(values.includes("'CD-1')"), 'recipient contact id not carried');
});

test('provenance rows carry the file sha256 and the same-file guard precedes them', () => {
  // Both INSERTs into finance_imports must include the checksum column + value.
  const provenance = sql.slice(sql.indexOf('-- 1. provenance rows'), sql.indexOf('-- 2.'));
  assert.ok(provenance.includes('source_checksum'), 'checksum column missing from provenance inserts');
  assert.ok(provenance.includes(bkSha), 'bookings sha256 missing');
  assert.ok(provenance.includes(invSha), 'invoices sha256 missing');
  // The warn-on-identical guard must run BEFORE the inserts, else it would
  // compare against the batch it just created.
  const guard = sql.indexOf('byte-identical');
  const inserts = sql.indexOf('INSERT INTO finance_imports');
  assert.ok(guard > 0 && guard < inserts, `guard not before inserts: guard=${guard} inserts=${inserts}`);
  assert.ok(sql.includes('RAISE WARNING'), 'guard must warn, never abort');
});

test('camt re-link (5b2) restores clubdesk_guess from match_clubdesk_id after the reinsert', () => {
  const reinsert = sql.indexOf("DELETE FROM finance_invoices WHERE source = 'clubdesk';");
  const overrides = sql.indexOf('finance_invoice_member_overrides');
  const relink = sql.indexOf('UPDATE finance_payments p SET clubdesk_guess = fi.id');
  const commit = sql.indexOf('\nCOMMIT;');
  assert.ok(relink > 0, 'missing re-link step');
  assert.ok(reinsert < overrides && overrides < relink && relink < commit,
    `order broken: reinsert=${reinsert} overrides=${overrides} relink=${relink} commit=${commit}`);
  // Guarded on the column existing (the nightly sync can predate migration 254).
  const guard = sql.lastIndexOf("column_name = 'match_clubdesk_id'", relink);
  assert.ok(guard > 0 && guard < relink, 're-link not guarded on match_clubdesk_id existing');
  // A vanished invoice flips to link_lost; a re-appeared one comes back as a guess.
  assert.ok(sql.includes("UPDATE finance_payments p SET match_status = 'link_lost'"), 'missing link_lost flip');
  assert.ok(sql.includes("CASE WHEN p.match_status = 'link_lost' THEN 'clubdesk_guess'"), 'missing link_lost restore');
});

test('shrink guard runs before the mirror refresh and names the export\'s fiscal years', () => {
  // The DELETE+reinsert replaces the whole mirror, so an export that lost years
  // (14.10.2026: 7 years → 2020/21 only) or most invoices (the "Alle" filter not
  // found → drafts only) would erase them silently. The guard must abort first.
  const guard = sql.indexOf('-- 3b. Shrink guard');
  const deleteBookings = sql.indexOf("DELETE FROM finance_transactions WHERE source = 'clubdesk';");
  const deleteInvoices = sql.indexOf("DELETE FROM finance_invoices WHERE source = 'clubdesk';");
  assert.ok(guard > 0 && guard < deleteBookings && guard < deleteInvoices, 'guard missing or after a DELETE');
  const block = sql.slice(guard, deleteBookings);
  assert.ok(block.includes("ARRAY['2025/26']::text[]"), 'export fiscal years not passed to the guard');
  assert.ok(block.includes('RAISE EXCEPTION'), 'guard must abort, not warn');
  assert.ok(/< 0\.9 \*/.test(block), 'invoice shrink threshold missing');
});

test('--allow-shrink drops the guard (deliberate rebuild)', () => {
  const inv = join(tmpdir(), `clubdesk-finance-inv2-${process.pid}.csv`);
  const bk = join(tmpdir(), `clubdesk-finance-bk2-${process.pid}.csv`);
  writeFileSync(inv, invBytes);
  writeFileSync(bk, bkBytes);
  const r2 = spawnSync('node', [script, 'prod', inv, bk, '--emit-sql', '--allow-shrink'], { encoding: 'utf-8' });
  rmSync(inv, { force: true });
  rmSync(bk, { force: true });
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(!r2.stdout.includes('-- 3b. Shrink guard'), 'guard still emitted with --allow-shrink');
  assert.ok(r2.stdout.includes("DELETE FROM finance_transactions WHERE source = 'clubdesk';"));
});

test('mirror values land as slugs (migration 419) behind a vocabulary guard', () => {
  const guard = sql.indexOf('-- 3c. Vocabulary guard');
  const deleteBookings = sql.indexOf("DELETE FROM finance_transactions WHERE source = 'clubdesk';");
  assert.ok(guard > 0 && guard < deleteBookings, 'vocabulary guard missing or after the mirror DELETE');
  const block = sql.slice(guard, deleteBookings);
  assert.ok(block.includes("ARRAY['Bezahlt', 'Gestellt']::text[]"), 'export statuses not checked');
  assert.ok(block.includes("ARRAY['Standard']::text[]"), 'export booking types not checked');
  assert.ok(/RAISE EXCEPTION 'ClubDesk invoice status/.test(block), 'unknown status must abort');
  assert.ok(/RAISE WARNING 'ClubDesk payment method/.test(block), 'unknown payment method only warns');
  const ledger = sql.slice(sql.indexOf('-- 4. ledger'), sql.indexOf('-- 5. invoices'));
  assert.ok(ledger.includes("cd_to_app('booking_type', v.typ)"), 'Typ not translated');
  assert.ok(ledger.includes('entry_type, voucher_no'), 'English ledger columns not written');
  const invoices = sql.slice(sql.indexOf('-- 5. invoices'), sql.indexOf('-- 5b.'));
  assert.ok(invoices.includes("cd_to_app('invoice_status', v.status)"), 'Status not translated');
  assert.ok(invoices.includes("cd_to_app('payment_method', v.payment_method)"), 'Zahlungsart not translated');
  assert.ok(invoices.includes('cd_user_id'), 'cd_user_id not written');
  assert.ok(!invoices.includes('dunning_status'), 'dropped column still written');
  // Mahnstatus '2. Mahnung' → level 2, an empty one → 0.
  assert.ok(/'Gestellt', 2, /.test(invoices), 'Mahnstatus not parsed into dunning_level');
  assert.ok(/'Bezahlt', 0, /.test(invoices), 'empty Mahnstatus is not level 0');
  // Settled tests use the slugs, not the German words.
  assert.ok(!/'bezahlt'|'storn%'/.test(sql), 'German status test left in the emitted SQL');
  assert.ok(sql.includes("fi.status IN ('paid', 'cancelled')"), 'self-report cleanup not on slugs');
});
