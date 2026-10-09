#!/usr/bin/env bash
#
# directus-set-env.sh <dev|prod> <KEY> — set one variable in a Directus
# container's .env and recreate the container so it takes effect.
#
#   printf '%s' "$VALUE" | bash scripts/directus-set-env.sh dev SQL_WRITE_PIN
#
# The value is read from STDIN, never from argv: it stays out of shell history,
# out of `ps` on both machines and out of git. It is never printed back — the
# check at the end only reports its length.
#
# `docker restart` does not re-read --env-file (env is baked in at CREATE time),
# so a .env edit needs a recreate. Same recreate as scripts/f29-db-roles.sh —
# image, mounts and network kept, GITHUB_PAT carried — except the port binding
# is copied from the LIVE container instead of being forced, so this script
# changes nothing but the one variable. If /server/ping does not come back, the
# .env backup is restored and the container recreated again.
set -euo pipefail

TARGET="${1:-}"
KEY="${2:-}"
case "$TARGET" in
  dev)  CONT=directus-kscw-dev; DIR=/opt/directus-kscw-dev; PORT=8056 ;;
  prod) CONT=directus-kscw;     DIR=/opt/directus-kscw;     PORT=8055 ;;
  *) echo "usage: printf '%s' VALUE | scripts/directus-set-env.sh <dev|prod> KEY" >&2; exit 1 ;;
esac
[[ "$KEY" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "!! KEY must be UPPER_SNAKE_CASE" >&2; exit 1; }
[ -t 0 ] && { echo "!! pipe the value on stdin (it is never taken from argv)" >&2; exit 1; }
VALUE=$(cat)
[ -n "$VALUE" ] || { echo "!! empty value on stdin" >&2; exit 1; }
case "$VALUE" in *$'\n'*) echo "!! value must be a single line" >&2; exit 1 ;; esac

# First stdin line = the value (base64, so any byte survives); the rest = the
# remote script for `bash -s`. `read` on a pipe consumes exactly one line.
{ printf '%s\n' "$(printf '%s' "$VALUE" | base64 -w0)"; cat <<'REMOTE'; } |
set -euo pipefail
TARGET=$1 KEY=$2 CONT=$3 DIR=$4 PORT=$5
umask 077
say(){ echo "[set-env:$TARGET] $*"; }
VALUE=$(printf '%s' "$VALUE_B64" | base64 -d)

ENVF=$DIR/.env
BAK=$ENVF.bak-setenv-$(date -u +%Y%m%d-%H%M%S)
cp -p "$ENVF" "$BAK"
grep -v "^$KEY=" "$BAK" > "$ENVF.tmp"
printf '%s=%s\n' "$KEY" "$VALUE" >> "$ENVF.tmp"
chmod --reference="$BAK" "$ENVF.tmp"; chown --reference="$BAK" "$ENVF.tmp"
mv "$ENVF.tmp" "$ENVF"
say "1/3 $KEY set in $ENVF (backup $BAK)"

IMAGE=$(docker inspect "$CONT" --format '{{.Config.Image}}')
HOSTIP=$(docker inspect "$CONT" --format '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}}{{end}}{{end}}')
GHPAT=$(docker exec "$CONT" printenv GITHUB_PAT 2>/dev/null || true)
BIND="${HOSTIP:+$HOSTIP:}$PORT:8055"

recreate(){
  docker stop "$CONT" >/dev/null && docker rm "$CONT" >/dev/null
  args=(-d --name "$CONT" --restart unless-stopped --network coolify
        --env-file "$ENVF" -p "$BIND"
        -v "$DIR/extensions:/directus/extensions" -v "$DIR/templates:/directus/templates"
        -v "$DIR/uploads:/directus/uploads" -v "$DIR/logs:/directus/logs"
        -v "$DIR/scripts:/directus/scripts")
  [ -n "$GHPAT" ] && args+=(-e "GITHUB_PAT=$GHPAT")
  docker run "${args[@]}" "$IMAGE" >/dev/null
}
healthy(){
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/server/ping")" = 200 ] && return 0
    sleep 3
  done
  return 1
}

say "2/3 recreating $CONT ($IMAGE, port $BIND)"
recreate
got=$(docker exec "$CONT" printenv "$KEY" 2>/dev/null || true)
if healthy && [ "$got" = "$VALUE" ]; then
  say "3/3 $CONT healthy, $KEY live (${#got} chars). Done."
else
  say "!! $CONT not healthy or $KEY not live — rolling back to $BAK"
  docker logs --tail 30 "$CONT" 2>&1 | tail -15 || true
  cp -p "$BAK" "$ENVF"
  recreate
  healthy && say "rolled back: $CONT healthy on the previous .env" || say "!! rollback ALSO unhealthy — check docker logs $CONT"
  exit 1
fi
REMOTE
ssh hetzner "sudo bash -c 'IFS= read -r VALUE_B64; export VALUE_B64; exec bash -s -- $TARGET $KEY $CONT $DIR $PORT'"
