-- Migration 094: Pin existing open invites to the season scheduling deadline.
--
-- newInviteExpiry() now returns a FIXED 30.06.2026 (the VolleyManager cutoff)
-- instead of a rolling 90-day TTL, so every opponent works to the same deadline.
-- Align invites already created under the old rolling rule so each still-open
-- link uses (and displays) the same 30.06.2026 deadline. Terminal invites
-- (revoked / expired / booked) are left untouched.
--
-- Schema-policy note: this is a bounded one-time DATA backfill (allowed in a
-- numbered migration per CLAUDE.md). Idempotent: the WHERE guard makes a re-run
-- a no-op, and the runner applies it once anyway.

BEGIN;

UPDATE game_scheduling_opponents
SET expires_at = TIMESTAMPTZ '2026-06-30 23:59:59+00'
WHERE status IN ('invited', 'viewed', 'active')
  AND expires_at IS DISTINCT FROM TIMESTAMPTZ '2026-06-30 23:59:59+00';

COMMIT;
