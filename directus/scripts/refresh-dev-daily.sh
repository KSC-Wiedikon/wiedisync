#!/usr/bin/env bash
#
# refresh-dev-daily.sh — VPS-side DAILY cron: overwrite the dev database with a
# scrubbed copy of prod, so dev keeps realistic data for testing.
#
# This is the UNATTENDED sibling of refresh-dev-from-prod.sh:
#   • refresh-dev-from-prod.sh runs FROM a dev machine (SSHes in, then runs
#     `npm run db:migrate:dev` to reconcile dev-ahead schema).
#   • THIS script runs ON the Hetzner VPS as root (cron), fully self-contained —
#     no SSH-to-self, no node/npm. It mirrors that script's VPS-side phase
#     MINUS the migrate reconcile.
#
# Canonical source: repo  directus/scripts/refresh-dev-daily.sh
# Deploy to VPS:     npm run scripts:deploy:dev   (-> /opt/kscw-root/dev/, root:root 0700,
#                    next to refresh-dev-scrub.sql; the bind-mount copy in
#                    /opt/directus-kscw-dev/scripts/ is NOT the one cron runs)
# Root crontab (UTC):
#   0 3 * * * bash /opt/kscw-root/dev/refresh-dev-daily.sh >> /data/backups/refresh-dev-daily.log 2>&1
#
# ⚠⚠ Never point root's crontab back at /opt/directus-kscw-dev/scripts/. That
# directory is a rw bind mount of the internet-facing dev container (uid 1000
# owns it), so anything able to run code in dev Directus could rewrite what
# root runs at 03:00 — and this script and its scrub SQL run as psql superuser
# on the host that also holds PROD. The script refuses to start from a
# location that is not root-owned and closed to group/other (audit 2026-09-28,
# F72).
#
# Why no migrate reconcile: the prod clone carries prod's COMPLETE, consistent
# schema + its kscw_migrations tracker, so post-clone dev == prod (fully
# migrated). The only case the reconcile would matter is dev-branch schema
# AHEAD of prod (active migration development); that work is transient under a
# daily wipe anyway. During active schema dev, either pause this cron or re-run
# `npm run db:deploy:dev` after a nightly sync.
#
# Safety: a dev safety-dump is taken FIRST (7-day local retention). On a failed
# row-count gate, scrub or prod-equality guard, the script restores dev from
# that safety dump, re-scrubs it, and restarts it (so dev stays online on
# prior-day data and unscrubbed prod data is never served). If the restore or
# its re-scrub fails, dev is left STOPPED and the run exits non-zero — check
# this log.
#
# Scrub (audit 2026-09-28, F13 + F14): the SQL lives in refresh-dev-scrub.sql
# next to this file — the ONE copy both refresh scripts run. It nulls every
# cloned credential (tokens, password hashes, TOTP seeds) and the PII dev does
# not need (AHV, IBAN, street, ClubDesk phones; birthdates shifted within the
# year so minor/adult status is unchanged). After the re-pin, a prod-equality
# guard nulls any dev token still identical to prod's, and any password hash
# still identical to prod's except on the allowlisted dev logins (accepted
# residual, see [1b/7]).
#
# Pre-flight (security review 2026-10-11, H5): everything here runs as the psql
# SUPERUSER, and dev/prod Directus log in as roles that own the tables in
# `public`. A function such a role created and hung on a trigger / CHECK /
# DEFAULT / index would run as superuser the moment this script touches the
# table. preflight-no-foreign-functions.sql (next to this file, root-only like
# the scrub) refuses that, fail-closed:
#   [0/7]  prod AND dev, before anything reads either. Ownership is the only
#          evidence and `pg_dump --no-owner` erases it — the clone and the
#          safety dump both re-create every function as supabase_admin — so the
#          SOURCES are what count. Failure = abort, dev untouched.
#   [4/7]  prod again, right before the dump (minutes have passed) -> rollback.
#   [4b/7] the fresh clone, before its first UPDATE -> rollback.
#   rollback: the restored safety dump, before its scrub -> dev left STOPPED.
# Allowed owners: KSCW_PREFLIGHT_ALLOWED_OWNERS (comma-separated), default
# supabase_admin,postgres (postgres owns the pgcrypto + unaccent functions on
# prod) — the same contract as apply-migrations.mjs.
#
set -uo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin:${PATH:-}
# Everything this run writes — captured dev creds, the safety dump — is
# root-only. The scratch files live in a private mktemp dir that is removed on
# EVERY exit path, failures included (audit 2026-09-28, F71: a failed run used
# to leave the captured password hashes + tokens in a world-readable /tmp file).
umask 077

