-- Migration 245 — junction integrity: purge NULL-orphaned rows, stop them
-- being re-created, and give every M2M junction a real pair identity
--
-- Context (DB review 2026-07-27, findings jix-01 / jix-05 / ri-02 / EVT-01).
-- Migrations 021/037 changed the junction FKs to ON DELETE CASCADE, but only
-- 021 flipped Directus' one_deselect_action to 'delete' (teams_coaches,
-- teams_responsibles). Every other junction relation is still 'nullify', so
-- deselecting a related item in the admin UI NULLs the junction FK instead of
-- deleting the row — the exact "null-partitioned tombstone" class 021/037
-- documented (NULL leaks as the string "null" into m2m `_in` filters →
-- Directus castToNumber 400s). Live counts on prod, 2026-07-27:
--   • events_teams: 4 rows with events_id IS NULL — these four rows also break
--     the public events feed + iCal outright: `id NOT IN (subquery containing
--     NULL)` is never true (SQL three-valued logic), so BOTH feeds return
--     zero club-wide events (finding EVT-01; the endpoint code is hardened
--     separately, this migration removes the poison rows)
--   • hall_slots_teams: 24 NULL rows (17 five days earlier — actively growing)
--   • member_teams: 10 roster rows with team IS NULL (all 2026-03-29)
--   • events_members: 0, but same exposure
-- member_teams.team — the other half of the club's primary roster table — also
-- never got a foreign key at all (member got one in 003; team was skipped in
-- both junction-cascade passes).
--
-- Fix:
--   1. Purge NULL-FK junction rows (no pair = no business meaning)
--   2. member_teams.team gets the missing FK (CASCADE, like every junction)
--   3. Junction FK columns become NOT NULL so a 'nullify' regression fails
--      loudly instead of corrupting
--   4. one_deselect_action = 'delete' on all junction relations (021 style)
--   5. Composite unique pair indexes on every junction that lacks one
--      (member_teams already has member_teams_member_team_unique from 044);
--      duplicate pairs are deduped first, keeping the lowest id
--
-- conversation_members and the participations.member M2O are deliberately NOT
-- touched (messaging semantics / not a junction).
--
-- Schema + data repair; idempotent (safe to re-run).

BEGIN;

-- ── (1) Purge NULL-orphaned junction rows ────────────────────────────────
DELETE FROM events_teams      WHERE events_id     IS NULL OR teams_id   IS NULL;
DELETE FROM events_members    WHERE events_id     IS NULL OR members_id IS NULL;
DELETE FROM hall_slots_teams  WHERE hall_slots_id IS NULL OR teams_id   IS NULL;
DELETE FROM member_teams      WHERE member        IS NULL OR team       IS NULL;
DELETE FROM teams_coaches     WHERE teams_id      IS NULL OR members_id IS NULL;
DELETE FROM teams_responsibles WHERE teams_id     IS NULL OR members_id IS NULL;
DELETE FROM teams_sponsors    WHERE teams_id      IS NULL OR sponsors_id IS NULL;
DELETE FROM forms_teams       WHERE forms_id      IS NULL OR teams_id   IS NULL;
DELETE FROM carpool_passengers WHERE carpool      IS NULL OR passenger  IS NULL;

