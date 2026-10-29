#!/usr/bin/env bash
#
# directus-set-image.sh <dev|prod> <tag> — move a Directus container to another
# directus/directus image tag, verify it, and fall back to the old tag on failure.
#
#   bash scripts/directus-set-image.sh dev 12.5.0
#
# Same recreate as scripts/directus-set-env.sh — mounts, network, live port
# binding and GITHUB_PAT kept — so the image is the only thing that changes.
# On the VPS:
#   1. image gate: pull the target tag; the current tag must stay local
#   2. size-gated pg_dump of the instance's DB -> /root/pre-<tag>-<env>-<ts>.dump
#   3. recreate on the target tag
#   4. verify (<= 4 min): both extensions loaded, /server/ping, /kscw/public/teams,
#      container env unchanged, licence from env, no grace/lockdown, WS 101
#   5. on failure: recreate on the previous tag. Image-only on purpose: Directus
#      never down-migrates and the 12.x migrations so far only add columns/rows,
#      so the old tag runs on the newer schema. The dump is the disaster net.
# Log: /var/log/kscw-directus-set-image.log (also printed).
set -euo pipefail

TARGET="${1:-}"
TAG="${2:-}"
case "$TARGET" in
  dev)  CONT=directus-kscw-dev; DIR=/opt/directus-kscw-dev; PORT=8056; DB=directus_kscw_dev; URL=https://directus-dev.kscw.ch ;;
  prod) CONT=directus-kscw;     DIR=/opt/directus-kscw;     PORT=8055; DB=postgres;          URL=https://directus.kscw.ch ;;
  *) echo "usage: scripts/directus-set-image.sh <dev|prod> <tag>" >&2; exit 1 ;;
