#!/usr/bin/env bash
#
# check-file-integrity.sh — verify every file in directus_files actually IS what it claims.
#
#   npm run files:check:prod
#   npm run files:check:dev
#
# WHY
# ---
# On 2026-07-06 the registration upload endpoint began silently truncating the FRONT of
# every multi-chunk upload (a `req.on('data')` counter put the request into flowing mode,
# so the leading chunks were consumed and discarded before FilesService.uploadOne()
# attached its pipe). The stored files kept a valid PDF trailer and a plausible filesize;
# nothing errored and nothing logged. 36 government-ID scans and licence PDFs were
# destroyed and it went unnoticed for a week — until a human tried to open one.
#
# The bug is fixed (commit ffd019fc). This script exists so the NEXT one is caught in a
# day, not a week: it compares each file's leading magic bytes against directus_files.type.
# A file whose declared type does not match its actual content is either truncated,
# mislabelled, or corrupt.
#
# Reads from the local uploads mirror maintained by backup-uploads.sh (/data/uploads-mirror),
# so it costs no R2 egress. Run it after that, or pass --refresh to sync first.

set -uo pipefail

ENV_NAME="${1:-prod}"
REFRESH=false
for a in "$@"; do [ "$a" = "--refresh" ] && REFRESH=true; done

if [ "$ENV_NAME" = "prod" ]; then DB=postgres; BUCKET=r2:kscw-uploads
else DB=directus_kscw_dev; BUCKET=r2:kscw-uploads-dev; fi
MIRROR=/data/uploads-mirror

if $REFRESH; then
  echo "==> refreshing the local mirror from $BUCKET"
  ssh -n hetzner "sudo rclone copy '$BUCKET' '$MIRROR' --transfers 8 --stats-one-line" 2>/dev/null
fi

echo "==> checking every directus_files row against its actual bytes ($ENV_NAME)"

ssh hetzner "sudo bash -s" <<EOF
set -uo pipefail
DB=$DB
MIRROR=$MIRROR
ok=0; bad=0; absent=0; empty=0; mislabel=0

while IFS='|' read -r id disk typ size; do
  [ -z "\$disk" ] && continue
  f="\$MIRROR/\$disk"
  if [ ! -f "\$f" ]; then
    absent=\$((absent+1)); echo "  ABSENT   \$disk (\$typ)"; continue
  fi
  magic=\$(head -c 8 "\$f" | od -An -tx1 | tr -d ' \n')
  actual=\$(stat -c%s "\$f")

  # What do the bytes actually SAY they are?
  sniffed=unknown
  case "\$magic" in
    25504446*) sniffed=application/pdf;;
    ffd8ff*)   sniffed=image/jpeg;;
    89504e47*) sniffed=image/png;;
    52494646*) sniffed=image/webp;;
    47494638*) sniffed=image/gif;;
    3c3f786d*|3c737667*) sniffed=image/svg+xml;;
    000000*)   sniffed=image/avif;;   # ftyp box
  esac

  if [ "\$actual" -eq 0 ]; then
    empty=\$((empty+1))
    echo "  EMPTY        \$disk  declared=\$typ  (0 bytes — content never written)"
  elif [ "\$sniffed" = "\$typ" ]; then
    ok=\$((ok+1))
  elif [ "\$sniffed" != "unknown" ]; then
    # Valid file, just labelled as the wrong type. Browsers sniff, so it renders.
    # Benign — do NOT alarm, or the nightly run cries wolf and gets ignored.
    mislabel=\$((mislabel+1))
    echo "  MISLABELLED  \$disk  declared=\$typ  actually=\$sniffed  (renders fine; cosmetic)"
  elif [ "\$typ" = "image/svg+xml" ] || [ "\$typ" = "image/avif" ]; then
    ok=\$((ok+1))   # no reliable fixed magic for these
  else
    # Bytes match NOTHING known -> genuinely corrupt (this is what truncation looks like).
    bad=\$((bad+1))
    echo "  CORRUPT      \$disk  declared=\$typ  magic=0x\${magic:0:8}  bytes=\$actual"
  fi
done < <(docker exec kscw-postgres psql -U supabase_admin -d \$DB -tAc \
  "SELECT id||'|'||filename_disk||'|'||COALESCE(type,'?')||'|'||COALESCE(filesize,0) FROM directus_files WHERE filename_disk IS NOT NULL ORDER BY uploaded_on;")

echo
echo "  valid: \$ok   CORRUPT: \$bad   EMPTY: \$empty   mislabelled (benign): \$mislabel   missing: \$absent"
if [ "\$bad" -eq 0 ] && [ "\$empty" -eq 0 ] && [ "\$absent" -eq 0 ]; then
  echo "  ✓ no corrupt or empty files"
else
  echo "  ✗ integrity problems found — see above"
fi
exit \$(( (bad + empty + absent) > 0 ? 1 : 0 ))
EOF
