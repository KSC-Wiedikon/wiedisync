-- 336: machine-written collections keep WHO/WHEN and drop the revision payload
--
-- Directus's default `accountability = 'all'` writes a full before/after snapshot
-- into `directus_revisions` on EVERY item write. For collections a cron rewrites
-- nightly that is pure bloat. Measured on prod 2026-08-25:
--
--   svrz_games                 3,135 live rows -> 477,983 revisions (152 per row!)
--                              2,254 MB of the table's 2.9 GB
--                              86% of them written by cron-service@kscw.ch
--   svrz_spielplaner_contacts     32,576 revisions /  52 MB
--   sv_vm_check                    6,457 revisions /  10 MB
--   user_logs                      5,538 revisions  (the audit log logging itself)
--   public_stats                   4,116 revisions
--   rankings                         488 revisions
--
-- `'activity'` keeps the `directus_activity` row -- who touched what, when, from
-- which IP -- and drops only the payload. That payload is where the gigabytes are.
--
-- ⚠ Human-edited collections are DELIBERATELY ABSENT from this list. For
--   `members`, `participations`, `absences`, `teams`, `member_teams`, `trainings`,
--   `games`, `hall_slots`, `hall_closures`, `team_requests` and the
--   `game_scheduling_*` set, the before/after IS the audit trail -- it is what the
--   superadmin audit page and Directus's own revision sidebar read to answer "who
--   changed this player's licence, and what did it say before". Each of those holds
--   under 8k revisions; they are not the problem and must not be swept in.
--
-- ⚠⚠ Directus CACHES collection metadata. A raw-SQL write here does not bust that
--    cache (same trap as migration 333's `directus_fields` insert, which read back
--    as `type: alias` until the container was restarted). RESTART the Directus
--    container after applying, or the running process keeps writing revisions
--    against its stale picture and this migration looks like it did nothing.
--
-- Reversible: set `accountability` back to `'all'` for any collection here.
-- This does NOT delete the existing backlog -- see `prune-machine-revisions.sh`.

UPDATE directus_collections
SET accountability = 'activity'
WHERE collection IN (
  'svrz_games',
  'svrz_spielplaner_contacts',
  'sv_vm_check',
  'public_stats',
  'rankings',
  'user_logs'
)
AND accountability IS DISTINCT FROM 'activity';
