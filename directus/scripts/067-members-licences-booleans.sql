-- Migration 067: split members.licences (json) into 6 boolean columns
--
-- Replaces the JSON-array storage (e.g. `["scorer_vb","referee_vb"]`) with
-- six explicit booleans. JSON is hostile to:
--   * `/admin/sql` queries (json vs jsonb casting, @>, ?, jsonb_array_elements)
--   * ClubDesk↔Directus reconciliation diff queries
--   * `/admin/explore` _contains filters (debugged 2026-05-20)
--   * per-field permissions (we can't grant scorer_vb without referee_*)
--   * Postgres indexes on a specific licence flag
--
-- Cutover strategy: keep `members.licences` (json) on disk through this
-- migration and one release. Migration 069 (separate PR, ~1-2 weeks later)
-- drops it. All code in this PR reads + writes the new booleans; legacy
-- JSON is no longer authoritative but remains as a passive rollback target.
--
-- Schema-only + idempotent. Permissions for the new fields live in
-- setup-permissions.mjs (MEMBER_VISIBLE_FIELDS / MEMBER_EDITABLE_FIELDS) —
-- per the "Permissions live ONLY in setup-permissions.mjs" rule.

BEGIN;

-- 1. Add the six boolean columns. NOT NULL with DEFAULT false so existing
--    rows get a sane value without a separate UPDATE step blocking the lock.
ALTER TABLE members ADD COLUMN IF NOT EXISTS scorer_vb  boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS referee_vb boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS otr1_bb    boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS otr2_bb    boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS otn_bb     boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS referee_bb boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN members.scorer_vb  IS 'Has the volleyball scorer (Schreiber) licence. Sourced from sv_vm_check + ClubDesk Volleyball Lizenz.';
COMMENT ON COLUMN members.referee_vb IS 'Has the volleyball referee licence.';
COMMENT ON COLUMN members.otr1_bb    IS 'Basketball OTR1 (table official tier 1). Sourced from ClubDesk Offizielle Lizenz.';
COMMENT ON COLUMN members.otr2_bb    IS 'Basketball OTR2 (table official tier 2). Sourced from ClubDesk Offizielle Lizenz.';
COMMENT ON COLUMN members.otn_bb     IS 'Basketball OTN (table official, national). Sourced from ClubDesk Offizielle Lizenz.';
COMMENT ON COLUMN members.referee_bb IS 'Basketball referee licence.';

-- 2. Backfill from the JSON column. Idempotent: re-running flips a boolean
--    only if the JSON still says so. Safe to run alongside concurrent writes
--    because the boolean defaults to false and the SET is a single statement.
--    Use `??` (jsonb ?| any) form via `?` for each key — works on jsonb but
--    members.licences is `json`, so cast first.
UPDATE members SET
  scorer_vb  = COALESCE((licences::jsonb) ? 'scorer_vb',  false),
  referee_vb = COALESCE((licences::jsonb) ? 'referee_vb', false),
  otr1_bb    = COALESCE((licences::jsonb) ? 'otr1_bb',    false),
  otr2_bb    = COALESCE((licences::jsonb) ? 'otr2_bb',    false),
  otn_bb     = COALESCE((licences::jsonb) ? 'otn_bb',     false),
  referee_bb = COALESCE((licences::jsonb) ? 'referee_bb', false)
WHERE licences IS NOT NULL
  AND licences::text NOT IN ('null', '[]', '""');

-- 3. Register the six fields in directus_fields so the admin UI shows
--    boolean toggles. Mirrors the pattern used by hide_phone / hide_email.
--    `sort` values continue from the existing licences entry (which sits
--    around 32-34 in members.json — pick free slots 35-40).
INSERT INTO directus_fields (collection, field, special, interface, sort, hidden, note)
SELECT 'members', f.field, NULL, 'boolean', f.sort, false, f.note
FROM (VALUES
  ('scorer_vb',  35, 'Has the volleyball Schreiber licence (auto-managed by SVRZ sync).'),
  ('referee_vb', 36, 'Has the volleyball referee licence.'),
  ('otr1_bb',    37, 'Basketball OTR1 table official.'),
  ('otr2_bb',    38, 'Basketball OTR2 table official.'),
  ('otn_bb',     39, 'Basketball OTN (national table official).'),
  ('referee_bb', 40, 'Basketball referee licence.')
) AS f(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df
  WHERE df.collection = 'members' AND df.field = f.field
);

COMMIT;
