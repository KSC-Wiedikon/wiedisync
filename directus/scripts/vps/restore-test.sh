#!/bin/bash
# Weekly restore-test: pulls latest scheduled dump, loads into scratch
# postgres:15 container, asserts critical tables have plausible row counts.
# Catches silently-corrupt dumps before they are needed in a real restore.
set -euo pipefail
BACKUP_DIR=/data/backups
LOG=$BACKUP_DIR/backup.log
NAME=kscw-restore-test
DATE=$(date)

# Pick the most recent SCHEDULED dump (skip predeploy_ files)
LATEST=$(ls -t $BACKUP_DIR/kscw_20*-*.sql.gz 2>/dev/null | grep -v predeploy | head -1)
if [ -z "$LATEST" ]; then
  echo "$DATE: RESTORE-TEST FAILED - no scheduled dump found" | tee -a $LOG >&2
  exit 1
fi

# Thresholds: counts must be at least N (current prod numbers as of 2026-05-14).
# Tune downward if these become noisy after data purges.
declare -A MIN
MIN[members]=400
MIN[teams]=25
MIN[trainings]=400
MIN[games]=300
MIN[participations]=800
MIN[hall_slots]=40

cleanup() { docker rm -f $NAME >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME \
  -e POSTGRES_PASSWORD=test -e POSTGRES_USER=supabase_admin -e POSTGRES_DB=postgres \
  postgres:15 >/dev/null

for i in {1..30}; do
  docker exec $NAME pg_isready -U supabase_admin >/dev/null 2>&1 && break
  sleep 1
done

# Load dump; redirect noisy GRANT-on-missing-role warnings to /dev/null.
# ON_ERROR_STOP=0 because Supabase-specific role grants are expected to fail
# on vanilla postgres:15 (data restore still succeeds).
if ! zcat "$LATEST" | docker exec -i $NAME psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=0 >/dev/null 2>&1; then
  echo "$DATE: RESTORE-TEST FAILED - psql load returned non-zero on $LATEST" | tee -a $LOG >&2
  exit 1
fi

FAIL=0
RESULTS=""
for tbl in "${!MIN[@]}"; do
  COUNT=$(docker exec $NAME psql -U supabase_admin -d postgres -t -A -c "SELECT count(*) FROM $tbl" 2>/dev/null || echo "X")
  MINV=${MIN[$tbl]}
  if [ "$COUNT" = "X" ] || [ "$COUNT" -lt "$MINV" ] 2>/dev/null; then
    RESULTS="$RESULTS $tbl=$COUNT(<$MINV)!"
    FAIL=1
  else
    RESULTS="$RESULTS $tbl=$COUNT"
  fi
done

if [ $FAIL -eq 1 ]; then
  echo "$DATE: RESTORE-TEST FAILED - $LATEST -$RESULTS" | tee -a $LOG >&2
  exit 1
fi

echo "$DATE: RESTORE-TEST OK - $(basename $LATEST) -$RESULTS" | tee -a $LOG
