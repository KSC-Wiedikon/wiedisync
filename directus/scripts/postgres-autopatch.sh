#!/usr/bin/env bash
# postgres-autopatch.sh — auto-apply postgres:16 PATCH releases to the `kscw-postgres`
# container (the Directus DB for BOTH prod and dev).
#
# SAFE BY DESIGN: the container is pinned to the `postgres:16` tag, so this only ever
# moves within major 16 (16.x -> 16.y) = data-dir compatible, no pg_upgrade needed.
# A jump to Postgres 17 is a DELIBERATE MANUAL migration and is explicitly refused here.
#
# Flow: pull :16 -> if the Postgres X.Y version actually changed -> pg_dump backup ->
# recreate the container on the new image (same volume/net/name) -> restart Directus
# (clean pool reconnect) -> health-check prod+dev. If nothing changed it's a cheap no-op
# (pull + compare, ZERO downtime). If the post-patch health check fails it logs loudly
# and exits non-zero (uptime-kuma also independently alerts on the Directus endpoints).
#
# Registered as a weekly root cron (Sun 04:00 UTC). Deployed to the host via
# `npm run scripts:deploy:prod`. Canonical source: repo directus/scripts/postgres-autopatch.sh
set -uo pipefail

CONT=kscw-postgres
VOL=kscw-postgres-data
ENVF=/opt/directus-kscw/.env
BK=/root/pgbackup-autopatch
KEEP=5

log(){ echo "[$(date -u '+%F %T')] $*"; }
running_ver(){ docker exec "$CONT" psql -U postgres -tAc "show server_version" 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+'; }

log "=== postgres-autopatch check ==="
OLD=$(running_ver)
[ -z "$OLD" ] && { log "ERROR: cannot read running Postgres version — aborting"; exit 1; }

docker pull postgres:16 >/dev/null 2>&1 || { log "ERROR: docker pull postgres:16 failed"; exit 1; }
NEW=$(docker run --rm postgres:16 postgres --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)
[ -z "$NEW" ] && { log "ERROR: cannot read pulled Postgres version — aborting"; exit 1; }

if [ "$OLD" = "$NEW" ]; then
  log "up to date (Postgres $OLD) — no-op"
  exit 0
fi

# Never auto-cross a major version (16 -> 17 requires manual pg_upgrade / dump+restore).
if [ "${OLD%%.*}" != "${NEW%%.*}" ]; then
  log "REFUSING: major change $OLD -> $NEW is not an auto-patch (needs manual migration). No action taken."
  exit 1
fi

log "patch available: Postgres $OLD -> $NEW ; backing up then recreating"
PGPW=$(grep -E '^DB_PASSWORD=' "$ENVF" | cut -d= -f2- | tr -d '"'"'"'"')

mkdir -p "$BK"; TS=$(date -u '+%Y%m%d-%H%M%S')
docker exec "$CONT" pg_dump -Fc -U supabase_admin -d postgres         > "$BK/postgres_$TS.dump" || { log "ERROR: prod backup failed — aborting (no changes made)"; exit 1; }
docker exec "$CONT" pg_dump -Fc -U supabase_admin -d directus_kscw_dev > "$BK/dev_$TS.dump"      || { log "ERROR: dev backup failed — aborting (no changes made)"; exit 1; }
ls -1t "$BK"/postgres_*.dump 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
ls -1t "$BK"/dev_*.dump      2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
log "backup ok: $BK/{postgres,dev}_$TS.dump"

docker stop "$CONT" >/dev/null 2>&1
docker rm   "$CONT" >/dev/null 2>&1
docker run -d --name "$CONT" --restart unless-stopped --network coolify \
  -e POSTGRES_PASSWORD="$PGPW" -v "$VOL":/var/lib/postgresql/data postgres:16 >/dev/null
for i in $(seq 1 30); do docker exec "$CONT" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done

# Directus pools hold connections to the old container instance — restart for a clean reconnect.
docker restart directus-kscw directus-kscw-dev >/dev/null 2>&1
sleep 10

OK=1
docker exec "$CONT" psql -U postgres -d postgres -tAc "select 1" >/dev/null 2>&1 || OK=0
curl -fsS --retry 15 --retry-delay 3 --retry-all-errors https://directus.kscw.ch/kscw/public/teams     -o /dev/null 2>/dev/null || OK=0
curl -fsS --retry 8  --retry-delay 3 --retry-all-errors https://directus-dev.kscw.ch/kscw/public/teams -o /dev/null 2>/dev/null || OK=0

if [ "$OK" = 1 ]; then
  log "SUCCESS: Postgres now $(running_ver); prod+dev healthy. Pruning old images."
  docker image prune -f >/dev/null 2>&1
else
  log "!!! FAILURE after patch $OLD -> $NEW — prod/dev health check FAILED. DB backups in $BK. INVESTIGATE NOW."
  exit 1
fi