-- ── (2) member_teams.team: the missing FK ────────────────────────────────
-- A roster row whose team no longer exists carries no meaning — delete, don't
-- SET NULL (0 such rows live; guard for divergent clones).
DELETE FROM member_teams mt
WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = mt.team);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'member_teams_team_foreign' AND conrelid = 'member_teams'::regclass
  ) THEN
    ALTER TABLE member_teams
      ADD CONSTRAINT member_teams_team_foreign
      FOREIGN KEY (team) REFERENCES teams(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── (3) NOT NULL on junction FK columns ──────────────────────────────────
-- SET NOT NULL is a no-op when already set.
ALTER TABLE member_teams       ALTER COLUMN member        SET NOT NULL;
ALTER TABLE member_teams       ALTER COLUMN team          SET NOT NULL;
ALTER TABLE events_teams       ALTER COLUMN events_id     SET NOT NULL;
ALTER TABLE events_teams       ALTER COLUMN teams_id      SET NOT NULL;
ALTER TABLE events_members     ALTER COLUMN events_id     SET NOT NULL;
ALTER TABLE events_members     ALTER COLUMN members_id    SET NOT NULL;
ALTER TABLE hall_slots_teams   ALTER COLUMN hall_slots_id SET NOT NULL;
ALTER TABLE hall_slots_teams   ALTER COLUMN teams_id      SET NOT NULL;
ALTER TABLE teams_coaches      ALTER COLUMN teams_id      SET NOT NULL;
ALTER TABLE teams_coaches      ALTER COLUMN members_id    SET NOT NULL;
ALTER TABLE teams_responsibles ALTER COLUMN teams_id      SET NOT NULL;
ALTER TABLE teams_responsibles ALTER COLUMN members_id    SET NOT NULL;
ALTER TABLE teams_sponsors     ALTER COLUMN teams_id      SET NOT NULL;
ALTER TABLE teams_sponsors     ALTER COLUMN sponsors_id   SET NOT NULL;
ALTER TABLE forms_teams        ALTER COLUMN forms_id      SET NOT NULL;
ALTER TABLE forms_teams        ALTER COLUMN teams_id      SET NOT NULL;
ALTER TABLE carpool_passengers ALTER COLUMN carpool       SET NOT NULL;
ALTER TABLE carpool_passengers ALTER COLUMN passenger     SET NOT NULL;

-- ── (4) Admin-UI deselect must delete, not nullify ───────────────────────
UPDATE directus_relations
   SET one_deselect_action = 'delete'
 WHERE many_collection IN (
         'member_teams', 'events_teams', 'events_members', 'hall_slots_teams',
         'teams_coaches', 'teams_responsibles', 'teams_sponsors',
         'forms_teams', 'carpool_passengers'
       )
   AND one_deselect_action = 'nullify';

-- ── (5) Composite pair uniqueness ────────────────────────────────────────
-- Dedupe first (keep the lowest id per pair — oldest row wins; junction rows
-- carry no payload beyond the pair, except carpool_passengers.status where the
-- oldest row is the original request).
DELETE FROM teams_coaches a      USING teams_coaches b      WHERE a.id > b.id AND a.teams_id = b.teams_id AND a.members_id = b.members_id;
DELETE FROM teams_responsibles a USING teams_responsibles b WHERE a.id > b.id AND a.teams_id = b.teams_id AND a.members_id = b.members_id;
DELETE FROM teams_sponsors a     USING teams_sponsors b     WHERE a.id > b.id AND a.teams_id = b.teams_id AND a.sponsors_id = b.sponsors_id;
DELETE FROM events_teams a       USING events_teams b       WHERE a.id > b.id AND a.events_id = b.events_id AND a.teams_id = b.teams_id;
DELETE FROM events_members a     USING events_members b     WHERE a.id > b.id AND a.events_id = b.events_id AND a.members_id = b.members_id;
DELETE FROM hall_slots_teams a   USING hall_slots_teams b   WHERE a.id > b.id AND a.hall_slots_id = b.hall_slots_id AND a.teams_id = b.teams_id;
DELETE FROM forms_teams a        USING forms_teams b        WHERE a.id > b.id AND a.forms_id = b.forms_id AND a.teams_id = b.teams_id;
DELETE FROM carpool_passengers a USING carpool_passengers b WHERE a.id > b.id AND a.carpool = b.carpool AND a.passenger = b.passenger;

CREATE UNIQUE INDEX IF NOT EXISTS teams_coaches_pair_uq      ON teams_coaches (teams_id, members_id);
CREATE UNIQUE INDEX IF NOT EXISTS teams_responsibles_pair_uq ON teams_responsibles (teams_id, members_id);
CREATE UNIQUE INDEX IF NOT EXISTS teams_sponsors_pair_uq     ON teams_sponsors (teams_id, sponsors_id);
CREATE UNIQUE INDEX IF NOT EXISTS events_teams_pair_uq       ON events_teams (events_id, teams_id);
CREATE UNIQUE INDEX IF NOT EXISTS events_members_pair_uq     ON events_members (events_id, members_id);
CREATE UNIQUE INDEX IF NOT EXISTS hall_slots_teams_pair_uq   ON hall_slots_teams (hall_slots_id, teams_id);
CREATE UNIQUE INDEX IF NOT EXISTS forms_teams_pair_uq        ON forms_teams (forms_id, teams_id);
CREATE UNIQUE INDEX IF NOT EXISTS carpool_passengers_pair_uq ON carpool_passengers (carpool, passenger);

COMMIT;
