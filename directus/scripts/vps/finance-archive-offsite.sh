#!/bin/bash
#
# finance-archive-offsite.sh — keep every yearly finance archive offsite for 10 years.
#
# WHY THIS EXISTS
# ---------------
# The books must be kept 10 years (Art. 958f OR). /kscw/finance/archive stores each
# fiscal year's package (journal, accounts, receipts, statements, manifest) as a
# Directus file — which since 2026-07-13 lives ONLY in the R2 uploads bucket, with no
# versioning and a credential that can delete. The weekly uploads backup keeps 8 weeks.
#
# So each new archive is copied, GPG-encrypted to backup@kscw.ch (same key and escrow
# as the database dumps — the private half is not on this box), to the same three
# places as the backups, but under its own folders that NO prune pattern touches:
#   gdrive:Archive/kscw-finance     r2kscw:kscw-db-backups/finance-archive/
#   NAS /volume1/backups/directus-kscw/finance-archive/
# The prune globs of backup-postgres.sh ('*.sql.gz.gpg') and backup-uploads.sh
# ('kscw_uploads_*.tar.gz.gpg') cannot match 'kscw_finanzarchiv_*.zip.gpg'.
#
# Daily, idempotent: only archives with offsite_at IS NULL are handled; the result per
# target lands in finance_archives.offsite, offsite_at only once all three succeed.
# The plaintext copy is checked against the recorded SHA-256 before encrypting.
# Deploy: npm run backup:deploy-scripts (installs to /usr/local/bin). Cron (root):
#   45 3 * * * /usr/local/bin/finance-archive-offsite.sh

set -uo pipefail

PG=kscw-postgres
DB=postgres
BUCKET=r2kscw:kscw-uploads
WORK=/data/backups/finance-archive
GDRIVE_DIR=gdrive:Archive/kscw-finance
R2_DIR=r2kscw:kscw-db-backups/finance-archive
NAS_USER=lucanepa
NAS_HOST=100.64.212.125
NAS_PATH=/volume1/backups/directus-kscw/finance-archive
SSH_KEY=/root/.ssh/id_ed25519
GPG_RECIPIENT=backup@kscw.ch
LOG=/data/backups/backup.log

log() { echo "$(date): [finance-archive] $*" >> "$LOG"; }
psqlq() { docker exec -i "$PG" psql -U supabase_admin -d "$DB" -X -At -v ON_ERROR_STOP=1 "$@"; }

mkdir -p "$WORK" && chmod 700 "$WORK"
umask 077

ROWS=$(psqlq -F '|' -c "
  SELECT a.id, f.filename_disk, a.sha256, regexp_replace(fy.label, '[^0-9A-Za-z]', '-', 'g')
  FROM finance_archives a
  JOIN directus_files f ON f.id = a.file
  JOIN finance_fiscal_years fy ON fy.id = a.fiscal_year
  WHERE a.offsite_at IS NULL
  ORDER BY a.id") || { log "FAILED: could not list archives"; exit 1; }
[ -z "$ROWS" ] && exit 0

while IFS='|' read -r ID DISK SHA FY; do
  [ -z "$ID" ] && continue
  NAME="kscw_finanzarchiv_${FY}_${ID}"
  PLAIN="$WORK/$NAME.zip"
  ENC="$WORK/$NAME.zip.gpg"
  rm -f "$PLAIN" "$ENC"
  if ! rclone copyto "$BUCKET/$DISK" "$PLAIN" 2>>"$LOG"; then
    log "archive $ID: FAILED to fetch $DISK from R2"; continue
  fi
  GOT=$(sha256sum "$PLAIN" | cut -d' ' -f1)
  if [ "$GOT" != "$SHA" ]; then
    log "archive $ID: SHA-256 MISMATCH (stored $SHA, R2 copy $GOT) — not copying"
    psqlq -c "UPDATE finance_archives SET offsite = jsonb_build_object('error', 'sha256 mismatch', 'checked_at', now()) WHERE id = $ID" >/dev/null
    rm -f "$PLAIN"; continue
  fi
  if ! gpg --batch --yes --trust-model always --encrypt --recipient "$GPG_RECIPIENT" --output "$ENC" "$PLAIN" 2>>"$LOG"; then
    log "archive $ID: FAILED to encrypt"; rm -f "$PLAIN" "$ENC"; continue
  fi
  rm -f "$PLAIN"
  ENC_SHA=$(sha256sum "$ENC" | cut -d' ' -f1)
  G=failed; R=failed; N=failed
  rclone copy "$ENC" "$GDRIVE_DIR" 2>>"$LOG" && G=ok
  rclone copy "$ENC" "$R2_DIR" 2>>"$LOG" && R=ok
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_HOST}" "mkdir -p '${NAS_PATH}'" 2>>"$LOG" \
    && scp -O -i "$SSH_KEY" -o StrictHostKeyChecking=no "$ENC" "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/" 2>>"$LOG" && N=ok
  DONE=""
  if [ "$G$R$N" = "okokok" ]; then DONE=", offsite_at = now()"; rm -f "$ENC"; fi
  psqlq -c "UPDATE finance_archives SET offsite = jsonb_build_object(
      'gdrive', '$G', 'r2', '$R', 'nas', '$N', 'file', '$NAME.zip.gpg',
      'encrypted_sha256', '$ENC_SHA', 'checked_at', now())$DONE WHERE id = $ID" >/dev/null \
    || log "archive $ID: could not record the result"
  log "archive $ID ($FY): GDrive $G, R2 $R, NAS $N"
done <<< "$ROWS"
