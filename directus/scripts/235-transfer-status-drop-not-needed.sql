-- Migration 235: `not_needed` is redundant — federation_of_origin already says it.
--
-- 234 gave transfer_status a 'not_needed' value on the reasoning that the
-- member's own answer ("where was I first licensed") and the club's conclusion
-- ("is there paperwork to do") were different statements. They are not — and what
-- collapsed the difference was rewording the picker's NONE option to
-- **"None / never licensed with a national federation"**.
--
-- Before that rewording, a player whose only history was an Italian recreational
-- body (CSI, UISP, PGS — CONI promotion bodies, NOT FIVB/FIBA members, so no
-- licence exists to transfer) might reasonably have answered "Italy", leaving the
-- club to record separately that no transfer applied. With the explicit wording
-- that player answers NONE, and NONE then means exactly "nothing to chase".
--
-- So "needs no transfer" is now DERIVED, never stored:
--   federation_of_origin = 'NONE' → never licensed nationally  → nothing to do
--   federation_of_origin = 'CH'   → already Swiss-licensed     → no INTERNATIONAL transfer
--   federation_of_origin = other  → actionable; transfer_status carries the work
--   federation_of_origin IS NULL  → not asked yet
--
-- transfer_status therefore narrows to NULL | 'pending' | 'done' — it now tracks
-- only work in progress, which is the one thing federation_of_origin cannot say.
--
-- Safe: 234 shipped hours ago and no row has ever held 'not_needed' (asserted
-- below rather than assumed — the UPDATE is a no-op if that holds, and a correct
-- migration if it somehow does not).
--
-- Schema-only + idempotent.

BEGIN;

-- Any straggler becomes "not reviewed" rather than silently violating the new
-- constraint. NULL is the honest landing place: the club's conclusion is now read
-- off federation_of_origin, so there is nothing to preserve here.
UPDATE members SET transfer_status = NULL WHERE transfer_status = 'not_needed';

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_transfer_status_chk;
ALTER TABLE members ADD CONSTRAINT members_transfer_status_chk
  CHECK (transfer_status IS NULL OR transfer_status IN ('pending', 'done'));

COMMENT ON COLUMN members.transfer_status IS
  'International-transfer WORK state: NULL = not reviewed, ''pending'' = being chased, ''done'' = cleared. Whether a transfer is needed at all is derived from federation_of_origin (''NONE'' or ''CH'' = not needed), never stored here.';

UPDATE directus_fields
   SET options = '{"choices":[{"text":"Pending","value":"pending"},{"text":"Done","value":"done"}]}'::json,
       note = 'International-transfer work state. Empty = not reviewed. Whether a transfer is needed at all comes from federation_of_origin.'
 WHERE collection = 'members' AND field = 'transfer_status';

COMMIT;

SELECT 'rows_with_not_needed_after' AS metric, count(*) AS value
  FROM members WHERE transfer_status = 'not_needed';
