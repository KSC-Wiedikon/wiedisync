-- Migration 218: generalize basketball_team_links → team_links (sport-agnostic).
--
-- Team links (coach/player-sharing constraints between teams) were basketball-only
-- (migration 217). Volleyball scheduling wants the same manual model, so the table
-- gains a `sport` discriminator and is renamed to the neutral `team_links`. This is
-- non-destructive: the rename preserves rows + PKs, existing rows are stamped
-- 'basketball', and the unique key gains `sport`.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. Item permissions live
-- in setup-permissions.mjs, NOT here. A Directus schema reload (container restart)
-- is required AFTER this migration so the API sees the renamed collection + new
-- field before setup-permissions runs.

BEGIN;

-- 1. Sport discriminator — existing rows are basketball. Guarded for both the
--    pre-rename and post-rename table name so a re-run is a no-op.
ALTER TABLE IF EXISTS public.basketball_team_links
  ADD COLUMN IF NOT EXISTS sport varchar(16) NOT NULL DEFAULT 'basketball';
ALTER TABLE IF EXISTS public.team_links
  ADD COLUMN IF NOT EXISTS sport varchar(16) NOT NULL DEFAULT 'basketball';

-- 2. Rename the table (idempotent — only when the old name still exists and the
--    new one does not).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'basketball_team_links')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'team_links') THEN
    ALTER TABLE public.basketball_team_links RENAME TO team_links;
  END IF;
END $$;

-- 3. Unique key now includes sport (Postgres keeps the old constraint name across a
--    table rename, so drop it explicitly and add the sport-aware one).
ALTER TABLE public.team_links DROP CONSTRAINT IF EXISTS basketball_team_links_unique;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_links_unique') THEN
    ALTER TABLE public.team_links ADD CONSTRAINT team_links_unique UNIQUE (season, sport, team_a, team_b);
  END IF;
END $$;

-- 4. Season index rename (idempotent).
ALTER INDEX IF EXISTS basketball_team_links_season_idx RENAME TO team_links_season_idx;

COMMENT ON TABLE public.team_links IS
  'Coach/player-sharing links between teams, per season + sport. link_type: diff = must not play the same time (shared person); same = keep the same time; adjacent = different time but back-to-back. Drives the scheduling planners'' slot/day highlights. Edited via Basketball → Settings and Terminplanung → Settings.';

-- 5. Directus metadata — point the collection, fields, and relations at the new name.
UPDATE directus_collections SET collection = 'team_links' WHERE collection = 'basketball_team_links';
UPDATE directus_fields SET collection = 'team_links' WHERE collection = 'basketball_team_links';
UPDATE directus_relations SET many_collection = 'team_links' WHERE many_collection = 'basketball_team_links';

-- 6. Register the sport field so the items API accepts reading/writing it.
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'team_links', 'sport', NULL, 'input', 6, 'half', 'basketball | volleyball — which planner owns the link.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'team_links' AND field = 'sport');

COMMIT;
