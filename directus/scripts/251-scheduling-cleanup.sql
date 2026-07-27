-- Migration 251: scheduling cleanup — dead link columns, season typing, status
-- vocabularies, and one leftover sequence name.
--
-- 1. game_scheduling_slots.booking / .game and game_scheduling_bookings.game
--    were meant as a bidirectional slot↔booking↔games link that never shipped:
--    nothing in the repo writes them and live (2026-07-27) they are 100% NULL
--    (slots.booking 0/2017, slots.game 0/2017, bookings.game 0/156 — including
--    all 80 status='booked' slots). The real linkage is bookings.slot +
--    slots.status, and the games mirror keys on (game_id, kscw_team). The dead
--    columns invite exactly the wrong join (a panel on slots.booking would show
--    every booked slot as unbooked), so they go — columns, their indexes
--    (dropped implicitly), and their directus_fields/directus_relations rows.
--    The one reader — the team-calendar endpoint's slot select — drops the
--    column in the same deploy (game-scheduling.js).
--
-- 2. bookings.season and slots.season stored the game_scheduling_seasons id as
--    varchar(255) ('1' ×156 / ×2017 live) while every sibling (opponents,
--    derbies, club_portals, team_links, basketball_*) stores it as integer with
--    a real FK. That forced sv-sync's ssn.id::text join and String(...) season
--    coercions in game-scheduling.js, and left 2017 slots + 156 bookings free
--    to strand silently if a season were deleted. Converted to integer + FK.
--    ON DELETE RESTRICT, not the siblings' CASCADE: a season that still owns
--    slots or bookings must not vanish out from under them.
--
-- 3. Status vocabularies, code-derived (every write in game-scheduling.js —
--    the only writer besides the Directus admin dropdown):
--      slots.status:    'available' | 'booked' | 'blocked'   (live: 1807/80/130)
--      bookings.status: 'pending' | 'confirmed'  in code, plus 'rejected'
--                       offered by the admin dropdown + typed in the frontend
--                       (live: 'confirmed' ×156)
--    Both vocabularies are closed, so they get CHECKs. A typo'd status is
--    silently invisible to every WHERE filter (sv-sync feed protection and the
--    games mirror both key on status='confirmed' exactly) — better to reject it
--    at write time. The 'expired'/'revoked'/'viewed' literals nearby in
--    game-scheduling.js belong to game_scheduling_opponents / team_requests /
--    club portals, NOT to these two tables.
--
-- 4. team_links (renamed from basketball_team_links by migration 218, which
--    renamed the table and its index but not the identity sequence) still owns
--    basketball_team_links_id_seq — the schema's only mismatched-owner
--    sequence. Renamed so 'basketball_' greps stop lying about a cross-sport
--    table.
--
-- Idempotent. Ships with the matching game-scheduling.js + sv-sync.js edits
-- (the ::text season join and the slots.booking select must not outlive the
-- old schema) — deploy schema first, then ext, per the standard deploy chain.

BEGIN;

-- ── 1. Drop the never-written link columns ────────────────────────────────

ALTER TABLE game_scheduling_slots    DROP COLUMN IF EXISTS booking;
ALTER TABLE game_scheduling_slots    DROP COLUMN IF EXISTS game;
ALTER TABLE game_scheduling_bookings DROP COLUMN IF EXISTS game;

DELETE FROM directus_fields
WHERE (collection = 'game_scheduling_slots'    AND field IN ('booking', 'game'))
   OR (collection = 'game_scheduling_bookings' AND field = 'game');

DELETE FROM directus_relations
WHERE (many_collection = 'game_scheduling_slots'    AND many_field IN ('booking', 'game'))
   OR (many_collection = 'game_scheduling_bookings' AND many_field = 'game');

-- ── 2. season: varchar id-as-text → integer + FK ──────────────────────────
-- Repair first so the cast and the FK cannot fail (live: every value is '1'
-- and season 1 exists; the guard covers non-numeric or season-less strays on
-- any clone). Type change is guarded on the current column type so the block
-- is a no-op wherever the conversion already happened.

