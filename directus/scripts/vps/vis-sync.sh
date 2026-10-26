#!/usr/bin/env bash
# FIVB VIS sync, root cron 15 5 * * * (INFRA.md → root crontab):
#   15 5 * * * /usr/local/bin/vis-sync.sh >> /opt/vis-sync/last-run.log 2>&1
# Installed into /usr/local/bin by `npm run backup:deploy-scripts` like the other host scripts.
#
# Credentials live in /opt/vis-sync/vis.env (0600, root) rather than in the vault because the
# VPS has no rbw.
#
# Until 26.10.2026 this file existed only on the VPS (/opt/vis-sync/vis-sync.sh) and ran
# `node` from /opt/directus-kscw/scripts: the rw bind mount of the internet-facing Directus
# container, which F72 forbids root to execute from. It now runs root's own copies in
# /opt/kscw-root/prod/ (installed root:root 0600 by `npm run scripts:deploy:prod`, ROOT_RUN).
# Both .mjs files use node built-ins only, so they run from there without node_modules.
set -euo pipefail
source /opt/vis-sync/vis.env
export KSCW_LOCAL_PSQL=1
cd /opt/kscw-root/prod
echo "=== vis-sync $(date -Is) ==="
node vis-transfer-sync.mjs prod
# Player-presence check: MONDAYS (date +%u = 1). Was the 1st of the month until
# 2026-08-05, on the stated grounds that "30 federation rosters is a heavy read".
# Measured that day on both envs: 24 federations, 464 members, ~3.6-3.8s end to
# end. It is not heavy, and a monthly cadence meant /admin/transfers showed a
# frozen answer for 30 days of every 31. Admins can also run it on demand now —
# POST /kscw/admin/vis-player-check, the "Check VIS now" button on that page.
if [ "$(date +%u)" = "1" ]; then node vis-player-check.mjs prod; fi
