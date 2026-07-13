#!/bin/bash
# Pull Vaultwarden SQLite snapshot from NAS, store on Hetzner VPS, mirror to Lenovo.
# Live DB has active WAL writes — must use sqlite3 .backup (online backup API), never plain cp.
# Triple redundancy: NAS (live) + Hetzner VPS (canonical history) + Lenovo (offsite peer).
set -euo pipefail
BACKUP_DIR=/data/backups/vaultwarden
NAS_USER=lucanepa
NAS_HOST=100.64.212.125
LENOVO_USER=lucanepa
LENOVO_HOST=100.76.39.66
LENOVO_PATH=/home/lucanepa/backups/vaultwarden
SSH_KEY=/root/.ssh/id_ed25519
DATE=$(date +%Y-%m-%d_%H%M)
SNAP="db-${DATE}.sqlite3"
NAS_TMP="/tmp/${SNAP}"

mkdir -p "${BACKUP_DIR}"

# 1) Consistent snapshot to /tmp on NAS (online backup API — WAL-safe)
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_HOST}" \
  "sqlite3 /volume1/docker/vaultwarden/db.sqlite3 \".backup ${NAS_TMP}\""

# 2) Pull to VPS, gzip
scp -O -i "$SSH_KEY" -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_HOST}:${NAS_TMP}" "${BACKUP_DIR}/${SNAP}"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${NAS_USER}@${NAS_HOST}" "rm -f ${NAS_TMP}"
gzip -f "${BACKUP_DIR}/${SNAP}"
find "${BACKUP_DIR}" -name "db-*.sqlite3.gz" -mtime +30 -delete

# 3) Mirror to Lenovo (Tailnet peer) for triple redundancy
scp -O -i "$SSH_KEY" -o StrictHostKeyChecking=no "${BACKUP_DIR}/${SNAP}.gz" "${LENOVO_USER}@${LENOVO_HOST}:${LENOVO_PATH}/"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${LENOVO_USER}@${LENOVO_HOST}" \
  "find ${LENOVO_PATH} -name \"db-*.sqlite3.gz\" -mtime +30 -delete"

SIZE=$(ls -lh "${BACKUP_DIR}/${SNAP}.gz" | awk "{print \$5}")
echo "$(date): Vaultwarden backup - ${SIZE} - VPS + Lenovo (NAS keeps live)" >> /data/backups/backup.log
