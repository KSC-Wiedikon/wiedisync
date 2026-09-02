-- Migration 350: team-level fines — `fines.member` becomes nullable.
--
-- Until now every fine belonged to exactly one member. Some fines belong to
-- the TEAM as a whole and to no individual: a federation forfait, a missing
-- scorer, a late match sheet. Those are paid out of the Teamkasse, so pinning
-- them on an arbitrary member (or fanning them out across the roster) both
-- misreports who owes what.
--
--   member IS NULL  ⇒ the fine is against the team itself.
--   member IS NOT NULL ⇒ unchanged, the existing per-member ledger.
--
-- Consequences, all handled in the same change:
--   • The escalation engine (kscw_compute_fine_amount) is per member×team×
--     category — a team fine has no offense counter, so the hook SKIPS the
--     engine and REQUIRES an explicit amount (FINE_NO_RULE otherwise).
--   • The fines.items.create/update notification actions already bail on a
--     member-less row (`if (!fine?.member)`), and the daily reminder cron now
--     filters them out — a NULL member would otherwise aggregate into a
--     phantom push recipient.
--   • Member read permission walks `fines.member.user` and therefore does NOT
--     match member-less rows: a team fine is visible to the team's leaders
--     (coach / TR / Sport Admin / Vorstand), not on a member's own list. That
--     is deliberate — nobody's personal balance may move because of it.
--   • No permission row changes: LEADER read/update/delete are team-scoped
--     (COACH_OR_TR_OF_FINE walks `team`, not `member`), so they already cover
--     member-less rows.
--
-- ⚠ Directus caches column nullability. RESTART the container after applying
-- (`sudo docker restart directus-kscw[-dev]`) or /items/fines keeps rejecting
-- a member-less insert as a missing required field.
--
-- Schema-only + idempotent (per CLAUDE.md hard rule). No data backfill: every
-- existing row keeps its member.

BEGIN;

ALTER TABLE fines ALTER COLUMN member DROP NOT NULL;

COMMENT ON COLUMN fines.member IS
  'Member being fined. NULL = a TEAM-level fine (forfait, missing scorer, …) owed by the team as a whole — no escalation tier, amount must be explicit, and it never appears on a member''s personal balance.';

COMMENT ON TABLE fines IS
  'Fine ledger — per member, or per team when `member` IS NULL (migration 350). amount + tier_offense + reset_window_at_issue are snapshotted at issue time and never re-derived. Edits to amount/category/reason are blocked by the kscw-hooks filter — leaders must waive + reissue to change a wrong fine, preserving audit trail.';

-- Directus field note (admin UI) — keep the app metadata honest about the new
-- nullability. Idempotent by construction (plain UPDATE of an existing row).
UPDATE directus_fields
   SET note = 'Member being fined. Leave empty for a team-level fine (owed by the team, not an individual).'
 WHERE collection = 'fines' AND field = 'member';

-- Leader list of team fines ("all fines this team owes as a team"). Partial so
-- it stays tiny next to the per-member indexes.
CREATE INDEX IF NOT EXISTS fines_team_level_idx
  ON fines (team, status, issued_at DESC)
  WHERE member IS NULL;

COMMIT;
