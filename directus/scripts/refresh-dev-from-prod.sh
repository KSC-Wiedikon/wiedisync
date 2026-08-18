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
#   6. Scrub PII: member/user emails -> non-deliverable sink, phones nulled,
#      push subscriptions + sessions + verification rows cleared. Admin/dev
#      login emails are kept on an allowlist so OAuth + admin login still work.
#   7. Re-pin dev's captured service creds onto the cloned allowlist accounts,
#      restart dev Directus.
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
#
set -euo pipefail

# script lives in directus/scripts/ -> cd to repo root for npm
cd "$(dirname "$0")/../.."

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
  echo " * PII is SCRUBBED: emails -> sink, phones -> null, push/sessions cleared."
else
  echo " * !! --no-scrub: REAL prod emails/phones will be copied into dev."
fi
echo

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Type 'refresh dev' to proceed: " ans
  [ "$ans" = "refresh dev" ] || { echo "Aborted."; exit 1; }
fi

echo "==> Running clone + scrub on the VPS (this can take a minute) ..."

# Quoted heredoc => nothing is expanded locally; config is passed as positional
# args to the remote bash. Every `docker exec` that is NOT a file/pipe redirect
# gets </dev/null so it can't swallow the script stream.
ssh "$SSH_HOST" "sudo bash -s -- $DO_SCRUB $PGC $PROD_DB $DEV_DB $DEV_CONTAINER" <<'REMOTE'
set -uo pipefail
DO_SCRUB="$1"; PGC="$2"; PROD_DB="$3"; DEV_DB="$4"; DEV_CONTAINER="$5"
TS=$(date +%F_%H%M%S)
BACKUP=/data/backups/kscw_dev_pre-refresh_${TS}.sql.gz
CREDS=/tmp/refresh_devcreds_${TS}.txt
SCRUB=/tmp/refresh_scrub_${TS}.sql
REPIN=/tmp/refresh_repin_${TS}.sql
RLOG=/tmp/refresh_restore_${TS}.log

# Emails kept REAL after scrub (admin/cron logins + your own OAuth account).
# Used both as the scrub allowlist and as the re-pin filter.
ALLOW_SQL="'admin@kscw.ch','aniish.k@hotmail.com','anja_jimenez@hotmail.com','cron-service@kscw.ch','luca.canepa@gmail.com','thamayanth.kanagalingam@uzh.ch'"

echo "[1/7] Capturing dev service-account creds (for re-pin after clone)"
# id is captured FIRST and used as the re-pin key: it survives the PII scrub
# (which rewrites emails), so both allowlist service accounts AND token-holding
# members (e.g. the db:smoke test member) get their token restored.
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -t -A -F'|' </dev/null \
  -c "SELECT id, email, coalesce(password,''), coalesce(token,'') FROM directus_users WHERE token IS NOT NULL OR lower(email) IN ($ALLOW_SQL);" \
  > "$CREDS" 2>/dev/null || true

echo "[2/7] Safety snapshot of dev -> $BACKUP"
docker exec "$PGC" pg_dump -U supabase_admin -d "$DEV_DB" --no-owner --no-acl </dev/null | gzip > "$BACKUP"
if [ ! -s "$BACKUP" ]; then
  echo "!! Safety dump failed/empty — aborting BEFORE touching dev (dev untouched)."
  rm -f "$CREDS"; exit 1
fi
echo "      $(ls -lh "$BACKUP" | awk '{print $5}')"

echo "[3/7] Stopping dev Directus + recreating public schema"
docker stop "$DEV_CONTAINER" >/dev/null </dev/null
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 </dev/null \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DEV_DB' AND pid<>pg_backend_pid();" >/dev/null
docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 </dev/null \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO supabase_admin; GRANT USAGE ON SCHEMA public TO anon, authenticated;" >/dev/null

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
  echo "   Restore log:   $RLOG"
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
  echo "[6/7] Scrubbing PII"
  cat > "$SCRUB" <<'SQL'
BEGIN;