PGC=kscw-postgres
PROD_DB=postgres
DEV_DB=directus_kscw_dev
DEV_CONTAINER=directus-kscw-dev
BACKUP_DIR=/data/backups
RETENTION_DAYS=7

TS=$(date +%F_%H%M%S)
BACKUP="$BACKUP_DIR/kscw_dev_pre-refresh_${TS}.sql.gz"
SELF="$(readlink -f "$0")"
SELF_DIR="$(dirname "$SELF")"
SCRUB_SQL="$SELF_DIR/refresh-dev-scrub.sql"
ROLE_SQL="$SELF_DIR/directus-db-role.sql"
PREFLIGHT_SQL="$SELF_DIR/preflight-no-foreign-functions.sql"

log(){ echo "[$(date -u +%F_%H:%M:%SZ)] $*"; }

# Root-only location check (F72, see header). Checked for the directory, this
# file and the scrub SQL: a writable directory alone lets someone swap either.
for f in "$SELF_DIR" "$SELF" "$SCRUB_SQL" "$ROLE_SQL" "$PREFLIGHT_SQL"; do
  [ -e "$f" ] || continue          # a missing scrub file is reported below
  read -r own mode < <(stat -c '%u %a' "$f")
  if [ "$own" != 0 ] || (( 8#$mode & 8#022 )); then
    log "!! $f is owned by uid $own, mode $mode — refusing to run as root from a"
    log "   location a non-root user can write. Deploy with npm run scripts:deploy:dev"
    log "   and point root's crontab at /opt/kscw-root/dev/refresh-dev-daily.sh (dev untouched)."
    exit 1
  fi
done

# Same default and validation as preflight-no-foreign-functions.mjs. The SQL
# also refuses any entry that is not a superuser or that a Directus role can act as.
PREFLIGHT_OWNERS=${KSCW_PREFLIGHT_ALLOWED_OWNERS:-supabase_admin,postgres}
if ! [[ "$PREFLIGHT_OWNERS" =~ ^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$ ]] \
   || [[ ",$PREFLIGHT_OWNERS," =~ ,directus_(prod|dev), ]]; then
  log "!! KSCW_PREFLIGHT_ALLOWED_OWNERS='$PREFLIGHT_OWNERS' is not a list of plain role names (or names a Directus role) — aborting (dev untouched)."
  exit 1
fi

# Pre-refresh dumps and this log hold prod-derived data; runs before F71
# created them 0644. Tighten whatever is already there on every run.
chmod 600 "$BACKUP_DIR"/kscw_dev_pre-refresh_*.sql.gz \
  "$BACKUP_DIR/refresh-dev-daily.log" 2>/dev/null || true

# The restore log can hold whole rows (COPY error CONTEXT lines). Only error
# lines go to the cron log, with quoted values masked and length capped.
restore_log_tail(){
  grep -E 'ERROR|FATAL' "$RLOG" 2>/dev/null | sed -E "s/\"[^\"]*\"/\"…\"/g; s/'[^']*'/'…'/g" \
    | cut -c1-200 | tail -n 20 | sed 's/^/      /'
}

WORK=$(mktemp -d /tmp/refresh-dev.XXXXXX) || { log "!! mktemp failed — aborting (dev untouched)."; exit 1; }
trap 'rm -rf "$WORK"' EXIT
CREDS="$WORK/devcreds.txt"
REPIN="$WORK/repin.sql"
PGUARD="$WORK/prod-guard.sql"
RLOG="$WORK/restore.log"
LICKEEP="$WORK/devlicense.sql"

# Emails kept REAL after scrub (admin/cron logins + OAuth accounts). Used both
# as the scrub allowlist and as the re-pin filter. Keep in sync with
# refresh-dev-from-prod.sh.
ALLOW_SQL="'admin@kscw.ch','aniish.k@hotmail.com','anja_jimenez@hotmail.com','cron-service@kscw.ch','luca.canepa@gmail.com','thamayanth.kanagalingam@uzh.ch'"
# The same list with its quotes doubled, for use INSIDE a SQL string literal
# (the prod-equality guard below builds its UPDATEs as text on prod).
ALLOW_SQL_LIT=${ALLOW_SQL//\'/\'\'}

# Scrub → re-pin → prod-equality guard: what turns a database into something
# dev may serve. Run on the fresh clone AND on a rolled-back safety dump.
scrub(){ docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 -v scrub_pii=1 -q < "$SCRUB_SQL"; }
repin(){ docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 -q < "$REPIN"; }
pguard(){ docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 < "$PGUARD" 2>&1 | sed 's/^/      /'; }
# F29: dev Directus logs in as directus_dev, not the superuser. The clone (and a
# rolled-back dump) re-creates `public` as supabase_admin, so hand it back —
# otherwise dev cannot alter its tables and reads ZERO rows from every table
# that still carries Supabase-era RLS. A no-op until the role exists.
ownrole(){ docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -X -v ON_ERROR_STOP=1 -v role=directus_dev -q < "$ROLE_SQL"; }
# H5 pre-flight on database $1 (see header). Passes ONLY on the exact line
# `PREFLIGHT|0` from a psql that exited 0: findings, a psql error or a truncated
# answer all fail CLOSED.
# Findings are logged printable-only and capped (identifiers are attacker-chosen).
preflight(){
  local out rc
  out=$(docker exec -i "$PGC" psql -U supabase_admin -d "$1" -X -v ON_ERROR_STOP=1 \
          -v allowed_owners="$PREFLIGHT_OWNERS" < "$PREFLIGHT_SQL" 2>&1); rc=$?
  [ "$rc" -eq 0 ] && [ "$out" = "PREFLIGHT|0" ] && return 0
  log "!! PRE-FLIGHT FAILED on $1: a function not owned by ($PREFLIGHT_OWNERS) is in public or"
  log "   wired into it — superuser tooling would run it. Findings / psql output:"
  printf '%s\n' "$out" | tr -cd '[:print:]\n' | cut -c1-300 | head -n 40 | sed 's/^/      /'
  return 1
}

# Restore dev from the safety dump + restart it. Used on any post-wipe failure
# so an unattended run never leaves dev down (or serving unscrubbed PII).
#
# ⚠ The safety dump is YESTERDAY's dev, and the ones taken before the F13/F14
# scrub shipped still hold prod's static tokens, password hashes and real PII.
# So the restored DB goes through the same scrub + re-pin + guard as a fresh
# clone before dev is started. If the full scrub fails (the likely reason the
# rollback is happening), fall back to the credential minimum — guard + TOTP /
# OAuth data — and if even that fails, dev stays STOPPED.
rollback(){
  log "ROLLBACK: restoring dev from safety dump $BACKUP"
  if [ ! -s "$BACKUP" ]; then
    log "ROLLBACK ABORTED: safety dump missing/empty — dev left STOPPED."
    return 1
  fi
  docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 </dev/null \
    -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO supabase_admin; GRANT USAGE ON SCHEMA public TO anon, authenticated;" >/dev/null 2>&1
  if ! zcat "$BACKUP" | docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -q >/dev/null 2>&1; then
    log "ROLLBACK FAILED: dev left STOPPED. Safety dump: $BACKUP"
    return 1
  fi
  # The dump was taken after [0/7] passed on dev; check the restore before the
  # scrub fires anything on it anyway (H5).
  if ! preflight "$DEV_DB"; then
    log "ROLLBACK: pre-flight failed on the restored dump — dev left STOPPED. Safety dump: $BACKUP"
    return 1
  fi
  if scrub; then
    repin || log "   (warning: some re-pins failed after rollback)"
  else
    log "   rollback: full scrub failed on the restored dump — credential minimum only"
    if ! docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 -q </dev/null \
         -c "UPDATE directus_users SET tfa_secret = NULL, auth_data = NULL; DELETE FROM directus_sessions;"; then
      log "ROLLBACK: could not clear credentials on the restored dump — dev left STOPPED. Safety dump: $BACKUP"
      return 1
    fi
  fi
  if ! pguard; then
    log "ROLLBACK: prod-equality guard failed on the restored dump — dev left STOPPED. Safety dump: $BACKUP"
    return 1
  fi
  ownrole || log "   WARN rollback: directus_dev ownership step failed — dev may read empty tables"
  docker start "$DEV_CONTAINER" >/dev/null </dev/null 2>&1 || true
  log "ROLLBACK OK: dev restored to prior-day data (credentials re-checked) + restarted."
  return 0
}

log "===== refresh-dev-daily START (prod=$PROD_DB -> dev=$DEV_DB) ====="

# Everything the scrub needs is checked BEFORE dev is touched: a missing scrub
# file or guard would otherwise only surface after the wipe.
for req in "$SCRUB_SQL" "$ROLE_SQL" "$PREFLIGHT_SQL"; do
  if [ ! -s "$req" ]; then
    log "!! $req missing/empty — aborting BEFORE touching dev (dev untouched)."
    log "   It ships with this script: npm run scripts:deploy:dev"
    exit 1
  fi
done

log "[0/7] Pre-flight: no function a non-superuser could have written (prod + dev)"
# Before [1/7]/[1b/7] read either database as superuser, and before [2/7] dumps
# dev: that dump is what a rollback restores, and it carries no owners.
for db in "$PROD_DB" "$DEV_DB"; do
  if ! preflight "$db"; then
    log "!! Aborting BEFORE touching dev (dev untouched). Find out who created those"
    log "   functions before running anything else as superuser against $db."
    exit 1
  fi
done

log "[1/7] Capturing dev service-account creds (for re-pin after clone)"
# id is captured FIRST and used as the re-pin key: it survives the PII scrub
# (which rewrites emails), so both allowlist service accounts AND token-holding
# members (e.g. the db:smoke test member) get their token restored.
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -t -A -F'|' </dev/null \
  -c "SELECT id, email, coalesce(password,''), coalesce(token,'') FROM directus_users WHERE token IS NOT NULL OR lower(email) IN ($ALLOW_SQL);" \
  > "$CREDS" 2>/dev/null || true

# Dev's own Directus licence activation (own key since 14.10.2026, see [5b/7]):
# one UPDATE that puts dev's project_id + licence key + token back after the clone.
# Empty when dev has not activated yet.
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -t -A </dev/null \
  -c "SELECT format('UPDATE directus_settings SET project_id = %L, license_key = %L, license_token = %L;', project_id, license_key, license_token) FROM directus_settings WHERE license_key IS NOT NULL LIMIT 1;" \
  > "$LICKEEP" 2>/dev/null || true

# Built now (not after the clone) because the rollback path needs it too.
# Fields: $1=id  $2=email  $3=password  $4=token.
# Key on id (not email) so member tokens survive the email scrub. Passwords are
# re-pinned for allowlist service accounts only; tokens for every captured row
# (allowlist service tokens + member smoke tokens alike).
awk -F'|' '
  BEGIN{
    a["admin@kscw.ch"]=1;a["cron-service@kscw.ch"]=1;a["luca.canepa@gmail.com"]=1;
    a["aniish.k@hotmail.com"]=1;a["anja_jimenez@hotmail.com"]=1;a["thamayanth.kanagalingam@uzh.ch"]=1;
  }
  function q(s){ gsub(/\047/,"\047\047",s); return "\047" s "\047" }
  ($1!=""){
    s="";
    if((tolower($2) in a) && $3!=""){ s="password=" q($3) }
    if($4!=""){ if(s!="") s=s", "; s=s "token=" q($4) }
    if(s!="") printf "UPDATE directus_users SET %s WHERE id=%s;\n", s, q($1)
  }
' "$CREDS" > "$REPIN"

log "[1b/7] Fingerprinting prod credentials (prod-equality guard)"
# One UPDATE per credential kind, listing md5() of every PROD token / password
# hash. Run on dev after the re-pin, it nulls whatever dev still shares with
# prod: the re-pin restores what DEV had before the clone, and until the prod
# tokens were rotated that WAS prod's (audit 2026-09-28, F13 — 7 of 8 static
# tokens identical, 3 of them Administrator). Only fingerprints are written.
#
# ⚠ ACCEPTED RESIDUAL — allowlist PASSWORDS are exempt from the guard. The
# allowlisted logins (ALLOW_SQL: the operator's own admin login, cron-service,
# the OAuth dev accounts) are how dev is administered; nulling their password
# every night because it still equals prod's would lock the operator out of dev
# admin with no way back in except a manual psql reset. So for THOSE accounts a
# password hash identical to prod's may survive on dev. What that leaves: an
# argon2 hash (not a usable credential; offline cracking only) of up to six
# known accounts, readable only by someone who can already read dev's
# directus_users. Close it by setting a dev-only password on each allowlisted
# login once — the re-pin then carries that one forward. TOKENS get no
# exemption: a token is a bearer credential, so one equal to prod is always
# nulled, allowlist or not.
# ⚠ Keep identical to refresh-dev-from-prod.sh.
docker exec "$PGC" psql -U supabase_admin -d "$PROD_DB" -t -A -v ON_ERROR_STOP=1 </dev/null \
  -c "SELECT 'UPDATE directus_users SET token = NULL WHERE token IS NOT NULL AND md5(token) IN (' || coalesce(string_agg(DISTINCT quote_literal(md5(token)), ','), 'NULL') || ');' FROM directus_users WHERE token IS NOT NULL UNION ALL SELECT 'UPDATE directus_users SET password = NULL WHERE password IS NOT NULL AND (email IS NULL OR lower(email) NOT IN ($ALLOW_SQL_LIT)) AND md5(password) IN (' || coalesce(string_agg(DISTINCT quote_literal(md5(password)), ','), 'NULL') || ');' FROM directus_users WHERE password IS NOT NULL;" \
  > "$PGUARD" 2>/dev/null || true
if [ "$(grep -c '^UPDATE directus_users SET ' "$PGUARD")" -ne 2 ]; then
  log "!! Could not fingerprint prod credentials — aborting BEFORE touching dev (dev untouched)."
  exit 1
fi

log "[2/7] Safety snapshot of dev -> $BACKUP"
docker exec "$PGC" pg_dump -U supabase_admin -d "$DEV_DB" --no-owner --no-acl </dev/null | gzip > "$BACKUP"
if [ ! -s "$BACKUP" ]; then
  log "!! Safety dump failed/empty — aborting BEFORE touching dev (dev untouched)."
  exit 1
fi
log "      $(ls -lh "$BACKUP" | awk '{print $5}')"

log "[3/7] Stopping dev Directus + recreating public schema"
docker stop "$DEV_CONTAINER" >/dev/null </dev/null
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 </dev/null \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DEV_DB' AND pid<>pg_backend_pid();" >/dev/null
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 </dev/null \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO supabase_admin; GRANT USAGE ON SCHEMA public TO anon, authenticated;" >/dev/null

# ⚠⚠ EXTENSIONS ARE NOT IN THE DUMP. `DROP SCHEMA public CASCADE` above takes
# every extension installed into that schema with it, and `pg_dump -n public`
# never emits CREATE EXTENSION (extensions are database-level objects, excluded
# by a schema filter). So each refresh left dev without `unaccent` and the
# ClubDesk sync-down died on the accent-insensitive linker pass every day
# (`function unaccent(text) does not exist`).
#
# ⚠ refresh-dev-from-prod.sh — the attended sibling — has carried this block
# since 25.08.2026 and THIS script did not, which is why the fix looked like it
# worked: running the manual refresh by hand put the extension back, the nightly
# cron took it away again, and the sync-down failed the next day (08.09.2026).
# Whatever is added to one of these two scripts belongs in the other.
#
# ⚠ A migration CANNOT fix this on its own: `kscw_migrations` lives in the public
# schema, so the clone restores PROD's tracker, which already lists the migration
# as applied. The runner would skip it forever while the extension stayed gone.
log "[3b/7] Recreating database-level extensions (not carried by a schema-only dump)"
for ext in unaccent; do
  if docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 </dev/null \
       -c "CREATE EXTENSION IF NOT EXISTS $ext;" >/dev/null 2>&1; then
    log "     ok $ext"
  else
    # Not fatal: the rest of dev works without it. Loud, because the thing it
    # breaks (the ClubDesk sync-down) fails minutes later with an error that
    # points at SQL rather than at this.
    log "     WARN $ext FAILED — the ClubDesk sync-down will break on dev"
  fi
done

log "[4/7] Cloning prod -> dev (public schema)"
# Prod again, right before its dump: the restore's COPY evaluates every CHECK
# as superuser, and [0/7] was minutes ago.
if ! preflight "$PROD_DB"; then
  log "!! Pre-flight on prod FAILED right before the clone — rolling back."
  rollback || true
  exit 1
fi
docker exec "$PGC" pg_dump -U supabase_admin -d "$PROD_DB" -n public --no-owner --no-acl </dev/null \
  | docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -q -v ON_ERROR_STOP=0 > "$RLOG" 2>&1 || true

log "[4b/7] Pre-flight on the fresh clone (before its first UPDATE)"
# The restore re-created every function as supabase_admin, so this mostly
# proves the clone is what [4/7] checked; the binding checks are the source
# ones above. Cheap, and it is the last look before the scrub fires triggers.
if ! preflight "$DEV_DB"; then
  log "!! Pre-flight on the clone FAILED — rolling back (the scrub must not run on it)."
  rollback || true
  exit 1
fi

log "[5/7] Verifying restore (row-count gate)"
fail=0
for chk in members:400 teams:25 trainings:400 games:300; do
  t=${chk%%:*}; min=${chk##*:}
  c=$(docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -t -A </dev/null -c "SELECT count(*) FROM $t;" 2>/dev/null || echo X)
  log "      $t = $c (min $min)"
  if [ "$c" = X ] || ! [ "$c" -ge "$min" ] 2>/dev/null; then fail=1; fi
done
if [ "$fail" -eq 1 ]; then
  log "!! Restore verification FAILED — rolling back. Restore errors (values masked):"
  restore_log_tail
  rollback || true
  exit 1
fi

# Directus licence: drop prod's, put dev's own activation back. Since 14.10.2026
# dev has its OWN Open Innovation Grant key (LICENSE_KEY in its .env; prod's key
# is never on dev). The clone carries prod's project_id, license_key and
# license_token, and Directus binds an activation to the project_id, so dev keeps
# its own three values across the clone:
#   - restored -> Directus only REFRESHES its activation at start (no new slot);
#   - nulled instead -> it ACTIVATES again from LICENSE_KEY every night and burns
#     the key's activation slots (5) in days, then crash-loops on "Activation
#     limit exceeded" — what happened with prod's key in July 2026.
# Without a key dev is NOT in a perpetual grace: Core's 30-day grace counts from
# the v12 migration timestamp, which the clone copies from prod (11.07.2026), so
# keyless dev is locked (/items, filtered permissions, realtime, member login).
# If dev has no activation yet, it gets a fresh project_id (UUIDv7, like Directus
# makes) so its first activation is never made under prod's project_id.
log "[5b/7] Licence: clearing prod's, restoring dev's own activation"
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" </dev/null \
  -c "UPDATE directus_settings SET license_key=NULL, license_token=NULL;" >/dev/null 2>&1 || true
if [ -s "$LICKEEP" ]; then
  if docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 -q < "$LICKEEP" >/dev/null 2>&1; then
    log "      dev's activation restored"
  else
    log "      WARN could not restore dev's activation — Directus activates again at start (uses one of the key's slots)"
  fi
else
  docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" </dev/null \
    -c "UPDATE directus_settings SET project_id = (lpad(to_hex((extract(epoch FROM clock_timestamp())*1000)::bigint), 12, '0') || '7' || substr(md5(random()::text), 1, 3) || to_hex(8 + floor(random()*4)::int) || substr(md5(random()::text), 1, 15))::uuid;" >/dev/null 2>&1 || true
  log "      dev had no activation of its own — fresh project_id; it activates from LICENSE_KEY at start"
fi

log "[6/7] Scrubbing credentials + PII ($(basename "$SCRUB_SQL"))"
if ! scrub; then
  log "!! Scrub FAILED — rolling back (unscrubbed prod data must NOT be served)."
  rollback || true
  exit 1
fi
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" </dev/null \
  -c "UPDATE directus_settings SET project_url='https://wiedisync-dev.kscw.ch' WHERE project_url IS NOT NULL;" >/dev/null 2>&1 || true

log "[7/7] Re-pinning dev creds by id (allowlist passwords + all captured tokens)"
if ! repin; then
  log "   (warning: some re-pins failed; admin/cron login on dev may need attention)"
fi

log "[7b/7] Prod-equality guard (null any dev token / non-allowlist password hash identical to prod)"
# Prints "UPDATE <n>" per kind. A non-zero n means a dev test credential was
# still a prod credential and is now gone: mint a dev-only token / set a
# dev-only password on dev — the next run's re-pin keeps it, because it no
# longer matches prod. If the guard itself fails, dev must not come back up
# holding prod credentials: roll back to the prior-day dump instead.
if ! pguard; then
  log "!! Prod-equality guard FAILED — rolling back."
  rollback || true
  exit 1
fi

log "[7c/7] Handing the public schema to directus_dev (F29)"
if ! ownrole; then
  log "!! directus_dev ownership step FAILED — dev would read empty tables; rolling back."
  rollback || true
  exit 1
fi

docker start "$DEV_CONTAINER" >/dev/null </dev/null

# Retention: keep only the last RETENTION_DAYS of pre-refresh safety dumps.
find "$BACKUP_DIR" -name 'kscw_dev_pre-refresh_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

log "===== refresh-dev-daily DONE. Dev restarted. Safety backup: $BACKUP ====="
