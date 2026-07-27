#!/usr/bin/env node
/**
 * import-clubdesk-finance.mjs — Load ClubDesk Finanz "Alle Spalten" CSV exports
 * (Rechnungen + Buchhaltung) into the finance_* collections (migration 114).
 *
 * Usage:
 *   node directus/scripts/import-clubdesk-finance.mjs <env> <invoices.csv> <bookings.csv> [--local] [--emit-sql]
 *     [--actor-name="…"] [--actor-email="…"]
 *
 *   <env> ∈ { dev, prod }
 *   CSVs are CP1252 (ISO-8859-1), ';'-delimited, '"'-quoted, Swiss amounts (1'234.56),
 *   dd.mm.yyyy dates. Header-name-aware (column order independent).
 *
 * What it does, in ONE psql transaction:
 *   1. finance_imports — one provenance row per file (\gset the ids for FK refs).
 *   2. finance_fiscal_years — upsert June–May years spanning all dates.
 *   3. finance_accounts — upsert the Kontenplan (distinct Soll/Haben), type from
 *      number range (1 asset / 2 liability+equity / 3 income / 4 expense / 9 close),
 *      division (vb/bb/club) from the account name.
 *   4. finance_transactions — DELETE source='clubdesk' then re-insert the ledger,
 *      resolving debit/credit account FKs by number + fiscal_year by date.
 *   5. finance_invoices — DELETE source='clubdesk' then re-insert, matching member
 *      by email (recipient E-Mail → members.email), fiscal_year by date.
 *   5b. Re-apply finance_invoice_member_overrides (migration 129) so treasurer
 *      member-links survive the delete+reinsert.
 *   5b2. Re-point finance_payments.clubdesk_guess (migration 254) from the
 *      stable match_clubdesk_id snapshot — the id FK dies with every reinsert.
 *   5c. Auto-confirm native invoices (Scope C) whose ClubDesk counterpart is
 *      paid, matched strictly by the native invoice number.
 *
 * Pure mirror: native rows (source='native', Scope C) are never touched. Re-runs
 * are idempotent (delete-clubdesk-then-insert for the two ledgers; upsert for the
 * reference tables). PII guard: AHV/IBAN/address columns in the invoice CSV are
 * intentionally NOT read — only invoice fields + a member link land in the DB.
 *
 * No npm deps — node:child_process / node:fs / built-in TextDecoder only.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const ENVS = {
  dev:  { container: 'kscw-postgres', database: 'directus_kscw_dev', user: 'supabase_admin' },
  prod: { container: 'kscw-postgres', database: 'postgres',          user: 'supabase_admin' },
}

const rawArgs = process.argv.slice(2)
const LOCAL = process.env.CLUBDESK_IMPORT_LOCAL === '1' || rawArgs.includes('--local')
const EMIT_SQL = rawArgs.includes('--emit-sql')
const getOpt = (k) => { const a = rawArgs.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : '' }
const ACTOR_NAME = getOpt('actor-name') || 'ClubDesk finance import'
const ACTOR_EMAIL = getOpt('actor-email') || ''
const positional = rawArgs.filter(a => !a.startsWith('--'))
const [envName, invoicesCsv, bookingsCsv] = positional
if (!envName || !ENVS[envName] || !invoicesCsv || !bookingsCsv) {
  console.error('Usage: import-clubdesk-finance.mjs <dev|prod> <invoices.csv> <bookings.csv> [--local] [--emit-sql] [--actor-name=…] [--actor-email=…]')
  process.exit(1)
}
const env = ENVS[envName]

// ── CSV helpers (CP1252 decode + quoted-field state machine) ────────
const decode = (p) => new TextDecoder('windows-1252').decode(readFileSync(p))
function parseCsv(s, delim = ';') {
  const rows = []; let row = [], field = '', inQ = false, i = 0
  while (i < s.length) {
    const c = s[i]
    if (inQ) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 2 }
      else if (c === '"') { inQ = false; i++ }
      else { field += c; i++ }
    } else {
      if (c === '"' && field === '') { inQ = true; i++ }
      else if (c === delim) { row.push(field); field = ''; i++ }
      else if (c === '\r') { i++ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++ }
      else { field += c; i++ }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}
/** Parse a CSV into {header, rows[], idx(name)->first-occurrence column index}. */
function loadCsv(path) {
  const all = parseCsv(decode(path))
  if (all.length < 1) throw new Error(`${path}: empty`)
  const header = all[0]
  const idx = {}
  header.forEach((h, i) => { if (!(h in idx)) idx[h] = i }) // first occurrence wins (dup 'Status')
  const rows = all.slice(1).filter(r => r.some(c => c && c.length))
  return { header, rows, idx }
}

