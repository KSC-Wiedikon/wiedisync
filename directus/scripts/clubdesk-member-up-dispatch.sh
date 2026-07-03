#!/usr/bin/env bash
# Host dispatcher for the superadmin "Sync up to ClubDesk" action (cron, every
# minute). Claims a queued up-request from clubdesk_member_sync, writes the stashed
# CSV (transcoded to CP1252 for ClubDesk), runs the import scraper (dry-run preview
# first, then commit only if enabled) under the shared ClubDesk-session lock, clears
# clubdesk_push_pending for the pushed members, and writes back up_state + up_result.
# Twin of the down dispatcher.
#
# Install at /opt/clubdesk-sync/ and wire to root crontab, e.g.:
#   * * * * * CLUBDESK_ENV=prod CLUBDESK_UP_COMMIT=1 /opt/clubdesk-sync/clubdesk-member-up-dispatch.sh >> /opt/clubdesk-sync/up-dispatch.log 2>&1
#
# CLUBDESK_ENV (dev|prod) is the ONE knob — it derives the target DB with the SAME
# mapping as the down dispatcher / clubdesk-sync.sh, so a mis-wired cron can't claim on
# one env while pushing another. There is NO dev ClubDesk instance (single shared
# account), so a WRITE (commit) is only ever performed when CLUBDESK_ENV=prod AND
# CLUBDESK_UP_COMMIT=1; any other env is forced to dry-run regardless of the commit flag.
#
# ⚠ up_csv carries member PII (AHV/address) — the file is trap-cleaned and up_csv is
#   nulled in the DB after the run; never let either linger.
# ⚠ Commit WRITES to the club's legal member record. It is gated behind an explicit
#   CLUBDESK_UP_COMMIT=1 (default = dry-run only) AND a successful dry-run preview, so
#   a mis-wired cron can never silently write to ClubDesk. Commit is only ever reached
#   after a superadmin approved the set in the modal (the endpoint stashed the CSV).
set -uo pipefail
DIR=/opt/clubdesk-sync
PG=supabase-db-vek42jyj0owoutoouq29aisq
PW_IMG=mcr.microsoft.com/playwright:v1.60.0-jammy

# ── Single env selection (claim/write-back DB must never diverge from the push
# TARGET) ────────────────────────────────────────────────────────────────────────
# CLUBDESK_ENV is the ONE knob: it derives the DB this dispatcher claims/writes back to
# using the SAME dev/prod mapping as clubdesk-sync.sh + the down dispatcher. Fail fast
# on a bad env, and — for legacy crons that still set DB directly — fail fast if that
# explicit DB disagrees.
DB_REQUESTED="${DB:-}"   # capture any explicit override BEFORE we derive the real DB
CLUBDESK_ENV="${CLUBDESK_ENV:-prod}"
case "$CLUBDESK_ENV" in
  prod) DB=postgres ;;
  dev)  DB=directus_kscw_dev ;;
  *) echo "FATAL: bad CLUBDESK_ENV '$CLUBDESK_ENV' (expected dev|prod)" >&2; exit 1 ;;
esac
if [ -n "$DB_REQUESTED" ] && [ "$DB_REQUESTED" != "$DB" ]; then
  echo "FATAL: explicit DB=$DB_REQUESTED conflicts with CLUBDESK_ENV=$CLUBDESK_ENV (→ $DB)" >&2; exit 1
fi
export CLUBDESK_ENV

# Per-env claim lock (dev vs prod process their own requests independently); the
# ClubDesk scrape itself is serialised on the shared .sync.lock further down.
exec 9>"$DIR/.up-dispatch-${DB}.lock"
flock -n 9 || exit 0   # a previous up-dispatcher (same env) is still running

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

# 2. Push to ClubDesk. Two-phase for safety (both phases run under the shared
#    ClubDesk-session lock — one session per account — against the down/weekly/finance
#    scrapes). Capture the JSON result (last stdout line); scraper logs → up-run.log.
#  (a) ALWAYS run a dry-run 'preview' first: ClubDesk uploads + maps the CSV and reports
#      the pre-commit summary, then backs out WITHOUT writing. Proves the CSV maps
#      cleanly before we ever touch the legal register.
#  (b) COMMIT (write) only if the preview succeeded AND commit is explicitly enabled
#      via CLUBDESK_UP_COMMIT=1. Default = dry-run only.
#  ⚠ VALIDATION: ClubDesk's import-wizard commit behaviour (how it treats empty cells,
#    whether it truly UPDATES vs DUPLICATES a matched contact) must be validated on a
#    live import before enabling CLUBDESK_UP_COMMIT=1 on prod. Leave it unset until then.
COMMIT_ENABLED="${CLUBDESK_UP_COMMIT:-0}"
#  (c) HARD ENV GUARD: ClubDesk is a single shared (prod) account — there is no dev
#      ClubDesk instance. A commit from the dev cron would write scrubbed test data into
#      the club's legal member register, so a WRITE is only ever allowed when
#      CLUBDESK_ENV=prod. On any other env we force dry-run (never commit) even if the
#      operator set CLUBDESK_UP_COMMIT=1.
if [ "$COMMIT_ENABLED" = "1" ] && [ "$CLUBDESK_ENV" != "prod" ]; then
  echo "REFUSING commit: CLUBDESK_ENV=$CLUBDESK_ENV (not prod) — forcing dry-run (no dev ClubDesk instance)" >&2
  COMMIT_ENABLED=0
