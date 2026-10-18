-- Migration 423: teams.wieplay_enabled — which teams use WiePlay, for the "Video" link on games.
--
-- WHY
-- ---
-- WiePlay (the club's video analysis app, wieplay.kscw.ch) has a page per Wiedisync game
-- (/games/<id>) that opens the game's video. The member app links game cards there, but only
-- for teams that use WiePlay, and that is decided in WiePlay (Admin → Teams, full admins;
-- WiePlay ADR-001), not here. WiePlay already tells us on every hourly sync: it calls the
-- bridge's GET /kscw/wieplay/v1/sync?teams=<ids> with exactly its enabled team rows (current
-- and previous season). The bridge now records that list here.
--
-- WHAT CHANGES
-- ------------
--   1. teams.wieplay_enabled boolean NOT NULL DEFAULT false.
--   2. Endpoint-owned, as events.signup_form_slug (migration 385): a BEFORE INSERT/UPDATE
--      trigger keeps the stored value (false on INSERT) unless the writer set the
--      transaction-local GUC `kscw.wieplay_enabled_write = 'on'`. Only the bridge's /sync
--      does (wieplay-bridge.js markWieplayTeams). Silent keep, not an error, so a sport admin
--      or coach saving a team through the items API never fails on it and cannot switch a
--      team's link on or off; the season rollover's new rows start false and the next sync
--      marks them.
--   3. Registered in directus_fields, read-only. Members read it through their unfiltered
--      `teams` read (all fields); it is NOT in PUBLIC_TEAM_FIELDS (setup-permissions.mjs).
--
-- No backfill: the first WiePlay sync after the deploy (within the hour) sets the flags.
-- Schema-only + idempotent. Restart the container after deploy (new directus_fields row).

BEGIN;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS wieplay_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN teams.wieplay_enabled IS
  'The team uses WiePlay (wieplay.kscw.ch): WiePlay asked for this team row on its last sync '
  '(GET /kscw/wieplay/v1/sync). Game cards link its games to WiePlay. Endpoint-owned: writes '
  'without the kscw.wieplay_enabled_write GUC are ignored (trigger teams_wieplay_enabled_guard). '
  'Migration 423.';

CREATE OR REPLACE FUNCTION public.teams_wieplay_enabled_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('kscw.wieplay_enabled_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.wieplay_enabled := false;
  ELSE
    NEW.wieplay_enabled := OLD.wieplay_enabled;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_wieplay_enabled_guard ON teams;
CREATE TRIGGER teams_wieplay_enabled_guard
  BEFORE INSERT OR UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION public.teams_wieplay_enabled_guard();

-- ── Directus field registration (read-only) ─────────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, width, note)
SELECT 'teams', 'wieplay_enabled', 'cast-boolean', 'boolean', true, false, 'half',
  'Uses WiePlay (video analysis). Set by WiePlay''s hourly sync; switch teams on or off in WiePlay (Admin → Teams), not here.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'teams' AND field = 'wieplay_enabled');

COMMIT;
