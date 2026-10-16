#!/usr/bin/env bash
#
# github-token-rotate.sh <dev|prod> — put a new GitHub token on a Directus
# server. Used for the switch to the club account (handover item G2) and for
# every renewal after that.
#
#   rbw get "GitHub PAT - KSCWiedikon (Directus server)" --folder services/github \
#     | bash scripts/github-token-rotate.sh dev
#
# The token lives in two places, and both are replaced:
#   1. GITHUB_PAT of the Directus container (bug reports → GitHub issues, AI
#      bug-fix workflows, merging the bug-fix PR) — via directus-set-env.sh
#   2. the Authorization header of every Flow step that calls api.github.com
#      ("Auto-rebuild website (content change)")
# The flows are changed first and loaded by the container recreate in step 1.
#
# Before touching anything it proves the token can do what the server needs,
# with requests that change nothing (a missing workflow, an empty issue or PR,
# a missing branch): 404/422 means allowed, 403 means the permission is missing.
# The token is read from STDIN and never printed; only short hashes are shown.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
case "$TARGET" in
  dev)  CONT=directus-kscw-dev ;;
  prod) CONT=directus-kscw ;;
  *) echo "usage: printf '%s' TOKEN | scripts/github-token-rotate.sh <dev|prod>" >&2; exit 1 ;;
esac
[ -t 0 ] && { echo "!! pipe the token on stdin" >&2; exit 1; }
TOKEN=$(head -n1 | tr -d '\r\n')
[[ "$TOKEN" =~ ^(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+)$ ]] || { echo "!! that does not look like a GitHub token" >&2; exit 1; }
sha(){ printf '%s' "$1" | sha256sum | cut -c1-8; }
NEW=$(sha "$TOKEN")
say(){ echo "[gh-token:$TARGET] $*"; }

gh_api(){ # method path body → HTTP code
  curl -s -o /dev/null -w '%{http_code}' -X "$1" \
    -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") \
    -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
    "https://api.github.com$2" ${3:+-d "$3"}
}

say "1/4 checking the token (sha $NEW)"
LOGIN=$(curl -s -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") https://api.github.com/user \
  | python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("login") or "")')
[ -n "$LOGIN" ] || { echo "!! GitHub does not accept the token" >&2; exit 1; }
say "    belongs to $LOGIN"
fail=0
for r in wiedisync kscw-website; do
  check(){ local got; got=$(gh_api "$1" "/repos/KSC-Wiedikon/$r$2" "$3")
    if [ "$got" = "$4" ]; then say "    ok   $r: $5"; else say "    MISSING $r: $5 (HTTP $got, want $4)"; fail=1; fi; }
  check POST /actions/workflows/does-not-exist.yml/dispatches '{"ref":"main"}' 404 'Actions read/write'
  check POST /issues '{}' 422 'Issues read/write'
  check PATCH /git/refs/heads/does-not-exist '{"sha":"0000000000000000000000000000000000000000"}' 422 'Contents read/write'
  check POST /pulls '{}' 422 'Pull requests read/write'
done
[ "$fail" = 0 ] || { echo "!! fix the token's permissions on GitHub first; nothing was changed" >&2; exit 1; }

say "2/4 replacing the token in the Flow steps that call GitHub"
# First stdin line = the token; the rest = the remote script (as in directus-set-env.sh)
{ printf '%s\n' "$TOKEN"; cat <<'REMOTE'; } | ssh hetzner "sudo bash -c 'IFS= read -r TOKEN; export TOKEN; exec bash -s -- $CONT'"
set -euo pipefail
CONT=$1
DB=$(docker exec "$CONT" printenv DB_DATABASE)
# </dev/null: this script itself arrives on stdin, psql must not eat it
q(){ docker exec kscw-postgres psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -Atqc "$1" </dev/null; }
q "select '    before: ' || count(*) || ' step(s) with a GitHub token' from directus_operations where options::text ~ '(github_pat_|ghp_)[A-Za-z0-9_]+'"
# SQL on stdin, not argv (printf is a builtin): the token never shows up in ps
printf '%s\n' "update directus_operations set options = regexp_replace(options::text, '(github_pat_|ghp_)[A-Za-z0-9_]+', '$TOKEN', 'g')::json where options::text ~ 'api[.]github[.]com' and options::text ~ '(github_pat_|ghp_)[A-Za-z0-9_]+';" \
  | docker exec -i kscw-postgres psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -Atq
q "select '    updated: ' || o.key || ' in \"' || f.name || '\"' from directus_operations o join directus_flows f on f.id = o.flow where o.options::text ~ 'api[.]github[.]com'"
REMOTE

say "3/4 setting GITHUB_PAT (recreates $CONT, which also reloads the flows)"
printf '%s' "$TOKEN" | bash scripts/directus-set-env.sh "$TARGET" GITHUB_PAT

say "4/4 verifying"
out=$(ssh hetzner "sudo bash -s -- $CONT" <<'REMOTE'
CONT=$1
DB=$(docker exec "$CONT" printenv DB_DATABASE </dev/null)
echo "env $(docker exec "$CONT" printenv GITHUB_PAT </dev/null | tr -d '\n' | sha256sum | cut -c1-8)"
docker exec kscw-postgres psql -U postgres -d "$DB" -Atc \
  "select substring(options::text from '(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+)') from directus_operations where options::text ~ 'api[.]github[.]com'" </dev/null \
  | while IFS= read -r t; do echo "flow $(printf '%s' "$t" | sha256sum | cut -c1-8)"; done
REMOTE
)
while read -r what h; do
  if [ "$h" = "$NEW" ]; then say "    ok   $what uses the new token"; else say "    OLD  $what still uses $h"; fail=1; fi
done <<<"$out"
[ "$fail" = 0 ] || exit 1
say "Done. Revoke the old token on GitHub once both dev and prod are switched."
