-- 293 — give a native invoice the fields a real Swiss Rechnung needs.
--
-- WHY: what wiedisync currently emails is a title line plus a QR payment part
-- (finance-qrbill.js:24-34). It has no addressee, no invoice date on the page, no
-- due date, no positions and no total — it is a payment slip, not an invoice.
-- ClubDesk emits a proper Rechnung, so this is the one place the club would be
-- visibly worse off after the move. Two independent audits called it a blocker.
--
-- Three columns, all nullable so every existing mirror row stays valid:
--
--   recipient_address / recipient_zip / recipient_city
--     The postal address AS AT BILLING TIME. Deliberately copied onto the invoice
--     rather than joined from members at render time: a member who moves in March
--     must not retroactively change where January's invoice was addressed, and the
--     five members with no email can only be reached by post at the address we
--     actually used. ClubDesk stores it on the invoice for the same reason.
--
--   lines
--     Invoice positions as JSONB: [{ "label": "...", "amount": 440 }, ...].
--     A dues invoice for a member who owes the no-Schreiberlizenz surcharge is
--     CHF 540, and "540" on its own invites the support question this column
--     answers on the page: 440 base + 100 surcharge. JSONB rather than a child
--     table because positions are written once at issue time and never queried
--     across invoices; a finance_invoice_lines table would buy joins nobody needs.
--     NULL/empty renders a single line from `subject` — every existing row.
--
-- Schema-only, idempotent. Permissions live in setup-permissions.mjs.

ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS recipient_address varchar(255);
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS recipient_zip     varchar(16);
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS recipient_city    varchar(128);
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS lines             jsonb;

COMMENT ON COLUMN finance_invoices.recipient_address IS
  'Street address the invoice was addressed to, copied at issue time. Not joined from members: a later move must not rewrite where an old invoice went.';
COMMENT ON COLUMN finance_invoices.recipient_zip IS 'Postal code as at billing time (see recipient_address).';
COMMENT ON COLUMN finance_invoices.recipient_city IS 'Town as at billing time (see recipient_address).';
COMMENT ON COLUMN finance_invoices.lines IS
  'Invoice positions: [{"label":"Mitgliederbeitrag 2026/27","amount":440},{"label":"Zuschlag ohne Schreiberlizenz","amount":100}]. NULL = render one line from subject. Sum must equal amount.';

-- ── Directus admin metadata so the items API + admin UI can read the columns ──
INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoices', 'recipient_address', 'input', true, 60, 'half', 'Street address at billing time.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'recipient_address');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoices', 'recipient_zip', 'input', true, 61, 'half', 'Postal code at billing time.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'recipient_zip');

INSERT INTO directus_fields (collection, field, interface, readonly, sort, width, note)
SELECT 'finance_invoices', 'recipient_city', 'input', true, 62, 'half', 'Town at billing time.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'recipient_city');

INSERT INTO directus_fields (collection, field, interface, special, readonly, sort, width, note)
SELECT 'finance_invoices', 'lines', 'input-code', ARRAY['cast-json'], true, 63, 'full', 'Invoice positions (JSON). Sum equals the invoice amount.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'lines');
