-- Migration 303: drop the legacy `members.otn_bb` flag
--
-- Migration 067 modelled basketball table officials as one coarse boolean per
-- kind — otr1_bb / otr2_bb / otn_bb — because ClubDesk's "Offiziellen Lizenz"
-- picklist could only express a level-less "OTN". Migration 228 added the real
-- levels Basketplan issues (otn1_bb / otn2_bb) and deliberately KEPT otn_bb
-- alongside them: its holders were of unknown level at the time, so every
-- eligibility check ORed all three and dropping it would have silently revoked
-- somebody's 24s-desk qualification.
--
-- That reason has expired. Measured on prod 2026-08-10, immediately before this
-- migration was written:
--
--   otn_bb = true                                        8
--   otn_bb = true AND no otn1_bb AND no otn2_bb          0   ← the whole point
--   otn1_bb OR otn2_bb                                   8
--
-- Every one of the eight is `otn2_bb`. The Basketplan import (which reads the
-- real `otn2_since` dates) resolved all of them, so the coarse flag is now a
-- second, less precise copy of a fact two other columns already hold — and a
-- copy that can only ever disagree with them.
--
-- Checked for stored references before dropping, all zero:
--   • events.invited_roles containing 'otn_bb'            0
--   • announcements.audience_roles containing 'otn_bb'    0
--   • views / rules depending on the column               0 (pg_depend)
--
-- ── What changes in behaviour ───────────────────────────────────────────────
-- A level-less "OTN" arriving from ClubDesk or from a registration's licence
-- string now sets NO column, where it used to set otn_bb. That is deliberate:
-- asserting OTN 1 for somebody who may hold OTN 2 is a licence claim the club
-- cannot back, and Basketplan — the authority — is what resolves a level. The
-- input is not lost either way: the registration keeps its raw `lizenz` answer,
-- and the ClubDesk cell is untouched. The sync-down additionally REPORTS the
-- case as the metric `members_otn_unresolved` (import-clubdesk-csv.mjs), which
-- is 0 today and is how a future level-less official becomes visible instead of
-- silently losing eligibility.
--
-- ⚠ DEPLOY ORDER — the opposite of an ADD. Extension + frontend code that no
-- longer selects `otn_bb` must be live BEFORE this runs, or every query naming
-- the column 500s in the window between. Shipped that way on 2026-08-10:
-- migration 302 → ext:deploy → this.
--
-- Schema-only + idempotent.

BEGIN;

-- ── The column ───────────────────────────────────────────────────────────────
ALTER TABLE members DROP COLUMN IF EXISTS otn_bb;

-- Directus keeps its own field metadata; a row pointing at a dropped column
-- renders as a broken field in the admin UI and in the field list the items API
-- reports.
DELETE FROM directus_fields WHERE collection = 'members' AND field = 'otn_bb';

-- Permission rows naming the column are NOT touched here — permissions live in
-- setup-permissions.mjs (CLAUDE.md rule 1), which has had `otn_bb` removed from
-- MEMBER_VISIBLE_FIELDS and MEMBER_EDITABLE_FIELDS in the same commit. The
-- deploy chain runs db:setup-perms straight after this migration and rebuilds
-- every row declaratively.

-- ── The ClubDesk licence-string mapper ───────────────────────────────────────
-- `clubdesk_offliz_to_dx` (migration 066, extended by 229) translates the
-- register's "Offiziellen Lizenz" string into the members column that holds it.
-- Its bare-'OTN' branch returned the name of a column that no longer exists, so
-- the diagnostic queries built on it would have looked up a missing key rather
-- than reporting the gap. NULL is the honest answer now: "the register says OTN,
-- and no column represents that on its own".
CREATE OR REPLACE FUNCTION clubdesk_offliz_to_dx(offliz TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN offliz LIKE '%Volleyball Lizenz%'            THEN 'scorer_vb'
    WHEN upper(btrim(offliz)) = 'OTR1'                THEN 'otr1_bb'
    WHEN upper(btrim(offliz)) = 'OTR2'                THEN 'otr2_bb'
    WHEN upper(replace(btrim(offliz), ' ', '')) = 'OTN1' THEN 'otn1_bb'
    WHEN upper(replace(btrim(offliz), ' ', '')) = 'OTN2' THEN 'otn2_bb'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION clubdesk_offliz_to_dx(TEXT) IS
  'ClubDesk "Offiziellen Lizenz" string -> members column name. OTN1/OTN2 added 2026-07-25 (migration 229). A bare level-less "OTN" maps to NULL since migration 303 dropped the coarse otn_bb flag — Basketplan is what resolves a level. NULL = no column represents this value.';

COMMIT;

-- Verification (dev/prod):
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'members' AND column_name = 'otn_bb';   -- → 0
--   SELECT count(*) FROM directus_fields
--    WHERE collection = 'members' AND field = 'otn_bb';         -- → 0
--   SELECT clubdesk_offliz_to_dx('OTN'), clubdesk_offliz_to_dx('OTN 2');
--                                                               -- → NULL, otn2_bb
--   -- Nobody lost their 24s-desk eligibility:
--   SELECT count(*) FROM members WHERE otn1_bb OR otn2_bb;      -- → 8 on prod
