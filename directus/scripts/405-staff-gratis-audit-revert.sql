-- Migration 405: the staff 'Gratis' fill is audited, and undone when the seat goes.
--
-- WHY
-- ---
-- Security audit 2026-10-11, M10. Migration 262's staff_gratis_fill() (AFTER
-- INSERT on teams_coaches / teams_responsibles) sets an EMPTY
-- members.beitragskategorie to 'Gratis' (free membership) for an active member
-- with no non-guest roster row, and queues it for the ClubDesk push. The LEADER
-- policy lets a coach add ANY member as co-coach / team responsible of their own
-- team through the items API, so a coach could hand anyone a free membership:
-- silently (the only trace was the junction insert in directus_activity) and for
-- good (removing the seat again changed nothing).
--
-- WHAT CHANGES
-- ------------
--   1. staff_gratis_fill() — same rule, same UPDATE as 262, plus ONE user_logs row
--      when (and only when) it changed a member:
--        action 'fee_category_auto', collection 'members', record_id = member,
--        user NULL (system row — the DB cannot know the Directus user; the
--        junction insert itself is actor-logged by Directus and kscw-hooks),
--        data { source, field, value, team, junction, junction_id,
--               clubdesk_queued, pending_before, revision_hwm }.
--      The row also shows on /admin/audit-log under the member.
--   2. staff_gratis_revert() — DEFERRED constraint trigger, AFTER DELETE on both
--      junctions. At COMMIT, when the member
--        • holds no seat left in teams_coaches ∪ teams_responsibles,
--        • still has no non-guest member_teams row (262's rule),
--        • still holds exactly 'Gratis', and
--        • nobody touched the category since the fill (signal below),
--      it sets beitragskategorie back to NULL and writes
--      'fee_category_auto_revert' (always), plus
--      'fee_category_auto_revert_needs_clubdesk' when the 'Gratis' may already
--      be in ClubDesk (see CLUBDESK).
--
-- "NOBODY TOUCHED IT SINCE" — the signal
-- --------------------------------------
--   The newest user_logs row on this member (collection 'members') whose payload
--   names `beitragskategorie` must BE the fill's row. Every human write path of
--   the column leaves such a row: items-API edits (kscw-hooks audit.js logs the
--   payload, keys included), ClubDesk proposal accept / refuse / superseded
--   (clubdesk-update.js writeUserLog, field 'beitragskategorie'), the
--   registration merge (fields_applied). This trigger's own rows name it too, so
--   a revert is never repeated. Ordered by user_logs.id, not by date (the hook
--   stamps JS time, this trigger DB time). Two backstops for writers that leave
--   no such row:
--     • directus_revisions: a members revision newer than the fill whose delta
--       names the column. Catches items-API writes in SYSTEM context, which the
--       audit hook skips (no accountability.user), and a payload too big for
--       the hook's 4 KB preview. The fill stores the then
--       max(directus_revisions.id) as revision_hwm, so this is a PK range scan
--       over the revisions written since, not a scan of the 3 GB table.
--     • the value: it must still be exactly 'Gratis'. Every unlogged raw writer
--       that CHANGED it (registration approval, a migration, psql) left
--       something else there.
--   Blind spot: a raw, unlogged write that sets 'Gratis' AGAIN. No such writer
--   exists today (262's backfill only fills empty cells, and ran long ago).
--   members.date_updated alone is not a signal (raw knex never bumps it), and
--   directus_activity has no delta.
--   ⚠ user_logs keeps 90 days (kscw-hooks audit.js purge). A fill older than
--   that has no row left, so removing that seat reverts nothing: the fail-safe
--   direction, i.e. the pre-405 behaviour. Same for every member filled BEFORE
--   this migration — no row, no revert; their 'Gratis' cannot be told apart
--   from one inherited from ClubDesk (262: 8 of 9 came that way). No backfill.
--
-- CLUBDESK
-- --------
--   The up-sync never blanks a register cell, so a 'Gratis' that already reached
--   ClubDesk cannot be taken back from here. "May have reached it" = a sync-up
--   holding this member is queued/running (clubdesk_member_sync.up_member_ids —
--   its CSV is already built), or the member was pushed (clubdesk_pushed_at) at
--   or after the fill. Then 'fee_category_auto_revert_needs_clubdesk' tells the
--   treasurer to fix the register by hand. (Until then a sync-down PROPOSES
--   'Gratis' back as a fill; accepting that is logged and blocks any later
--   revert.)
--   The queued 'beitragskategorie' → 'Gratis' entry in clubdesk_push_changes is
--   removed in every case: a push in flight still lands (hence the row above),
--   a failed one no longer carries 'Gratis' on its retry.
--   clubdesk_push_pending is cleared ONLY when the fill was provably its sole
--   reason: the array is empty afterwards, the member was not pending before the
--   fill (pending_before in the fill row), nothing was pushed or is in flight
--   since, members.date_updated is not newer than the fill, and no other
--   user_logs row on the member exists since the fill. "Array empty" alone is no
--   proof — registration approval and merge set the flag WITHOUT an entry
--   (contact fields ride the full UPDATE row), the dispatcher keeps it for a
--   member edited mid-push — and clearing it wrongly would drop a contact edit
--   from the legal register. Left set, it costs one no-op row in the next push.
--
-- ⚠ Why DEFERRED (same reasoning as migration 382): a seat can move between the
-- two junctions in one transaction (coach → team responsible of the same team,
-- both aliases in one Directus PATCH on `teams`). A plain AFTER DELETE trigger
-- fires between the two statements, sees no seat, reverts — and the insert then
-- re-fills: a false "needs ClubDesk" row and a re-queued push. At COMMIT only a
-- seat that is really gone counts.
-- Member deletion cascades into both junctions (ON DELETE CASCADE): at COMMIT
-- the member row is gone, the locking lookup finds nothing and the trigger
-- returns before writing anything. Team deletion cascades too and counts as the
-- seat going.
-- A failure never blocks the seat removal: the body runs in its own
-- sub-transaction, a failure rolls back the revert alone and is a WARNING in the
-- postgres log (the pre-405 behaviour — no revert).
--
-- Both functions: SECURITY INVOKER (as 262), search_path pinned to
-- `public, pg_temp` (071/101 pin `public`; pg_temp last so a temp table can never
-- shadow members / user_logs). Owned by whoever runs migrations, like every
-- function here (preflight-no-foreign-functions).
--
-- Schema-only + idempotent (CREATE OR REPLACE, DROP TRIGGER IF EXISTS → CREATE),
-- per the migration policy. No permission rows, no data backfill.

BEGIN;

-- ── 1. The fill, now audited ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION staff_gratis_fill() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clubdesk_id    text;
  v_pending_before boolean;
  v_revision_hwm   bigint;
BEGIN
  -- 262's rule, unchanged. Row-locked first, so the row the UPDATE changes is
  -- the row that was judged and pending_before is its real prior value.
  SELECT m.clubdesk_id, m.clubdesk_push_pending
    INTO v_clubdesk_id, v_pending_before
    FROM members m
   WHERE m.id = NEW.members_id
     AND COALESCE(BTRIM(m.beitragskategorie), '') = ''
     AND m.kscw_membership_active IS TRUE
     AND NOT EXISTS (SELECT 1 FROM member_teams mt
                      WHERE mt.member = NEW.members_id
                        AND COALESCE(mt.guest_level, 0) = 0)
     FOR UPDATE OF m;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE members m SET
    beitragskategorie = 'Gratis',
    clubdesk_push_pending = CASE WHEN m.clubdesk_id IS NOT NULL
      THEN true ELSE m.clubdesk_push_pending END,
    clubdesk_push_changes = CASE WHEN m.clubdesk_id IS NOT NULL THEN
      (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
        WHERE e->>'field' <> 'beitragskategorie')
      || jsonb_build_array(jsonb_build_object(
           'field', 'beitragskategorie', 'old_value', NULL, 'new_value', 'Gratis'))
      ELSE m.clubdesk_push_changes END
  WHERE m.id = NEW.members_id;

  -- High-water mark for the revert's directus_revisions backstop. Directus owns
  -- that table and it is not in SCHEMA.sql, hence the guard (a bare database
  -- has none; plpgsql only plans the SELECT when it runs).
  IF to_regclass('public.directus_revisions') IS NOT NULL THEN
    SELECT COALESCE(max(r.id), 0) INTO v_revision_hwm FROM directus_revisions r;
  END IF;

  INSERT INTO user_logs (action, collection_name, record_id, data, "user", date_created)
  VALUES ('fee_category_auto', 'members', NEW.members_id::text,
          jsonb_build_object(
            'source', 'staff_gratis_fill',
            'field', 'beitragskategorie',
            'value', 'Gratis',
            'team', NEW.teams_id,
            'junction', TG_TABLE_NAME,
            'junction_id', NEW.id,
            'clubdesk_queued', v_clubdesk_id IS NOT NULL,
            'pending_before', v_pending_before,
            'revision_hwm', v_revision_hwm)::json,
          NULL, now());

  RETURN NEW;
END $$;

COMMENT ON FUNCTION staff_gratis_fill() IS
  'AFTER INSERT on teams_coaches / teams_responsibles: an empty fee category of an active, staff-only member becomes ''Gratis'' and is queued for the ClubDesk push (migration 262); every fill writes a user_logs ''fee_category_auto'' row (migration 405).';

-- ── 2. The revert ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION staff_gratis_revert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member      integer := OLD.members_id;
  m             record;
  fill          record;
  v_hwm         bigint;
  v_changes     jsonb;
  v_had_entry   boolean := false;
  v_in_flight   boolean;
  v_reached     boolean;
  v_clear       boolean;
BEGIN
  -- Still staff somewhere (checked at COMMIT) → no seat ended. Cheapest test
  -- first: both junctions are a few hundred rows.
  IF EXISTS (SELECT 1 FROM teams_coaches WHERE members_id = v_member)
     OR EXISTS (SELECT 1 FROM teams_responsibles WHERE members_id = v_member) THEN
    RETURN NULL;
  END IF;

  BEGIN
    -- Locked so nothing changes the row between the checks and the UPDATE.
    -- NOT FOUND = the member was deleted and took this junction row with it.
    SELECT mm.beitragskategorie, mm.clubdesk_id, mm.clubdesk_push_pending,
           mm.clubdesk_push_changes, mm.clubdesk_pushed_at, mm.date_updated
      INTO m
      FROM members mm
     WHERE mm.id = v_member
       FOR UPDATE;
    IF NOT FOUND OR m.beitragskategorie IS DISTINCT FROM 'Gratis' THEN
      RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM member_teams mt
                WHERE mt.member = v_member
                  AND COALESCE(mt.guest_level, 0) = 0) THEN
      RETURN NULL;
    END IF;

    -- The newest fee-category row on this member must be the fill's.
    SELECT l.id, l.action, l.date_created, l.data
      INTO fill
      FROM user_logs l
     WHERE l.collection_name = 'members'
       AND l.record_id = v_member::text
       AND strpos(COALESCE(l.data::text, ''), 'beitragskategorie') > 0
     ORDER BY l.id DESC
     LIMIT 1;
    IF NOT FOUND OR fill.action IS DISTINCT FROM 'fee_category_auto' THEN
      RETURN NULL;
    END IF;

    -- Backstop: an items-API write in system context names the column in a
    -- revision but leaves no user_logs row.
    v_hwm := (fill.data->>'revision_hwm')::bigint;
    IF v_hwm IS NOT NULL AND to_regclass('public.directus_revisions') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM directus_revisions r
                  WHERE r.id > v_hwm
                    AND r.collection = 'members'
                    AND r.item = v_member::text
                    AND strpos(COALESCE(r.delta::text, ''), 'beitragskategorie') > 0) THEN
        RETURN NULL;
      END IF;
    END IF;

    -- ClubDesk: is a sync-up carrying this member queued or running (its CSV is
    -- already built), or was the member pushed since the fill?
    v_in_flight := EXISTS (
      SELECT 1 FROM clubdesk_member_sync s
       WHERE s.id = 1
         AND s.up_state IN ('queued', 'running')
         AND jsonb_typeof(s.up_member_ids) = 'array'
         AND (s.up_member_ids @> to_jsonb(v_member)
              OR s.up_member_ids @> to_jsonb(v_member::text)));
    -- Unknown counts as reached: a false "check ClubDesk" is cheap, a missed one is not.
    v_reached := COALESCE(v_in_flight
      OR (m.clubdesk_pushed_at IS NOT NULL AND m.clubdesk_pushed_at >= fill.date_created), true);

    -- Drop the queued 'Gratis' entry (262's shape); keep every other entry.
    IF jsonb_typeof(m.clubdesk_push_changes) = 'array' AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(m.clubdesk_push_changes) e
          WHERE e->>'field' = 'beitragskategorie'
            AND e->>'new_value' = 'Gratis') THEN
      v_had_entry := true;
      SELECT COALESCE(jsonb_agg(t.e ORDER BY t.ord), '[]'::jsonb)
        INTO v_changes
        FROM jsonb_array_elements(m.clubdesk_push_changes) WITH ORDINALITY AS t(e, ord)
       WHERE t.e->>'field' IS DISTINCT FROM 'beitragskategorie';
    END IF;

    -- The pending flag goes only when the fill was provably its sole reason
    -- (see header: "array empty" alone is no proof).
    v_clear := COALESCE(v_had_entry
      AND jsonb_array_length(v_changes) = 0
      AND NOT v_reached
      AND (fill.data->>'pending_before') = 'false'
      AND (m.date_updated IS NULL OR m.date_updated <= fill.date_created)
      AND NOT EXISTS (SELECT 1 FROM user_logs l
                       WHERE l.collection_name = 'members'
                         AND l.record_id = v_member::text
                         AND l.id > fill.id), false);

    UPDATE members SET
      beitragskategorie = NULL,
      clubdesk_push_changes = CASE WHEN v_had_entry
        THEN NULLIF(v_changes, '[]'::jsonb) ELSE clubdesk_push_changes END,
      clubdesk_push_pending = CASE WHEN v_clear
        THEN false ELSE clubdesk_push_pending END
    WHERE id = v_member;

    INSERT INTO user_logs (action, collection_name, record_id, data, "user", date_created)
    VALUES ('fee_category_auto_revert', 'members', v_member::text,
            jsonb_build_object(
              'source', 'staff_gratis_revert',
              'field', 'beitragskategorie',
              'old_value', 'Gratis',
              'value', NULL,
              'team', OLD.teams_id,
              'junction', TG_TABLE_NAME,
              'junction_id', OLD.id,
              'auto_fill_log', fill.id,
              'clubdesk', CASE WHEN v_reached THEN 'needs_manual_fix'
                               WHEN v_had_entry THEN 'push_dequeued'
                               ELSE 'not_pushed' END,
              'push_entry_removed', v_had_entry,
              'push_pending_cleared', v_clear)::json,
            NULL, now());

    IF v_reached THEN
      INSERT INTO user_logs (action, collection_name, record_id, data, "user", date_created)
      VALUES ('fee_category_auto_revert_needs_clubdesk', 'members', v_member::text,
              jsonb_build_object(
                'source', 'staff_gratis_revert',
                'field', 'beitragskategorie',
                'clubdesk_value', 'Gratis',
                'clubdesk_id', m.clubdesk_id,
                'reason', CASE WHEN v_in_flight THEN 'push_in_flight' ELSE 'pushed' END,
                'pushed_at', m.clubdesk_pushed_at,
                'auto_fill_log', fill.id,
                'action_needed', 'Clear the auto-assigned Gratis Beitragskategorie in ClubDesk by hand: the sync-up never blanks a register cell, and until then a sync-down proposes Gratis back.')::json,
              NULL, now());
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'staff_gratis_revert: member % not reverted: % (SQLSTATE %)',
      v_member, SQLERRM, SQLSTATE;
  END;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION staff_gratis_revert() IS
  'Deferred AFTER DELETE on teams_coaches / teams_responsibles: when the member holds no staff seat left and the fee category is still the untouched ''Gratis'' of staff_gratis_fill (its user_logs row is the newest fee-category entry), it goes back to NULL and the queued ClubDesk entry is dropped; a value that may already be in ClubDesk is flagged ''fee_category_auto_revert_needs_clubdesk'' (migration 405).';

DROP TRIGGER IF EXISTS trg_staff_gratis_revert_coaches ON teams_coaches;
CREATE CONSTRAINT TRIGGER trg_staff_gratis_revert_coaches
  AFTER DELETE ON teams_coaches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION staff_gratis_revert();

DROP TRIGGER IF EXISTS trg_staff_gratis_revert_responsibles ON teams_responsibles;
CREATE CONSTRAINT TRIGGER trg_staff_gratis_revert_responsibles
  AFTER DELETE ON teams_responsibles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION staff_gratis_revert();

COMMIT;
