#!/bin/bash
BACKUP_DIR=/data/backups
DATE=$(date +%Y-%m-%d_%H%M)
CONTAINER=kscw-postgres
R2_DIR=r2kscw:kscw-db-backups
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

# Google Drive leg dropped 16.10.2026: the `gdrive` remote was Luca's PERSONAL Drive with
# full access, which the club's server must not hold. Club offsite copy = R2; Luca's server
# also pulls a private copy to his NAS. A club-owned Drive (kscwzh@gmail.com) can come back
# later as a second club copy (handover document 03, GG1).

# Sync ENCRYPTED files to Cloudflare R2 (60d retention)
leg R2 rclone copy "$BACKUP_DIR" "$R2_DIR" --include '*.sql.gz.gpg' 2>&1
rclone delete "$R2_DIR" --min-age 60d --include '*.sql.gz.gpg' 2>&1 || PRUNE_FAILED+=(R2)

# NAS copy: since 16.10.2026 this server no longer pushes to Luca's NAS. The VPS belongs to
# the club's Hetzner account, so it must hold no key to his home network; his lenovoserver
# PULLS the encrypted files instead (kscw-backup-pull.timer there, 40 min after each run).

SUMMARY=$(IFS=,; echo "${OFFSITE[*]}" | sed 's/,/, /g')
[ ${#PRUNE_FAILED[@]} -gt 0 ] && SUMMARY="$SUMMARY; retention prune FAILED on ${PRUNE_FAILED[*]}"
[ "$NOMAL_FAILED" -eq 1 ] && SUMMARY="$SUMMARY; nomal dump FAILED"
[ -n "$NOMAL" ] && [ "$NOMAL_FAILED" -eq 0 ] && SUMMARY="$SUMMARY; nomal $(ls -lh "$NOMAL" | awk '{print $5}') plain"
case "$SUMMARY" in *FAILED*) RESULT="Backup INCOMPLETE" ;; *) RESULT="Backup complete" ;; esac
echo "$(date): $RESULT - $(ls -lh $PLAIN | awk '{print $5}') plain / $(ls -lh $PLAIN.gpg | awk '{print $5}') gpg - offsite (all gpg): $SUMMARY" >> /data/backups/backup.log
