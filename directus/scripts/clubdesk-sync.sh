#!/usr/bin/env bash
#
# clubdesk-sync.sh — weekly ClubDesk -> Directus member sync, run by cron ON the
# Hetzner VPS (the host has no node, so everything node-related runs inside the
# official Playwright container; the host only pipes the result into Postgres).
#
# Flow:
#   1. Scrape the ClubDesk member export in a Playwright container -> export.csv
#   2. Transform CSV -> psql script in the same image (import --emit-sql)
#   3. Pipe the SQL into the target pg container via `docker exec`
#
# Credentials (CLUBDESK_USER / CLUBDESK_PASS) come from /opt/clubdesk-sync/.env
# (root-only, chmod 600) and are passed to the scrape container via --env-file,
# never on a command line.
#
# Install: lives at /opt/clubdesk-sync/clubdesk-sync.sh on the VPS alongside
# clubdesk-scrape-export.mjs, import-clubdesk-csv.mjs and node_modules/
# (playwright + playwright-core, 1.60.0). Run from root crontab.
#
# Target: defaults to prod. Set CLUBDESK_ENV=dev to load the dev database.
#
set -euo pipefail

DIR=/opt/clubdesk-sync
IMG=mcr.microsoft.com/playwright:v1.60.0-jammy
PG=supabase-db-vek42jyj0owoutoouq29aisq
ENVNAME="${CLUBDESK_ENV:-prod}"
case "$ENVNAME" in
  prod) DB=postgres ;;
  dev)  DB=directus_kscw_dev ;;
  *) echo "bad CLUBDESK_ENV: $ENVNAME (expected dev|prod)" >&2; exit 1 ;;
esac
CSV="$DIR/export.csv"
SQL="$DIR/import.sql"

cleanup() { rm -f "$CSV" "$SQL"; }   # export holds member PII (IBAN/AHV) — never linger
trap cleanup EXIT

echo "=== ClubDesk sync start $(date -u +%FT%TZ) (env=$ENVNAME db=$DB) ==="

# 1. Scrape (headless chromium in container) -> CSV on the mounted host dir
docker run --rm -w /work -v "$DIR":/work --env-file "$DIR/.env" "$IMG" \
  node /work/clubdesk-scrape-export.mjs /work/export.csv

# 2. Transform CSV -> psql script (node, zero deps; no DB access from container)
docker run --rm -w /work -v "$DIR":/work "$IMG" \
  node /work/import-clubdesk-csv.mjs "$ENVNAME" /work/export.csv --emit-sql > "$SQL"

# 3. Load into Postgres from the host
docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -v ON_ERROR_STOP=1 < "$SQL"

echo "=== ClubDesk sync done $(date -u +%FT%TZ) ==="
