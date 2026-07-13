#!/usr/bin/env bash
#
# verify-backup-key.sh — prove the escrowed GPG key actually decrypts a real backup.
#
#   npm run backup:verify-key
#
# WHY THIS EXISTS
# ---------------
# The VPS holds only the PUBLIC half of backup@kscw.ch, so it can encrypt dumps but
# cannot decrypt them (correct: a rooted VPS cannot read its own backups). The
# consequence is that nothing on the VPS can restore-test the .gpg files — and
# /usr/local/bin/restore-test.sh only ever exercises the PLAINTEXT .sql.gz. So the
# encrypted archives, which are the only copies that leave the building (GDrive, R2,
# NAS), were never verified end-to-end until 2026-07-13.
#
# They turned out to be fine, but the key nearly read as unrecoverable — see below.
# Run this quarterly, and after ANY change to the vault entries or the backup script.
#
# THE VAULT LAYOUT IS NOT WHAT YOU EXPECT  (read before doing DR by hand)
# ----------------------------------------------------------------------
# The armored private key is split across two Vaultwarden entries in folder
# services/directus-kscw-prod, and one line hides in a password field:
#
#   "GPG - KSCW Backup PRIVATE KEY (part 1 of 2)"
#       password : the "-----BEGIN PGP PRIVATE KEY BLOCK-----" armor header
#       notes    : base64 body, lines 1-57
#
#   "GPG - KSCW Backup PRIVATE KEY (part 2 of 2)"
#       password : ONE 64-char base64 body line  <-- line 58. NOT a label. Easy to miss.
#       notes    : base64 body lines 59-114, then the =CRC line, then the END line
#
#   "GPG - KSCW Backup Encryption"
#       password : the key's passphrase
#       notes    : the public key + metadata
#
# Concatenating just the two `notes` fields — the obvious move — drops line 58 and
# yields "gpg: CRC error" and then "mpi too large", which looks exactly like a
# corrupt, unrecoverable key. It isn't. You are one line short.
#
# Expected identity:  B3AB83F8C9DD9A9C664B610B1CC2657BF54F59E3
#                     KSCW Backup Encryption <backup@kscw.ch>  (RSA-4096, 2026-05-14)
#
# SAFETY
# ------
# Imports into a THROWAWAY GNUPGHOME under $TMPDIR — never your real keyring.
# The private key never touches the VPS. Prints only a verdict + fingerprint.
# All key material is shredded on exit, including on failure.

set -uo pipefail
umask 077

FOLDER="services/directus-kscw-prod"
EXPECT_FPR="B3AB83F8C9DD9A9C664B610B1CC2657BF54F59E3"
CHUNK=2000000   # 2 MB is plenty: it proves the session key unwrapped and the gzip stream starts.

command -v rbw >/dev/null || { echo "ERROR: rbw not installed"; exit 2; }
rbw unlocked 2>/dev/null || { echo "ERROR: rbw is locked. Run: rbw unlock"; exit 2; }

WORK="$(mktemp -d)"
export GNUPGHOME="$WORK/gnupg"
mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
trap '
  gpgconf --kill gpg-agent 2>/dev/null
  find "$WORK" -type f -exec shred -u {} + 2>/dev/null
  rm -rf "$WORK" 2>/dev/null
' EXIT

echo "==> Reassembling the private key from Vaultwarden"
rbw get --field password "GPG - KSCW Backup PRIVATE KEY (part 1 of 2)" --folder "$FOLDER" > "$WORK/hdr" 2>/dev/null
rbw get --field notes    "GPG - KSCW Backup PRIVATE KEY (part 1 of 2)" --folder "$FOLDER" > "$WORK/b1"  2>/dev/null
rbw get --field password "GPG - KSCW Backup PRIVATE KEY (part 2 of 2)" --folder "$FOLDER" > "$WORK/mid" 2>/dev/null
rbw get --field notes    "GPG - KSCW Backup PRIVATE KEY (part 2 of 2)" --folder "$FOLDER" > "$WORK/b2"  2>/dev/null

