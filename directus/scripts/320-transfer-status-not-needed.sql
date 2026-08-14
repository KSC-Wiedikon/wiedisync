-- Migration 320: `not_needed` comes back — as an OVERRIDE, not as a synonym.
--
-- Migration 234 introduced 'not_needed' and migration 235 removed it again, on
-- the reasoning that "needs no transfer" was fully DERIVABLE from
-- federation_of_origin ('NONE' = never licensed nationally, 'CH' = already
-- Swiss-licensed) and that a stored copy could only ever drift from it.
--
-- That reasoning held exactly as long as our federation_of_origin was the only
-- record in play. It is not. Swiss Volley works from THEIR value, and the
-- Volleymanager cross-check (`fooConflicts` on /admin/transfers) surfaces
-- members where the two disagree — 16 of them on prod today. Both directions
-- produce a decision the derivation cannot express:
--
--   our FoO = DE, VM says SUI  — Swiss Volley already counts them as Swiss, so
--                                the club concludes no ITC is needed. Deriving
--                                from our own value keeps them on the worklist
--                                forever, and the only way to clear them is to
--                                falsify federation_of_origin — overwriting the
--                                member's own answer about their history to
--                                silence a task list.
--   our FoO = CH, VM says GER  — a transfer may be missing. Here the club wants
--                                the OPPOSITE override: work on somebody the
--                                derivation calls settled.
--
-- So the two statements are genuinely different after all, and 235 collapsed
-- them one register too early:
--
--   federation_of_origin  — where the member was licensed at 14. Their answer.
--   transfer_status       — what the CLUB has decided to do about it. Staff's.
--
-- The derivation is NOT removed. It stays the default for the ~700 members
-- nobody has looked at, and `transfer_status` stays NULL for every one of them:
--
--   status NULL         → derive from federation_of_origin (CH/NONE = nothing
--                         to do, anything else = actionable). Unchanged.
--   status 'not_needed' → a person looked and concluded no transfer applies,
--                         whatever the federation column says.
--   status 'pending'    → being chased, EVEN IF federation_of_origin says CH.
--   status 'done'       → cleared.
--
-- ⚠ Deliberately NO backfill. Stamping 'not_needed' onto the ~483 CH-origin
-- members would convert a derivation that self-corrects (fix the federation,
-- the conclusion follows) into ~483 frozen assertions nobody made, and would
-- make the column's own meaning unreadable: a stored value would no longer mean
-- "somebody decided this". Every row stays NULL until a human clicks.
--
-- Schema-only + idempotent. No column is added or dropped, so no Directus
-- restart is needed (contrast the migration-303 DROP gotcha in INFRA.md).

BEGIN;

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_transfer_status_chk;
ALTER TABLE members ADD CONSTRAINT members_transfer_status_chk
  CHECK (transfer_status IS NULL OR transfer_status IN ('pending', 'done', 'not_needed'));

COMMENT ON COLUMN members.transfer_status IS
  'International-transfer state as the CLUB decided it: NULL = not reviewed (fall back to deriving it from federation_of_origin), ''pending'' = being chased, ''done'' = cleared, ''not_needed'' = reviewed and no transfer applies. A non-NULL value OVERRIDES the federation_of_origin derivation in both directions — ''pending'' on a CH-origin member is a transfer being chased anyway, ''not_needed'' on a foreign-origin member is a transfer the club has ruled out.';

UPDATE directus_fields
   SET options = '{"choices":[{"text":"Pending","value":"pending"},{"text":"Done","value":"done"},{"text":"Not needed","value":"not_needed"}]}'::json,
       note = 'International-transfer state. Empty = not reviewed, and the answer is derived from federation of origin instead. Set it on /admin/transfers, which also records who decided and when.'
 WHERE collection = 'members' AND field = 'transfer_status';

COMMIT;

-- Nothing to backfill by design (see above): every row that has never been
-- reviewed must stay NULL. This reports the split so the deploy log shows what
-- the page will render.
SELECT COALESCE(transfer_status, '(null — derived)') AS transfer_status, count(*) AS members
  FROM members GROUP BY 1 ORDER BY 2 DESC;
