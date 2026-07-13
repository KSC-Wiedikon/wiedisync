#!/bin/bash
#
# backup-uploads.sh — weekly encrypted backup of the Directus uploads bucket.
#
# WHY THIS EXISTS
# ---------------
# Since the 2026-07-13 R2 cutover, r2:kscw-uploads is the ONLY home of the club's
# uploaded files — including members' scanned ID documents (registrations.id_upload_*)
# and Swiss Basketball licence docs. The Postgres dumps back up directus_files ROWS,
# not the bytes.
#
# R2 has NO versioning and NO object lock — Cloudflare lists PutBucketVersioning /
# GetBucketVersioning as unimplemented. There is no undelete. And R2 offers no
# write-without-delete token permission, so the credential Directus holds (Object Read
# & Write) can also erase objects. A bad delete or a Directus compromise would take
# those files permanently.
#
# So the bucket needs a real backup. This is it.
#
# DESIGN
# ------
# Same key, same destinations, same escrow as the DB pipeline (backup-postgres.sh):
# encrypted to backup@kscw.ch, whose PRIVATE half is not on this box — so a rooted VPS
# still cannot read the archive it just produced. Verify with `npm run backup:verify-key`.
#
# Weekly, not 6-hourly: ~194 MB and the files change rarely. The rclone sync is
# incremental, so only changed objects cross the wire.

set -uo pipefail

BACKUP_DIR=/data/backups
MIRROR=/data/uploads-mirror
DATE=$(date +%Y-%m-%d)
BUCKET=r2:kscw-uploads          # existing rclone remote (admin creds, root-only)
GDRIVE_DIR=gdrive:Backups/directus-kscw
R2_DIR=r2:kscw-db-backups
NAS_USER=lucanepa
NAS_HOST=100.64.212.125
NAS_PATH=/volume1/backups/directus-kscw
SSH_KEY=/root/.ssh/id_ed25519
GPG_RECIPIENT=backup@kscw.ch

ARCHIVE="$BACKUP_DIR/kscw_uploads_${DATE}.tar.gz.gpg"

log() { echo "$(date): [uploads] $*" >> "$BACKUP_DIR/backup.log"; }

# ── 1. incremental mirror of the bucket ─────────────────────────────────────────────
mkdir -p "$MIRROR"
# NOT --delete: an object deleted in R2 (accidentally or maliciously) must NOT be
# propagated into the mirror, or the backup faithfully reproduces the disaster. The
# mirror is append-mostly; prune it by hand if it ever genuinely needs shrinking.
if ! rclone copy "$BUCKET" "$MIRROR" --transfers 8 --stats-one-line 2>&1; then
  log "FAILED: rclone copy from $BUCKET"
  exit 1
fi

OBJECTS=$(find "$MIRROR" -type f | wc -l)
if [ "$OBJECTS" -lt 10 ]; then
  # Guard against archiving an empty/half-synced mirror over a good one.
  log "ABORT: mirror holds only $OBJECTS files — refusing to make an archive"
  exit 1
fi

# ── 2. encrypt (public-key only on this box — cannot be decrypted here) ─────────────
if ! tar -czf - -C "$MIRROR" . \
     | gpg --batch --yes --trust-model always --encrypt --recipient "$GPG_RECIPIENT" \
           --output "$ARCHIVE" 2>&1; then
  log "FAILED: tar|gpg"
  rm -f "$ARCHIVE"
  exit 1
fi
SIZE=$(du -h "$ARCHIVE" | cut -f1)

# ── 3. offsite: same three destinations as the DB dumps ─────────────────────────────
rclone copy "$ARCHIVE" "$GDRIVE_DIR" 2>&1
rclone copy "$ARCHIVE" "$R2_DIR" 2>&1
scp -O -i "$SSH_KEY" -o StrictHostKeyChecking=no "$ARCHIVE" \
    "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/" 2>&1

# ── 4. retention: 8 weeks everywhere ────────────────────────────────────────────────
find "$BACKUP_DIR" -name 'kscw_uploads_*.tar.gz.gpg' -mtime +56 -delete
rclone delete "$GDRIVE_DIR" --min-age 56d --include 'kscw_uploads_*.tar.gz.gpg' 2>&1
rclone delete "$R2_DIR"     --min-age 56d --include 'kscw_uploads_*.tar.gz.gpg' 2>&1
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_HOST}" \
  "find '${NAS_PATH}' -name 'kscw_uploads_*.tar.gz.gpg' -mtime +56 -delete" 2>&1

log "complete - ${OBJECTS} objects, ${SIZE} encrypted - GDrive + R2 + NAS"