DO $do$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'game_scheduling_slots'
      AND column_name = 'season' AND data_type = 'character varying'
  ) THEN
    UPDATE game_scheduling_slots SET season = NULL
    WHERE season IS NOT NULL
      AND (season !~ '^[0-9]+$'
           OR NOT EXISTS (SELECT 1 FROM game_scheduling_seasons s
                          WHERE s.id::text = game_scheduling_slots.season));
    ALTER TABLE game_scheduling_slots ALTER COLUMN season DROP DEFAULT;
    ALTER TABLE game_scheduling_slots ALTER COLUMN season TYPE integer USING season::integer;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'game_scheduling_bookings'
      AND column_name = 'season' AND data_type = 'character varying'
  ) THEN
    UPDATE game_scheduling_bookings SET season = NULL
    WHERE season IS NOT NULL
      AND (season !~ '^[0-9]+$'
           OR NOT EXISTS (SELECT 1 FROM game_scheduling_seasons s
                          WHERE s.id::text = game_scheduling_bookings.season));
    ALTER TABLE game_scheduling_bookings ALTER COLUMN season DROP DEFAULT;
    ALTER TABLE game_scheduling_bookings ALTER COLUMN season TYPE integer USING season::integer;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scheduling_slots_season_fkey') THEN
    ALTER TABLE game_scheduling_slots ADD CONSTRAINT game_scheduling_slots_season_fkey
      FOREIGN KEY (season) REFERENCES game_scheduling_seasons(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scheduling_bookings_season_fkey') THEN
    ALTER TABLE game_scheduling_bookings ADD CONSTRAINT game_scheduling_bookings_season_fkey
      FOREIGN KEY (season) REFERENCES game_scheduling_seasons(id) ON DELETE RESTRICT;
  END IF;
END $do$;

-- Directus metadata: promote the two season fields from a bare text input to
-- the m2o dropdown every sibling season FK already uses (opponents, derbies,
-- club_portals, team_links).
UPDATE directus_fields
SET special = 'm2o', interface = 'select-dropdown-m2o', options = '{"template":"{{season}}"}'::json
WHERE collection IN ('game_scheduling_slots', 'game_scheduling_bookings')
  AND field = 'season' AND (special IS DISTINCT FROM 'm2o');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'game_scheduling_slots', 'season', 'game_scheduling_seasons', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'game_scheduling_slots' AND many_field = 'season');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'game_scheduling_bookings', 'season', 'game_scheduling_seasons', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'game_scheduling_bookings' AND many_field = 'season');

-- ── 3. Status CHECKs (closed vocabularies, live data verified clean) ──────

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scheduling_slots_status_chk') THEN
    ALTER TABLE game_scheduling_slots ADD CONSTRAINT game_scheduling_slots_status_chk
      CHECK (status IS NULL OR status IN ('available', 'booked', 'blocked'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_scheduling_bookings_status_chk') THEN
    ALTER TABLE game_scheduling_bookings ADD CONSTRAINT game_scheduling_bookings_status_chk
      CHECK (status IS NULL OR status IN ('pending', 'confirmed', 'rejected'));
  END IF;
END $do$;

-- ── 4. Sequence rename: basketball_team_links_id_seq → team_links_id_seq ──
-- Migration 218 residue (table + index renamed, sequence forgotten).

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'basketball_team_links_id_seq' AND relkind = 'S')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'team_links_id_seq' AND relkind = 'S') THEN
    ALTER SEQUENCE basketball_team_links_id_seq RENAME TO team_links_id_seq;
  END IF;
END $do$;

COMMIT;

-- After applying: `ext:deploy` ships the paired game-scheduling.js / sv-sync.js
-- (team-calendar no longer selects slots.booking; sv-sync joins seasons on the
-- integer id). Re-baseline SCHEMA.sql per the standard post-migration step.
