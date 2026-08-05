-- 286-global-blocks-sport.sql
--
-- `scheduling_global_blocks` (migration 160) gains an optional `sport`.
--
-- WHY
-- ---
-- The table was deliberately club-wide: one superadmin blackout, no home games for
-- anybody. That was right while volleyball was the only sport using the scheduler.
-- It stopped being right the moment basketball joined: found 2026-08-05, a
-- VOLLEYBALL U20 tournament (row id 3, "U20 Tournament", 13.12.2026) was blocking
-- BASKETBALL home games, on a date where nothing in the system actually occupies
-- KWI — volleyball's own slots that day are all still 'available', none booked.
-- It cost basketball a Sunday inside the juniors' 1. Phase, which is the part of the
-- season that is already shortest (only 6 of the club's 10 Spielsamstage fall inside
-- it). U20 is unambiguously volleyball here: KSCW has active volleyball DU20 + HU20
-- and NO basketball U20 team at all — basketball's juniors stop at U18.
--
-- SEMANTICS
-- ---------
--   sport IS NULL      → club-wide, blocks BOTH sports. The old behaviour, and still
--                        the right default for a hall closure or a club event.
--   sport = 'volleyball'  → blocks volleyball only.
--   sport = 'basketball'  → blocks basketball only.
-- Every reader must therefore test `sport IS NULL OR sport = <its own sport>`, never
-- `sport = <sport>` — a bare equality silently drops the club-wide rows, which is the
-- failure mode that matters (a blackout that stops blocking is invisible until
-- someone books a game on a closed hall).
--
-- BACKFILL, from the evidence rather than by row id
-- ------------------------------------------------
--   "HU20" (07.03.2026)            → volleyball. Literally the volleyball team's name.
--   "U20 Tournament" (13.12.2026)  → volleyball. Same author (member 8), same season,
--                                    and no basketball U20 exists.
--   "Mini-Turnier BB" (17-18.04.2027) → basketball. Author 263 (Anja Jimenez, bb_admin)
--                                    tagged the sport in the reason herself.
-- ⚠ Anything added later without a sport stays club-wide. That is the safe direction:
-- a new block keeps blocking everyone until someone narrows it deliberately.
--
-- ⚠ NOT resolved here, flagged for the BB section: the "Mini-Turnier BB" block is on
-- 17./18.04.2027, but ProBasket's Kids-und-Mini-Abschlussturnier is 29./30. Mai 2027
-- and 17./18.04.2027 is the Final-Four-Jugend Sperrdatum for ALL leagues. So that
-- block is currently redundant, and if the intent was the May weekend then 29./30.05
-- is unblocked while junior regional 2. Phase still runs to 30.05.27.
--
-- Schema + data backfill, idempotent.

BEGIN;

ALTER TABLE scheduling_global_blocks ADD COLUMN IF NOT EXISTS sport varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_global_blocks_sport_chk') THEN
    ALTER TABLE scheduling_global_blocks
      ADD CONSTRAINT scheduling_global_blocks_sport_chk
      CHECK (sport IS NULL OR sport IN ('volleyball', 'basketball'));
  END IF;
END $$;

COMMENT ON COLUMN scheduling_global_blocks.sport IS
  'Which sport this blackout applies to. NULL = club-wide (both), the default and the safe fallback. Readers MUST test (sport IS NULL OR sport = <own sport>) — a bare equality drops the club-wide rows.';

-- Backfill only rows that are still unscoped, so a later hand-edit is never overwritten.
UPDATE scheduling_global_blocks SET sport = 'volleyball'
 WHERE sport IS NULL AND btrim(reason) IN ('HU20', 'U20 Tournament');
UPDATE scheduling_global_blocks SET sport = 'basketball'
 WHERE sport IS NULL AND btrim(reason) = 'Mini-Turnier BB';

-- Register for the items API + admin UI (an unregistered column is invisible there).
INSERT INTO directus_fields (collection, field, interface, options, display, readonly, hidden, sort, width, note)
SELECT 'scheduling_global_blocks', 'sport', 'select-dropdown',
       '{"choices":[{"text":"Club-wide (both sports)","value":null},{"text":"Volleyball","value":"volleyball"},{"text":"Basketball","value":"basketball"}],"allowNone":true}',
       'labels', false, false, 99, 'half',
       'NULL = blocks both sports. Set it to stop one sport''s event blocking the other.'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'scheduling_global_blocks' AND field = 'sport');

DO $$
DECLARE vb integer; bb integer; nul integer;
BEGIN
  SELECT count(*) FILTER (WHERE sport = 'volleyball'),
         count(*) FILTER (WHERE sport = 'basketball'),
         count(*) FILTER (WHERE sport IS NULL)
    INTO vb, bb, nul FROM scheduling_global_blocks;
  IF vb <> 2 OR bb <> 1 THEN
    RAISE EXCEPTION 'migration 286: expected 2 volleyball + 1 basketball after backfill, got vb=% bb=% unscoped=%', vb, bb, nul;
  END IF;
  RAISE NOTICE 'migration 286: scheduling_global_blocks.sport added — % volleyball, % basketball, % club-wide', vb, bb, nul;
END $$;

COMMIT;
