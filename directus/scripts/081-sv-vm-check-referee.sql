-- Migration 081: add referee columns to sv_vm_check
--
-- The Volleymanager sync (vm-sync-check.mjs) now also fetches club referees
-- from /api/sportmanager.indoorvolleyball/api\clubreferee. VM does not expose a
-- referee licence *grade* — only the managing association(s) (SVRZ / SVRNO) the
-- referee is licensed under. We store the boolean presence + the association
-- list here (the audit table), mirroring how is_writer drives members.scorer_vb.
-- members.referee_vb (added in migration 067) is the denormalised flag.
--
-- Schema-only + idempotent. No permission rows here (those live in
-- setup-permissions.mjs); the sync runs as the cron admin which bypasses them.

BEGIN;

-- 1. Columns. NOT NULL DEFAULT false for the boolean so pre-backfill rows get a
--    sane value; the next sync rewrites every row anyway.
ALTER TABLE sv_vm_check ADD COLUMN IF NOT EXISTS is_referee    boolean NOT NULL DEFAULT false;
ALTER TABLE sv_vm_check ADD COLUMN IF NOT EXISTS referee_assoc text;

COMMENT ON COLUMN sv_vm_check.is_referee    IS 'Person holds a volleyball referee licence (appears in clubreferee for KSC Wiedikon). Drives members.referee_vb.';
COMMENT ON COLUMN sv_vm_check.referee_assoc IS 'Managing association(s) the referee is licensed under, e.g. "SVRZ" or "SVRZ, SVRNO". VM exposes no referee grade.';

-- 2. Register the fields in directus_fields so the admin UI shows them and the
--    REST upsert accepts them. Mirrors the is_writer (boolean) / team_names
--    (input) metadata already present on this collection.
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'sv_vm_check', f.field, NULL, f.interface, f.sort, false, f.note
FROM (VALUES
  ('is_referee',    'boolean', 14, 'Holds a volleyball referee licence (from clubreferee).'),
  ('referee_assoc', 'input',   15, 'Referee managing association(s), e.g. SVRZ.')
) AS f(field, interface, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'sv_vm_check' AND df.field = f.field
);

COMMIT;
