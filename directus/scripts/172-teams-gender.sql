-- Migration 172: teams.gender ('m' | 'f' | 'mixed', NULL = unknown)
--
-- UX metadata for team pickers (Join-a-team modal: sport step + only teams
-- matching the member's sex), NOT access control. Team gender was previously
-- only derivable from name prefixes, which the 2026-07-04 renames broke
-- ("1xDU18"/"2xDU18" no longer start with D). Backfill uses the same naming
-- ruleset as the 2026-06-29 members.sex backfill; unmatched names stay NULL
-- ("unknown") and pickers show those to everyone.
--
-- Schema-only + idempotent.

BEGIN;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS gender varchar(8);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_gender_check') THEN
    ALTER TABLE teams ADD CONSTRAINT teams_gender_check
      CHECK (gender IS NULL OR gender IN ('m', 'f', 'mixed'));
  END IF;
END $$;

-- Backfill (NULL-only so manual corrections survive re-runs).
-- Order matters: mixed first — mini/mixed names must not fall through to m/f.
UPDATE teams SET gender = 'mixed'
WHERE gender IS NULL AND (name ILIKE 'mini%' OR name IN ('MU8', 'MU10'));

UPDATE teams SET gender = 'f'
WHERE gender IS NULL AND (
     name ~* '(^|[^a-z0-9])DU?[0-9]'   -- D1..D4, DU12.., Lions D1, Rhinos D3
  OR name ~* '^[0-9]+xDU?[0-9]'        -- 1xDU18 / 2xDU18 (rename style)
  OR name ILIKE '%damen%'
  OR name ILIKE '%lions%'
  OR name ILIKE '%rhinos%'
  OR name ILIKE '%d-classics%'
);

UPDATE teams SET gender = 'm'
WHERE gender IS NULL AND (
     name ~* '(^|[^a-z0-9])HU?[0-9]'   -- H1..H4, HU12.., Herren 2 H3
  OR name ~* '^[0-9]+xHU?[0-9]'        -- future 1xHU18-style renames
  OR name ILIKE '%herren%'
  OR name ILIKE '%legends%'
  OR name ILIKE '%h-classics%'
);

-- Admin-app dropdown (the items API reads the column with or without this row).
INSERT INTO directus_fields (collection, field, interface, options, width)
SELECT 'teams', 'gender', 'select-dropdown',
  '{"choices":[{"text":"Male","value":"m"},{"text":"Female","value":"f"},{"text":"Mixed","value":"mixed"}],"allowNone":true}',
  'half'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'teams' AND field = 'gender'
);

COMMIT;
