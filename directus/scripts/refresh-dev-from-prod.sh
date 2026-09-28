#!/usr/bin/env bash
#
# refresh-dev-from-prod.sh — On-demand: overwrite the dev database with a
# scrubbed copy of prod, so dev has realistic data for testing.
#
# Prod (`postgres`) and dev (`directus_kscw_dev`) live in the SAME Postgres
# container on Hetzner, so the clone is an in-container pg_dump | psql — no
# data ever leaves the VPS.
#
# What it does, in order:
#   1. Capture dev's service-account creds (admin@ / cron-service@ passwords +
#      static tokens) so dev automation keeps working after the clone.
#   2. Safety-dump the current dev DB to /data/backups (recoverable rollback);
#      abort before touching dev if the dump is empty.
#   3. Stop dev Directus, drop+recreate dev's public schema.
#   4. Clone prod's public schema into dev.
#   5. Row-count gate — abort (leaving dev stopped + the safety dump) if the
#      restore looks implausible.
#   6. Scrub (refresh-dev-scrub.sql — the SAME file the nightly cron runs):
#      every cloned credential ALWAYS (tokens, password hashes, TOTP seeds,
#      prod-valid link tokens); PII unless --no-scrub (emails -> sink, phones,
#      AHV, IBAN, street nulled/faked, birthdates shifted within the year).
#      Admin/dev login emails are kept on an allowlist so OAuth + admin login
#      still work.
#   7. Re-pin dev's captured service creds onto the cloned allowlist accounts,
#      null any dev token (and any non-allowlist password hash) still
#      identical to prod's
#      (audit 2026-09-28, F13), restart dev Directus.
#   8. (unless --no-migrate) run `npm run db:migrate:dev` so any dev-branch
#      schema ahead of prod is re-applied on top of the prod data.
#
# Note: clubdesk_{basketball,people,volleyball} are VIEWS over clubdesk_export,
# so only the base table is scrubbed (the views reflect it).
#
# Usage:
#   bash directus/scripts/refresh-dev-from-prod.sh            # interactive
#   npm run db:refresh-dev                                    # same, via npm
#   bash directus/scripts/refresh-dev-from-prod.sh --yes      # skip confirm
#   bash directus/scripts/refresh-dev-from-prod.sh --no-migrate
#   bash directus/scripts/refresh-dev-from-prod.sh --no-scrub # DANGER: real PII
#                                                              # (credentials are
#                                                              # scrubbed anyway)
#
set -euo pipefail

# script lives in directus/scripts/ -> cd to repo root for npm
cd "$(dirname "$0")/../.."

# The scrub SQL is shared with refresh-dev-daily.sh. The remote phase reads its
# script from stdin, so the SQL travels as one base64 positional argument.
SCRUB_FILE=directus/scripts/refresh-dev-scrub.sql
[ -s "$SCRUB_FILE" ] || { echo "Missing $SCRUB_FILE" >&2; exit 1; }
SCRUB_B64=$(base64 -w0 "$SCRUB_FILE")

SSH_HOST=hetzner
PGC=kscw-postgres
PROD_DB=postgres
DEV_DB=directus_kscw_dev
DEV_CONTAINER=directus-kscw-dev

ASSUME_YES=0
DO_MIGRATE=1
DO_SCRUB=1
for a in "$@"; do
  case "$a" in
    --yes|-y)     ASSUME_YES=1 ;;
    --no-migrate) DO_MIGRATE=0 ;;
    --no-scrub)   DO_SCRUB=0 ;;
    *) echo "Unknown argument: $a" >&2; exit 2 ;;
  esac
done

echo "──────────────────────────────────────────────────────────────────────"
echo " Refresh DEV database from PROD"
echo "──────────────────────────────────────────────────────────────────────"
echo " Target (overwritten): $DEV_DB  (container $DEV_CONTAINER)"
echo " Source (read-only):   $PROD_DB"
echo
echo " * The ENTIRE dev database is replaced with a copy of prod."
echo " * Dev's current data (incl. any test data / in-progress schema) is lost."
echo " * A safety backup of dev is taken first (to /data/backups on the VPS)."
if [ "$DO_SCRUB" -eq 1 ]; then
  echo " * PII is SCRUBBED: emails -> sink; phones, AHV, IBAN, street nulled/faked;"
  echo "   birthdates shifted; push/sessions cleared."
