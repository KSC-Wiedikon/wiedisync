#!/bin/bash
set -euo pipefail
BACKUP_DIR=/data/backups
LABEL="${1:-manual}"
DATE=$(date +%Y-%m-%d_%H%M)
CONTAINER=kscw-postgres
GDRIVE_DIR=gdrive:Backups/directus-kscw
R2_DIR=r2kscw:kscw-db-backups
GPG_RECIPIENT=backup@kscw.ch
FILE="$BACKUP_DIR/kscw_predeploy_${LABEL}_${DATE}.sql.gz"
# A deploy waits on this script, so each offsite leg is time-boxed. Google Drive
# throttles rclone's shared OAuth client (403 rateLimitExceeded) and rclone then backs
# off and retries for as long as it takes — on 13.10.2026 the Drive leg held a deploy
# for 35 min. A leg that fails or times out is only logged: the local .gpg stays, and
# the next 6-hourly backup-postgres.sh run copies any .gpg still missing offsite.
OFFSITE_TIMEOUT=300

docker exec $CONTAINER pg_dump -U supabase_admin -d postgres --no-owner --no-acl | gzip > "$FILE"
gpg --batch --yes --trust-model always --encrypt --recipient $GPG_RECIPIENT --output "$FILE.gpg" "$FILE"
SIZE=$(ls -lh "$FILE" | awk '{print $5}')

# offsite <name> <rclone dir> → "<name> OK" | "<name> FAILED"
offsite() {
  local err why rc=0
  err=$(timeout "$OFFSITE_TIMEOUT" rclone copy "$FILE.gpg" "$2" --retries 2 2>&1) || rc=$?
  if [ "$rc" -eq 0 ]; then echo "$1 OK"; return; fi
  if [ "$rc" -eq 124 ]; then
    why="timed out after ${OFFSITE_TIMEOUT}s"
  else
    why=$(printf '%s' "$err" | grep -o 'rateLimitExceeded\|storageQuotaExceeded\|NotImplemented' | head -1 || true)
    why=${why:-exit $rc}
  fi
  echo "$1 FAILED ($why)"
}
GDRIVE=$(offsite GDrive "$GDRIVE_DIR")
R2=$(offsite R2 "$R2_DIR")

echo "$(date): Predeploy snapshot ($LABEL) - $SIZE - $FILE - offsite: $GDRIVE, $R2" | tee -a /data/backups/backup.log
echo "$FILE"
