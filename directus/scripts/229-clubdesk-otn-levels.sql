-- Migration 229: teach the ClubDesk mapping about OTN 1 / OTN 2.
--
-- Migration 228 split the basketball OTN table-official licence into otn1_bb /
-- otn2_bb, but noted that ClubDesk could not represent it: its "Offiziellen
-- Lizenz" picklist held exactly VB SC / OTR1 / OTR2 / OTN (prod counts at the
-- time: 156 / 92 / 64 / 7). The user has now added OTN1 and OTN2 options there,
-- so the two registers can finally agree and the mapping stops being lossy.
--
-- `clubdesk_offliz_to_dx` (migration 066) translates the ClubDesk string into a
-- wiedisync column name. It knew 'OTN' only, so an OTN1/OTN2 cell would fall
-- through its ELSE and read as "no licence expected" — i.e. the moment the user
-- assigned the new options, those members would have looked UNLICENSED to every
-- consumer of the basketball view. That is the bug this migration prevents.
--
-- Matching is deliberately tolerant of a space ('OTN 1' as well as 'OTN1') and of
-- case: the picklist labels were entered by hand in the ClubDesk UI and a single
-- character of drift would silently route a real licence to NULL. Same reason the
-- volleyball branch already uses LIKE rather than equality.
--
-- Bare 'OTN' keeps mapping to the coarse otn_bb — 7 ClubDesk contacts still carry
-- it, and it stays correct until Basketplan resolves each one to a level.
--
-- Schema-only + idempotent (CREATE OR REPLACE).

BEGIN;

CREATE OR REPLACE FUNCTION clubdesk_offliz_to_dx(offliz TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN offliz LIKE '%Volleyball Lizenz%'            THEN 'scorer_vb'
    WHEN upper(btrim(offliz)) = 'OTR1'               THEN 'otr1_bb'
    WHEN upper(btrim(offliz)) = 'OTR2'               THEN 'otr2_bb'
    -- Levels before the bare value, or 'OTN1' would never be reached.
    WHEN upper(replace(btrim(offliz), ' ', '')) = 'OTN1' THEN 'otn1_bb'
    WHEN upper(replace(btrim(offliz), ' ', '')) = 'OTN2' THEN 'otn2_bb'
    WHEN upper(btrim(offliz)) = 'OTN'                THEN 'otn_bb'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION clubdesk_offliz_to_dx(TEXT) IS
  'ClubDesk "Offiziellen Lizenz" string -> members column name. OTN1/OTN2 added 2026-07-25 (migration 229); bare OTN still maps to the coarse otn_bb. NULL = no licence expected.';

COMMIT;
