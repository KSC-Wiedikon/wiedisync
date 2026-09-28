#!/usr/bin/env bash
#
# f29-db-roles.sh <dev|prod> — move one Directus container off the Postgres
# SUPERUSER onto its own login role (security audit 2026-09-28, F29).
#
#   bash scripts/f29-db-roles.sh dev     # always dev first; check the app
#   bash scripts/f29-db-roles.sh prod
#
# Before: both containers connected as `supabase_admin` (superuser), so anyone
# with code execution in dev Directus could open the PROD database or run
# `COPY … TO PROGRAM` as the database server on the host that holds prod.
# After: directus_dev / directus_prod — NOSUPERUSER, CONNECT only to their own
# database, owner of their `public` schema (directus/scripts/directus-db-role.sql).
#
# Also re-publishes the container port on 127.0.0.1 only: it was 0.0.0.0, so
# Directus answered on the server's raw IP past Cloudflare — and every in-memory
# rate limiter trusts X-Forwarded-For, which a direct caller sets freely. The
# Cloudflare tunnel (a host systemd service) connects to 127.0.0.1.
#
# Steps, each checked before the next:
#   1. create/refresh the role (password generated on the VPS, never printed;
#      kept root-only in /root/kscw-db-roles/<env>.pw), per-database CONNECT
#   2. hand `public` to the role (directus-db-role.sql)
#   3. PROVE the role before switching: not superuser, COPY TO PROGRAM refused,
#      cannot connect to the other env's database, reads the same row count as
#      the superuser from an RLS table, can ALTER a table (rolled back)
#   4. back up .env, set DB_USER/DB_PASSWORD, recreate the container
#      (same image, mounts, network, GITHUB_PAT carried over)
#   5. wait for /server/ping; on failure restore the .env backup and recreate
#      again — Directus is never left on a half-working login.
#
# Host tooling is unaffected: every host-side psql (migrations, dev refresh,
# ClubDesk, backups) runs `docker exec … psql -U supabase_admin` over the local
# socket and never reads DB_USER/DB_PASSWORD.
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  dev)  ROLE=directus_dev;  DB=directus_kscw_dev; OTHER_DB=postgres;          CONT=directus-kscw-dev; DIR=/opt/directus-kscw-dev; PORT=8056 ;;
  prod) ROLE=directus_prod; DB=postgres;          OTHER_DB=directus_kscw_dev; CONT=directus-kscw;     DIR=/opt/directus-kscw;     PORT=8055 ;;
  *) echo "usage: scripts/f29-db-roles.sh <dev|prod>" >&2; exit 1 ;;
esac
SSH_HOST=hetzner
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROLE_SQL_B64=$(base64 -w0 "$REPO_ROOT/directus/scripts/directus-db-role.sql")

ssh "$SSH_HOST" "sudo bash -s -- $TARGET $ROLE $DB $OTHER_DB $CONT $DIR $PORT $ROLE_SQL_B64" <<'REMOTE'
set -euo pipefail
TARGET=$1 ROLE=$2 DB=$3 OTHER_DB=$4 CONT=$5 DIR=$6 PORT=$7
PGC=kscw-postgres
umask 077
say(){ echo "[f29:$TARGET] $*"; }
su_psql(){ docker exec -i "$PGC" psql -U supabase_admin -X -v ON_ERROR_STOP=1 "$@"; }
# As the new role, over TCP with its password — exactly how Directus connects.
role_psql(){ docker exec -i -e PGPASSWORD="$PW" "$PGC" psql -h 127.0.0.1 -U "$ROLE" -X -v ON_ERROR_STOP=1 "$@"; }

WORK=$(mktemp -d /tmp/f29.XXXXXX); trap 'rm -rf "$WORK"' EXIT
printf '%s' "$8" | base64 -d > "$WORK/role.sql"

