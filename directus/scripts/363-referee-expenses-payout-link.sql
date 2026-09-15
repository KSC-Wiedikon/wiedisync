-- 363 — referee_expenses.payout: the season-end reimbursement link.
--
-- A referee fee is money a member paid out of pocket at a home game
-- (referee_expenses, written from the game modal). Until now nothing tied it
-- to finance: the treasurer reimbursed from memory and the member had no
-- record. The decision (2026-09-15) is to DERIVE, never mirror — the fee row
-- stays the single record; /finance/my-invoices and /finance/team/:id read it
-- at request time, and the team's `net` never includes it (referee fees are
-- club-reimbursed, not a Teamkasse item).
--
-- The one write this needs is the settlement mark. At season end the
-- treasurer runs POST /kscw/finance/referee-payout-run, which creates ONE
-- finance_payouts row per paying member (their fees for the season, summed)
-- and stamps every settled fee row with that payout's id. `payout IS NULL`
-- therefore means "not yet reimbursed" — the run's candidate filter, and the
-- scope under which a coach / sport admin may still edit or delete the row
-- (setup-permissions.mjs: REFEREE_EXPENSE_I_LEAD_UNPAID + the Sport Admin
-- update/delete filter). A reimbursed fee is frozen.
--
-- ON DELETE SET NULL, same as finance_expenses.payout (migration 177): if a
-- payout row is ever removed the fee reverts to "unpaid" rather than vanishing.
--
-- Schema-only + idempotent (per CLAUDE.md hard rule). No permission rows —
-- the scope change lives in setup-permissions.mjs.
--
-- ⚠ Registers a directus_fields + directus_relations row — RESTART the
-- container after applying (`npm run deploy:dev` chains it) or the field reads
-- back as an alias and the items API cannot expand it.

BEGIN;

-- ── Column + FK ───────────────────────────────────────────────────────
ALTER TABLE referee_expenses ADD COLUMN IF NOT EXISTS payout integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referee_expenses_payout_fk') THEN
    ALTER TABLE referee_expenses ADD CONSTRAINT referee_expenses_payout_fk
      FOREIGN KEY (payout) REFERENCES finance_payouts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS referee_expenses_payout_idx ON referee_expenses (payout);

COMMENT ON COLUMN referee_expenses.payout IS
  'finance_payouts row that reimbursed this fee — set by the season-end run (POST /kscw/finance/referee-payout-run), one payout per member per season. NULL = not yet reimbursed; only unpaid rows are editable by coaches / sport admins.';

-- ── Directus admin metadata ──────────────────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width, note)
SELECT 'referee_expenses', 'payout', 'm2o', 'select-dropdown-m2o', 'related-values', true, 20, 'half',
  'Season-end reimbursement (finance_payouts). Set by the payout run; NULL = not yet reimbursed.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'referee_expenses' AND field = 'payout');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_deselect_action)
SELECT 'referee_expenses', 'payout', 'finance_payouts', 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'referee_expenses' AND many_field = 'payout');

COMMIT;

-- Container restart required after apply: Directus caches the schema at boot,
-- so the new field/relation is invisible to the items API until then.
