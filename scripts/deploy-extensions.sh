#!/usr/bin/env bash
#
# deploy-extensions.sh <dev|prod> — ship directus/extensions/ from a COMMITTED
# ref, never from the working tree.
#
# Why this exists. `ext:deploy:*` used to rsync `directus/extensions/` straight
# off the working tree. This repo is edited by two actors at once, so whatever
# uncommitted work happened to be sitting in that directory shipped too —
# silently, to whichever environment you named. On 2026-07-16 that put an
# unfinished announcements fanout on PROD (its permission gate wasn't deployed
# yet, so a targeted post would have emailed members while the link 404'd), and
# later the same day nearly shipped an in-progress scorer-exam feature the same
# way. Both were caught by luck, not by the pipeline.
#
# A deploy should ship what a branch SAYS is deployed. So this resolves a git
# ref, exports it to a scratch dir, installs its deps there, and rsyncs THAT.
# The working tree is only ever read by git, never copied.
#
# Usage:
#   scripts/deploy-extensions.sh dev
#   scripts/deploy-extensions.sh prod
#   EXT_DEPLOY_REF=my-branch scripts/deploy-extensions.sh dev
#
# EXT_DEPLOY_REF overrides the ref (default: origin/dev | origin/prod). It must
# still be a COMMIT — to test uncommitted work on dev, commit it first (cheap on
# dev, and it is what makes the deploy reproducible). There is deliberately no
# flag to deploy a dirty tree: that is the bug this script exists to remove.

set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  dev)
    REF="${EXT_DEPLOY_REF:-origin/dev}"
    DEST="/opt/directus-kscw-dev/extensions/"
    CONTAINER="directus-kscw-dev"
    SMOKE_URL="https://directus-dev.kscw.ch/kscw/public/teams"
    ;;
  prod)
    REF="${EXT_DEPLOY_REF:-origin/prod}"
    DEST="/opt/directus-kscw/extensions/"
    CONTAINER="directus-kscw"
    SMOKE_URL="https://directus.kscw.ch/kscw/public/teams"
    ;;
  *)
    echo "usage: scripts/deploy-extensions.sh <dev|prod>" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Refuse a ref we can't name a commit for, rather than silently deploying
# something surprising.
git fetch -q origin 2>/dev/null || true
if ! SHA="$(git rev-parse --verify --quiet "${REF}^{commit}")"; then
  echo "✗ EXT_DEPLOY_REF '${REF}' is not a commit" >&2
  exit 1
fi

echo "▸ Deploying extensions to ${TARGET}"
echo "  ref:    ${REF} (${SHA:0:8}) — $(git log -1 --format=%s "$SHA")"

# Tell the operator exactly what is NOT shipping. This is the whole point: the
# WIP stays put, and they find that out here rather than from production.
WIP="$(git status --porcelain -- directus/extensions/ || true)"
if [ -n "$WIP" ]; then
  echo "  ⚠ Uncommitted work in directus/extensions/ — NOT deployed (${REF} is):"
  echo "$WIP" | sed 's/^/      /'
fi

TMP="$(mktemp -d -t kscw-ext-XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# git archive reads the object store, never the working tree.
git archive "$SHA" directus/extensions | tar -x -C "$TMP"
SRC="$TMP/directus/extensions"
[ -d "$SRC/kscw-endpoints" ] || { echo "✗ ${REF} has no directus/extensions/kscw-endpoints" >&2; exit 1; }

# Deps must be installed into the exported tree — node_modules is not in git, and
# restarting Directus with an incomplete extension node_modules takes down every
# /kscw/* route.
echo "  deps:   npm ci"
npm --prefix "$SRC/kscw-endpoints" ci --silent

echo "  rsync:  → ${CONTAINER}:${DEST}"
rsync -az --delete "$SRC/" "hetzner:/tmp/kscw-extensions-${TARGET}/"
ssh hetzner "sudo rsync -a --delete /tmp/kscw-extensions-${TARGET}/ ${DEST} && sudo docker restart ${CONTAINER}" >/dev/null

echo "  smoke:  ${SMOKE_URL}"
curl -fsS --retry 12 --retry-delay 3 --retry-all-errors "$SMOKE_URL" -o /dev/null
echo "✓ kscw-endpoints responding (${TARGET}) — deployed ${SHA:0:8}"