// ── value transforms ────────────────────────────────────────────────
const sql = (v) => (v == null || v === '') ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const clean = (v) => (v == null ? '' : String(v).trim())
/** Swiss amount "1'234.56" / "210" → "1234.56" (string for ::numeric cast); '' → null. */
function amount(v) {
  const t = clean(v).replace(/'/g, '').replace(/\s/g, '')
  if (!t) return null
  const n = t.replace(/[^0-9.\-]/g, '')
  return n === '' ? null : n
}
/** dd.mm.yyyy → yyyy-mm-dd; '' → null. */
function date(v) {
  const m = clean(v).match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
/** dd.mm.yyyy HH:MM → yyyy-mm-dd HH:MM (Europe/Zurich wall-clock); '' → null. */
function datetime(v) {
  const m = clean(v).match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ ,]+(\d{2}):(\d{2}))?/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}` + (m[4] ? ` ${m[4]}:${m[5]}` : ' 00:00')
}
function accountType(number) {
  const d = clean(number)[0]
  if (d === '1') return 'asset'
  if (d === '2') return (number.startsWith('28') || number.startsWith('29')) ? 'equity' : 'liability'
  if (d === '3') return 'income'
  if (d === '4' || d === '5' || d === '6') return 'expense'
  if (d === '9') return 'close'
  return null
}
function accountDivision(name) {
  const n = clean(name)
  if (/\bVB\b/.test(n)) return 'vb'
  if (/\bBB\b/.test(n)) return 'bb'
  return 'club'
}
/** Map an ISO date to its KSCW fiscal year (June–May). Returns {label,starts_on,ends_on}. */
function fiscalYearOf(iso) {
  const [y, m] = iso.split('-').map(Number)
  const startY = m >= 6 ? y : y - 1
  return {
    label: `${startY}/${String((startY + 1) % 100).padStart(2, '0')}`,
    starts_on: `${startY}-06-01`,
    ends_on: `${startY + 1}-05-31`,
  }
}

// ── load both files ─────────────────────────────────────────────────
const inv = loadCsv(invoicesCsv)
const bk = loadCsv(bookingsCsv)
const need = (csv, name) => { if (!(name in csv.idx)) throw new Error(`${name} column missing — headers: ${csv.header.join(', ').slice(0, 200)}`) }
;['Datum', 'Soll (Nummer)', 'Haben (Nummer)', 'Betrag (CHF)'].forEach(n => need(bk, n))
;['[Id]', 'Rechnungsdatum', 'Betrag'].forEach(n => need(inv, n))

// ── derive accounts + fiscal years ──────────────────────────────────
const accounts = new Map() // number -> name
for (const r of bk.rows) {
  for (const [no, nm] of [[r[bk.idx['Soll (Nummer)']], r[bk.idx['Soll (Bezeichnung)']]],
                          [r[bk.idx['Haben (Nummer)']], r[bk.idx['Haben (Bezeichnung)']]]]) {
    const num = clean(no)
    if (num && !accounts.has(num)) accounts.set(num, clean(nm))
  }
}
const fyMap = new Map() // label -> {label,starts_on,ends_on}
const collectFy = (iso) => { if (iso) { const f = fiscalYearOf(iso); fyMap.set(f.label, f) } }
for (const r of bk.rows) collectFy(date(r[bk.idx['Datum']]))
for (const r of inv.rows) collectFy(date(r[inv.idx['Rechnungsdatum']]))

// ── build the psql transaction ──────────────────────────────────────
const g = (csv, r, name) => name in csv.idx ? r[csv.idx[name]] : '' // safe getter

const bookingValues = bk.rows.map(r => {
  const v = (n) => g(bk, r, n)
  return `(${sql(clean(v('ID')) || null)}, ${sql(clean(v('Typ')))}, ${sql(clean(v('Beleg')))}, ` +
    `${sql(date(v('Datum')))}, ${sql(clean(v('Text')))}, ` +
    `${sql(clean(v('Soll (Nummer)')))}, ${sql(clean(v('Soll (Bezeichnung)')))}, ` +
    `${sql(clean(v('Haben (Nummer)')))}, ${sql(clean(v('Haben (Bezeichnung)')))}, ` +
    `${sql(amount(v('Betrag (CHF)')))})`
}).join(',\n  ')

// Dedupe by ClubDesk [Id] — multi-position / collective invoices repeat the
// invoice id across rows; finance_invoices is invoice-level (UNIQUE clubdesk_id),
// and the columns we store are all invoice-level, so keeping the first row per id
// is lossless. Skip rows with no [Id].
const seenInvoiceIds = new Set()
const invRows = inv.rows.filter((r) => {
  const id = clean(g(inv, r, '[Id]'))
  if (!id || seenInvoiceIds.has(id)) return false
  seenInvoiceIds.add(id)
  return true
})
const invDupCount = inv.rows.length - invRows.length

const invoiceValues = invRows.map(r => {
  const v = (n) => g(inv, r, n)
  return `(${sql(clean(v('[Id]')))}, ${sql(clean(v('Nummer')) || null)}, ${sql(date(v('Rechnungsdatum')))}, ` +
    `${sql(clean(v('Betreff')))}, ${sql(amount(v('Betrag')))}, ${sql(clean(v('Status')))}, ` +
    `${sql(clean(v('Mahnstatus')))}, ${sql(date(v('Fällig am')))}, ${sql(amount(v('Betrag Bezahlt')))}, ` +
    `${sql(amount(v('Offener Betrag')))}, ${sql(amount(v('Überbezahlt Betrag')))}, ${sql(amount(v('Abgeschrieben Betrag')))}, ` +
    `${sql(clean(v('Zahlungsart')))}, ${sql(clean(v('Referenznummer')))}, ${sql(clean(v('Beitragskategorie')))}, ` +
    `${sql(date(v('Abgeschlossen am')))}, ${sql(datetime(v('Erstellt am')))}, ${sql(datetime(v('Geändert am')))}, ` +
    `${sql(clean(v('Empfänger')))}, ${sql(clean(v('E-Mail')))}, ${sql(clean(v('Benutzer-Id')))})`
}).join(',\n  ')

const accountValues = [...accounts.entries()].map(([num, nm]) =>
  `(${sql(num)}, ${sql(nm)}, ${sql(accountType(num))}, ${sql(accountDivision(nm))})`).join(',\n  ')

const fyValues = [...fyMap.values()].map(f =>
  `(${sql(f.label)}, ${sql(f.starts_on)}, ${sql(f.ends_on)})`).join(',\n  ')

// finance_imports.fiscal_year_label is varchar(16): store a single label or a
// compact "earliest–latest" range, never the full joined list (overflows on
// multi-year invoice exports).
const fyKeys = [...fyMap.keys()].sort()
const fyLabels = (fyKeys.length <= 1 ? (fyKeys[0] || '') : `${fyKeys[0]}–${fyKeys[fyKeys.length - 1]}`).slice(0, 16)
const invFile = basename(invoicesCsv).replace(/'/g, "''")
const bkFile = basename(bookingsCsv).replace(/'/g, "''")
// sha256 of the raw file bytes → finance_imports.source_checksum, so a
// double-import of the same export is visible in the provenance trail.
const checksum = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const invSha = checksum(invoicesCsv)
const bkSha = checksum(bookingsCsv)

const psqlInput = `
BEGIN;

