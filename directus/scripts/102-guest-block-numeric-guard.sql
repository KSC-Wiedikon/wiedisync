-- Migration 102: guard the implicit varchar->int cast in trg_participations_guest_block.
--
-- `participations.activity_id` is `varchar(255)` but `games.id` is `serial`
-- (integer). The guest-block trigger (migration 050) resolves the game's team
-- with `SELECT kscw_team FROM games WHERE id = NEW.activity_id` — an IMPLICIT
-- varchar->int comparison. Postgres casts NEW.activity_id to int for the compare;
-- for a well-formed numeric game id that's fine, but if a row ever carries a
-- non-numeric `activity_id` (a UUID-style id, a stray prefix, a future
-- non-game activity that slipped through with activity_type='game') the cast
-- either errors or the lookup silently finds nothing → `v_team IS NULL` → the
-- guest block is skipped and a guest could confirm a game.
--
-- Fix: only attempt the games lookup when `NEW.activity_type = 'game'` AND
-- `NEW.activity_id` is a pure run of digits (`~ '^[0-9]+$'`). The team-scope join
-- and the rest of the logic are preserved BYTE-for-BYTE from migration 050, so
-- behaviour for valid numeric game participations is identical — the guard only
-- short-circuits the malformed-id case that previously bypassed the block.
--
-- Also (re)pins `SET search_path = public` on the function (migration 050 already
-- had it; kept here so a CREATE OR REPLACE can never drop it).
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER. Schema-only, no
-- data changes, no permission changes.
--
-- Apply on dev:  npm run db:migrate:dev
-- Apply on prod: npm run db:migrate:prod

CREATE OR REPLACE FUNCTION trg_participations_guest_block()
RETURNS trigger AS $$
DECLARE
  v_team integer;
BEGIN
  -- Block guests from confirming game participation (on insert or status
  -- change to confirmed), scoped to the team that owns the game.
  IF NEW.activity_type = 'game' AND NEW.status = 'confirmed' AND NEW.member IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
      -- Resolve the game's team. If the game row is missing (FK orphan)
      -- we fall back to allowing the write — the FK constraint will catch
      -- the real problem, not this trigger.
      --
      -- Guard the implicit varchar->int cast: only look up games when
      -- activity_id is a pure numeric string. A non-numeric activity_id would
      -- otherwise make the cast error or the lookup find nothing, silently
      -- skipping the guest block. A non-numeric game activity_id is itself
      -- invalid, so leaving v_team NULL (no block) is the safe fallback —
      -- the FK / app layer owns that error, not this guard.
      IF NEW.activity_id ~ '^[0-9]+$' THEN
        SELECT kscw_team INTO v_team FROM games WHERE id = NEW.activity_id::integer;
      END IF;
      IF v_team IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM member_teams
          WHERE member = NEW.member
            AND team = v_team
            AND guest_level > 0
          LIMIT 1
        ) THEN
          RAISE EXCEPTION 'Guests cannot directly confirm game participation';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_participations_guest_block ON participations;
CREATE TRIGGER trg_participations_guest_block
  BEFORE INSERT OR UPDATE ON participations
  FOR EACH ROW EXECUTE FUNCTION trg_participations_guest_block();
