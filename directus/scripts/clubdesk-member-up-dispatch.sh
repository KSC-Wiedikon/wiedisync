#!/usr/bin/env bash
# Host dispatcher for the superadmin "Sync up to ClubDesk" action (cron, every
# minute). Claims a queued up-request from clubdesk_member_sync, writes the stashed
# CSV (transcoded to CP1252 for ClubDesk), runs the import scraper in COMMIT mode
# under the shared ClubDesk-session lock, clears clubdesk_push_pending for the
# pushed members, and writes back up_state + up_result. Twin of the down dispatcher.
#
# Install at /opt/clubdesk-sync/ and wire to root crontab, e.g.:
#   * * * * * CLUBDESK_ENV=dev DB=directus_kscw_dev /opt/clubdesk-sync/clubdesk-member-up-dispatch.sh >> /opt/clubdesk-sync/up-dispatch.log 2>&1
#
# ⚠ up_csv carries member PII (AHV/address) — the file is trap-cleaned and up_csv is
#   nulled in the DB after the run; never let either linger.
# ⚠ Commit WRITES to the club's legal member record — only ever reached after a
#   superadmin approved the set in the modal (the endpoint stashed the CSV).
set -uo pipefail
DIR=/opt/clubdesk-sync
PG=supabase-db-vek42jyj0owoutoouq29aisq
DB="${DB:-postgres}"
PW_IMG=mcr.microsoft.com/playwright:v1.60.0-jammy

exec 9>"$DIR/.up-dispatch.lock"
flock -n 9 || exit 0   # a previous up-dispatcher is still running

psqlc() { docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -tAc "$1"; }

# Recover a stuck 'running' (>15 min).
psqlc "UPDATE clubdesk_member_sync SET up_state='idle', up_requested_at=NULL, up_message='Reset (stale run)' WHERE id=1 AND up_state='running' AND up_requested_at < now() - interval '15 minutes'" >/dev/null 2>&1 || true

# Atomically claim a queued up-request (CTE so the top-level statement is a SELECT).
claim=$(psqlc "WITH u AS (UPDATE clubdesk_member_sync SET up_state='running' WHERE id=1 AND up_requested_at IS NOT NULL AND up_state <> 'running' RETURNING 1) SELECT count(*) FROM u" 2>/dev/null || echo 0)
[ "$claim" = "1" ] || exit 0

echo "=== up-dispatch: sync-up requested — running $(date -u +%FT%TZ) (db=$DB) ==="
CSVUTF="$DIR/up-import.utf8.csv"; CSV="$DIR/up-import.csv"
cleanup() { rm -f "$CSVUTF" "$CSV"; }   # member PII — never linger
trap cleanup EXIT

# 1. Pull the stashed CSV → file (UTF-8 from psql), transcode to CP1252 for ClubDesk.
docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -tAc "SELECT up_csv FROM clubdesk_member_sync WHERE id=1" > "$CSVUTF"
if [ ! -s "$CSVUTF" ]; then
  psqlc "UPDATE clubdesk_member_sync SET up_state='failed', up_requested_at=NULL, up_finished_at=now(), up_message='No CSV payload', up_csv=NULL WHERE id=1"
  echo "=== up-dispatch: FAILED (no CSV) ==="; exit 0
fi
iconv -f UTF-8 -t WINDOWS-1252//TRANSLIT "$CSVUTF" > "$CSV" 2>/dev/null || cp "$CSVUTF" "$CSV"

# 2. Run the import scraper in COMMIT mode under the shared ClubDesk-session lock
#    (serialises against the down/weekly/finance scrapes — one session per account).
#    Capture the JSON result (last stdout line); scraper logs go to up-run.log.
RES=$(flock "$DIR/.sync.lock" docker run --rm -w /work -v "$DIR":/work --env-file "$DIR/.env" "$PW_IMG" \
  node /work/clubdesk-scrape-import.mjs /work/up-import.csv commit 2>>"$DIR/up-run.log" | tail -1)
echo "scraper result: $RES"

if printf '%s' "$RES" | grep -q '"committed":true'; then
  RES_ESC=${RES//\'/\'\'}
  # 3. Clear push flags for the pushed members + stamp pushed_at, write result.
  psqlc "UPDATE members SET clubdesk_push_pending=false, clubdesk_pushed_at=now(), clubdesk_push_changes=NULL WHERE id IN (SELECT jsonb_array_elements_text(up_member_ids)::int FROM clubdesk_member_sync WHERE id=1)" >/dev/null 2>&1 || true
  psqlc "UPDATE clubdesk_member_sync SET up_state='done', up_requested_at=NULL, up_finished_at=now(), up_message='Pushed to ClubDesk', up_result='${RES_ESC}'::jsonb, up_csv=NULL WHERE id=1"
  echo "=== up-dispatch: done ==="
else
  if [ -n "$RES" ]; then RES_ESC=${RES//\'/\'\'}; RESSQL="'${RES_ESC}'::jsonb"; else RESSQL='NULL'; fi
  psqlc "UPDATE clubdesk_member_sync SET up_state='failed', up_requested_at=NULL, up_finished_at=now(), up_message='Push failed — see up-run.log', up_result=${RESSQL}, up_csv=NULL WHERE id=1"
  echo "=== up-dispatch: FAILED ==="
fi