else
  echo " * !! --no-scrub: REAL prod PII (emails, phones, AHV, IBAN, addresses) will be copied into dev."
fi
echo " * Credentials (tokens, password hashes, TOTP) are ALWAYS scrubbed."
echo

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Type 'refresh dev' to proceed: " ans
  [ "$ans" = "refresh dev" ] || { echo "Aborted."; exit 1; }
fi

echo "==> Running clone + scrub on the VPS (this can take a minute) ..."

# Quoted heredoc => nothing is expanded locally; config is passed as positional
# args to the remote bash. Every `docker exec` that is NOT a file/pipe redirect
# gets </dev/null so it can't swallow the script stream.
ssh "$SSH_HOST" "sudo bash -s -- $DO_SCRUB $PGC $PROD_DB $DEV_DB $DEV_CONTAINER $SCRUB_B64" <<'REMOTE'
set -uo pipefail
DO_SCRUB="$1"; PGC="$2"; PROD_DB="$3"; DEV_DB="$4"; DEV_CONTAINER="$5"
# Root-only output (captured creds, safety dump), scratch in a private dir that
# is removed on EVERY exit — failures included (audit 2026-09-28, F71: the
# scrub-failure path used to leave the captured password hashes + tokens in a
# world-readable /tmp file and print its path).
umask 077
WORK=$(mktemp -d /tmp/refresh-dev.XXXXXX) || { echo "!! mktemp failed — aborting (dev untouched)."; exit 1; }
trap 'rm -rf "$WORK"' EXIT
TS=$(date +%F_%H%M%S)
BACKUP=/data/backups/kscw_dev_pre-refresh_${TS}.sql.gz
CREDS="$WORK/devcreds.txt"
SCRUB="$WORK/scrub.sql"
REPIN="$WORK/repin.sql"
PGUARD="$WORK/prod-guard.sql"
RLOG="$WORK/restore.log"
printf '%s' "$6" | base64 -d > "$SCRUB" 2>/dev/null
if [ ! -s "$SCRUB" ]; then
  echo "!! Scrub SQL did not arrive — aborting (dev untouched)."; exit 1
fi

