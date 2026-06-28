#!/usr/bin/env bash
# Host dispatcher for the in-app superadmin "Sync down from ClubDesk" button (cron,
# every minute). Claims a queued request from clubdesk_member_sync, runs the member
# sync (clubdesk-sync.sh), and writes back the state the button polls. flock keeps a
# single dispatcher at a time. Twin of clubdesk-finance-dispatch.sh.
#
# Install on the VPS at /opt/clubdesk-sync/ alongside clubdesk-sync.sh, and wire to
# root crontab, e.g.:
#   * * * * * /opt/clubdesk-sync/clubdesk-member-dispatch.sh >> /opt/clubdesk-sync/member-dispatch.log 2>&1
#
# CLUBDESK_ENV (dev|prod) flows through to clubdesk-sync.sh → picks the target DB.
set -uo pipefail
DIR=/opt/clubdesk-sync
PG=supabase-db-vek42jyj0owoutoouq29aisq
DB="${DB:-postgres}"

# Per-env claim lock so the dev and prod dispatchers process their own requests
# independently (DB=postgres for prod, directus_kscw_dev for dev). The actual
# ClubDesk scrape is serialised separately on the shared .sync.lock below.
exec 9>"$DIR/.member-dispatch-${DB}.lock"
flock -n 9 || exit 0   # a previous dispatcher (same env) is still running

psqlc() { docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -tAc "$1"; }

# Recover a stuck 'running' (a dispatch that died mid-sync) so it can't block forever.
psqlc "UPDATE clubdesk_member_sync SET down_state='idle', down_requested_at=NULL, down_message='Reset (stale run)' WHERE id=1 AND down_state='running' AND down_requested_at < now() - interval '15 minutes'" >/dev/null 2>&1 || true

# Atomically claim a queued request. CTE so the top-level statement is a SELECT —
# a bare UPDATE…RETURNING via psql -tAc also prints the "UPDATE 1" command tag.
claim=$(psqlc "WITH u AS (UPDATE clubdesk_member_sync SET down_state='running' WHERE id=1 AND down_requested_at IS NOT NULL AND down_state <> 'running' RETURNING 1) SELECT count(*) FROM u" 2>/dev/null || echo 0)
[ "$claim" = "1" ] || exit 0

echo "=== dispatch: member sync requested — running $(date -u +%FT%TZ) ==="
# Serialise the ClubDesk login against the up/finance/weekly scrapes (one session
# per account) — blocking, so a concurrent scrape makes us wait, not collide.
if flock "$DIR/.sync.lock" /opt/clubdesk-sync/clubdesk-sync.sh; then
  psqlc "UPDATE clubdesk_member_sync SET down_state='done', down_requested_at=NULL, down_finished_at=now(), down_message='Synced from ClubDesk' WHERE id=1"
  echo "=== dispatch: done ==="
else
  psqlc "UPDATE clubdesk_member_sync SET down_state='failed', down_requested_at=NULL, down_finished_at=now(), down_message='Sync failed — see the member sync log' WHERE id=1"
  echo "=== dispatch: FAILED ==="
fi
