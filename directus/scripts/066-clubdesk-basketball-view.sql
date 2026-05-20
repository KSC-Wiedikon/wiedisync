-- Migration 066: clubdesk_basketball view + licence-mapping helper
--
-- Basketball "Offiziellen Lizenz" uses OTR1 / OTR2 / OTN instead of
-- "Volleyball Lizenz", and maps to Directus members.licences values
-- otr1_bb / otr2_bb / otn_bb. This migration adds the per-sport view
-- and a helper view that flattens the CD licence value to a target
-- Directus licence code per person.

BEGIN;

CREATE OR REPLACE VIEW clubdesk_basketball AS
SELECT * FROM clubdesk_people WHERE sektion = 'Basketball';

REVOKE ALL ON clubdesk_basketball FROM PUBLIC;
REVOKE ALL ON clubdesk_basketball FROM anon, authenticated;

-- Maps a ClubDesk `offiziellen_lizenz` string to the expected Directus
-- `members.licences` JSON-array element. NULL means "no licence
-- expected" (Keine / empty / Sammelt Unterschriften / unknown).
CREATE OR REPLACE FUNCTION clubdesk_offliz_to_dx(offliz TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN offliz LIKE '%Volleyball Lizenz%' THEN 'scorer_vb'
    WHEN offliz = 'OTR1' THEN 'otr1_bb'
    WHEN offliz = 'OTR2' THEN 'otr2_bb'
    WHEN offliz = 'OTN'  THEN 'otn_bb'
    ELSE NULL
  END;
$$;

COMMIT;