# ── 1. role + password + per-database CONNECT ──────────────────────────
install -d -m 0700 /root/kscw-db-roles
PWF=/root/kscw-db-roles/$TARGET.pw
[ -s "$PWF" ] || openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40 > "$PWF"
PW=$(cat "$PWF")
[ ${#PW} -ge 32 ] || { say "!! password generation failed"; exit 1; }
su_psql -d postgres -q -v role="$ROLE" -v pw="$PW" -v db="$DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
ALTER ROLE :"role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'pw';
REVOKE ALL ON DATABASE postgres, directus_kscw_dev FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"role";
SQL
say "1/5 role $ROLE ready (CONNECT to $DB only)"

# ── 2. ownership of public ─────────────────────────────────────────────
su_psql -d "$DB" -q -v role="$ROLE" < "$WORK/role.sql"
left=$(su_psql -d "$DB" -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m') and pg_get_userbyid(c.relowner) <> '$ROLE'")
[ "$left" = 0 ] || { say "!! $left relations in public still not owned by $ROLE"; exit 1; }
say "2/5 public schema of $DB owned by $ROLE"

# ── 3. prove the role BEFORE switching ─────────────────────────────────
[ "$(role_psql -d "$DB" -At -c 'select rolsuper from pg_roles where rolname = current_user')" = f ] \
  || { say "!! $ROLE is a superuser"; exit 1; }
if role_psql -d "$DB" -At -c "COPY (SELECT 1) TO PROGRAM 'true'" >/dev/null 2>&1; then
  say "!! COPY TO PROGRAM succeeded as $ROLE"; exit 1; fi
if role_psql -d "$OTHER_DB" -At -c 'select 1' >/dev/null 2>&1; then
  say "!! $ROLE can connect to $OTHER_DB"; exit 1; fi
a=$(su_psql -d "$DB" -At -c 'select count(*) from members')
b=$(role_psql -d "$DB" -At -c 'select count(*) from members')
[ "$a" = "$b" ] && [ "$a" -gt 0 ] || { say "!! members rows: superuser $a vs $ROLE $b (RLS?)"; exit 1; }
role_psql -d "$DB" -q -c 'BEGIN; ALTER TABLE members ADD COLUMN f29_probe int; ROLLBACK;' \
  || { say "!! $ROLE cannot ALTER members"; exit 1; }
say "3/5 proven: not superuser, no COPY TO PROGRAM, no access to $OTHER_DB, members=$b, DDL ok"

# ── 4. .env + recreate ─────────────────────────────────────────────────
ENVF=$DIR/.env
BAK=$ENVF.bak-f29-$(date -u +%Y%m%d-%H%M%S)
cp -p "$ENVF" "$BAK"
IMAGE=$(docker inspect "$CONT" --format '{{.Config.Image}}')
GHPAT=$(docker exec "$CONT" printenv GITHUB_PAT 2>/dev/null || true)

recreate(){
  docker stop "$CONT" >/dev/null && docker rm "$CONT" >/dev/null
  args=(-d --name "$CONT" --restart unless-stopped --network coolify
        --env-file "$ENVF" -p "127.0.0.1:$PORT:8055"
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

sed -i -E "s|^DB_USER=.*|DB_USER=$ROLE|; s|^DB_PASSWORD=.*|DB_PASSWORD=$PW|" "$ENVF"
grep -q "^DB_USER=$ROLE\$" "$ENVF" || { cp -p "$BAK" "$ENVF"; say "!! .env edit failed — restored"; exit 1; }
say "4/5 .env updated (backup $BAK); recreating $CONT on 127.0.0.1:$PORT"
recreate

# ── 5. health, or roll back ────────────────────────────────────────────
if healthy && [ "$(docker exec "$CONT" printenv DB_USER)" = "$ROLE" ]; then
  n=$(su_psql -d postgres -At -c "select count(*) from pg_stat_activity where usename='$ROLE' and datname='$DB'")
  say "5/5 $CONT healthy on $ROLE ($n connections). Done."
  docker logs --since 3m "$CONT" 2>&1 | grep -iE 'permission denied|must be owner|ERROR' | tail -5 || true
else
  say "!! $CONT not healthy on $ROLE — rolling back to $BAK"
  docker logs --tail 40 "$CONT" 2>&1 | tail -20 || true
  cp -p "$BAK" "$ENVF"
  recreate
  healthy && say "rolled back: $CONT healthy on its previous login" || say "!! rollback ALSO unhealthy — check docker logs $CONT"
  exit 1
fi
REMOTE