-- Members (real player PII)
UPDATE members SET email    = 'member_' || id || '@devsink.invalid' WHERE email IS NOT NULL AND email <> '';
UPDATE members SET vm_email = NULL WHERE vm_email IS NOT NULL;
UPDATE members SET phone    = NULL WHERE phone IS NOT NULL;

-- Directus login accounts (keep admin/dev logins on the allowlist)
UPDATE directus_users
   SET email = 'user_' || id || '@devsink.invalid'
 WHERE email IS NOT NULL
   AND lower(email) NOT IN (
     'admin@kscw.ch','aniish.k@hotmail.com','anja_jimenez@hotmail.com',
     'cron-service@kscw.ch','luca.canepa@gmail.com','thamayanth.kanagalingam@uzh.ch'
   );

-- ClubDesk: {basketball,people,volleyball} are VIEWS over clubdesk_export — scrub the base only
UPDATE clubdesk_export SET
  email            = CASE WHEN email IS NOT NULL AND email<>'' THEN 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid' ELSE email END,
  email_alternativ = CASE WHEN email_alternativ IS NOT NULL AND email_alternativ<>'' THEN 'scrub_'||substr(md5(email_alternativ),1,16)||'@devsink.invalid' ELSE email_alternativ END;

-- Other contact tables
UPDATE event_signups             SET email         = 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid'         WHERE email IS NOT NULL AND email<>'';
UPDATE feedback                  SET email         = 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid'         WHERE email IS NOT NULL AND email<>'';
UPDATE game_scheduling_opponents SET contact_email = 'scrub_'||substr(md5(contact_email),1,16)||'@devsink.invalid' WHERE contact_email IS NOT NULL AND contact_email<>'';
UPDATE newsletter_subscribers    SET email         = 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid'         WHERE email IS NOT NULL AND email<>'';
UPDATE registrations             SET email         = 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid'         WHERE email IS NOT NULL AND email<>'';
UPDATE sv_vm_check               SET email         = 'scrub_'||substr(md5(email),1,16)||'@devsink.invalid'         WHERE email IS NOT NULL AND email<>'';
UPDATE svrz_spielplaner_contacts SET contact_email = CASE WHEN contact_email IS NOT NULL AND contact_email<>'' THEN 'scrub_'||substr(md5(contact_email),1,16)||'@devsink.invalid' ELSE contact_email END,
                                     contact_phone = NULL;
UPDATE vm_vb_spielplan_contact   SET "Email"       = 'scrub_'||substr(md5("Email"),1,16)||'@devsink.invalid'       WHERE "Email" IS NOT NULL AND "Email"<>'';

-- Mailbox credentials (Emails Garage, migration 326).
-- ⚠⚠ The INVENTORY is useful on dev; the CIPHERTEXT is not. Without this, a
-- clone hands dev every club mailbox password, and the only thing standing
-- between dev and plaintext is EMAIL_VAULT_KEY differing between the two
-- containers — a one-line env mistake away from being the same key. Null the
-- column instead so the question cannot arise: dev's page lists the accounts
-- and honestly reports "no password stored".
UPDATE email_accounts SET password_enc = NULL WHERE password_enc IS NOT NULL;

-- Devices / transient state
TRUNCATE push_subscriptions;
DELETE FROM email_verifications;
DELETE FROM directus_sessions;

COMMIT;
SQL
  if ! docker exec -i "$PGC" psql -U supabase_admin -d "$DEV_DB" -v ON_ERROR_STOP=1 -q < "$SCRUB"; then
    echo "!! Scrub FAILED — dev left STOPPED (unscrubbed prod data is NOT served)."
    echo "   Safety backup: $BACKUP   Scrub SQL: $SCRUB   Captured creds: $CREDS"
    exit 1
  fi
  docker exec "$PGC" psql -U supabase_admin -d "$DEV_DB" </dev/null \
    -c "UPDATE directus_settings SET project_url='https://wiedisync.pages.dev' WHERE project_url IS NOT NULL;" >/dev/null 2>&1 || true
else
  echo "[6/7] Scrub SKIPPED (--no-scrub)"
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

docker start "$DEV_CONTAINER" >/dev/null </dev/null
rm -f "$SCRUB" "$REPIN" "$CREDS" "$RLOG"
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
