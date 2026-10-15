#!/bin/bash
BACKUP_DIR=/data/backups
DATE=$(date +%Y-%m-%d_%H%M)
CONTAINER=kscw-postgres
GDRIVE_DIR=gdrive:Backups/directus-kscw
R2_DIR=r2kscw:kscw-db-backups
NAS_USER=lucanepa
NAS_HOST=100.64.212.125
NAS_PATH=/volume1/backups/directus-kscw
SSH_KEY=/root/.ssh/id_ed25519
GPG_RECIPIENT=backup@kscw.ch

# Dump postgres database (KSCW data) — plaintext local
PLAIN="$BACKUP_DIR/kscw_${DATE}.sql.gz"
docker exec $CONTAINER pg_dump -U supabase_admin -d postgres --no-owner --no-acl | gzip > "$PLAIN"

# Nomal (video analysis, repo KSC-Wiedikon/nomal) keeps its own database on the same
# server. Prod only: nomal_dev is disposable. Skipped until the database exists.
# The file name starts with nomal_, so restore-test.sh (kscw_20*) never picks it up.
NOMAL=""
NOMAL_FAILED=0
if docker exec $CONTAINER psql -U supabase_admin -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = 'nomal'" | grep -qx 1; then
  NOMAL="$BACKUP_DIR/nomal_${DATE}.sql.gz"
  docker exec $CONTAINER pg_dump -U supabase_admin -d nomal --no-owner --no-acl | gzip > "$NOMAL"
  [ "${PIPESTATUS[0]}" -eq 0 ] || NOMAL_FAILED=1
fi

# Encrypt for offsite copies (recipient = public-key-only VPS keyring)
# Encrypt every .sql.gz that doesn't yet have a .gpg twin (catches today's + last 7 days).
for f in "$BACKUP_DIR"/*.sql.gz; do
  [ -f "$f.gpg" ] && continue
  gpg --batch --yes --trust-model always --encrypt --recipient $GPG_RECIPIENT --output "$f.gpg" "$f"
done

# Keep only last 7 days of local backups (plaintext + encrypted)
find $BACKUP_DIR -name '*.sql.gz' -mtime +7 -delete
find $BACKUP_DIR -name '*.sql.gz.gpg' -mtime +7 -delete

# Every offsite leg is checked. The closing log line used to claim "synced to
# GDrive+R2+NAS" whether or not anything landed — and Google Drive throttles rclone's
# shared OAuth client (403 rateLimitExceeded: 20.09, 27.09, 11.10 and 13.10.2026).
# A failed leg is now logged FAILED. Each copy sends every local .gpg the remote lacks,
# so the next run fills in what this one missed (7-day local retention).
OFFSITE=()
PRUNE_FAILED=()
# leg <name> <command…> — records "<name> OK" / "<name> FAILED"
leg() { local name=$1; shift; if "$@"; then OFFSITE+=("$name OK"); else OFFSITE+=("$name FAILED"); fi; }

# Sync ENCRYPTED files to Google Drive (60d retention)
leg GDrive rclone copy "$BACKUP_DIR" "$GDRIVE_DIR" --include '*.sql.gz.gpg' 2>&1
rclone delete "$GDRIVE_DIR" --min-age 60d --include '*.sql.gz.gpg' 2>&1 || PRUNE_FAILED+=(GDrive)

# Sync ENCRYPTED files to Cloudflare R2 (60d retention)
leg R2 rclone copy "$BACKUP_DIR" "$R2_DIR" --include '*.sql.gz.gpg' 2>&1
rclone delete "$R2_DIR" --min-age 60d --include '*.sql.gz.gpg' 2>&1 || PRUNE_FAILED+=(R2)

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
# An unreachable NAS (DSM upgrade, Tailscale down) fails the listing and every scp —
# both now mark the NAS leg FAILED instead of vanishing into the old fixed log line.
NAS_OK=1
REMOTE_LIST=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_HOST}" \
  "find '${NAS_PATH}' -maxdepth 1 -name '*.sql.gz.gpg' -printf '%f %s\n' 2>/dev/null" 2>/dev/null) || NAS_OK=0
for f in "$BACKUP_DIR"/*.sql.gz.gpg; do
  [ -e "$f" ] || continue
  base=$(basename "$f"); size=$(stat -c%s "$f")
  if printf '%s\n' "$REMOTE_LIST" | grep -qx "$base $size"; then
    continue   # already on the NAS at the correct size
  fi
  scp -O -i "$SSH_KEY" -o StrictHostKeyChecking=no "$f" "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/" 2>&1 || NAS_OK=0
done
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_HOST}" \
  "find '${NAS_PATH}' -name '*.sql.gz.gpg' -mtime +7 -delete" 2>&1 || PRUNE_FAILED+=(NAS)
if [ "$NAS_OK" -eq 1 ]; then OFFSITE+=("NAS OK"); else OFFSITE+=("NAS FAILED"); fi

SUMMARY=$(IFS=,; echo "${OFFSITE[*]}" | sed 's/,/, /g')
[ ${#PRUNE_FAILED[@]} -gt 0 ] && SUMMARY="$SUMMARY; retention prune FAILED on ${PRUNE_FAILED[*]}"
[ "$NOMAL_FAILED" -eq 1 ] && SUMMARY="$SUMMARY; nomal dump FAILED"
[ -n "$NOMAL" ] && [ "$NOMAL_FAILED" -eq 0 ] && SUMMARY="$SUMMARY; nomal $(ls -lh "$NOMAL" | awk '{print $5}') plain"
case "$SUMMARY" in *FAILED*) RESULT="Backup INCOMPLETE" ;; *) RESULT="Backup complete" ;; esac
echo "$(date): $RESULT - $(ls -lh $PLAIN | awk '{print $5}') plain / $(ls -lh $PLAIN.gpg | awk '{print $5}') gpg - offsite (all gpg): $SUMMARY" >> /data/backups/backup.log
