-- Migration 365 — scheduling_blocks table comment no longer mentions chat.
--
-- Follow-up to 364 (messaging removed): the COMMENT ON TABLE written by
-- migration 085 described a block as "like a team event ... with no RSVP/chat".
-- Cosmetic, but it is the one place the live schema still named the feature.
-- Idempotent: COMMENT ON simply overwrites.

BEGIN;

COMMENT ON TABLE scheduling_blocks IS
  'Team-level game-scheduling blackouts (Team blocking). A row hard-blocks game scheduling for `team` on every date in [start_date, end_date] — home-slot offering AND all three away proposals — exactly like a team event, but coach/TR-managed with no RSVP. Created via the app by coaches/TRs (scoped in setup-permissions.mjs + enforced in the kscw-hooks create filter).';

COMMIT;
