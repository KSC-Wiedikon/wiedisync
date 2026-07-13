#!/bin/bash
BACKUP_DIR=/data/backups
DATE=$(date +%Y-%m-%d_%H%M)
CONTAINER=kscw-postgres
GDRIVE_DIR=gdrive:Backups/directus-kscw
R2_DIR=r2:kscw-db-backups
NAS_USER=lucanepa
NAS_HOST=100.64.212.125
NAS_PATH=/volume1/backups/directus-kscw
SSH_KEY=/root/.ssh/id_ed25519
GPG_RECIPIENT=backup@kscw.ch

# Dump postgres database (KSCW data) — plaintext local
PLAIN="$BACKUP_DIR/kscw_${DATE}.sql.gz"
docker exec $CONTAINER pg_dump -U supabase_admin -d postgres --no-owner --no-acl | gzip > "$PLAIN"

# Encrypt for offsite copies (recipient = public-key-only VPS keyring)
# Encrypt every .sql.gz that doesn't yet have a .gpg twin (catches today's + last 7 days).
for f in "$BACKUP_DIR"/*.sql.gz; do
  [ -f "$f.gpg" ] && continue
  gpg --batch --yes --trust-model always --encrypt --recipient $GPG_RECIPIENT --output "$f.gpg" "$f"
done

# Keep only last 7 days of local backups (plaintext + encrypted)
find $BACKUP_DIR -name '*.sql.gz' -mtime +7 -delete
find $BACKUP_DIR -name '*.sql.gz.gpg' -mtime +7 -delete

# Sync ENCRYPTED files to Google Drive (60d retention)
rclone copy "$BACKUP_DIR" "$GDRIVE_DIR" --include '*.sql.gz.gpg' 2>&1
rclone delete "$GDRIVE_DIR" --min-age 60d --include '*.sql.gz.gpg' 2>&1

# Sync ENCRYPTED files to Cloudflare R2 (60d retention)
rclone copy "$BACKUP_DIR" "$R2_DIR" --include '*.sql.gz.gpg' 2>&1
rclone delete "$R2_DIR" --min-age 60d --include '*.sql.gz.gpg' 2>&1

# Sync ENCRYPTED files to NAS via Tailscale.
# The dumps carry AHV numbers and IBANs; a Synology is a ransomware target like any
# other box, so it gets the .gpg — never the plaintext. Restoring from the NAS needs
# the backup@kscw.ch private key, same as GDrive/R2 (see CONTINGENCY.md).
#
# Copy only what the NAS is missing. The old loop re-sent every dump in the 7-day
# window on every run (~30 files x 313 MB, 4x/day) — pure waste over Tailscale.
#
# NOT rsync: DSM refuses rsync-over-ssh for this user ("Permission denied" on
# `rsync --server`, even though plain ssh + scp with the same key work fine).
# So: fetch the remote name+size list once, then scp only the files that are absent
# or size-mismatched (a half-transferred .gpg re-sends rather than being trusted).
REMOTE_LIST=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_HOST}" \
  "find '${NAS_PATH}' -maxdepth 1 -name '*.sql.gz.gpg' -printf '%f %s\n' 2>/dev/null" 2>/dev/null)
for f in "$BACKUP_DIR"/*.sql.gz.gpg; do
  [ -e "$f" ] || continue
  base=$(basename "$f"); size=$(stat -c%s "$f")
  if printf '%s\n' "$REMOTE_LIST" | grep -qx "$base $size"; then
    continue   # already on the NAS at the correct size
  fi
  scp -O -i "$SSH_KEY" -o StrictHostKeyChecking=no "$f" "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/" 2>&1
done
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_HOST}" \
  "find '${NAS_PATH}' -name '*.sql.gz.gpg' -mtime +7 -delete" 2>&1

echo "$(date): Backup complete - $(ls -lh $PLAIN | awk '{print $5}') plain / $(ls -lh $PLAIN.gpg | awk '{print $5}') gpg - synced to GDrive+R2+NAS (all gpg)" >> /data/backups/backup.log
