#!/usr/bin/env bash
#
# r2-cutover.sh — move Directus file storage from the local disk to Cloudflare R2.
#
#   npm run r2:cutover:dev     # dev first, always
#   npm run r2:cutover:prod    # then prod (recreates the container — brief downtime)
#   npm run r2:cutover:prod -- --dry-run
#
# WHY R2: uploads currently sit as plain files on the VPS (/opt/directus-kscw/uploads),
# including members' scanned ID documents (registrations.id_upload_front/back) and
# basketball licence docs. R2 encrypts objects at rest unconditionally and moves them
# off the box. Directus stays the only door — permissions are unchanged.
#
# PREREQUISITE, already done (2026-07-13):
#   - expense-upload.js / registration.js read bytes via storage-read.js (AssetsService),
#     NOT off the local disk. Without that, this cutover 500s the expense OCR, the expense
#     receipt download, and the member ID-doc self-view. See commit 2a1e1608.
#
# ─────────────────────────────────────────────────────────────────────────────────────
# THE BUCKET MUST STAY PRIVATE. If anyone ever enables an r2.dev public URL or a public
# custom domain on kscw-uploads, every ID scan becomes fetchable by object key
# (filename_disk is just <uuid>.<ext>), bypassing the entire Directus folder-permission
# model. Serve exclusively through Directus /assets.
# ─────────────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENV_NAME="${1:-}"
DRY_RUN=false
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY_RUN=true; done
[ "$ENV_NAME" = "dev" ] || [ "$ENV_NAME" = "prod" ] || {
  echo "usage: r2-cutover.sh <dev|prod> [--dry-run]"; exit 2; }

if [ "$ENV_NAME" = "prod" ]; then
  CONTAINER=directus-kscw; ENV_DIR=/opt/directus-kscw; DB=postgres;             BUCKET=kscw-uploads
else
  CONTAINER=directus-kscw-dev; ENV_DIR=/opt/directus-kscw-dev; DB=directus_kscw_dev; BUCKET=kscw-uploads-dev
fi

ACCOUNT_ID=e67fa2518fc606b016f58037d006d0fb
ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
BACKUP_BUCKET=kscw-db-backups   # the token must NOT be able to reach this

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# ── credentials: Vaultwarden by default; env override for a one-off run ─────────────
# The vault is the canonical home. R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY exist so a
# freshly-issued token can be used before it has been filed, without ever writing it to
# rclone.conf or a shell rc. Add it to the vault straight after.
AKID="${R2_ACCESS_KEY_ID:-}"
SECRET="${R2_SECRET_ACCESS_KEY:-}"

if [ -z "$AKID" ] || [ -z "$SECRET" ]; then
  command -v rbw >/dev/null || { echo "rbw not installed and no R2_* env override"; exit 2; }
  rbw unlocked 2>/dev/null || { echo "rbw is locked — run: rbw unlock"; exit 2; }
  AKID=$(rbw get --field username "Cloudflare R2 - kscw-directus-uploads" --folder services/cloudflare 2>/dev/null || true)
  SECRET=$(rbw get             "Cloudflare R2 - kscw-directus-uploads" --folder services/cloudflare 2>/dev/null || true)
fi
[ -n "$AKID" ] && [ -n "$SECRET" ] || {
  echo "No R2 credentials. Either export R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY,"
  echo "or add vault entry 'Cloudflare R2 - kscw-directus-uploads' (services/cloudflare)"
  echo "with username = Access Key ID, password = Secret Access Key."
  exit 2; }

r2() {  # run rclone on the VPS with these creds passed as env only (never written to rclone.conf)
  ssh -n hetzner "sudo env \
    RCLONE_CONFIG_X_TYPE=s3 RCLONE_CONFIG_X_PROVIDER=Cloudflare \
    RCLONE_CONFIG_X_ACCESS_KEY_ID='$AKID' RCLONE_CONFIG_X_SECRET_ACCESS_KEY='$SECRET' \
    RCLONE_CONFIG_X_REGION=auto RCLONE_CONFIG_X_ENDPOINT='$ENDPOINT' \
    rclone $1" 2>/dev/null
}

# ── HARD GATE: least privilege. A token that can reach the backup bucket must never ──
# ── be handed to an internet-facing Directus: a compromise would let an attacker    ──
# ── delete every offsite backup. This check is the reason the script exists.        ──
say "Verifying the token is scoped to the uploads buckets ONLY"
if r2 "lsd x:${BACKUP_BUCKET}" >/dev/null 2>&1 || r2 "ls x:${BACKUP_BUCKET} --max-depth 1" >/dev/null 2>&1; then
  cat <<EOF

  ABORT — this token can reach '${BACKUP_BUCKET}'.

  It is too broad. Recreate it in Cloudflare with:
      Permission : Object Read & Write
      Buckets    : SPECIFY kscw-uploads and kscw-uploads-dev ONLY
                   (not "Apply to all buckets")

  Handing this credential to Directus would mean a Directus compromise could
  destroy every backup you have.
