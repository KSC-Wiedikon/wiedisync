-- Migration 390: DB backstops from the 2026-09-28 deep audit — five small, unrelated
-- hardenings that each close a gap the application layer alone cannot hold.
--
-- ── 1. members.deactivated_at cannot be backdated (fixes 335) ───────────────
-- 335 made the column trigger-owned, but the trigger only acted on a CHANGE of
-- `kscw_membership_active`. Two writes went straight through:
--   * PATCH { deactivated_at: '2020-01-01' } on an already-inactive member — the
--     status is unchanged, so the trigger never touched the value; and
--   * PATCH { kscw_membership_active: false, deactivated_at: '2020-01-01' } —
--     the transition branch did COALESCE(NEW.deactivated_at, now()), i.e. it
--     KEPT the caller's value.
-- Either one makes a member due for erasure on /admin/data-health immediately
-- (retention.js: 12 months after deactivated_at) — the retention clock is only
-- worth anything if nobody can wind it. Now:
--   * true→false  stamps COALESCE(OLD.deactivated_at, now()) — never NEW.
--   * false→true  clears it, as before (reactivation is still how it is reset).
--   * no status change: the stored value is kept, whatever NEW says.
--   * an ACTIVE row can never carry a stamp (335: "a stale timestamp under a live
--     membership would read … as eligible for erasure"; the member_teams create
--     filter in kscw-hooks also treats a non-NULL stamp as inactive). 0 such rows
--     on dev today, so this is a tightening, not a data change.
-- The column is readonly in directus_fields and memberFieldSchema.ts says "never
-- by hand"; no endpoint or script writes it (grep, 2026-09-28). The one legitimate
-- manual write — dating one of the undated departures 335 left NULL on purpose —
-- goes through psql with an escape hatch, same shape as 389:
--   BEGIN; SET LOCAL kscw.allow_deactivated_at_edit = 'on';
--   UPDATE members SET deactivated_at = '…' WHERE id = …; COMMIT;
-- ⚠ Still BEFORE UPDATE only, as in 335. An INSERT can carry a value; no insert
-- path sets it today (ClubDesk import, registration, dev refresh = full pg_dump
-- whose triggers are created after the COPY). Left alone deliberately.
--
-- ── 2. trg_pv_members fires only when a login link can change (fixes 341) ───
-- 341 hung the participation_visibility full reconcile on EVERY statement that
-- updates `members` — ClubDesk sync, profile edits, the nightly scrubs — although
-- the expected view reads only members.id and members."user". Now
-- AFTER INSERT OR DELETE OR UPDATE OF "user", id. INSERT/DELETE stay: cheap, rare,
-- and a delete cascading through member_teams/game_guests must still reconcile.
-- Function unchanged. (UPDATE OF fires when the column is in the SET list even if
-- the value is unchanged — a statement trigger cannot see OLD/NEW — which is still
-- a strict subset of today's firing.)
--
-- ── 3. referee_expenses.amount >= 0 ─────────────────────────────────────────
-- numeric(10,2) since 254 (the "amount is a string" note is fetchItems'
-- serialisation, not the column). A negative fee would net against a member's
-- season payout. NOT VALID + guarded; dev has 4 rows, min 60.00, 0 negative, so a
-- later VALIDATE CONSTRAINT is expected to pass. NULL passes, as it does today.
--
-- ── 4. live_match_logs.events size cap (fixes 376) ──────────────────────────
-- The board's publisher token can create rows with an unbounded jsonb. The board
-- itself caps a match at 4000 events (point-hub historyStore.js MAX_EVENTS); 4000
-- padded events measure 752,008 bytes as jsonb on dev. The cap is 2 MiB — ~2.8×
-- that — because a rejected upload is NOT read as "done" by matchUpload.js (only
-- RECORD_NOT_UNIQUE is): a legitimate match over the cap would be retried
-- forever. 0 rows on dev today, so there is no existing maximum to clear.
-- ⚠ The check runs before TOAST compression, so it bounds the raw jsonb size.
--
-- ── 5. game_roster_officials drops the DoB when its member is deleted (fixes 372)
-- `member` is ON DELETE SET NULL (live FK checked). Deleting a member left their
-- full birthdate on every match sheet they ever sat on the bench for, now
-- attached to no member and reachable by no retention sweep. A BEFORE UPDATE OF
-- member trigger nulls `birthdate` on the non-NULL→NULL transition (the FK action
-- is an UPDATE, so it fires). `last_name` / `first_initial` are KEPT: 372 says the
-- name is denormalised precisely so "the sheet stays as it was shown", and it is
-- the club's record of who sat on the bench. A row INSERTED with member NULL (a
-- VM official we hold no member for) keeps its DoB — that is 372's design and the
-- endpoint writes by delete + insert, never by nulling `member`. No backfill:
-- existing member-NULL rows cannot be told apart from VM officials (0 on dev).
--
-- Schema-only + idempotent. No permission rows (CLAUDE.md rule 1). Self-wrapped.

