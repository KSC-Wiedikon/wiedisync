#!/bin/bash
set -euo pipefail
BACKUP_DIR=/data/backups
LABEL="${1:-manual}"
DATE=$(date +%Y-%m-%d_%H%M)
CONTAINER=kscw-postgres
GDRIVE_DIR=gdrive:Backups/directus-kscw
R2_DIR=r2:kscw-db-backups
GPG_RECIPIENT=backup@kscw.ch
FILE="$BACKUP_DIR/kscw_predeploy_${LABEL}_${DATE}.sql.gz"

docker exec $CONTAINER pg_dump -U supabase_admin -d postgres --no-owner --no-acl | gzip > "$FILE"
gpg --batch --yes --trust-model always --encrypt --recipient $GPG_RECIPIENT --output "$FILE.gpg" "$FILE"
SIZE=$(ls -lh "$FILE" | awk '{print $5}')
rclone copy "$FILE.gpg" "$GDRIVE_DIR" 2>&1 | tail -1 || true
rclone copy "$FILE.gpg" "$R2_DIR" 2>&1 | tail -1 || true
echo "$(date): Predeploy snapshot ($LABEL) - $SIZE - $FILE (encrypted offsite to GDrive+R2)" | tee -a /data/backups/backup.log
echo "$FILE"
