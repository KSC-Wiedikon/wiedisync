-- Migration 247 — games / trainings / rankings referential integrity
--
-- Context (DB review 2026-07-27, findings ri-03/GAMES-03, ri-04/GAMES-09,
-- ri-12/GAMES-11, GAMES-04 data half). The games table carries kscw_team,
-- hall and the whole duty-assignment matrix as bare integers — games does not
-- appear ONCE in the FK catalog — and trainings.team / hall_slot / hall are
-- equally unconstrained. Deleting a team or member silently corrupts every
-- duty page, scorer match sheet and Einsatzliste join. Live corruption on
-- prod 2026-07-27:
--   • games 392/393 → deleted team 91 (BB inactive-team restructure)
--   • game 57 scorer_member=45 + scoreboard_member=86, game 130
--     scorer_member=25 + scoreboard_member=44 — all four members deleted
--   • 28 trainings dangle on deleted hall_slots rows (2026-03-17..06-05);
--     deleting one of those trainings makes the tombstone write violate
--     training_slot_skips' FK (caught+swallowed → tombstone lost)
--   • rankings rows 485/707 → deleted teams 14/91
--   • 15 DU23-2 games (2025/26, all completed) sit with kscw_team NULL:
--     sv-sync's active-only team lookup missed after the team went inactive
--     and COMPARE_FIELDS re-pointed them to NULL (GAMES-04; the sync-side
--     never-downgrade guard ships separately in sv-sync.js)
--
-- Fix: guarded repair (NULL-out / re-attach) immediately before every FK add.
-- Delete rules: SET NULL everywhere here — game and training history must
-- survive a team/member/hall deletion (003's "game record should persist"
-- intent) — EXCEPT trainings.team (CASCADE: a training without its team is
-- meaningless, and team deletion is already gated by trg_protect_team_delete
-- while a roster exists).
--
-- rankings.team stays (bp-sync writes it for active BB teams; sv-sync never
-- does — asymmetry documented in the review, GAMES-11) but gets the FK so it
-- can no longer dangle.
--
-- Schema + data repair; idempotent (safe to re-run).

BEGIN;

-- ── (0) Helper-free guarded FK adds ──────────────────────────────────────
-- Pattern per column: repair violating rows, then ADD CONSTRAINT if absent.

-- GAMES-04: re-attach the DU23-2 2025/26 season before the generic repairs.
-- Target resolved by SV team id (vb_14040); two teams rows share it (10 = the
-- real one: 11 roster rows, 11 trainings; 96 = an empty duplicate) — min(id)
-- picks 10 deterministically.
UPDATE games g
   SET kscw_team = (SELECT min(t.id) FROM teams t WHERE t.team_id = 'vb_14040')
 WHERE g.kscw_team IS NULL
   AND g.game_id LIKE 'vb_%'
   AND (g.home_team ILIKE '%Wiedikon DU23-2%' OR g.away_team ILIKE '%Wiedikon DU23-2%')
   AND EXISTS (SELECT 1 FROM teams t WHERE t.team_id = 'vb_14040');

-- games → teams (kscw_team + the 8 duty-team columns)
UPDATE games g SET kscw_team = NULL                  WHERE g.kscw_team IS NOT NULL                  AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.kscw_team);
UPDATE games g SET scorer_duty_team = NULL           WHERE g.scorer_duty_team IS NOT NULL           AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.scorer_duty_team);
UPDATE games g SET scoreboard_duty_team = NULL       WHERE g.scoreboard_duty_team IS NOT NULL       AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.scoreboard_duty_team);
UPDATE games g SET scorer_scoreboard_duty_team = NULL WHERE g.scorer_scoreboard_duty_team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.scorer_scoreboard_duty_team);
UPDATE games g SET bb_duty_team = NULL               WHERE g.bb_duty_team IS NOT NULL               AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.bb_duty_team);
UPDATE games g SET bb_scorer_duty_team = NULL        WHERE g.bb_scorer_duty_team IS NOT NULL        AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.bb_scorer_duty_team);
UPDATE games g SET bb_timekeeper_duty_team = NULL    WHERE g.bb_timekeeper_duty_team IS NOT NULL    AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.bb_timekeeper_duty_team);
UPDATE games g SET bb_24s_duty_team = NULL           WHERE g.bb_24s_duty_team IS NOT NULL           AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.bb_24s_duty_team);
UPDATE games g SET referee_duty_team = NULL          WHERE g.referee_duty_team IS NOT NULL          AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = g.referee_duty_team);

