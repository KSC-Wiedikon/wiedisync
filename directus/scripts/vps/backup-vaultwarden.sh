#!/bin/bash
# Vaultwarden backup — snapshot the LIVE database and keep three copies.
#
# ⚠ HISTORY (fixed 11.08.2026): this script used to snapshot
#   NAS:/volume1/docker/vaultwarden/db.sqlite3
# but Vaultwarden was moved to lenovoserver around 31.05.2026 and the NAS copy was
# abandoned. For 73 days the cron faithfully backed up a dead file: the NAS DB held
# 153 ciphers with a newest timestamp of 2026-05-30, while the live DB held 185.
# 32 credentials — including every secret created during the Cloudflare migration —
# existed in exactly one place. The job reported success the whole time.
#
# THE SOURCE OF TRUTH IS lenovoserver:/home/lucanepa/vaultwarden/data/db.sqlite3
# If Vaultwarden ever moves again, change LIVE_HOST/LIVE_DB here in the same commit.
#
# The live DB runs in WAL mode, so a plain cp/scp yields a torn file. Use SQLite's
# online backup API. sqlite3(1) is NOT installed on lenovoserver — python3's stdlib
# sqlite3 module exposes the same API, so use that.
set -euo pipefail

BACKUP_DIR=/data/backups/vaultwarden
LIVE_USER=lucanepa
LIVE_HOST=100.76.39.66                                   # lenovoserver (Tailscale)
LIVE_DB=/home/lucanepa/vaultwarden/data/db.sqlite3
NAS_USER=lucanepa
NAS_HOST=100.64.212.125
NAS_PATH=/volume1/docker/vaultwarden/backups
SSH_KEY=/root/.ssh/id_ed25519
SSH="ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no"

DATE=$(date +%Y-%m-%d_%H%M)
SNAP="db-${DATE}.sqlite3"
REMOTE_TMP="/tmp/${SNAP}"
mkdir -p "${BACKUP_DIR}"

# Reading the snapshot with sqlite creates -shm/-wal sidecars. Clean them on EVERY exit
# path — the failure branches used to leak them into the backup directory.
trap 'rm -f "${BACKUP_DIR}/${SNAP}"-shm "${BACKUP_DIR}/${SNAP}"-wal' EXIT

# 1) Consistent snapshot on the live host (WAL-safe online backup API)
${SSH} "${LIVE_USER}@${LIVE_HOST}" "python3 - <<'EOF'
import sqlite3
src = sqlite3.connect('file:${LIVE_DB}?mode=ro', uri=True)
dst = sqlite3.connect('${REMOTE_TMP}')
src.backup(dst)
dst.close(); src.close()
EOF"

# 2) Pull to this host, then verify BEFORE discarding the remote copy
scp -O -i "${SSH_KEY}" -o StrictHostKeyChecking=no \
  "${LIVE_USER}@${LIVE_HOST}:${REMOTE_TMP}" "${BACKUP_DIR}/${SNAP}"

# 3) Integrity + freshness gate. A backup that restores to a stale or corrupt DB is
#    worse than none, because it reports success. Fail loudly instead.
COUNT=$(python3 - <<EOF
import sqlite3, sys
c = sqlite3.connect('file:${BACKUP_DIR}/${SNAP}?mode=ro', uri=True)
if c.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
    print('CORRUPT', file=sys.stderr); sys.exit(1)
print(c.execute('SELECT COUNT(*) FROM ciphers').fetchone()[0])
EOF
)
# 3b) Freshness gate. The count gate above catches corruption and truncation, but NOT
#     the failure that actually happened: a stale-but-plausible source (the abandoned NAS
#     copy held 153 ciphers — well over any floor — frozen on 2026-05-30). The only
#     unambiguous signal is that the newest entry went BACKWARDS versus the last good
#     backup. Equal is fine (an idle vault is normal); older never is.
STATE=/data/backups/vaultwarden/.last-newest
NEWEST=$(python3 -c "
import sqlite3
c = sqlite3.connect('file:${BACKUP_DIR}/${SNAP}?mode=ro', uri=True)
print(c.execute('SELECT MAX(updated_at) FROM ciphers').fetchone()[0] or '')
")
if [ -f "${STATE}" ] && [ -n "${NEWEST}" ]; then
  PREV=$(cat "${STATE}")
  if [ "$(printf '%s\n%s\n' "${PREV}" "${NEWEST}" | sort | tail -1)" != "${NEWEST}" ]; then
    echo "$(date): Vaultwarden backup FAILED - newest entry went BACKWARDS (${PREV} -> ${NEWEST}). Source likely moved; check LIVE_HOST/LIVE_DB." >> /data/backups/backup.log
    rm -f "${BACKUP_DIR}/${SNAP}"
    exit 1
  fi
fi

if [ -z "${COUNT}" ] || [ "${COUNT}" -lt 100 ]; then
  echo "$(date): Vaultwarden backup FAILED — only '${COUNT}' ciphers, refusing" >> /data/backups/backup.log
  rm -f "${BACKUP_DIR}/${SNAP}"
  exit 1
fi

rm -f "${BACKUP_DIR}/${SNAP}"-shm "${BACKUP_DIR}/${SNAP}"-wal
${SSH} "${LIVE_USER}@${LIVE_HOST}" "rm -f ${REMOTE_TMP}"
[ -n "${NEWEST}" ] && printf '%s' "${NEWEST}" > "${STATE}"
gzip -f "${BACKUP_DIR}/${SNAP}"
find "${BACKUP_DIR}" -name "db-*.sqlite3.gz" -mtime +30 -delete

# 4) Mirror to the NAS (third copy; the NAS no longer runs Vaultwarden, it is storage now)
${SSH} "${NAS_USER}@${NAS_HOST}" "mkdir -p ${NAS_PATH}"
scp -O -i "${SSH_KEY}" -o StrictHostKeyChecking=no \
  "${BACKUP_DIR}/${SNAP}.gz" "${NAS_USER}@${NAS_HOST}:${NAS_PATH}/"
${SSH} "${NAS_USER}@${NAS_HOST}" \
  "find ${NAS_PATH} -name 'db-*.sqlite3.gz' -mtime +30 -delete"

# 5) OFFSITE. lenovoserver (live) and the NAS are BOTH in the same building — a house
#    fire takes out two of three copies, and this VPS is the only survivor. Worse, the
#    GPG key that decrypts every KSCW database backup on Drive/R2 lives in this vault,
#    so losing it turns 25 GB of offsite KSCW backups into permanently unopenable
#    ciphertext. Push to two independent clouds so the vault outlives any one site.
#
#    Deliberately NOT gpg-encrypted: the GPG passphrase is stored IN this vault, so
#    encrypting with it would be circular and unrecoverable. Vaultwarden ciphers are
#    already encrypted client-side — the file is useless without the master password
#    (safe-sheet secret #1), which is the intended protection.
for REMOTE in gdrive:Backups/vaultwarden r2:kscw-db-backups/vaultwarden; do
  if rclone copy "${BACKUP_DIR}/${SNAP}.gz" "${REMOTE}/" 2>/dev/null; then
    echo "$(date): Vaultwarden offsite OK - ${REMOTE}" >> /data/backups/backup.log
  else
    echo "$(date): Vaultwarden offsite FAILED - ${REMOTE}" >> /data/backups/backup.log
  fi
done

SIZE=$(ls -lh "${BACKUP_DIR}/${SNAP}.gz" | awk '{print $5}')
echo "$(date): Vaultwarden backup OK - ${SIZE} - ${COUNT} ciphers - VPS + NAS (live on lenovoserver)" >> /data/backups/backup.log
