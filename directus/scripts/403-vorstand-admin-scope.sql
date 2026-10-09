-- Migration 403: a board member's admin rights can be sport-scoped.
--
-- WHY
-- ---
-- Migration 402 made every board member a full admin. Decided the same day
-- (09.10.2026): the board's admin rights follow the member's sport — a basketball
-- board member is a BB admin, a volleyball one a VB admin, and only some are full
-- admins. The scope is expressed with the roles that already exist:
--
--     vorstand + admin     board, full admin
--     vorstand + vb_admin  board, volleyball admin
--     vorstand + bb_admin  board, basketball admin
--
-- WHAT CHANGES
-- ------------
--   members_vorstand_implies_admin() is replaced:
--     - role has 'vorstand' and NONE of admin / vb_admin / bb_admin → 'admin' is
--       added (a board member always holds some admin tier; full is the default).
--     - 402's "dropping vorstand also drops admin" branch is gone. The scope is now
--       an explicit pick the editor shows, so leaving the board unticks exactly
--       what is shown — the trigger no longer guesses which tier came with it.
--   The trigger itself (402) is unchanged. No backfill: every current board member
--   already holds a tier after 402; the per-person scopes are set through the
--   items API so the role-sync hook moves each login to the matching Directus role.
--
-- Schema-only + idempotent, per the migration policy. No permission rows.

BEGIN;

CREATE OR REPLACE FUNCTION members_vorstand_implies_admin() RETURNS trigger AS $$
BEGIN
  IF NEW.role IS NOT NULL
    AND NEW.role @> '["vorstand"]'::jsonb
    AND NOT NEW.role ?| ARRAY['admin', 'vb_admin', 'bb_admin'] THEN
    NEW.role := NEW.role || '["admin"]'::jsonb;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
