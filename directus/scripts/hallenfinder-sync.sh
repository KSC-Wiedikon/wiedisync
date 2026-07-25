#!/usr/bin/env bash
#
# hallenfinder-sync.sh — nightly City-of-Zürich hall-availability scrape, run by
# cron ON the Hetzner VPS. The host has no node, so the scrape runs inside the
# Playwright image (present for clubdesk-sync); the host only pipes the emitted
# SQL into Postgres via `docker exec`.
#
# Flow:
#   1. Scrape the public "freie Termine" tool (no login) -> import.sql
#   2. Pipe the SQL into the target pg container
#
# No credentials needed (public site). Install: lives at
# /opt/hallenfinder-sync/ on the VPS alongside hallenfinder-scrape.mjs and the
# hallenfinder/ helper dir. Run from root crontab, e.g.:
#   30 3 * * *  HALLENFINDER_ENV=prod /opt/hallenfinder-sync/hallenfinder-sync.sh >> /var/log/hallenfinder-sync.log 2>&1
#
# Target: defaults to prod. Set HALLENFINDER_ENV=dev for the dev database.
#
set -euo pipefail

DIR=/opt/hallenfinder-sync
IMG=mcr.microsoft.com/playwright:v1.60.0-jammy
PG=kscw-postgres
ENVNAME="${HALLENFINDER_ENV:-prod}"
case "$ENVNAME" in
  prod) DB=postgres ;;
  dev)  DB=directus_kscw_dev ;;
  *) echo "bad HALLENFINDER_ENV: $ENVNAME (expected dev|prod)" >&2; exit 1 ;;
esac
SQL="$DIR/import.sql"

cleanup() { rm -f "$SQL"; }
trap cleanup EXIT

echo "=== Hallenfinder sync start $(date -u +%FT%TZ) (env=$ENVNAME db=$DB) ==="

# 1. Scrape (plain node fetch in the container) -> SQL on the mounted host dir.
docker run --rm -w /work -v "$DIR":/work "$IMG" \
  node /work/hallenfinder-scrape.mjs --emit-sql > "$SQL"

if [ ! -s "$SQL" ]; then
  echo "hallenfinder-sync: empty SQL — scrape failed, not touching DB" >&2
  exit 1
fi

# 2. Load into Postgres from the host (transaction is inside the SQL).
docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -v ON_ERROR_STOP=1 < "$SQL"

echo "=== Hallenfinder sync done $(date -u +%FT%TZ) ==="
