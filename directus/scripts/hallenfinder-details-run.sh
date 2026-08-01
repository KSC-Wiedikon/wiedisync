#!/usr/bin/env bash
#
# hallenfinder-details-run.sh — run the Hallenfinder detail pass from a DEV
# MACHINE against dev or prod (`npm run hallenfinder:details:dev|prod`).
#
# The VPS runs this monthly on its own via hallenfinder-sync.sh; this wrapper is
# for the first backfill after migration 269 and for ad-hoc re-runs.
#
# Two hops are needed because hallenfinder-details.mjs deliberately has no DB
# access: read the hall ids over ssh, scrape locally, pipe the SQL back.
#
set -euo pipefail

ENVNAME="${1:-}"
case "$ENVNAME" in
  prod) DB=postgres ;;
  dev)  DB=directus_kscw_dev ;;
  *) echo "usage: $0 dev|prod" >&2; exit 1 ;;
esac

PSQL="sudo docker exec -i kscw-postgres psql -U supabase_admin -d $DB -X -v ON_ERROR_STOP=1"

echo "→ reading hall ids from $ENVNAME…" >&2
IDS=$(ssh hetzner "$PSQL -tAc \"SELECT string_agg(einrichtung_id::text, ',') FROM city_halls\"" | tr -d '[:space:]')
if [ -z "$IDS" ]; then
  echo "no halls in city_halls on $ENVNAME — run the availability scrape first" >&2
  exit 1
fi

echo "→ scraping detail pages…" >&2
SQL=$(node "$(dirname "$0")/hallenfinder-details.mjs" --emit-sql --ids="$IDS")
if [ -z "$SQL" ]; then
  echo "detail pass produced no SQL — not touching $ENVNAME" >&2
  exit 1
fi

echo "→ loading into $ENVNAME…" >&2
printf '%s\n' "$SQL" | ssh hetzner "$PSQL"
echo "✓ hallenfinder details updated on $ENVNAME" >&2
