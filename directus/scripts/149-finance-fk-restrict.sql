-- Migration 149: protect financial-audit records from cascade deletion.
--
-- Audit 2026-06-25 (PG-2 / PG-3). finance_payments (camt.053/054 reconciliation
-- — proof that money arrived against an invoice) and finance_dunning_notices
-- (Mahnwesen reminder trail — a legally relevant record that reminders were
-- sent) both referenced finance_invoices ON DELETE CASCADE. Deleting an invoice
-- therefore silently destroyed every received-payment row and the entire
-- dunning/escalation history tied to it. Switch both FKs to ON DELETE RESTRICT:
-- an invoice that carries payments or dunning notices can no longer be
-- hard-deleted (the finance UI must void/soft-delete instead), preserving the
-- accounting + dunning audit trail. Not member-triggerable (finance/admin
-- gated) — this is an accounting-integrity safeguard.
--
-- Idempotent: each block drops whatever FK currently constrains the `invoice`
-- column (by name, resolved from pg_constraint) and re-adds it with RESTRICT.

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
   WHERE con.conrelid = 'finance_payments'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'finance_payments'::regclass
                                AND attname = 'invoice')]::smallint[];
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE finance_payments DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE finance_payments
    ADD CONSTRAINT finance_payments_invoice_fk
    FOREIGN KEY (invoice) REFERENCES finance_invoices(id) ON DELETE RESTRICT;
END $$;

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
   WHERE con.conrelid = 'finance_dunning_notices'::regclass
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'finance_dunning_notices'::regclass
                                AND attname = 'invoice')]::smallint[];
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE finance_dunning_notices DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE finance_dunning_notices
    ADD CONSTRAINT finance_dunning_notices_invoice_fk
    FOREIGN KEY (invoice) REFERENCES finance_invoices(id) ON DELETE RESTRICT;
END $$;