-- 0. Same-file guard: warn (never abort) when the newest prior batch of the
-- same type is byte-identical — the delete+reinsert keeps the mirrors correct,
-- but the duplicate batch pollutes the provenance trail.
DO $$ BEGIN
  IF (SELECT source_checksum FROM finance_imports WHERE import_type = 'bookings'
       ORDER BY imported_at DESC, id DESC LIMIT 1) = ${sql(bkSha)} THEN
    RAISE WARNING 'bookings CSV is byte-identical to the previous bookings import';
  END IF;
  IF (SELECT source_checksum FROM finance_imports WHERE import_type = 'invoices'
       ORDER BY imported_at DESC, id DESC LIMIT 1) = ${sql(invSha)} THEN
    RAISE WARNING 'invoices CSV is byte-identical to the previous invoices import';
  END IF;
END $$;

-- 1. provenance rows
INSERT INTO finance_imports (import_type, filename, imported_by_name, imported_by_email, row_count, fiscal_year_label, source_checksum)
VALUES ('bookings', ${sql(bkFile)}, ${sql(ACTOR_NAME)}, ${sql(ACTOR_EMAIL || null)}, ${bk.rows.length}, ${sql(fyLabels)}, ${sql(bkSha)})
RETURNING id AS bookings_imp \\gset
INSERT INTO finance_imports (import_type, filename, imported_by_name, imported_by_email, row_count, fiscal_year_label, source_checksum)
VALUES ('invoices', ${sql(invFile)}, ${sql(ACTOR_NAME)}, ${sql(ACTOR_EMAIL || null)}, ${invRows.length}, ${sql(fyLabels)}, ${sql(invSha)})
RETURNING id AS invoices_imp \\gset