EOF
  exit 1
fi
echo "    cannot reach ${BACKUP_BUCKET}  ✓"
r2 "size x:${BUCKET}" | sed 's/^/    /'

# ── 1. sync any objects added since the initial copy ─────────────────────────────────
say "Syncing uploads -> r2:${BUCKET} (skipping regenerable __<hash> derivatives)"
$DRY_RUN && DRY="--dry-run" || DRY=""
r2 "copy ${ENV_DIR}/uploads x:${BUCKET} --exclude '*__*' --transfers 8 $DRY --stats-one-line" | tail -2 | sed 's/^/    /'

# ── 2. verify every DB row has its object, at the right size, BEFORE flipping ────────
#
# STRICT on prod, ADVISORY on dev — and that asymmetry is deliberate.
#
# Dev's `directus_files` is a nightly CLONE of prod's rows, but the refresh copies the
# DATABASE only, never /directus/uploads (INFRA.md → Dev DB refresh). So on dev, almost
# every row points at a prod object that dev has never had — that is why some dev images
# 404 today, and it is expected.
#
# The fix is NOT to copy prod's objects into the dev bucket. Those include members'
# scanned ID documents (registrations.id_upload_front/back). Dev is PII-scrubbed for
# exactly this reason; shipping real ID scans there would be a privacy regression. The
# 404s are a feature. So dev proceeds with a warning and prod refuses to flip.
say "Verifying every directus_files row exists in the bucket"
# Fetch the bucket listing ONCE (name + size), then check each row against it.
# NOT `rclone lsf <path>` per file: lsf on a missing object exits 0 with empty output,
# so a per-file existence test on its exit status silently passes for EVERY file. That
# false-green waved a broken dev migration straight through on 2026-07-13.
r2 "lsl x:${BUCKET}" 2>/dev/null | awk '{ $2=""; $3=""; sub(/^ +/,""); print }' > /tmp/r2-listing.$$
r2 "lsl x:${BUCKET}" 2>/dev/null | awk '{print $NF}' | sort > /tmp/r2-names.$$
echo "    objects in bucket: $(wc -l < /tmp/r2-names.$$)"

MISSING=0
while read -r sz name; do
  [ -z "$name" ] && continue
  grep -qxF "$name" /tmp/r2-names.$$ || { MISSING=$((MISSING+1)); [ "$MISSING" -le 5 ] && echo "    missing: $name"; }
done < <(ssh hetzner "sudo docker exec kscw-postgres psql -U supabase_admin -d ${DB} -tAc \
  \"SELECT filesize||chr(32)||filename_disk FROM directus_files WHERE filename_disk IS NOT NULL;\"" 2>/dev/null)
rm -f /tmp/r2-listing.$$ /tmp/r2-names.$$

if [ "$MISSING" -eq 0 ]; then
  echo "    all rows accounted for  ✓"
elif [ "$ENV_NAME" = "prod" ]; then
  echo "    ABORT: ${MISSING} file(s) in directus_files have no object in r2:${BUCKET}."
  echo "           Not flipping — prod assets would 404. Re-run the sync and try again."
  exit 1
else
  cat <<EOF
    ${MISSING} row(s) have no object in r2:${BUCKET} — EXPECTED on dev, continuing.
    Dev's directus_files is a clone of prod's rows, but the nightly refresh copies the
    DB only, never the uploads. Those files 404 on dev today and will keep 404ing.
    That is intentional: copying prod's objects here would put real member ID scans on
    dev, which is PII-scrubbed precisely to avoid that.
EOF
fi

$DRY_RUN && { echo; echo "DRY RUN — stopping before any change to ${ENV_NAME}."; exit 0; }

# ── 3. env: add the r2 location, keep local defined for rollback ─────────────────────
# STORAGE_LOCATIONS order matters — the FIRST location is where new uploads go.
# Keeping `local` defined means any row still saying storage='local' still resolves.
say "Updating ${ENV_DIR}/.env"
ssh -n hetzner "sudo bash -c '
  cp ${ENV_DIR}/.env ${ENV_DIR}/.env.pre-r2-\$(date +%Y%m%d-%H%M%S)
  chmod 0600 ${ENV_DIR}/.env.pre-r2-*
  sed -i \"/^STORAGE_/d\" ${ENV_DIR}/.env
  cat >> ${ENV_DIR}/.env <<EOF