BEGIN_LINE="$(grep -m1 'BEGIN PGP PRIVATE KEY BLOCK' "$WORK/hdr" 2>/dev/null)"
[ -n "$BEGIN_LINE" ] || { echo "FAIL: no armor header in part 1's password field"; exit 1; }

# header, blank line, then body: part1 notes + part2 PASSWORD (the missing line) + part2 notes
{
  printf '%s\n\n' "$BEGIN_LINE"
  cat "$WORK/b1" "$WORK/mid" "$WORK/b2" | grep -v '^[[:space:]]*$'
} > "$WORK/key.asc"

echo "==> Importing into a throwaway keyring"
if ! gpg --batch --quiet --import "$WORK/key.asc" 2>"$WORK/import.err"; then
  echo "FAIL: import rejected the reassembled key"
  sed 's/^/      /' "$WORK/import.err" | head -6
  echo "      (If you see 'CRC error': the vault layout changed — re-read the header of this script.)"
  exit 1
fi

FPR="$(gpg --batch --list-secret-keys --with-colons 2>/dev/null | awk -F: '/^fpr:/{print $10; exit}')"
echo "    fingerprint: $FPR"
if [ "$FPR" != "$EXPECT_FPR" ]; then
  echo "FAIL: fingerprint mismatch — expected $EXPECT_FPR"
  exit 1
fi
echo "    matches the public key the VPS encrypts to"

echo "==> Fetching ${CHUNK} bytes of the newest real archive from the VPS"
LATEST="$(ssh hetzner "sudo ls -1t /data/backups/*.sql.gz.gpg 2>/dev/null | head -1" | tr -d '\r')"
[ -n "$LATEST" ] || { echo "FAIL: no .sql.gz.gpg found in /data/backups"; exit 1; }
echo "    $LATEST"
ssh hetzner "sudo head -c $CHUNK '$LATEST'" > "$WORK/chunk.gpg" 2>/dev/null

echo "==> Decrypting (a truncation error at the tail is expected and harmless)"
rbw get "GPG - KSCW Backup Encryption" --folder "$FOLDER" > "$WORK/pw" 2>/dev/null
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$WORK/pw" \
    --decrypt "$WORK/chunk.gpg" > "$WORK/out.bin" 2>"$WORK/dec.err"

OUT="$(wc -c < "$WORK/out.bin")"
MAGIC="$(head -c2 "$WORK/out.bin" | od -An -tx1 | tr -d ' \n')"

# gpg necessarily reports "encrypted message has been manipulated" and a checksum
# error here: we fed it a deliberately truncated file, so the MDC tag at the end is
# absent. That is expected. What proves the key is good is that the session key
# unwrapped at all and produced a valid gzip stream containing the dump header.
#
# Read the gzip header WITHOUT letting the pipeline's exit status decide the verdict:
# under `set -o pipefail`, gunzip on a truncated stream (and head closing the pipe)
# returns non-zero even when the bytes are perfectly good.
DUMP_HDR="$( { gunzip -c < "$WORK/out.bin" 2>/dev/null || true; } | head -c 300 || true )"

if [ "$OUT" -gt 100000 ] && [ "$MAGIC" = "1f8b" ] \
   && printf '%s' "$DUMP_HDR" | grep -qa 'PostgreSQL database dump'; then
  echo
  echo "PASS — the escrowed key decrypts the real backup archive."
  echo "       ${OUT} bytes recovered, valid gzip, PostgreSQL dump header present."
  echo "       (gpg's 'message has been manipulated' warning above is expected:"
  echo "        we only fetched the first ${CHUNK} bytes, so the MDC tag is missing.)"
  exit 0
fi

echo
echo "FAIL — key imported but did not decrypt the archive."
echo "       decrypted ${OUT} bytes, magic 0x${MAGIC} (expected 1f8b)"
sed 's/^/       /' "$WORK/dec.err" | head -8
exit 1