-- 2. fiscal years (upsert)
INSERT INTO finance_fiscal_years (label, starts_on, ends_on, source)
SELECT v.label, v.starts_on::date, v.ends_on::date, 'clubdesk'
FROM (VALUES
  ${fyValues}
) AS v(label, starts_on, ends_on)
ON CONFLICT (label) DO NOTHING;

-- 3. accounts / Kontenplan (upsert)
INSERT INTO finance_accounts (number, name, type, division, source)
SELECT v.number, v.name, v.type, v.division, 'clubdesk'
FROM (VALUES
  ${accountValues}
) AS v(number, name, type, division)
ON CONFLICT (number) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, division = EXCLUDED.division;

-- 4. ledger (full refresh of the clubdesk mirror)
DELETE FROM finance_transactions WHERE source = 'clubdesk';
INSERT INTO finance_transactions
  (clubdesk_id, typ, beleg, booking_date, text,
   debit_account_number, debit_account_name, credit_account_number, credit_account_name,
   debit_account, credit_account, amount_chf, fiscal_year, import_batch, source)
SELECT v.clubdesk_id, v.typ, v.beleg, v.booking_date::date, v.text,
   v.dno, v.dname, v.cno, v.cname,
   (SELECT id FROM finance_accounts WHERE number = v.dno),
   (SELECT id FROM finance_accounts WHERE number = v.cno),
   v.amount::numeric(12,2),
   (SELECT id FROM finance_fiscal_years fy WHERE v.booking_date::date BETWEEN fy.starts_on AND fy.ends_on ORDER BY fy.id LIMIT 1),
   :bookings_imp, 'clubdesk'
FROM (VALUES
  ${bookingValues}
) AS v(clubdesk_id, typ, beleg, booking_date, text, dno, dname, cno, cname, amount);

-- 5. invoices (full refresh of the clubdesk mirror; member matched by email)
DELETE FROM finance_invoices WHERE source = 'clubdesk';
INSERT INTO finance_invoices
  (clubdesk_id, number, invoice_date, subject, amount, status, dunning_status, due_date,
   amount_paid, open_amount, overpaid_amount, written_off_amount, payment_method, reference,
   fee_category, closed_on, cd_created_at, cd_changed_at, recipient_name, recipient_email,
   cd_benutzer_id, member, fiscal_year, import_batch, source)
