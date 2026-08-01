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
DETAILS_SQL="$DIR/import-details.sql"

cleanup() { rm -f "$SQL" "$DETAILS_SQL"; }
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

# 3. Detail pass (migration 269): dimensions, photo and rental contact per hall.
#    Monthly, not nightly — a hall's floor plan and photo never change, so doing
#    this every night would multiply requests against the city's server by ~100
#    for no new information. Force an off-schedule run with HALLENFINDER_DETAILS=1.
if [ "$(date -u +%d)" = "01" ] || [ "${HALLENFINDER_DETAILS:-0}" = "1" ]; then
  echo "--- detail pass $(date -u +%FT%TZ) ---"
  # The scrape script has no DB access by design, so the id list comes from here.
  IDS=$(docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -tAc \
    "SELECT string_agg(einrichtung_id::text, ',') FROM city_halls" | tr -d '[:space:]')
  if [ -z "$IDS" ]; then
    echo "hallenfinder-sync: no halls in city_halls, skipping detail pass" >&2
  else
    docker run --rm -w /work -v "$DIR":/work "$IMG" \
      node /work/hallenfinder-details.mjs --emit-sql --ids="$IDS" > "$DETAILS_SQL"
    if [ -s "$DETAILS_SQL" ]; then
      docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -v ON_ERROR_STOP=1 < "$DETAILS_SQL"
    else
      # Non-fatal: availability (the part people actually search on) already
      # landed above, and the previous run's dimensions are still valid.
      echo "hallenfinder-sync: detail pass produced no SQL, keeping existing details" >&2
    fi
  fi
fi

echo "=== Hallenfinder sync done $(date -u +%FT%TZ) ==="
