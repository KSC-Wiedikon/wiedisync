-- Migration 389: junction rows can never be re-pointed — DB backstop.
--
-- 2026-09-28 deep audit F07 (update side), F08, F32. The LEADER update grants on
-- these junctions filter the PRE-update row (`teams_id` = a team I lead), and
-- nothing validated the new values. One PATCH re-pointed a legitimate row:
--   teams_coaches / teams_responsibles  {teams_id: <other team>}  → coach of any
--       team: roster PII (minors included) + roster, fine and RSVP writes there
--   hall_slots_teams  {hall_slots_id: <other slot>}  → take over another team's
--       hall slot (and fire its training cascade)
--   events_teams      {events_id: <other event>}     → manage another team's event
--   forms_teams       {forms_id: <other form>}       → read that form's submissions
--   teams_sponsors    {sponsors_id: <other sponsor>} → edit a sponsor shown on kscw.ch
--   game_guests / game_guest_teams {game|team|member} → create-then-move grants a
--       cross-team RSVP read through the participation_visibility reconcile
-- The same re-point is reachable through a PARENT save: Directus upserts each
-- kept M2M link `{ id, <related>, <parent fk> }`, so naming a junction id that
-- belongs to another parent moves it under yours.
--
-- The kscw-hooks IMMUTABLE_ON_UPDATE filter now refuses these for items-API
-- writes by non-admins. This is the schema-level twin (migration 163 pattern):
-- it holds for every writer — a raw knex endpoint, a future grant widening, the
-- Directus admin UI. The M2M editors delete + insert, and every FK here is
-- ON DELETE CASCADE (no SET NULL action that would UPDATE a key). Unchanged
-- values pass, so the upsert of a kept link `{ id: 14, teams_id: 3 }` works.
--
-- ONE code path re-points on purpose: the season rollover
-- (POST /kscw/admin/terminplanung/rollover-season, game-scheduling.js) MOVES
-- hall_slots_teams, upcoming events_teams and open forms_teams links from each
-- archived team to its clone, in place (`.update({ teams_id: newId })`) — it
-- clones teams_coaches / teams_responsibles / teams_sponsors but moves these
-- three. It must open its transaction with
--   await trx.raw("SELECT set_config('kscw.allow_junction_repoint', 'on', true)")
-- (transaction-local, so it ends with the rollover). Without it the first move
-- raises check_violation and the WHOLE rollover rolls back — nothing is half
-- moved, but the season does not roll over. ⚠ That endpoint change must be live
-- before the next rollover (June); deploying this migration first is safe as
-- long as nobody rolls a season over in between.
--
-- The same escape hatch, for a deliberate data repair in psql as the DB owner:
--   SET LOCAL kscw.allow_junction_repoint = 'on';
-- in the same transaction as the UPDATE.
--
-- Schema only + idempotent. Self-wrapped in a transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.kscw_junction_keys_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  col text;
  old_val text;
  new_val text;
BEGIN
  IF coalesce(current_setting('kscw.allow_junction_repoint', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%1$I::text, ($2).%1$I::text', col) USING OLD, NEW INTO old_val, new_val;
    IF old_val IS DISTINCT FROM new_val THEN
      RAISE EXCEPTION '%: % cannot be changed after creation (delete the link and create a new one)',
        TG_TABLE_NAME, col
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teams_coaches_keys_immutable ON teams_coaches;
CREATE TRIGGER trg_teams_coaches_keys_immutable
  BEFORE UPDATE ON teams_coaches
  FOR EACH ROW EXECUTE FUNCTION public.kscw_junction_keys_immutable('teams_id', 'members_id');

DROP TRIGGER IF EXISTS trg_teams_responsibles_keys_immutable ON teams_responsibles;
CREATE TRIGGER trg_teams_responsibles_keys_immutable
  BEFORE UPDATE ON teams_responsibles
  FOR EACH ROW EXECUTE FUNCTION public.kscw_junction_keys_immutable('teams_id', 'members_id');

DROP TRIGGER IF EXISTS trg_hall_slots_teams_keys_immutable ON hall_slots_teams;
CREATE TRIGGER trg_hall_slots_teams_keys_immutable
  BEFORE UPDATE ON hall_slots_teams
  FOR EACH ROW EXECUTE FUNCTION public.kscw_junction_keys_immutable('hall_slots_id', 'teams_id');

DROP TRIGGER IF EXISTS trg_events_teams_keys_immutable ON events_teams;
CREATE TRIGGER trg_events_teams_keys_immutable
  BEFORE UPDATE ON events_teams
  FOR EACH ROW EXECUTE FUNCTION public.kscw_junction_keys_immutable('events_id', 'teams_id');

DROP TRIGGER IF EXISTS trg_events_members_keys_immutable ON events_members;
CREATE TRIGGER trg_events_members_keys_immutable
  BEFORE UPDATE ON events_members
  FOR EACH ROW EXECUTE FUNCTION public.kscw_junction_keys_immutable('events_id', 'members_id');

DROP TRIGGER IF EXISTS trg_forms_teams_keys_immutable ON forms_teams;
CREATE TRIGGER trg_forms_teams_keys_immutable
  BEFORE UPDATE ON forms_teams
  FOR EACH ROW EXECUTE FUNCTION public.kscw_junction_keys_immutable('forms_id', 'teams_id');

DROP TRIGGER IF EXISTS trg_teams_sponsors_keys_immutable ON teams_sponsors;
CREATE TRIGGER trg_teams_sponsors_keys_immutable
  BEFORE UPDATE ON teams_sponsors
  FOR EACH ROW EXECUTE FUNCTION public.kscw_junction_keys_immutable('teams_id', 'sponsors_id');

DROP TRIGGER IF EXISTS trg_game_guests_keys_immutable ON game_guests;
CREATE TRIGGER trg_game_guests_keys_immutable
  BEFORE UPDATE ON game_guests
  FOR EACH ROW EXECUTE FUNCTION public.kscw_junction_keys_immutable('game', 'member', 'via_team');

DROP TRIGGER IF EXISTS trg_game_guest_teams_keys_immutable ON game_guest_teams;
CREATE TRIGGER trg_game_guest_teams_keys_immutable
  BEFORE UPDATE ON game_guest_teams
  FOR EACH ROW EXECUTE FUNCTION public.kscw_junction_keys_immutable('game', 'team');

COMMIT;