SELECT v.clubdesk_id, v.number, v.invoice_date::date, v.subject, v.amount::numeric(12,2), v.status,
   v.dunning_status, v.due_date::date, v.amount_paid::numeric(12,2), v.open_amount::numeric(12,2),
   v.overpaid::numeric(12,2), v.written_off::numeric(12,2), v.payment_method, v.reference,
   v.fee_category, v.closed_on::date,
   (v.cd_created::timestamp AT TIME ZONE 'Europe/Zurich'),
   (v.cd_changed::timestamp AT TIME ZONE 'Europe/Zurich'),
   v.recipient_name, v.recipient_email, v.cd_benutzer_id,
   (SELECT m.id FROM members m WHERE lower(m.email) = lower(NULLIF(v.recipient_email, '')) ORDER BY m.id LIMIT 1),
   (SELECT fy.id FROM finance_fiscal_years fy WHERE v.invoice_date::date BETWEEN fy.starts_on AND fy.ends_on ORDER BY fy.id LIMIT 1),
   :invoices_imp, 'clubdesk'
FROM (VALUES
  ${invoiceValues}
) AS v(clubdesk_id, number, invoice_date, subject, amount, status, dunning_status, due_date,
       amount_paid, open_amount, overpaid, written_off, payment_method, reference, fee_category,
       closed_on, cd_created, cd_changed, recipient_name, recipient_email, cd_benutzer_id);

-- 5b. Re-apply treasurer member-link overrides (migration 129). The delete+
-- reinsert above wipes any hand-set member FK on clubdesk rows, so re-pin them
-- from finance_invoice_member_overrides. Guarded so the import still works if
-- the migration hasn't been applied yet. Email overrides first (link all of a
-- recipient's invoices), then per-invoice overrides.
DO $$ BEGIN
  IF to_regclass('public.finance_invoice_member_overrides') IS NOT NULL THEN
    UPDATE finance_invoices fi SET member = o.member
      FROM finance_invoice_member_overrides o
      WHERE fi.source = 'clubdesk' AND o.match_email IS NOT NULL
        AND lower(fi.recipient_email) = lower(o.match_email);
    UPDATE finance_invoices fi SET member = o.member
      FROM finance_invoice_member_overrides o
      WHERE fi.source = 'clubdesk' AND o.match_clubdesk_id IS NOT NULL
        AND fi.clubdesk_id = o.match_clubdesk_id;
  END IF;
END $$;

-- 5b2. Re-point finance_payments.clubdesk_guess (migration 254). The delete+
-- reinsert re-keys every mirror invoice id and the FK is ON DELETE SET NULL,
-- so restore the link from the stable match_clubdesk_id snapshot. A link whose
-- invoice vanished from ClubDesk flips to 'link_lost'; if the invoice
-- re-appears in a later export it comes back as a flag-only 'clubdesk_guess'
-- (the original confidence is unknowable by then). Guarded so the import still
-- works before the migration that adds the column ships.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'finance_payments' AND column_name = 'match_clubdesk_id') THEN
    UPDATE finance_payments p SET clubdesk_guess = fi.id,
        match_status = CASE WHEN p.match_status = 'link_lost' THEN 'clubdesk_guess' ELSE p.match_status END
      FROM finance_invoices fi
      WHERE p.match_clubdesk_id IS NOT NULL
        AND fi.source = 'clubdesk' AND fi.clubdesk_id = p.match_clubdesk_id
        AND (p.clubdesk_guess IS DISTINCT FROM fi.id OR p.match_status = 'link_lost');
    UPDATE finance_payments p SET match_status = 'link_lost'
      WHERE p.match_clubdesk_id IS NOT NULL AND p.clubdesk_guess IS NULL
        AND p.match_status IN ('clubdesk_match', 'clubdesk_guess')
        AND NOT EXISTS (SELECT 1 FROM finance_invoices fi
                         WHERE fi.source = 'clubdesk' AND fi.clubdesk_id = p.match_clubdesk_id);
  END IF;
END $$;

