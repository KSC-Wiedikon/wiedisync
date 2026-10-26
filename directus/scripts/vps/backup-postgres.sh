#!/bin/bash
BACKUP_DIR=/data/backups
DATE=$(date +%Y-%m-%d_%H%M)
CONTAINER=kscw-postgres
R2_DIR=r2kscw:kscw-db-backups
GPG_RECIPIENT=backup@kscw.ch

# Dump postgres database (KSCW data) — plaintext local
PLAIN="$BACKUP_DIR/kscw_${DATE}.sql.gz"
docker exec $CONTAINER pg_dump -U supabase_admin -d postgres --no-owner --no-acl | gzip > "$PLAIN"

# WiePlay (video analysis, repo KSC-Wiedikon/wieplay; called Nomal until 17.10.2026) keeps its
# own database `wieplay` on the same server. Prod only: the dev database is disposable. Skipped
# while it does not exist. (The `nomal` fallback went on 18.10.2026: that database is gone.)
# The file name starts with wieplay_, so restore-test.sh (kscw_20*) never picks it up.
WIEPLAY=""
WIEPLAY_FAILED=0
if docker exec $CONTAINER psql -U supabase_admin -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = 'wieplay'" | grep -qx 1; then
  WIEPLAY="$BACKUP_DIR/wieplay_${DATE}.sql.gz"
  docker exec $CONTAINER pg_dump -U supabase_admin -d wieplay --no-owner --no-acl | gzip > "$WIEPLAY"
  [ "${PIPESTATUS[0]}" -eq 0 ] || WIEPLAY_FAILED=1
fi

# OpnForm (forms.kscw.ch) runs its own Postgres in its own container. Until 26.10.2026 nothing
# backed it up (form submissions are personal data). The container is Coolify's on Hetzner and
# opnform-postgres in the plain compose (deploy/opnform/); skipped while neither runs. The user
# and database come from the container's own env, so nothing is hard-coded here.
OPNFORM=""
OPNFORM_FAILED=0
OPNFORM_DB=$(docker ps --format '{{.Names}}' | grep -m1 -xE 'opnform-postgres|postgresql-g57v4frrpv7kz69s7aortpf0' || true)
if [ -n "$OPNFORM_DB" ]; then
  OPNFORM="$BACKUP_DIR/opnform_${DATE}.sql.gz"
  docker exec "$OPNFORM_DB" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' | gzip > "$OPNFORM"
  [ "${PIPESTATUS[0]}" -eq 0 ] || OPNFORM_FAILED=1
fi

# Uptime Kuma (status.kscw.ch): monitors, notification settings and history in SQLite (WAL mode).
# Every run: the dump is ~250 KB (26.10.2026). Python's online backup API takes a consistent copy
# while Kuma keeps running, and iterdump turns that copy into SQL, so the file rides the same
# *.sql.gz pipeline as the dumps (gpg, R2, lenovoserver's NAS pull).
# Restore, with the container stopped:
#   zcat kuma_<ts>.sql.gz | python3 -c 'import sqlite3,sys; sqlite3.connect("kuma.db").executescript(sys.stdin.read())'
KUMA=""
KUMA_FAILED=0
KUMA_DB=/opt/uptime-kuma/kuma.db
if [ -f "$KUMA_DB" ]; then
  KUMA="$BACKUP_DIR/kuma_${DATE}.sql.gz"
  python3 - "$KUMA_DB" "$BACKUP_DIR" <<'PY' | gzip > "$KUMA"
import os, sqlite3, sys, tempfile
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
with tempfile.TemporaryDirectory(dir=sys.argv[2]) as tmp:
    copy = sqlite3.connect(os.path.join(tmp, "kuma.db"))
    src.backup(copy)
    src.close()
    for line in copy.iterdump():
        sys.stdout.write(line + "\n")
    copy.close()
PY
  [ "${PIPESTATUS[0]}" -eq 0 ] || KUMA_FAILED=1
fi

# Config bundle, once a day (the 00:00 UTC run; CONFIG_BUNDLE_NOW=1 forces it): what a rebuild
# needs besides the dumps — every .env, the tunnel token, the crontab, the DB role passwords,
# rclone.conf, the compose files. Encrypted straight from tar to the club backup key (this server
# cannot decrypt it) and never written in plaintext, so it may travel with the dumps. Since
# 26.10.2026, when the vault's env mirrors were found stale. 14 days local, 60 days offsite.
CONFIG=""
CONFIG_FAILED=0
if [ "$(date -u +%H)" = 00 ] || [ "${CONFIG_BUNDLE_NOW:-}" = 1 ]; then
  CONFIG="$BACKUP_DIR/config_${DATE}.tar.gz.gpg"
  crontab -l > /root/crontab.current 2>/dev/null || true
  for f in opt/directus-kscw/.env opt/directus-kscw-dev/.env opt/wieplay-prod/.env opt/wieplay-prod/compose.yaml \
           opt/wieplay-dev/.env opt/wieplay-dev/compose.yaml opt/opnform/.env opt/opnform/compose.yaml opt/opnform/nginx \
           opt/clubdesk-sync/.env opt/vis-sync/vis.env etc/cloudflared root/kscw-db-roles \
           root/.config/rclone/rclone.conf root/crontab.current; do
    [ -e "/$f" ] && echo "$f"
  done | tar -C / -czf - -T - \
    | gpg --batch --yes --trust-model always --encrypt --recipient $GPG_RECIPIENT --output "$CONFIG"
  PS=("${PIPESTATUS[@]}")   # copy first: the next [ ] would reset PIPESTATUS
  [ "${PS[1]}" -eq 0 ] && [ "${PS[2]}" -eq 0 ] || CONFIG_FAILED=1
