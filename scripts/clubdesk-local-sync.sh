#!/usr/bin/env bash
#
# clubdesk-local-sync.sh <members|finance> <dev|prod> — the scrape → import
# chains behind `npm run db:clubdesk:sync:*` and `db:finance:sync:*`, run from
# a workstation (the nightly finance chain runs from lenovoserver's crontab).
#
# Why this exists (audit 2026-09-28, F73). The chains used to be one-line npm
# scripts writing the ClubDesk exports to FIXED /tmp paths and deleting them
# with a trailing `&& rm -f`. Any failing step skipped the rm, so the member
# register (AHV, IBAN, addresses, birthdates) or the invoice/booking CSVs were
# left behind 0664 in a shared /tmp — every night for the finance chain while
# it was failing. Now:
#   • umask 077 before anything is written, so the CSVs are 0600;
#   • a private mktemp -d directory (0700), also used as TMPDIR so Playwright's
#     own download scratch lands inside it;
#   • a trap that removes it on EVERY exit path, success or failure.
#
# Usage:
#   scripts/clubdesk-local-sync.sh members dev
#   scripts/clubdesk-local-sync.sh finance prod
set -euo pipefail

KIND="${1:-}"
TARGET="${2:-}"
case "$TARGET" in
  dev|prod) ;;
  *) echo "usage: scripts/clubdesk-local-sync.sh <members|finance> <dev|prod>" >&2; exit 1 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

umask 077
WORK="$(mktemp -d -t kscw-clubdesk-XXXXXX)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
export TMPDIR="$WORK"

case "$KIND" in
  members)
    node directus/scripts/clubdesk-scrape-export.mjs "$WORK/clubdesk-export.csv"
    node directus/scripts/import-clubdesk-csv.mjs "$TARGET" "$WORK/clubdesk-export.csv"
    ;;
  finance)
    node directus/scripts/clubdesk-scrape-finance.mjs "$WORK/cd-rechnungen.csv" "$WORK/cd-buchhaltung.csv"
    node directus/scripts/import-clubdesk-finance.mjs "$TARGET" "$WORK/cd-rechnungen.csv" "$WORK/cd-buchhaltung.csv"
    ;;
  *)
    echo "usage: scripts/clubdesk-local-sync.sh <members|finance> <dev|prod>" >&2
    exit 1
    ;;
esac