esac
[[ "$TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "!! tag must be an exact version like 12.5.0 (never latest/-dhi)" >&2; exit 1; }

ssh kscw-server "sudo bash -s -- $TARGET $TAG $CONT $DIR $PORT $DB $URL" <<'REMOTE'
set -euo pipefail
TARGET=$1 TAG=$2 CONT=$3 DIR=$4 PORT=$5 DB=$6 URL=$7
umask 077
LOG=/var/log/kscw-directus-set-image.log
exec > >(tee -a "$LOG") 2>&1
say(){ echo "[set-image:$TARGET $(date -u +%T)] $*"; }
NEW=directus/directus:$TAG
# Image-baked variables differ between tags by design; everything else must match.
BAKED='^(PATH|NODE_ENV|NODE_VERSION|YARN_VERSION|DB_FILENAME|NPM_CONFIG_UPDATE_NOTIFIER)='
envsum(){ docker inspect "$CONT" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -Ev "$BAKED" | grep -v '^$' | sort | sha256sum | cut -c1-16; }

OLD=$(docker inspect "$CONT" --format '{{.Config.Image}}')
[ "$OLD" != "$NEW" ] || { say "already on $NEW — nothing to do"; exit 0; }
say "=== $CONT: $OLD -> $NEW START"

# 1. image gate
docker pull -q "$NEW" >/dev/null || { say "ABORT: pull $NEW failed — nothing changed"; exit 1; }
docker image inspect "$OLD" >/dev/null 2>&1 || { say "ABORT: rollback image $OLD not local — nothing changed"; exit 1; }
say "1/5 image gate ok ($NEW pulled, $OLD kept for rollback)"

# 2. pre-flip dump; a broken dump is KB-sized, a real one is >5% of the DB
DUMP=/root/pre-$TAG-$TARGET-$(date -u +%Y%m%d-%H%M).dump
docker exec kscw-postgres pg_dump -U postgres -d "$DB" -Fc > "$DUMP" || { say "ABORT: dump failed — nothing changed"; exit 1; }
SZ=$(stat -c%s "$DUMP")
DBSZ=$(docker exec kscw-postgres psql -U postgres -XtAc "SELECT pg_database_size('$DB')")
[ "$SZ" -gt $((DBSZ / 20)) ] || { say "ABORT: dump $SZ bytes vs DB $DBSZ — nothing changed"; exit 1; }
MIGS_BEFORE=$(docker exec kscw-postgres psql -U postgres -d "$DB" -XtAc 'SELECT count(*) FROM directus_migrations')
say "2/5 dump ok: $DUMP ($((SZ / 1048576)) MB), directus_migrations=$MIGS_BEFORE"

HOSTIP=$(docker inspect "$CONT" --format '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}}{{end}}{{end}}')
GHPAT=$(docker exec "$CONT" printenv GITHUB_PAT 2>/dev/null || true)
BIND="${HOSTIP:+$HOSTIP:}$PORT:8055"
ENV_BEFORE=$(envsum)

recreate(){
  docker stop "$CONT" >/dev/null && docker rm "$CONT" >/dev/null
  args=(-d --name "$CONT" --restart unless-stopped --network coolify
        --env-file "$DIR/.env" -p "$BIND"
        -v "$DIR/extensions:/directus/extensions" -v "$DIR/templates:/directus/templates"
        -v "$DIR/uploads:/directus/uploads" -v "$DIR/logs:/directus/logs"
        -v "$DIR/scripts:/directus/scripts")
  [ -n "$GHPAT" ] && args+=(-e "GITHUB_PAT=$GHPAT")
  docker run "${args[@]}" "$1" >/dev/null
}
up(){
  for _ in $(seq 1 48); do
    sleep 5
    # no grep -q: under pipefail it can SIGPIPE `docker logs` and read as "not up"
    docker logs "$CONT" 2>&1 | grep "Loaded extensions: kscw-endpoints, kscw-hooks" >/dev/null || continue
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/server/ping")" = 200 ] || continue
    curl -fsS -m 15 "http://127.0.0.1:$PORT/kscw/public/teams" -o /dev/null 2>/dev/null || continue
    return 0
  done
  return 1
}

# 3. flip
recreate "$NEW"
say "3/5 recreated on $NEW (port $BIND)"

# 4. verify
fail=""
if up; then
  [ "$(envsum)" = "$ENV_BEFORE" ] || fail="container env differs from before the flip"
  LIC=$(docker exec "$CONT" node -e "fetch('http://127.0.0.1:8055/server/info').then(r=>r.json()).then(j=>console.log(j.data?.license?.source ?? 'none'))" 2>/dev/null || echo error)
  [ "$LIC" = env ] || fail="${fail:+$fail; }licence source '$LIC' (want env)"
  GRACE=$(docker logs "$CONT" 2>&1 | grep -ci 'grace\|lockdown' || true)
  [ "$GRACE" = 0 ] || fail="${fail:+$fail; }$GRACE grace/lockdown log lines"
  WS=$(curl -s -o /dev/null -w '%{http_code}' -m 10 --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
       -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(head -c 16 /dev/urandom | base64)" "$URL/websocket" || true)
  [ "$WS" = 101 ] || fail="${fail:+$fail; }websocket handshake HTTP $WS"
  MIGS_AFTER=$(docker exec kscw-postgres psql -U postgres -d "$DB" -XtAc 'SELECT count(*) FROM directus_migrations')
else
  fail="not up after 4 min (extensions log line, /server/ping, /kscw/public/teams)"
fi

if [ -z "$fail" ]; then
  say "4/5 verified: extensions, ping, public teams, env unchanged, licence env, 0 grace, WS 101, directus_migrations $MIGS_BEFORE -> $MIGS_AFTER"
  say "=== SUCCESS: $CONT on $NEW (dump kept at $DUMP)"
  exit 0
fi

# 5. rollback (image-only — see header)
say "!! verify failed: $fail — rolling back to $OLD"
docker logs --tail 30 "$CONT" 2>&1 | tail -20 || true
recreate "$OLD"
if up; then say "=== ROLLED BACK: $CONT healthy on $OLD (dump $DUMP)"; else say "=== !!! ROLLBACK ALSO UNHEALTHY — docker logs $CONT; dump $DUMP"; fi
exit 1
REMOTE