STORAGE_LOCATIONS=r2,local
STORAGE_LOCAL_DRIVER=local
STORAGE_LOCAL_ROOT=/directus/uploads
STORAGE_R2_DRIVER=s3
STORAGE_R2_KEY=${AKID}
STORAGE_R2_SECRET=${SECRET}
STORAGE_R2_BUCKET=${BUCKET}
STORAGE_R2_REGION=auto
STORAGE_R2_ENDPOINT=${ENDPOINT}
STORAGE_R2_FORCE_PATH_STYLE=true
EOF
  chmod 0600 ${ENV_DIR}/.env
'" 2>/dev/null
echo "    written (previous .env backed up alongside, mode 0600)"
echo "    NOTE: do not set STORAGE_R2_ACL or STORAGE_R2_SERVER_SIDE_ENCRYPTION —"
echo "          R2 rejects both. Encryption at rest is automatic and unconditional."

# ── 4. recreate the container (env-file changes need stop/rm/run, not restart) ───────
# docker restart does NOT re-read an --env-file, so this must be a full recreate.
# Canonical run line: INFRA.md → Hetzner VPS Management. Brief downtime.
if [ "$ENV_NAME" = "prod" ]; then
  PORT=8055; IMG=directus/directus:12.1.1
else
  PORT=8056; IMG=directus/directus:12.1.1
fi
say "Recreating ${CONTAINER} — BRIEF DOWNTIME (env-file changes need a full recreate)"
# NOTE: no `-n` on this ssh. `ssh -n` redirects stdin from /dev/null, which would eat the
# heredoc below — `bash -s` then reads nothing, exits 0, and the container is NEVER
# recreated. The script would sail on to flip directus_files to storage='r2' against a
# container that has no r2 location configured, 500ing every asset. That happened on dev
# on 2026-07-13. Every OTHER ssh in this script keeps -n (they must not eat the loop's stdin).
ssh hetzner "sudo bash -s" <<EOF
set -e
docker stop ${CONTAINER} && docker rm ${CONTAINER}
docker run -d \
  --name ${CONTAINER} --restart unless-stopped --network coolify \
  --env-file ${ENV_DIR}/.env -p ${PORT}:8055 \
  -v ${ENV_DIR}/extensions:/directus/extensions \
  -v ${ENV_DIR}/templates:/directus/templates \
  -v ${ENV_DIR}/uploads:/directus/uploads \
  -v ${ENV_DIR}/logs:/directus/logs \
  -v ${ENV_DIR}/scripts:/directus/scripts \
  ${IMG}
for i in \$(seq 1 30); do
  sleep 2
  curl -fsS http://127.0.0.1:${PORT}/server/ping >/dev/null 2>&1 && { echo "    ${CONTAINER} back up"; exit 0; }
done
echo "    !! ${CONTAINER} did NOT come back within 60s — check: docker logs ${CONTAINER}"
exit 1
EOF

# ── 5. flip the rows ────────────────────────────────────────────────────────────────
say "Pointing directus_files at r2"
ssh -n hetzner "sudo docker exec kscw-postgres psql -U supabase_admin -d ${DB} -c \
  \"UPDATE directus_files SET storage='r2' WHERE storage='local';\"" 2>/dev/null | sed 's/^/    /'

# ── 6. prove it actually serves ─────────────────────────────────────────────────────
say "Verifying assets serve from R2"
[ "$ENV_NAME" = "prod" ] && BASE=https://directus.kscw.ch || BASE=https://directus-dev.kscw.ch
FID=$(ssh -n hetzner "sudo docker exec kscw-postgres psql -U supabase_admin -d ${DB} -tAc \
  \"SELECT id FROM directus_files WHERE folder IS NULL AND type LIKE 'image/%' LIMIT 1;\"" 2>/dev/null | tr -d '[:space:]')
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/assets/${FID}")
echo "    GET ${BASE}/assets/${FID} -> HTTP ${CODE}"
[ "$CODE" = "200" ] || { echo "    !! assets not serving — ROLL BACK: UPDATE directus_files SET storage='local';"; exit 1; }
echo "    ✓ serving from R2"

cat <<EOF

Done (${ENV_NAME}).

  Rollback (local files are still on disk, untouched):
      docker exec kscw-postgres psql -U supabase_admin -d ${DB} \\
        -c "UPDATE directus_files SET storage='local';"
      restore ${ENV_DIR}/.env.pre-r2-* and recreate the container

  Keep ${ENV_DIR}/uploads on disk until you are satisfied. Only then delete it,
  and update INFRA.md's rebuild inputs — the bucket becomes the source of truth,
  so enable R2 versioning or a lifecycle policy on it.
EOF
