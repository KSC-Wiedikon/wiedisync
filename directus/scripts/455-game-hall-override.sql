-- 455: a synced game's hall can be overwritten in the app ("Sync" / "Overwrite")
--
-- Owner, 23.11.2026: the hall of a game from VolleyManager (sv-sync) or Basketplan
-- (bp-sync) can be overwritten by an admin or the sport admin of that sport. Back on
-- "Sync", the official hall applies again at once. The overwritten hall has to show
-- everywhere: the app, kscw.ch and above all the shared KWI hall calendar.
--
-- DESIGN. `games.hall` (+ `additional_halls`) stays the EFFECTIVE court set. Every
-- reader already uses it — game cards, the Hallenplan, the game→training sweeps, the
-- basketball floor claims (351), the duty recheck (451), the iCal feed, the public
-- endpoints, kscw.ch and the Google Calendar push — so none of them has to learn a
-- new column. What the official source says moves to `synced_hall` /
-- `synced_additional_halls` while the switch is on.
--
-- The trigger below is the guarantee, because sv-sync, bp-sync, the Terminplanung
-- booking mirror and the items API all write `games` differently and most bypass the
-- items hooks:
--   • switch OFF: synced_* mirror hall / additional_halls on every write;
--   • only the override path may flip the switch or touch its actor columns — the
--     endpoint (kscw-endpoints/src/game-hall-override.js) sets the transaction-local
--     GUC kscw.hall_override_write = 'on';
--   • OFF → ON: synced_* keep the court set the game had until now;
--   • ON → OFF: hall / additional_halls go back to synced_* in the same statement;
--   • ON, and a writer without the GUC changes hall / additional_halls (a sync that
--     does not know about the switch): the value is recorded in synced_* and the
--     effective court set stays. A writer that sets synced_* itself wins.
--
-- No email on the row: members read `games` with fields `*`. The acting user is in
-- user_logs (writeUserLog in the endpoint).
-- Schema-only: no permission rows (setup-permissions.mjs keeps the columns out of
-- every write list; kscw-hooks refuses them through /items).

BEGIN;

-- The backfill below rewrites every row: no bells, no duty questions for it.
SET LOCAL kscw.skip_games_notify = 'on';
SET LOCAL kscw.skip_duty_recheck = 'on';

ALTER TABLE games ADD COLUMN IF NOT EXISTS hall_override boolean NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS synced_hall integer;
ALTER TABLE games ADD COLUMN IF NOT EXISTS synced_additional_halls json;
ALTER TABLE games ADD COLUMN IF NOT EXISTS hall_override_by_name character varying(255);
ALTER TABLE games ADD COLUMN IF NOT EXISTS hall_override_at timestamptz;