# Emails kept REAL after scrub (admin/cron logins + your own OAuth account).
# Used both as the scrub allowlist and as the re-pin filter.
ALLOW_SQL="'admin@kscw.ch','aniish.k@hotmail.com','anja_jimenez@hotmail.com','cron-service@kscw.ch','luca.canepa@gmail.com','thamayanth.kanagalingam@uzh.ch'"
# Quotes doubled, for use INSIDE a SQL string literal (the guard below).
ALLOW_SQL_LIT=${ALLOW_SQL//\'/\'\'}

echo "[1/7] Capturing dev service-account creds (for re-pin after clone)"
# id is captured FIRST and used as the re-pin key: it survives the PII scrub
# (which rewrites emails), so both allowlist service accounts AND token-holding
# members (e.g. the db:smoke test member) get their token restored.
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -t -A -F'|' </dev/null \
  -c "SELECT id, email, coalesce(password,''), coalesce(token,'') FROM directus_users WHERE token IS NOT NULL OR lower(email) IN ($ALLOW_SQL);" \
  > "$CREDS" 2>/dev/null || true

echo "[1b/7] Fingerprinting prod credentials (prod-equality guard)"
# One UPDATE per credential kind, listing md5() of every PROD token / password
# hash; run on dev after the re-pin it nulls whatever dev still shares with
# prod (audit 2026-09-28, F13). Only fingerprints are written.
# ⚠ ACCEPTED RESIDUAL: allowlist PASSWORDS are exempt (nulling them would lock
# the operator out of dev admin); tokens never are. Full rationale in
# refresh-dev-daily.sh at the same step.
# ⚠ Keep identical to refresh-dev-daily.sh.
docker exec "$PGC" psql -U supabase_admin -d "$PROD_DB" -t -A -v ON_ERROR_STOP=1 </dev/null \
  -c "SELECT 'UPDATE directus_users SET token = NULL WHERE token IS NOT NULL AND md5(token) IN (' || coalesce(string_agg(DISTINCT quote_literal(md5(token)), ','), 'NULL') || ');' FROM directus_users WHERE token IS NOT NULL UNION ALL SELECT 'UPDATE directus_users SET password = NULL WHERE password IS NOT NULL AND (email IS NULL OR lower(email) NOT IN ($ALLOW_SQL_LIT)) AND md5(password) IN (' || coalesce(string_agg(DISTINCT quote_literal(md5(password)), ','), 'NULL') || ');' FROM directus_users WHERE password IS NOT NULL;" \
  > "$PGUARD" 2>/dev/null || true
if [ "$(grep -c '^UPDATE directus_users SET ' "$PGUARD")" -ne 2 ]; then
  echo "!! Could not fingerprint prod credentials — aborting BEFORE touching dev (dev untouched)."
  exit 1
fi

echo "[2/7] Safety snapshot of dev -> $BACKUP"
docker exec "$PGC" pg_dump -U supabase_admin -d "$DEV_DB" --no-owner --no-acl </dev/null | gzip > "$BACKUP"
if [ ! -s "$BACKUP" ]; then
  echo "!! Safety dump failed/empty — aborting BEFORE touching dev (dev untouched)."
  exit 1
fi
echo "      $(ls -lh "$BACKUP" | awk '{print $5}')"

echo "[3/7] Stopping dev Directus + recreating public schema"
docker stop "$DEV_CONTAINER" >/dev/null </dev/null
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 </dev/null \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DEV_DB' AND pid<>pg_backend_pid();" >/dev/null
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 </dev/null \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO supabase_admin; GRANT USAGE ON SCHEMA public TO anon, authenticated;" >/dev/null

# ⚠⚠ EXTENSIONS ARE NOT IN THE DUMP. `DROP SCHEMA public CASCADE` above takes
# every extension installed into that schema with it, and `pg_dump -n public`
# never emits CREATE EXTENSION (extensions are database-level objects, excluded
# by a schema filter). So each refresh silently left dev without `unaccent`, and
# the ClubDesk sync-down died every day on the accent-insensitive linker pass
# (`function unaccent(text) does not exist`) — invisible until the dispatcher
# started reporting real errors on 25.08.2026.
#
# ⚠ A migration CANNOT fix this on its own: `kscw_migrations` lives in the public
# schema, so the clone restores PROD's tracker, which already lists the migration
# as applied. The runner would then skip it forever while the extension stays
# gone. It has to be recreated here, on every refresh.
echo "[3b/7] Recreating database-level extensions (not carried by a schema-only dump)"
for ext in unaccent; do
  docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 </dev/null \
    -c "CREATE EXTENSION IF NOT EXISTS $ext;" >/dev/null && echo "     ✓ $ext" || echo "     ⚠ $ext FAILED — the ClubDesk sync will break on dev"
done

echo "[4/7] Cloning prod -> dev (public schema)"
docker exec "$PGC" pg_dump -U supabase_admin -d "$PROD_DB" -n public --no-owner --no-acl </dev/null \
  | docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -q -v ON_ERROR_STOP=0 > "$RLOG" 2>&1 || true

echo "[5/7] Verifying restore (row-count gate)"
fail=0
for chk in members:400 teams:25 trainings:400 games:300; do
  t=${chk%%:*}; min=${chk##*:}
  c=$(docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -t -A </dev/null -c "SELECT count(*) FROM $t;" 2>/dev/null || echo X)
  echo "      $t = $c (min $min)"
  if [ "$c" = X ] || ! [ "$c" -ge "$min" ] 2>/dev/null; then fail=1; fi
done
if [ "$fail" -eq 1 ]; then
  echo "!! Restore verification FAILED — dev left STOPPED to avoid serving a bad clone."
  echo "   Safety backup: $BACKUP"
  echo "   Restore log (tail):"
  tail -n 20 "$RLOG" | sed 's/^/     /'
  echo "   Roll back (as root on the VPS):"
  echo "     docker exec $PGC psql -U supabase_admin -d $DEV_DB -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'"
  echo "     zcat $BACKUP | docker exec -i $PGC psql -U supabase_admin -d $DEV_DB"
  echo "     docker start $DEV_CONTAINER"
  exit 1
fi

# Clear the cloned Directus license so dev runs keyless (Core/grace) and never
# re-activates. The clone carries prod's license_key/license_token encrypted with
# PROD's KEY/SECRET — dev can't decrypt them and would re-activate from the env
# LICENSE_KEY, burning a fresh activation slot every night until the 5-activation
# cap is exhausted (dev crash-loops on "Activation limit exceeded"). Dev has no
# LICENSE_KEY in its .env (commented out 2026-07-15), so nulling these keeps dev
# in the 30-day Core grace period, which resets on every nightly clone. Prod is
# untouched. Runs unconditionally (independent of the PII scrub flag).
echo "[5b/7] Clearing cloned license (dev runs keyless / Core grace)"
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" </dev/null \
  -c "UPDATE directus_settings SET license_key=NULL, license_token=NULL;" >/dev/null 2>&1 || true

if [ "$DO_SCRUB" = "1" ]; then
  echo "[6/7] Scrubbing credentials + PII (refresh-dev-scrub.sql)"
else
  echo "[6/7] Scrubbing credentials only (--no-scrub keeps PII)"
fi
if ! docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 -v scrub_pii="$DO_SCRUB" -q < "$SCRUB"; then
  echo "!! Scrub FAILED — dev left STOPPED (unscrubbed prod data is NOT served)."
  echo "   Safety backup: $BACKUP"
  exit 1
fi
if [ "$DO_SCRUB" = "1" ]; then
  docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" </dev/null \
    -c "UPDATE directus_settings SET project_url='https://wiedisync.pages.dev' WHERE project_url IS NOT NULL;" >/dev/null 2>&1 || true
fi

echo "[7/7] Re-pinning dev creds by id (allowlist passwords + all captured tokens)"
# awk builds the UPDATEs (no shell expansion of the \$-laden password hashes);
# \047 is a single quote, so the awk program stays single-quote-safe.
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
if ! docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 -q < "$REPIN"; then
  echo "   (warning: some re-pins failed; admin/cron login on dev may need attention)"
fi

echo "[7b/7] Prod-equality guard (null any dev token / non-allowlist password hash identical to prod)"
# Prints "UPDATE <n>" per kind; non-zero n = a dev credential that was still a
# prod credential, now gone. Mint a dev-only token / set a dev-only password on
# dev and the next refresh's re-pin keeps it.
if ! docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 < "$PGUARD" 2>&1 | sed 's/^/      /'; then
  echo "!! Prod-equality guard FAILED — dev left STOPPED (it may still hold prod credentials)."
  echo "   Safety backup: $BACKUP"
  exit 1
fi

docker start "$DEV_CONTAINER" >/dev/null </dev/null
echo "==> VPS phase done. Dev restarted. Safety backup: $BACKUP"
REMOTE

echo
if [ "$DO_MIGRATE" -eq 1 ]; then
  echo "==> Reconciling dev-branch schema on top of prod data (db:migrate:dev) ..."
  npm run db:migrate:dev
else
  echo "==> Skipped db:migrate:dev (--no-migrate). Run it manually if dev schema is ahead of prod."
fi

echo
echo "✔ Dev refreshed from prod."
echo "  • Permissions came from the prod clone (already correct)."
echo "  • Files/images are NOT copied — directus_files rows reference prod assets that don't exist in dev storage, so some images 404 in dev."
echo "  • Test it at https://wiedisync.pages.dev"
