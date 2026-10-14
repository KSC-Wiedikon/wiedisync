#!/usr/bin/env bash
# Nightly ClubDesk Finanz → Directus finance import (invoices + bookings).
#
# Counterpart of clubdesk-sync.sh (the weekly member sync). Scrapes the two Finanz
# CSVs (Rechnungen "Alle Spalten" + Buchhaltung), then imports them via
# import-clubdesk-finance.mjs --emit-sql and applies the SQL with ON_ERROR_STOP.
# Lives on the VPS at /opt/clubdesk-sync/ alongside the scraper + importer; wired
# to a nightly cron. Mirror of the repo copy (directus/scripts/).
#
# ⚠ CSVs hold member PII (IBAN/AHV) — the EXIT trap deletes them; never let them linger.
# ⚠ CLUBDESK_ENV=dev: the importer maps recipient_email to the dev-refresh sink
#   address (import-clubdesk-dev-scrub.mjs, audit 2026-09-28 F14); prod unchanged.
# ⚠ One ClubDesk session per account — runs on a dedicated service account.
set -euo pipefail
DIR=/opt/clubdesk-sync
# Single sync at a time (nightly cron + the on-demand dispatcher share this lock).
exec 8>"$DIR/.sync.lock"
flock -n 8 || { echo "another finance sync is running — skipping"; exit 0; }
PW_IMG=mcr.microsoft.com/playwright:v1.60.0-jammy
NODE_IMG=node:20-bookworm
PG=kscw-postgres
ENVNAME="${CLUBDESK_ENV:-prod}"
case "$ENVNAME" in
  prod) DB=postgres ;;
  dev)  DB=directus_kscw_dev ;;
  *) echo "bad CLUBDESK_ENV: $ENVNAME (expected dev|prod)" >&2; exit 1 ;;
esac
INV="$DIR/clubdesk-rechnungen.csv"
BOOK="$DIR/clubdesk-buchhaltung.csv"
SQL="$DIR/finance-import.sql"
STARTED=$(date +%s)
STAGE=start

# Heartbeat in sync_runs (source clubdesk_finance) — the Infra Health card and the
# daily kscw-hooks watchdog read it. This job failed silently twice before
# (82 nights in June–Sept, 11.–14.10.2026); now a failure or a missing night shows.
heartbeat() { # status, error message (may be empty)
  local ms=$(( ($(date +%s) - STARTED) * 1000 )) msg=${2//\'/\'\'}
  docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -q -v ON_ERROR_STOP=1 -c "
    INSERT INTO sync_runs (source, last_run_at, status, rows_changed, duration_ms, error_message)
    SELECT 'clubdesk_finance', now(), '$1',
           (SELECT count(*) FROM finance_transactions WHERE source = 'clubdesk'), $ms, NULLIF('$msg', '')
    ON CONFLICT (source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, status = EXCLUDED.status,
      rows_changed = EXCLUDED.rows_changed, duration_ms = EXCLUDED.duration_ms, error_message = EXCLUDED.error_message" \
    >/dev/null 2>&1 || echo "⚠ heartbeat write failed"
}

# "$BOOK".N = the per-year parts the scraper joins; left behind if it dies mid-run.
cleanup() {
  local rc=$?
  rm -f "$INV" "$BOOK" "$BOOK".* "$SQL"
  if [ "$rc" -ne 0 ]; then heartbeat error "exit $rc during $STAGE"; fi
}
trap cleanup EXIT

echo "=== ClubDesk finance sync start $(TZ=Europe/Zurich date +'%d.%m.%Y %H:%M:%S') (env=$ENVNAME db=$DB) ==="
STAGE=scrape
docker run --rm -w /work -v "$DIR":/work --env-file "$DIR/.env" "$PW_IMG" \
  node /work/clubdesk-scrape-finance.mjs /work/clubdesk-rechnungen.csv /work/clubdesk-buchhaltung.csv
STAGE=import
docker run --rm -w /work -v "$DIR":/work "$NODE_IMG" \
  node /work/import-clubdesk-finance.mjs "$ENVNAME" /work/clubdesk-rechnungen.csv /work/clubdesk-buchhaltung.csv --emit-sql > "$SQL"
STAGE=apply
docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -v ON_ERROR_STOP=1 < "$SQL"
heartbeat ok ""
echo "=== ClubDesk finance sync done $(TZ=Europe/Zurich date +'%d.%m.%Y %H:%M:%S') ==="