fi

PREVIEW=$(flock "$DIR/.sync.lock" docker run --rm -w /work -v "$DIR":/work --env-file "$DIR/.env" "$PW_IMG" \
  node /work/clubdesk-scrape-import.mjs /work/up-import.csv preview 2>>"$DIR/up-run.log" | tail -1)
echo "preview result: $PREVIEW"

# Preview OK = the scraper reached the summary (numeric total) with no error field.
if printf '%s' "$PREVIEW" | grep -q '"error"' || ! printf '%s' "$PREVIEW" | grep -q '"total":[0-9]'; then
  if [ -n "$PREVIEW" ]; then RES_ESC=${PREVIEW//\'/\'\'}; RESSQL="'${RES_ESC}'::jsonb"; else RESSQL='NULL'; fi
  psqlc "UPDATE clubdesk_member_sync SET up_state='failed', up_requested_at=NULL, up_finished_at=now(), up_message='Dry-run preview failed — see up-run.log', up_result=${RESSQL}, up_csv=NULL WHERE id=1"
  echo "=== up-dispatch: FAILED (preview) ==="; exit 0
fi

if [ "$COMMIT_ENABLED" != "1" ]; then
  RES_ESC=${PREVIEW//\'/\'\'}
  if [ "$CLUBDESK_ENV" != "prod" ]; then
    DRY_MSG="Dry-run OK — commit refused on CLUBDESK_ENV=${CLUBDESK_ENV} (no dev ClubDesk instance; only prod may write)"
  else
    DRY_MSG='Dry-run OK — commit disabled (set CLUBDESK_UP_COMMIT=1 to write)'
  fi
  DRY_MSG_ESC=${DRY_MSG//\'/\'\'}
  # Dry-run only: nothing was written, so clubdesk_push_pending stays set for a real
  # commit later. Do NOT touch members here.
  psqlc "UPDATE clubdesk_member_sync SET up_state='done', up_requested_at=NULL, up_finished_at=now(), up_message='${DRY_MSG_ESC}', up_result='${RES_ESC}'::jsonb, up_csv=NULL WHERE id=1"
  echo "=== up-dispatch: dry-run OK, commit disabled ==="; exit 0
fi

RES=$(flock "$DIR/.sync.lock" docker run --rm -w /work -v "$DIR":/work --env-file "$DIR/.env" "$PW_IMG" \
  node /work/clubdesk-scrape-import.mjs /work/up-import.csv commit 2>>"$DIR/up-run.log" | tail -1)
echo "scraper result: $RES"

if printf '%s' "$RES" | grep -q '"committed":true'; then
  RES_ESC=${RES//\'/\'\'}
  # 3a. Stamp EVERY pushed member with clubdesk_pushed_at. For a newly-created
  #     (unlinked, clubdesk_id IS NULL) member this doubles as the "pushed, awaiting
  #     link" marker: the shell can't scrape the new ClubDesk [Id] back, so the
  #     up-preview endpoint excludes stamped-but-unlinked members to stop a second
  #     push DUPLICATING them in ClubDesk.
  #     TODO write-back: a follow-up should scrape the new ClubDesk [Id] for these rows
  #     and set members.clubdesk_id, converting the marker into a real link.
  psqlc "UPDATE members SET clubdesk_pushed_at=now() WHERE id IN (SELECT jsonb_array_elements_text(up_member_ids)::int FROM clubdesk_member_sync WHERE id=1)" >/dev/null 2>&1 || true
  # 3b. Clear the pending flag ONLY for members whose edit-set is the one we actually
  #     pushed. A member edited again BETWEEN the stash (up_requested_at) and this push
  #     has a newer date_updated, so we KEEP clubdesk_push_pending=true and their newer
  #     edit is picked up on the next run instead of being silently dropped.
  psqlc "UPDATE members m SET clubdesk_push_pending=false, clubdesk_push_changes=NULL FROM clubdesk_member_sync s WHERE s.id=1 AND m.id IN (SELECT jsonb_array_elements_text(s.up_member_ids)::int) AND (m.date_updated IS NULL OR m.date_updated <= s.up_requested_at)" >/dev/null 2>&1 || true
  psqlc "UPDATE clubdesk_member_sync SET up_state='done', up_requested_at=NULL, up_finished_at=now(), up_message='Pushed to ClubDesk', up_result='${RES_ESC}'::jsonb, up_csv=NULL WHERE id=1"
  echo "=== up-dispatch: done ==="
else
  if [ -n "$RES" ]; then RES_ESC=${RES//\'/\'\'}; RESSQL="'${RES_ESC}'::jsonb"; else RESSQL='NULL'; fi
  psqlc "UPDATE clubdesk_member_sync SET up_state='failed', up_requested_at=NULL, up_finished_at=now(), up_message='Push failed — see up-run.log', up_result=${RESSQL}, up_csv=NULL WHERE id=1"
  echo "=== up-dispatch: FAILED ==="
fi
