-- Migration 142: dues-email send hardening (from the adversarial safety review).
--
-- (1) At-most-one running send per run, enforced at the DB. The endpoint's
--     check-then-insert guard was a TOCTOU race: two near-simultaneous live POSTs
--     could both pass the SELECT and both spawn a worker → every member emailed
--     twice. A partial unique index makes a second running row impossible.
-- (2) Per-invoice LIVE-send marker (finance_invoices.email_sent_at) so a crashed
--     or retried run only sends the remainder (idempotent resume — no duplicate
--     invoices). TEST-mode sends never set it, so the eventual live send still
--     reaches every member.
--
-- Schema-only + idempotent.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS finance_email_jobs_one_running
  ON finance_email_jobs (dues_run) WHERE status = 'running';

ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;
COMMENT ON COLUMN finance_invoices.email_sent_at IS
  'When this native dues invoice was emailed to the member (LIVE send only). NULL = not yet; used to skip already-emailed invoices on a resumed/retried run. Test-mode sends never set it.';

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort)
SELECT 'finance_invoices', 'email_sent_at', 'datetime', true, true, 38
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'finance_invoices' AND field = 'email_sent_at');

COMMIT;