fi
find $BACKUP_DIR -name 'config_*.tar.gz.gpg' -mtime +14 -delete

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
leg R2 rclone copy "$BACKUP_DIR" "$R2_DIR" --include '*.sql.gz.gpg' --include 'config_*.tar.gz.gpg' 2>&1
rclone delete "$R2_DIR" --min-age 60d --include '*.sql.gz.gpg' --include 'config_*.tar.gz.gpg' 2>&1 || PRUNE_FAILED+=(R2)

# Swiss Backup (Infomaniak, sponsored with the server: 200 GB, one S3 slot) since 26.10.2026: a
# second club offsite copy of EVERY encrypted file here — dumps, the config bundle, the weekly
# uploads archives (backup-uploads.sh) and the finance archives (finance-archive-offsite.sh) —
# so a lost R2 token or account does not leave the club with only Luca's private NAS copy.
# Bucket `default` is the one Swiss Backup creates with the device. Until the `swissbackup`
# rclone remote exists on this server the leg reports "not configured" (not a failure).
# Retention as on R2: 60 days for dumps/config, 8 weeks for uploads archives; finance archives stay.
SB_DIR=swissbackup:default/kscw-server
if rclone listremotes 2>/dev/null | grep -qx 'swissbackup:'; then
  leg SwissBackup rclone copy "$BACKUP_DIR" "$SB_DIR" --include '*.sql.gz.gpg' --include 'config_*.tar.gz.gpg' \
    --include 'kscw_uploads_*.tar.gz.gpg' --include 'finance-archive/*.zip.gpg' 2>&1
  rclone delete "$SB_DIR" --min-age 60d --include '*.sql.gz.gpg' --include 'config_*.tar.gz.gpg' 2>&1 || PRUNE_FAILED+=(SwissBackup)
  rclone delete "$SB_DIR" --min-age 56d --include 'kscw_uploads_*.tar.gz.gpg' 2>&1 || PRUNE_FAILED+=(SwissBackup)
else
  OFFSITE+=("SwissBackup not configured")
fi

# NAS copy: since 16.10.2026 this server no longer pushes to Luca's NAS. The VPS belongs to
# the club's Hetzner account, so it must hold no key to his home network; his lenovoserver
# PULLS the encrypted files instead (kscw-backup-pull.timer there, 40 min after each run).

SUMMARY=$(IFS=,; echo "${OFFSITE[*]}" | sed 's/,/, /g')
[ ${#PRUNE_FAILED[@]} -gt 0 ] && SUMMARY="$SUMMARY; retention prune FAILED on ${PRUNE_FAILED[*]}"
[ "$WIEPLAY_FAILED" -eq 1 ] && SUMMARY="$SUMMARY; wieplay dump FAILED"
[ -n "$WIEPLAY" ] && [ "$WIEPLAY_FAILED" -eq 0 ] && SUMMARY="$SUMMARY; wieplay $(ls -lh "$WIEPLAY" | awk '{print $5}') plain"
[ "$CONFIG_FAILED" -eq 1 ] && SUMMARY="$SUMMARY; config bundle FAILED"
[ -n "$CONFIG" ] && [ "$CONFIG_FAILED" -eq 0 ] && SUMMARY="$SUMMARY; config $(ls -lh "$CONFIG" | awk '{print $5}') gpg"
[ "$OPNFORM_FAILED" -eq 1 ] && SUMMARY="$SUMMARY; opnform dump FAILED"
[ -n "$OPNFORM" ] && [ "$OPNFORM_FAILED" -eq 0 ] && SUMMARY="$SUMMARY; opnform $(ls -lh "$OPNFORM" | awk '{print $5}') plain"
[ "$KUMA_FAILED" -eq 1 ] && SUMMARY="$SUMMARY; kuma dump FAILED"
[ -n "$KUMA" ] && [ "$KUMA_FAILED" -eq 0 ] && SUMMARY="$SUMMARY; kuma $(ls -lh "$KUMA" | awk '{print $5}') plain"
case "$SUMMARY" in *FAILED*) RESULT="Backup INCOMPLETE" ;; *) RESULT="Backup complete" ;; esac
echo "$(date): $RESULT - $(ls -lh $PLAIN | awk '{print $5}') plain / $(ls -lh $PLAIN.gpg | awk '{print $5}') gpg - offsite (all gpg): $SUMMARY" >> /data/backups/backup.log
