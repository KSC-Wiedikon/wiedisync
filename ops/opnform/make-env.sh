#!/usr/bin/env bash
# make-env.sh <out-file> — writes the .env for the plain OpnForm compose (ops/opnform/compose.yaml)
# from the environment of the RUNNING OpnForm containers, without printing a single value.
#
# Run as root on the box that runs OpnForm today (Hetzner, Coolify service g57v4frrpv7kz69s7aortpf0):
#   bash make-env.sh /root/opnform.env       → then rsync it to the new box as /opt/opnform/.env
#
# Source of truth = `docker inspect` of the live containers, minus the env their images set
# themselves, minus Coolify's bookkeeping (COOLIFY_*, SERVICE_*). Coolify inlines some values in
# its compose and keeps others in its .env; the running containers are what actually works.
# The union of all containers is written; a key that carries two different values in two
# containers aborts the run (prints the key name only). Values are single-quoted, which Compose
# reads literally (no ${} interpolation); a value containing ' or a newline aborts the run.
set -euo pipefail
OUT=${1:?usage: make-env.sh <out-file>}
UUID=g57v4frrpv7kz69s7aortpf0
CONTAINERS="opnform-api-$UUID opnform-ui-$UUID postgresql-$UUID redis-$UUID"
umask 077
trap 'rm -f "$OUT.tmp"' EXIT

for c in $CONTAINERS; do
  docker inspect "$c" >/dev/null 2>&1 || { echo "ABORT: container $c not found" >&2; exit 1; }
  img=$(docker inspect "$c" --format '{{.Image}}')
  # one JSON object per container on stdin, so no value ever appears on a command line
  { docker inspect "$c" --format '{{json .Config.Env}}'; docker image inspect "$img" --format '{{json .Config.Env}}'; } \
    | jq -s --arg c "$c" '{c: $c, env: (.[0] - .[1])}'
done | jq -rs --arg q "'" '
  [ .[] | .c as $c | .env[] | {c: $c, k: .[0:index("=")], v: .[index("=")+1:]} ]
  | map(select(.k | test("^(COOLIFY_|SERVICE_)") | not))
  | group_by(.k)
  | map(
      if (map(.v) | unique | length) > 1
      then error("conflicting values for \(.[0].k) in \(map(.c) | join(", "))")
      elif (.[0].v | test("[" + $q + "\n]"))
      then error("value of \(.[0].k) contains a quote or newline")
      else .[0] end)
  | .[] | "\(.k)=\($q)\(.v)\($q)"' > "$OUT.tmp"

# what the plain compose interpolates must all be there
for k in APP_KEY DB_USERNAME DB_PASSWORD DB_DATABASE REDIS_PASSWORD JWT_SECRET POSTGRES_USER POSTGRES_PASSWORD \
         POSTGRES_DB NUXT_PUBLIC_H_CAPTCHA_SITE_KEY NUXT_PUBLIC_RE_CAPTCHA_SITE_KEY; do
  grep -q "^$k=" "$OUT.tmp" || { rm -f "$OUT.tmp"; echo "ABORT: $k missing from the live env" >&2; exit 1; }
done
mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"
echo "wrote $OUT ($(wc -l < "$OUT") keys): $(cut -d= -f1 "$OUT" | tr '\n' ' ')"
