#!/usr/bin/env bash
#
# Prune directus_revisions for MACHINE-WRITTEN collections.
#
# Why this exists: Directus stores a full before/after snapshot per item write.
# For collections a cron rewrites nightly that trail is never read and grows without
# bound -- prod 2026-08-25 held 3,135 live `svrz_games` rows and 477,983 revisions of
# them (2,254 MB). Migration 336 stops NEW ones for the user collections; this script
# clears the BACKLOG, and stays useful because `directus_permissions` revisions
# regrow on every deploy (`setup-permissions.mjs` clears and recreates ~600 rows, and
# it is a SYSTEM collection so migration 336's accountability switch cannot reach it).
#
# ⚠ Human-edited collections are never touched. The list below is machine-written
#   data only; `members`, `participations`, `absences`, `teams`, `trainings`, `games`
#   and friends keep their full revision history, which is the actual audit trail.
#
# Usage:
#   ./prune-machine-revisions.sh prod              # dry run -- reports, deletes nothing
#   ./prune-machine-revisions.sh prod --apply      # delete, then plain VACUUM (no lock)
#   ./prune-machine-revisions.sh prod --apply --vacuum-full
#
# ⚠⚠ --vacuum-full takes an ACCESS EXCLUSIVE lock on directus_revisions for the
#    duration (~1-3 min on a 2.9 GB table). Directus writes a revision on every item
#    write, so item WRITES BLOCK for that window. Reads are unaffected. It is the only
#    way to hand the disk back -- a plain VACUUM just marks pages reusable. Run it in a
#    quiet window, never mid-deploy.
#
# Always snapshot first:  npm run db:snapshot:prod
set -euo pipefail

ENV="${1:-}"
shift || true
APPLY=false
VACUUM_FULL=false
for arg in "$@"; do
  case "$arg" in
    --apply)       APPLY=true ;;
    --vacuum-full) VACUUM_FULL=true ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

case "$ENV" in
  prod) DB=postgres ;;
  dev)  DB=directus_kscw_dev ;;
  *) echo "usage: $0 <prod|dev> [--apply] [--vacuum-full]" >&2; exit 2 ;;
esac

# Machine-written collections. Keep this list in sync with migration 336, plus the
# system collections that migration cannot reach.
COLLECTIONS="'svrz_games','svrz_spielplaner_contacts','sv_vm_check','public_stats','rankings','user_logs','directus_permissions','directus_flows','directus_operations'"

psql() { ssh hetzner "sudo docker exec -i kscw-postgres psql -U supabase_admin -d $DB -v ON_ERROR_STOP=1" ; }

echo "=== $ENV ($DB) — directus_revisions before ==="
psql <<SQL
\pset format unaligned
\pset fieldsep '  |  '
SELECT 'total rows', count(*)::text FROM directus_revisions
UNION ALL SELECT 'total size', pg_size_pretty(pg_total_relation_size('directus_revisions'))
UNION ALL SELECT 'to prune', count(*)::text FROM directus_revisions WHERE collection IN ($COLLECTIONS)
UNION ALL SELECT 'to KEEP', count(*)::text FROM directus_revisions WHERE collection NOT IN ($COLLECTIONS);
SQL

if [ "$APPLY" != true ]; then
  echo
  echo "DRY RUN — nothing deleted. Re-run with --apply (and --vacuum-full to reclaim disk)."
  exit 0
fi

echo
echo "=== deleting ==="
psql <<SQL
\timing on
DELETE FROM directus_revisions WHERE collection IN ($COLLECTIONS);
SQL

if [ "$VACUUM_FULL" = true ]; then
  echo
  echo "=== VACUUM FULL (item writes block until this finishes) ==="
  # Raised in-session: VACUUM FULL rewrites the table and rebuilds its indexes, and
  # maintenance_work_mem is what the index builds get. It is a plain GUC, so this
  # needs no restart and reverts when the session ends.
  #
  # NOTE the lock window is driven by the SURVIVING rows, not the deleted ones -- after
  # the delete only ~22k rows (~20 MB) remain to rewrite, so this is seconds, not minutes.
  psql <<SQL
\timing on
SET maintenance_work_mem = '512MB';
VACUUM FULL VERBOSE directus_revisions;
SQL
else
  echo
  echo "=== VACUUM (concurrent-safe; disk is NOT returned, pages are reused) ==="
  psql <<SQL
\timing on
VACUUM ANALYZE directus_revisions;
SQL
fi

echo
echo "=== after ==="
psql <<SQL
\pset format unaligned
\pset fieldsep '  |  '
SELECT 'total rows', count(*)::text FROM directus_revisions
UNION ALL SELECT 'total size', pg_size_pretty(pg_total_relation_size('directus_revisions'));
SQL
