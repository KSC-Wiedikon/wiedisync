#!/usr/bin/env bash
# Launcher for the Directus content MCP (@directus/content-mcp) — DEV only.
#
# Uses a SCOPED, READ-ONLY static token sourced from Vaultwarden (rbw) at startup.
# Deliberately NOT admin email/password: an LLM-driven MCP must not hold write access.
# No token is stored in the Claude config; rbw must be UNLOCKED (`rbw unlock`).
#
# One-time setup (done by a human in the Directus DEV admin UI):
#   1. Settings → Access Policies → create "MCP read-only" (App/Admin access OFF),
#      grant READ on the collections the MCP should see (no create/update/delete).
#   2. User Directory → create e.g. mcp-readonly@kscw.ch, attach that policy,
#      generate a Static Token, copy it.
#   3. Store it in Vaultwarden:  folder `repos/wiedisync-local`, name
#      `DIRECTUS_DEV_MCP_TOKEN`  (value = the static token).
#
# Then register:  claude mcp add directus-dev --scope local -- \
#                   bash directus/scripts/directus-mcp.sh
set -euo pipefail
export DIRECTUS_URL="${DIRECTUS_URL:-https://directus-dev.kscw.ch}"
export DIRECTUS_TOKEN
DIRECTUS_TOKEN="$(rbw get --folder repos/wiedisync-local DIRECTUS_DEV_MCP_TOKEN)"
exec npx -y @directus/content-mcp@latest
