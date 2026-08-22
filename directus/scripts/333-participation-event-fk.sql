-- Migration 333: `participations.event` — a REAL foreign key behind the
-- polymorphic `activity_id`, so a Directus policy filter can finally join an
-- RSVP back to the event it belongs to.
--
-- WHY. `participations` is polymorphic: (activity_type, activity_id) where
-- activity_id is a *varchar* pointing at trainings | games | events. A Directus
-- filter cannot traverse a varchar, so every read rule on this table had to be
-- written member-side — "do this row's member and I share an active team?"
-- (setup-permissions.mjs → SAME_TEAM_AS_ME). That is right for trainings and
-- games, whose audience IS one team. It silently breaks every MULTI-TEAM event:
--
--   Event 27 "Photoday mixed tournament" — 12 teams, 214-person audience,
--   32 confirmed. A DU20 player could read 0 of those 32. An H3 player 6.
--   Nobody but an admin saw more than 9. The roster still rendered all 214
--   names (`members` read is unfiltered) — only the RSVP column was missing,
--   so the page read "almost nobody has answered" instead of "you may not see
--   this". Coaches were cut the same way via COACH_OR_TR_OF_PARTICIPATION.
--
-- Migration 271 hit the same wall for called-up players and worked around it
-- with two more member-side branches (SAME_GAME_AS_ME). That trick does not
-- scale to events, whose audience is a set of teams + roles + individuals.
-- So: stop working around the missing join and add it.
--
-- WHAT. `event` is a derived mirror of activity_id, never hand-written:
-- a BEFORE INSERT/UPDATE trigger sets it to activity_id::int for event rows and
-- NULL for everything else. It duplicates no truth — (activity_type,
-- activity_id) stay the source, the unique indexes still key off them — it just
-- restates the event half of the pair in a column Postgres and Directus can
-- follow. Registered as an m2o in directus_fields so the items API + policy
-- filters can walk it; readonly in the admin UI because the trigger owns it.
--
-- ON DELETE CASCADE matches what already happens: trg_events_0_purge_polymorphic
-- (AFTER DELETE on events) deletes exactly these rows today.
--
-- Backfill verified against prod before writing: 504 event rows, 0 non-numeric
-- activity_ids, 0 pointing at a missing event — so the FK adds clean.
--
-- Schema-only + idempotent. The permission change that USES this column lives in
-- setup-permissions.mjs (never in a numbered migration — CLAUDE.md §1).

BEGIN;

ALTER TABLE participations
  ADD COLUMN IF NOT EXISTS event integer;

COMMENT ON COLUMN participations.event IS
  'Derived mirror of activity_id when activity_type = ''event'' (NULL otherwise). Maintained by trg_participations_sync_event — never write it by hand. Exists so policy filters can join an RSVP to its event; (activity_type, activity_id) remain the source of truth.';

-- Keep it in sync. BEFORE so the value is already correct for the AFTER
-- triggers (activity-chat sync) and for the FK check in the same statement.
CREATE OR REPLACE FUNCTION trg_participations_sync_event() RETURNS trigger AS $$
BEGIN
  IF NEW.activity_type = 'event' AND NEW.activity_id ~ '^[0-9]+$' THEN
    NEW.event := NEW.activity_id::int;
  ELSE
    NEW.event := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_participations_sync_event ON participations;
CREATE TRIGGER trg_participations_sync_event
  BEFORE INSERT OR UPDATE ON participations
  FOR EACH ROW EXECUTE FUNCTION trg_participations_sync_event();

-- Backfill. Defensive on both counts (non-numeric id, missing event) even
-- though prod has zero of either — dev is a scrubbed clone and fresh installs
-- run SCHEMA.sql, so this must not depend on today's data being clean.
UPDATE participations p
   SET event = p.activity_id::int
 WHERE p.activity_type = 'event'
   AND p.activity_id ~ '^[0-9]+$'
   AND p.event IS DISTINCT FROM p.activity_id::int
   AND EXISTS (SELECT 1 FROM events e WHERE e.id = p.activity_id::int);

DO $$ BEGIN
  ALTER TABLE participations
    ADD CONSTRAINT participations_event_foreign
    FOREIGN KEY (event) REFERENCES events(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Partial: only ~6% of rows are event rows, and every query that uses this
-- column is already scoped to activity_type = 'event'.
CREATE INDEX IF NOT EXISTS participations_event_idx
  ON participations (event) WHERE event IS NOT NULL;

INSERT INTO directus_fields (collection, field, special, interface, display, readonly, sort, width, note)
SELECT 'participations', 'event', 'm2o', 'select-dropdown-m2o', 'related-values', true, 90, 'half',
       'Derived from activity_id by trigger — do not edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'participations' AND field = 'event');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'participations', 'event', 'events', NULL, NULL, NULL, NULL, NULL, 'delete'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'participations' AND many_field = 'event');

COMMIT;
