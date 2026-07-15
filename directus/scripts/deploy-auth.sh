#!/usr/bin/env bash
# One-command Directus DB deploy with Vaultwarden-sourced credentials.
#
# Removes the manual token dance: reads the Directus admin login (and, on dev, the
# member smoke token) from Vaultwarden via `rbw` and runs the full DB deploy chain
# — snapshot → migrate → setup-perms → smoke — with the right env set, without ever
# pasting a token on the command line.
#
# `setup-permissions.mjs` authenticates by ADMIN_EMAIL/ADMIN_PASSWORD (password
# login) — the reliable path for BOTH envs (the static prod token lacks
# directus_roles access; see the kscw-deploy-tokens memory).
#
# Prereq: rbw must be UNLOCKED (`rbw unlock` — needs the master password via TTY;
# reads are non-interactive once unlocked).
#
# Usage:
#   directus/scripts/deploy-auth.sh dev
#   directus/scripts/deploy-auth.sh prod
#   directus/scripts/deploy-auth.sh prod --perms-only   # skip snapshot+migrate
set -euo pipefail

ENV="${1:?usage: deploy-auth.sh <dev|prod> [--perms-only]}"
MODE="${2:-full}"
cd "$(dirname "$0")/../.."   # repo root

case "$ENV" in
  dev)  ADMIN_ENTRY=kscw-dev-admin-user;  ADMIN_FOLDER=services/directus-kscw-dev ;;
  prod) ADMIN_ENTRY=kscw-prod-admin-user; ADMIN_FOLDER=services/directus-kscw-prod ;;
  *) echo "✗ env must be dev|prod" >&2; exit 1 ;;
esac

rbw unlocked >/dev/null 2>&1 || { echo "✗ rbw is locked — run: rbw unlock" >&2; exit 1; }

export ADMIN_EMAIL
export ADMIN_PASSWORD
ADMIN_EMAIL="$(rbw get "$ADMIN_ENTRY" --folder "$ADMIN_FOLDER" --field username)"
ADMIN_PASSWORD="$(rbw get "$ADMIN_ENTRY" --folder "$ADMIN_FOLDER")"

if [ "$MODE" != "--perms-only" ]; then
  echo "▶ snapshot ($ENV)"; npm run "db:snapshot:$ENV"
  echo "▶ migrate ($ENV)";  npm run "db:migrate:$ENV"
fi

echo "▶ setup-perms ($ENV) — re-run until it reports 0 errors (idempotent; transient CF 502s just need a retry)"
npm run "db:setup-perms:$ENV"

if [ "$ENV" = "dev" ]; then
  echo "▶ smoke (dev)"
  SMOKE_TEST_TOKEN="$(rbw get --folder repos/wiedisync-local DIRECTUS_DEV_USER_TOKEN_MEMBER)" \
    npm run db:smoke:dev || echo "  (dev smoke is flaky — verify via the directus_permissions DB query if it 401s)"
else
  echo "▶ smoke (prod) skipped — no member token in vault; verify a perms change with:"
  echo "    ssh hetzner \"sudo docker exec kscw-postgres psql -U postgres -d postgres -c \\\"SELECT count(*) FROM directus_permissions\\\"\""
fi

echo "✓ $ENV DB deploy complete"