-- games → members (duty assignments)
UPDATE games g SET scorer_member = NULL              WHERE g.scorer_member IS NOT NULL              AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = g.scorer_member);
UPDATE games g SET scoreboard_member = NULL          WHERE g.scoreboard_member IS NOT NULL          AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = g.scoreboard_member);
UPDATE games g SET scorer_scoreboard_member = NULL   WHERE g.scorer_scoreboard_member IS NOT NULL   AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = g.scorer_scoreboard_member);
UPDATE games g SET bb_scorer_member = NULL           WHERE g.bb_scorer_member IS NOT NULL           AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = g.bb_scorer_member);
UPDATE games g SET bb_timekeeper_member = NULL       WHERE g.bb_timekeeper_member IS NOT NULL       AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = g.bb_timekeeper_member);
UPDATE games g SET bb_24s_official = NULL            WHERE g.bb_24s_official IS NOT NULL            AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = g.bb_24s_official);
UPDATE games g SET referee_member = NULL             WHERE g.referee_member IS NOT NULL             AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = g.referee_member);

-- games → halls
UPDATE games g SET hall = NULL                       WHERE g.hall IS NOT NULL                       AND NOT EXISTS (SELECT 1 FROM halls h WHERE h.id = g.hall);

DO $$
DECLARE
  col text;
  ref text;
BEGIN
  FOR col, ref IN
    SELECT * FROM (VALUES
      ('kscw_team',                  'teams'),
      ('scorer_duty_team',           'teams'),
      ('scoreboard_duty_team',       'teams'),
      ('scorer_scoreboard_duty_team','teams'),
      ('bb_duty_team',               'teams'),
      ('bb_scorer_duty_team',        'teams'),
      ('bb_timekeeper_duty_team',    'teams'),
      ('bb_24s_duty_team',           'teams'),
      ('referee_duty_team',          'teams'),
      ('scorer_member',              'members'),
      ('scoreboard_member',          'members'),
      ('scorer_scoreboard_member',   'members'),
      ('bb_scorer_member',           'members'),
      ('bb_timekeeper_member',       'members'),
      ('bb_24s_official',            'members'),
      ('referee_member',             'members'),
      ('hall',                       'halls')
    ) AS v(col, ref)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = format('games_%s_foreign', col) AND conrelid = 'games'::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE games ADD CONSTRAINT games_%I_foreign FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE SET NULL',
        col, col, ref
      );
    END IF;
  END LOOP;
END $$;

-- ── trainings ────────────────────────────────────────────────────────────
-- A training whose team is gone is meaningless (0 live); the 28 dangling
-- hall_slot refs are NULLed (history preserved, tombstoning unaffected — the
-- skip table keys on real slots only).
DELETE FROM trainings tr WHERE tr.team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = tr.team);
UPDATE trainings tr SET hall_slot = NULL WHERE tr.hall_slot IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hall_slots h WHERE h.id = tr.hall_slot);
UPDATE trainings tr SET hall = NULL      WHERE tr.hall      IS NOT NULL AND NOT EXISTS (SELECT 1 FROM halls h WHERE h.id = tr.hall);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trainings_team_foreign' AND conrelid = 'trainings'::regclass) THEN
    ALTER TABLE trainings ADD CONSTRAINT trainings_team_foreign FOREIGN KEY (team) REFERENCES teams(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trainings_hall_slot_foreign' AND conrelid = 'trainings'::regclass) THEN
    ALTER TABLE trainings ADD CONSTRAINT trainings_hall_slot_foreign FOREIGN KEY (hall_slot) REFERENCES hall_slots(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trainings_hall_foreign' AND conrelid = 'trainings'::regclass) THEN
    ALTER TABLE trainings ADD CONSTRAINT trainings_hall_foreign FOREIGN KEY (hall) REFERENCES halls(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── hall_slots / hall_closures → halls ───────────────────────────────────
UPDATE hall_slots hs   SET hall = NULL WHERE hs.hall IS NOT NULL AND NOT EXISTS (SELECT 1 FROM halls h WHERE h.id = hs.hall);
UPDATE hall_closures hc SET hall = NULL WHERE hc.hall IS NOT NULL AND NOT EXISTS (SELECT 1 FROM halls h WHERE h.id = hc.hall);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hall_slots_hall_foreign' AND conrelid = 'hall_slots'::regclass) THEN
    ALTER TABLE hall_slots ADD CONSTRAINT hall_slots_hall_foreign FOREIGN KEY (hall) REFERENCES halls(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hall_closures_hall_foreign' AND conrelid = 'hall_closures'::regclass) THEN
    ALTER TABLE hall_closures ADD CONSTRAINT hall_closures_hall_foreign FOREIGN KEY (hall) REFERENCES halls(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── rankings.team ────────────────────────────────────────────────────────
UPDATE rankings r SET team = NULL WHERE r.team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = r.team);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rankings_team_foreign' AND conrelid = 'rankings'::regclass) THEN
    ALTER TABLE rankings ADD CONSTRAINT rankings_team_foreign FOREIGN KEY (team) REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
