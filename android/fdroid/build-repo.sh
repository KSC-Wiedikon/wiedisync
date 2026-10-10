#!/usr/bin/env bash
# Builds the static F-Droid repo served at https://fdroid.kscw.ch/repo.
#
#   android/fdroid/build-repo.sh <dir-with-release-apks> <out-dir>
#
# Every APK in <dir> becomes a version in the repo (CI passes all GitHub
# release APKs, so older versions stay installable). Needs fdroidserver
# (Debian's package: its androguard is patched for current APKs, PyPI's is
# not), keytool, and the repo signing key: FDROID_KEYSTORE (path),
# FDROID_KEYSTORE_PASSWORD, FDROID_KEY_ALIAS. Writes <out-dir>/site/ — the
# only thing to upload; the config holding the key password never leaves
# <out-dir>/work/.
set -euo pipefail

APKS=$(cd "$1" && pwd)
OUT=$2
HERE=$(cd "$(dirname "$0")" && pwd)
APP=ch.kscw.wiedisync

: "${FDROID_KEYSTORE:?}" "${FDROID_KEYSTORE_PASSWORD:?}" "${FDROID_KEY_ALIAS:?}"

rm -rf "$OUT"
mkdir -p "$OUT/work/repo" "$OUT/work/metadata/$APP" "$OUT/site"
WORK=$(cd "$OUT/work" && pwd)

cp "$HERE/metadata/$APP.yml" "$WORK/metadata/"
# fdroid only attaches changelogs/<versionCode>.txt ("What's new") to the current version.
GRADLE="$HERE/../app/build.gradle.kts"
VERSION_CODE=$(sed -n 's/^ *versionCode = \([0-9]*\).*/\1/p' "$GRADLE")
VERSION_NAME=$(sed -n 's/^ *versionName = "\(.*\)".*/\1/p' "$GRADLE")
printf 'CurrentVersion: %s\nCurrentVersionCode: %s\n' "$VERSION_NAME" "$VERSION_CODE" >> "$WORK/metadata/$APP.yml"
# Store texts, changelogs and icon, in fastlane layout (also what main F-Droid reads).
cp -r "$HERE/../fastlane/metadata/android/." "$WORK/metadata/$APP/"
cp "$APKS"/*.apk "$WORK/repo/"
# fdroid resolves repo_icon from the working dir and copies it into repo/icons/.
cp "$HERE/../../public/icons/icon-512.png" "$WORK/icon.png"

umask 077
cat > "$WORK/config.yml" <<EOF
repo_url: https://fdroid.kscw.ch/repo
repo_name: KSC Wiedikon
repo_description: >-
  Apps of KSC Wiedikon, the volleyball and basketball club in Zurich.
repo_icon: icon.png
archive_older: 0
keystore: $FDROID_KEYSTORE
repo_keyalias: $FDROID_KEY_ALIAS
keystorepass: $FDROID_KEYSTORE_PASSWORD
keypass: $FDROID_KEYSTORE_PASSWORD
EOF

# Without an SDK, fdroid uses the apksigner on PATH (Debian: apt install apksigner).
[ -n "${ANDROID_HOME:-}" ] && echo "sdk_path: $ANDROID_HOME" >> "$WORK/config.yml"

(cd "$WORK" && fdroid update --rename-apks --use-date-from-apk)

cp -r "$WORK/repo" "$OUT/site/repo"
# Landing page: the repo address + fingerprint, for adding it in an F-Droid client.
FINGERPRINT=$(keytool -list -v -storetype PKCS12 -keystore "$FDROID_KEYSTORE" \
  -storepass "$FDROID_KEYSTORE_PASSWORD" -alias "$FDROID_KEY_ALIAS" 2>/dev/null \
  | sed -n 's/.*SHA256: //p' | tr -d ':' | tr 'A-F' 'a-f')
sed "s/@FINGERPRINT@/$FINGERPRINT/g" "$HERE/index.html" > "$OUT/site/index.html"
# QR for phones: python-qrcode ships with fdroidserver.
python3 -c 'import sys, qrcode, qrcode.image.svg
qrcode.make(sys.argv[1], image_factory=qrcode.image.svg.SvgPathFillImage, border=2).save(sys.argv[2])' \
  "https://fdroid.kscw.ch/repo?fingerprint=$FINGERPRINT" "$OUT/site/qr.svg"
echo "F-Droid repo ready: $OUT/site (fingerprint $FINGERPRINT)"
