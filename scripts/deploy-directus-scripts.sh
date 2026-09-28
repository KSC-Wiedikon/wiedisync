#!/usr/bin/env bash
#
# deploy-directus-scripts.sh <dev|prod> — the body of `npm run scripts:deploy:*`:
# rsync directus/scripts/ into the Directus bind-mount on the VPS
# (/opt/directus-kscw{,-dev}/scripts/).
#
# Two passes on the VPS side, unchanged from the old inline npm script:
#   1. --delete restricted to numbered migrations (NNN-*), so a migration
#      removed from the repo also leaves the server, but runtime state the
#      scripts keep next to themselves is never swept;
#   2. a plain copy of everything else.
#
# Why this is a script now (audit 2026-09-28, F72). The inline version staged
# through a FIXED, pre-existing /tmp/kscw-scripts (uid 1000, mode 775) that root
# then copied from — and these files include refresh-dev-daily.sh, which root's
# crontab runs nightly. Whoever could write into that directory between the two
# rsyncs could plant code root later executes. The staging directory is now a
# fresh `mktemp -d` (0700, unpredictable name) created per run and removed on
# every exit path.
#
# The DESTINATION is the other half (same finding, second review). The
# bind-mount directory is owned by uid 1000 and mounted read-write into the
# Directus container, whose process runs as uid 1000 — so whoever gets code
# execution in an internet-facing Directus can rewrite any file there. Root
# must never execute from it. The files root's crontab runs are therefore
# ALSO installed, root:root and closed to everyone else, into
#   /opt/kscw-root/<env>/
# and the crontab points there (INFRA.md → root crontab). The bind-mount copy
# stays for the container and for humans reading the VPS; it is not what runs.
# Add a file to ROOT_RUN when a new root cron starts executing it.
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  # ROOT_RUN: "<file>:<mode>" — executables 0700, data 0600.
  dev)  DEST=/opt/directus-kscw-dev/scripts/
        ROOT_RUN="refresh-dev-daily.sh:0700 refresh-dev-scrub.sql:0600" ;;
  prod) DEST=/opt/directus-kscw/scripts/
        ROOT_RUN="postgres-autopatch.sh:0700 svrz-sync-verify.mjs:0600" ;;
  *) echo "usage: scripts/deploy-directus-scripts.sh <dev|prod>" >&2; exit 1 ;;
esac
SSH_HOST=hetzner

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

STAGE="$(ssh "$SSH_HOST" 'umask 077 && mktemp -d /tmp/kscw-scripts.XXXXXXXX')"
case "$STAGE" in
  /tmp/kscw-scripts.*) ;;
  *) echo "✗ could not create a staging dir on $SSH_HOST (got '$STAGE')" >&2; exit 1 ;;
esac
cleanup() { ssh "$SSH_HOST" "rm -rf -- '$STAGE'" || true; }
trap cleanup EXIT

# Stage into a SUBdirectory: rsync applies the source directory's own mode to
# the destination root, so syncing straight into $STAGE would re-open it to
# 775. The 0700 parent keeps the tree private while it waits for the root copy.
rsync -avz --delete directus/scripts/ "$SSH_HOST:$STAGE/s/"
ssh "$SSH_HOST" "sudo rsync -a --delete --include='[0-9][0-9][0-9]-*' --exclude='*' '$STAGE/s/' '$DEST' && sudo rsync -a '$STAGE/s/' '$DEST'"

ROOT_DIR=/opt/kscw-root/$TARGET
install_cmd="sudo install -d -o root -g root -m 0700 /opt/kscw-root '$ROOT_DIR'"
for entry in $ROOT_RUN; do
  f=${entry%%:*}; mode=${entry##*:}
  [ -s "directus/scripts/$f" ] || { echo "✗ root-run file directus/scripts/$f missing" >&2; exit 1; }
  install_cmd+=" && sudo install -o root -g root -m $mode '$STAGE/s/$f' '$ROOT_DIR/$f'"
done
ssh "$SSH_HOST" "$install_cmd"

echo "✓ directus/scripts/ → $SSH_HOST:$DEST"
echo "✓ root-run copies → $SSH_HOST:$ROOT_DIR ($ROOT_RUN)"