DO $$ BEGIN
  ALTER TABLE games
    ADD CONSTRAINT games_synced_hall_foreign
    FOREIGN KEY (synced_hall) REFERENCES halls(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS games_hall_override_idx ON games (id) WHERE hall_override;

COMMENT ON COLUMN public.games.hall_override IS
  'Hall source switch: false = Sync (hall comes from VolleyManager / Basketplan), true = Overwrite '
  '(hall + additional_halls set in the app; synced_* hold the official ones). Flipped only by '
  'POST /kscw/games/:id/hall-source (trigger trg_games_0_hall_override, migration 455).';
COMMENT ON COLUMN public.games.synced_hall IS
  'The hall the official source (sv-sync, bp-sync, the Terminplanung booking mirror) gives this game. '
  'Equals hall while hall_override is false; restored into hall when the switch goes back to Sync.';
COMMENT ON COLUMN public.games.synced_additional_halls IS
  'The official additional_halls (court set) — same rules as synced_hall.';
COMMENT ON COLUMN public.games.hall_override_by_name IS
  'Who set the active hall override (NULL while hall_override is false). The acting user is also in user_logs.';
COMMENT ON COLUMN public.games.hall_override_at IS
  'When the active hall override was set (NULL while hall_override is false).';

-- Every row starts on Sync with its current court set as the official one.
UPDATE games
   SET synced_hall = hall,
       synced_additional_halls = additional_halls
 WHERE hall_override = false
   AND (synced_hall IS DISTINCT FROM hall
        OR synced_additional_halls::jsonb IS DISTINCT FROM additional_halls::jsonb);

CREATE OR REPLACE FUNCTION public.kscw_games_hall_override()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_override_path boolean := COALESCE(current_setting('kscw.hall_override_write', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT COALESCE(NEW.hall_override, false) THEN
      NEW.synced_hall := NEW.hall;
      NEW.synced_additional_halls := NEW.additional_halls;
      NEW.hall_override_by_name := NULL;
      NEW.hall_override_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Only the override path flips the switch or writes who did it.
  IF NOT v_override_path THEN
    NEW.hall_override := OLD.hall_override;
    NEW.hall_override_by_name := OLD.hall_override_by_name;
    NEW.hall_override_at := OLD.hall_override_at;
  END IF;

  IF NEW.hall_override AND NOT OLD.hall_override THEN
    -- Sync → Overwrite: while the switch was off, hall WAS the official value.
    NEW.synced_hall := OLD.hall;
    NEW.synced_additional_halls := OLD.additional_halls;
  ELSIF OLD.hall_override AND NOT NEW.hall_override THEN
    -- Overwrite → Sync: the official court set applies again, now.
    NEW.hall := NEW.synced_hall;
    NEW.additional_halls := NEW.synced_additional_halls;
    NEW.hall_override_by_name := NULL;
    NEW.hall_override_at := NULL;
  ELSIF NEW.hall_override THEN
    IF NOT v_override_path THEN
      -- A hall deleted from `halls` (FK ON DELETE SET NULL) must not be pinned back.
      IF NEW.hall IS NULL AND OLD.hall IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM halls h WHERE h.id = OLD.hall) THEN
        RETURN NEW;
      END IF;
      -- Someone else wrote the court set: that is the source's word, not the app's.
      IF NEW.synced_hall IS NOT DISTINCT FROM OLD.synced_hall
         AND NEW.hall IS DISTINCT FROM OLD.hall THEN
        NEW.synced_hall := NEW.hall;
      END IF;
      IF NEW.synced_additional_halls::jsonb IS NOT DISTINCT FROM OLD.synced_additional_halls::jsonb
         AND NEW.additional_halls::jsonb IS DISTINCT FROM OLD.additional_halls::jsonb THEN
        NEW.synced_additional_halls := NEW.additional_halls;
      END IF;
      NEW.hall := OLD.hall;
      NEW.additional_halls := OLD.additional_halls;
    END IF;
  ELSE
    NEW.synced_hall := NEW.hall;
    NEW.synced_additional_halls := NEW.additional_halls;
  END IF;
  RETURN NEW;
END;
$function$;

-- `0_` sorts it before every other games trigger (same-event triggers fire in name
-- order), so the floor claims, duty recheck and notify triggers see the pinned values.
DROP TRIGGER IF EXISTS trg_games_0_hall_override ON games;
CREATE TRIGGER trg_games_0_hall_override
  BEFORE INSERT OR UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION public.kscw_games_hall_override();

-- Directus fields (schema-only). Read-only in the Studio: the endpoint is the writer.
-- ⚠ NULL in a VALUES list types as text and `options` is json — use NULL::json.
INSERT INTO directus_fields (collection, field, special, interface, options, display, readonly, hidden, sort, width, note)
SELECT 'games', 'hall_override', 'cast-boolean', 'boolean', NULL::json, 'boolean', true, false, NULL::integer, 'half',
       'Hall source: off = Sync (VolleyManager / Basketplan), on = Overwrite. Change it in the app (game → Venue).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'hall_override');

INSERT INTO directus_fields (collection, field, special, interface, options, display, readonly, hidden, sort, width, note)
SELECT 'games', 'synced_hall', 'm2o', 'select-dropdown-m2o', NULL::json, 'related-values', true, false, NULL::integer, 'half',
       'The hall VolleyManager / Basketplan gives this game. Kept by the trigger — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'synced_hall');

INSERT INTO directus_fields (collection, field, special, interface, options, display, readonly, hidden, sort, width, note)
SELECT 'games', 'synced_additional_halls', 'cast-json', 'input-code', NULL::json, NULL, true, false, NULL::integer, 'half',
       'The official additional halls. Kept by the trigger — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'synced_additional_halls');

INSERT INTO directus_fields (collection, field, special, interface, options, display, readonly, hidden, sort, width, note)
SELECT 'games', 'hall_override_by_name', NULL, 'input', NULL::json, NULL, true, false, NULL::integer, 'half',
       'Who overwrote the hall.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'hall_override_by_name');

INSERT INTO directus_fields (collection, field, special, interface, options, display, readonly, hidden, sort, width, note)
SELECT 'games', 'hall_override_at', NULL, 'datetime', NULL::json, 'datetime', true, false, NULL::integer, 'half',
       'When the hall was overwritten.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'games' AND field = 'hall_override_at');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'games', 'synced_hall', 'halls', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'games' AND many_field = 'synced_hall');

COMMIT;

-- Verification:
--   \d games → hall_override boolean NOT NULL DEFAULT false, synced_hall, synced_additional_halls, …
--   SELECT count(*) FROM games WHERE synced_hall IS DISTINCT FROM hall;  → 0
