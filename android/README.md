# Wiedisync for Android

A small Kotlin app around the live site. It is one WebView on
`https://wiedisync.kscw.ch`, plus what a WebView can't do on its own:

| Feature | How |
|---|---|
| Push notifications | [UnifiedPush](https://unifiedpush.org). With a distributor app (Sunup, ntfy from F-Droid) through that app; without one, through Google Play services via the built-in [embedded FCM distributor](https://codeberg.org/UnifiedPush/android-embedded_fcm_distributor) (LGPL, no Firebase SDK: it registers with Play services using our VAPID key and gets an `fcm.googleapis.com/fcm/send/…` endpoint). Either way the endpoint is plain Web Push, so the existing `kscw-push` worker sends to it. A phone with neither gets the "install Sunup or ntfy" hint. |
| Downloads | Exports from `saveFile()` (`src/utils/saveFile.ts`) arrive over the bridge and go to the public Downloads folder: at most 25 MB, only the types the site exports (`Downloads.SAVABLE_TYPES`; a new export type has to be added there), never an app package. Real `https` downloads go through DownloadManager, with the WebView's cookies only for our own hosts. |
| Share | The Android share sheet. |
| File upload | The system file picker, plus the camera for image inputs. Only `content://` files reach the page. |
| Links | Our hosts stay in the app; everything else (mail, phone, TWINT, other sites) opens outside, and only on a tap. `https://wiedisync.kscw.ch` links open in the app (App Links, `public/.well-known/assetlinks.json`). Other apps can only open our own pages; a notification's URL only counts from our own notification. |

Releases ship only when the shell itself changes. Site changes reach the app with every Cloudflare deploy.

## Build

Needs JDK 17+ and the Android SDK (platform 36).

```bash
cd android
./gradlew assembleDevDebug      # dev flavor → wiedisync-dev.kscw.ch, installs as "Wiedisync Dev"
./gradlew assembleProdRelease   # prod flavor → wiedisync.kscw.ch, signed (see below)
./gradlew lintProdRelease
```

The two flavors install side by side (`ch.kscw.wiedisync` and `ch.kscw.wiedisync.dev`). Only the dev flavor can log in on dev: the session cookie only sticks on `.kscw.ch` hosts (CLAUDE.md → Domains).

## Signing

The release key is `ch.kscw.wiedisync`'s identity for good. Lose it and every installed app has to be uninstalled. Leak it and someone else can ship updates.

- **Local:** `~/.config/wiedisync-android/release.p12` + `credentials.env` (`ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`). Both stay outside the repo, and both are backed up in Vaultwarden.
- **CI:** the same three values as env vars (GitHub Actions secrets).
- **Neither present:** e.g. on the F-Droid build server, the release APK is built unsigned.
- **Certificate SHA-256:** `0D:79:B0:74:DE:19:FF:D0:87:E2:F5:56:C5:6D:09:F9:33:14:E8:28:D3:44:FC:F1:85:01:FB:DC:DE:9F:E2:38`. This value is in `assetlinks.json`.

## The page bridge

Our origins (and only those, via `WebViewCompat.addWebMessageListener`) see `window.WiedisyncNative`. The site side is `src/lib/nativeBridge.ts`, and the protocol is documented in both files and in `NativeBridge.kt`. The site detects the app by the `WiedisyncApp/android/<version>` user-agent token (`src/utils/pwa.ts`).

## Testing on an emulator

```bash
~/Android/Sdk/emulator/emulator -avd wiedisync-test -no-window &
adb install -r app/build/outputs/apk/dev/debug/app-dev-debug.apk
```

Debug builds enable WebView debugging: open `chrome://inspect`, or forward `localabstract:webview_devtools_remote_<pid>` and drive the page over CDP. For push, run `adb shell pm grant ch.kscw.wiedisync.dev android.permission.POST_NOTIFICATIONS`. A Google Play emulator image uses the built-in Google path; install a distributor (Sunup from F-Droid) to test UnifiedPush. Turn airplane mode off first (`adb shell cmd connectivity airplane-mode disable`) — an error page instead of the site means no network.