BEGIN;

-- ── 1 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.members_stamp_deactivated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  hatch boolean := coalesce(current_setting('kscw.allow_deactivated_at_edit', true), '') = 'on';
BEGIN
  IF NEW.kscw_membership_active IS DISTINCT FROM OLD.kscw_membership_active THEN
    IF NEW.kscw_membership_active IS FALSE THEN
      -- Deactivated now: start the clock. From OLD, never NEW, so the caller
      -- cannot hand in a backdated stamp with the deactivation itself.
      IF hatch THEN
        NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
      ELSE
        NEW.deactivated_at := COALESCE(OLD.deactivated_at, now());
      END IF;
    END IF;
  ELSIF NOT hatch THEN
    -- No status change: the stored clock is not the caller's to move.
    NEW.deactivated_at := OLD.deactivated_at;
  END IF;

  -- Back in (or still in) the club — no retention period is running.
  IF NEW.kscw_membership_active IS TRUE THEN
    NEW.deactivated_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger unchanged (BEFORE UPDATE FOR EACH ROW); recreated so the migration is
-- self-contained if 335's trigger was ever dropped.
DROP TRIGGER IF EXISTS trg_members_deactivated_at ON members;
CREATE TRIGGER trg_members_deactivated_at
  BEFORE UPDATE ON members
  FOR EACH ROW
  EXECUTE FUNCTION members_stamp_deactivated_at();

COMMENT ON COLUMN members.deactivated_at IS
  'When kscw_membership_active last went true→false. Trigger-owned (trg_members_deactivated_at): stamped on deactivation, cleared on reactivation, otherwise immutable (migration 390; psql repair via SET LOCAL kscw.allow_deactivated_at_edit = ''on''). The start of any retention period for an ex-member.';

-- ── 2 ───────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_pv_members ON members;
CREATE TRIGGER trg_pv_members
  AFTER INSERT OR DELETE OR UPDATE OF "user", id ON members
  FOR EACH STATEMENT
  EXECUTE FUNCTION kscw_pv_refresh_trigger();

-- ── 3 ───────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'referee_expenses_amount_nonneg'
       AND conrelid = 'public.referee_expenses'::regclass
  ) THEN
    ALTER TABLE referee_expenses
      ADD CONSTRAINT referee_expenses_amount_nonneg
      CHECK (amount >= 0) NOT VALID;
  END IF;
END $$;

-- ── 4 ───────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'live_match_logs_events_size'
       AND conrelid = 'public.live_match_logs'::regclass
  ) THEN
    ALTER TABLE live_match_logs
      ADD CONSTRAINT live_match_logs_events_size
      CHECK (pg_column_size(events) <= 2097152) NOT VALID;   -- 2 MiB
  END IF;
END $$;

-- ── 5 ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.game_roster_officials_forget_dob()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The member behind this bench row is gone (ON DELETE SET NULL): the DoB has
  -- no owner left to retain it for. The name stays — it is the sheet's record.
  NEW.birthdate := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_game_roster_officials_forget_dob ON game_roster_officials;
CREATE TRIGGER trg_game_roster_officials_forget_dob
  BEFORE UPDATE OF member ON game_roster_officials
  FOR EACH ROW
  WHEN (OLD.member IS NOT NULL AND NEW.member IS NULL)
  EXECUTE FUNCTION game_roster_officials_forget_dob();

COMMIT;

-- Verification (dev/prod), each in a rolled-back transaction:
--   BEGIN;
--     -- 1: backdate refused on an inactive member, stamp kept
--     UPDATE members SET deactivated_at = '2000-01-01' WHERE id = <inactive id>;
--     SELECT deactivated_at FROM members WHERE id = <inactive id>;   -- → unchanged
--     -- 1: deactivation ignores a supplied value
--     UPDATE members SET kscw_membership_active = false, deactivated_at = '2000-01-01'
--      WHERE id = <active id>;
--     SELECT deactivated_at FROM members WHERE id = <active id>;     -- → now()
--     UPDATE members SET kscw_membership_active = true WHERE id = <active id>;
--     SELECT deactivated_at FROM members WHERE id = <active id>;     -- → NULL
--   ROLLBACK;
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_pv_members';
--     -- → … AFTER INSERT OR DELETE OR UPDATE OF "user", id ON public.members …
--   SELECT count(*) FROM verify_participation_visibility();        -- → 0
--   SELECT count(*) FROM referee_expenses WHERE amount < 0;         -- → 0, then:
--     ALTER TABLE referee_expenses VALIDATE CONSTRAINT referee_expenses_amount_nonneg;
--   SELECT max(pg_column_size(events)) FROM live_match_logs;        -- → < 2097152