-- 5c. Phase 2: auto-confirm native invoices whose ClubDesk counterpart is paid.
-- ClubDesk is the source of truth for payment. A native invoice carries a number
-- (N-YYYY-NNNN) the treasurer reuses as the ClubDesk invoice Nummer or
-- Referenznummer; when that ClubDesk row imports as settled (Status 'Bezahlt' or
-- open_amount 0), flip the native invoice pending_confirmation/open -> paid
-- (confirmed_via='sync'). Match STRICTLY on number — never amount alone, which
-- would risk confirming the wrong invoice. Unmatched native invoices stay
-- pending until the treasurer confirms them manually. Idempotent: paid rows are
-- excluded by the status filter.
--
-- 5c-pre: record the sync confirmation as a finance_payments 'sync' row FIRST, so
-- the settlement ledger is the single source of truth and a later recompute (from a
-- manual payment/refund once partial-payments is live) can't silently revert the
-- sync'd paid state. Guarded on the entry_type column existing — the nightly prod
-- sync runs before the finance batch (migration 143) ships there.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'finance_payments' AND column_name = 'entry_type') THEN
    INSERT INTO finance_payments (invoice, amount, entry_type, method, payment_date, source, created_by_name)
    SELECT n.id, n.amount, 'payment', 'sync', COALESCE(cd.closed_on, CURRENT_DATE), 'native', 'clubdesk sync'
    FROM finance_invoices n
    JOIN finance_invoices cd ON cd.source = 'clubdesk' AND (n.number = cd.number OR n.number = cd.reference)
    WHERE n.source = 'native' AND n.status IN ('pending_confirmation', 'open')
      AND nullif(btrim(n.number), '') IS NOT NULL
      AND (lower(btrim(coalesce(cd.status, ''))) = 'bezahlt' OR coalesce(cd.open_amount, cd.amount, 0) <= 0)
      AND NOT EXISTS (SELECT 1 FROM finance_payments p WHERE p.invoice = n.id AND p.method = 'sync');
  END IF;
END $$;

UPDATE finance_invoices n SET
  status = 'paid', amount_paid = n.amount, open_amount = 0,
  closed_on = COALESCE(cd.closed_on, CURRENT_DATE),
  confirmed_at = now(), confirmed_via = 'sync', date_updated = now()
FROM finance_invoices cd
WHERE n.source = 'native'
  AND n.status IN ('pending_confirmation', 'open')
  AND nullif(btrim(n.number), '') IS NOT NULL
  AND cd.source = 'clubdesk'
  AND (n.number = cd.number OR n.number = cd.reference)
  AND (lower(btrim(coalesce(cd.status, ''))) = 'bezahlt' OR coalesce(cd.open_amount, cd.amount, 0) <= 0);

COMMIT;

SELECT 'accounts'    AS t, COUNT(*) FROM finance_accounts WHERE source='clubdesk'
UNION ALL SELECT 'fiscal_years', COUNT(*) FROM finance_fiscal_years
UNION ALL SELECT 'transactions', COUNT(*) FROM finance_transactions WHERE source='clubdesk'
UNION ALL SELECT 'invoices',     COUNT(*) FROM finance_invoices WHERE source='clubdesk'
UNION ALL SELECT 'invoices_matched_member', COUNT(*) FROM finance_invoices WHERE source='clubdesk' AND member IS NOT NULL;
`

if (EMIT_SQL) {
  process.stdout.write(psqlInput, () => process.exit(0))
} else {
  console.error(`→ ${envName}/${env.database}: ${bk.rows.length} bookings, ${invRows.length} invoices (${invDupCount} dup rows collapsed), ${accounts.size} accounts, ${fyMap.size} fiscal year(s)…`)
  const dockerExec = ['sudo', 'docker', 'exec', '-i', env.container,
    'psql', '-U', env.user, '-d', env.database, '-X', '-v', 'ON_ERROR_STOP=1']
  const cmd = LOCAL ? dockerExec : ['ssh', 'hetzner', ...dockerExec]
  const r = spawnSync(cmd[0], cmd.slice(1), { input: psqlInput, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    console.error('psql failed:')
    console.error(r.stderr || r.stdout)
    process.exit(1)
  }
  // Surface psql WARNINGs (e.g. the step-0 same-checksum guard) — they land on
  // stderr, which would otherwise be silently dropped on a successful run.
  if (r.stderr) process.stderr.write(r.stderr)
  process.stdout.write(r.stdout)
  console.log('✓ finance import complete')
}
