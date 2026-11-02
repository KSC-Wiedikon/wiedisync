package ch.kscw.wiedisync

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.WebView
import android.widget.Toast
import androidx.core.graphics.toColorInt
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.UnifiedPush
import java.util.concurrent.Executors

/**
 * The page ↔ app channel. Our own origins (and only those) see
 * `window.WiedisyncNative` and talk JSON strings:
 *
 *   page → app   {id, type, …params}
 *   app  → page  {id, ok: true, result} | {id, ok: false, error, message?}
 *                {event: "push-endpoint", subscription | null}   (unsolicited)
 *
 * `ui.systemBars` {top, bottom: "#rrggbb"} paints the status and navigation
 * bars in the page's edge colours (src/lib/nativeSystemBars.ts).
 *
 * `saveFile` {filename, mime, base64} takes up to [Downloads.MAX_SAVE_BYTES] of
 * an allow-listed type ([Downloads.savableType]); errors `too_large`,
 * `unsupported_type`, `write_failed`.
 *
 * The app can only answer a page that has written to it, so the site sends
 * `hello` first. Web side of the protocol: src/lib/nativeBridge.ts.
 */
class NativeBridge(
    private val activity: MainActivity,
    webView: WebView,
    origins: Set<String>,
) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var proxy: JavaScriptReplyProxy? = null
    /** `push.subscribe` requests waiting for the distributor's NEW_ENDPOINT. */
    private val pendingSubscribe = mutableListOf<Int>()
    /** The VAPID key of the registration in flight, for the fallback below. */
    private var pendingVapid: String? = null
    private val distributorSilent = Runnable { onDistributorSilent() }
    private val pushListener: (PushStore.Event) -> Unit = { event -> main.post { onPushEvent(event) } }

    init {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "WiedisyncNative", origins) { _, message, _, isMainFrame, replyProxy ->
                if (!isMainFrame) return@addWebMessageListener
                proxy = replyProxy
                message.data?.let(::receive)
            }
        }
        PushStore.addListener(pushListener)
    }

    fun dispose() {
        PushStore.removeListener(pushListener)
        io.shutdown()
    }

    /**
     * On the UI thread. An export arrives as one base64 string of up to tens of
     * MB, so nothing is parsed here: an oversized message is refused unread, the
     * rest is parsed on [io] and handled back on the UI thread — except
     * `saveFile`, which stays on [io] for the decode and the write.
     */
    private fun receive(raw: String) {
        if (io.isShutdown) return
        if (raw.length > MAX_MESSAGE_CHARS) return refuseUnread(raw)
        io.execute {
            val msg = try {
                JSONObject(raw)
            } catch (_: Exception) {
                return@execute
            }
            val id = msg.optInt("id", -1).takeIf { it >= 0 } ?: return@execute
            if (msg.optString("type") == "saveFile") saveFile(id, msg) else main.post { handle(id, msg) }
        }
    }

    /** Too big to parse. The page puts `id` and `type` last (nativeRequest), so the request can still be answered. */
    private fun refuseUnread(raw: String) {
        val id = TAIL_ID.find(raw.takeLast(96))?.groupValues?.get(1)?.toIntOrNull() ?: return
        saveFailed(id, "too_large")
    }

    private fun handle(id: Int, msg: JSONObject) {
        when (msg.optString("type")) {
            "hello" -> ok(
                id,
                JSONObject()
                    .put("platform", "android")
                    .put("appVersion", BuildConfig.VERSION_NAME)
                    // pushEmbedded: this build can push through Play services (embedded FCM
                    // distributor) and this phone has them — the page may ask for it outright.
                    .put("features", JSONArray(listOf("saveFile", "share", "push", "systemBars") + if (hasPlayServices()) listOf("pushEmbedded") else emptyList())),
            )
            "share" -> share(id, msg)
            "push.state" -> ok(id, pushState())
            "push.subscribe" -> pushSubscribe(id, msg.str("vapidPublicKey"), msg.optBoolean("embedded"))
            "push.unsubscribe" -> {
                UnifiedPush.unregister(activity)
                PushStore.clear(activity)
                ok(id, JSONObject().put("unsubscribed", true))
            }
            "ui.systemBars" -> systemBars(id, msg)
            else -> fail(id, "unknown_type")
        }
    }

    // ── Files and sharing ────────────────────────────────────────────────────

    /** On [io]: checked before anything is decoded, then decoded and written off the UI thread. */
    private fun saveFile(id: Int, msg: JSONObject) {
        val mime = Downloads.savableType(msg.str("mime"))
        val filename = Downloads.savableName(msg.str("filename"))
        val data = msg.str("base64")
        if (mime == null || filename == null) return refuse(id, "unsupported_type")
        // Base64 is 4 characters per 3 bytes.
        if (data.length.toLong() * 3 / 4 > Downloads.MAX_SAVE_BYTES) return refuse(id, "too_large")
        val result = runCatching { Downloads.save(activity, filename, mime, Base64.decode(data, Base64.DEFAULT)) }
        main.post {
            result
                .onSuccess { name ->
                    Toast.makeText(activity, activity.getString(R.string.saved_to_downloads, name), Toast.LENGTH_SHORT).show()
                    ok(id, JSONObject().put("saved", true))
                }
                .onFailure { saveFailed(id, "write_failed", it.message) }
        }
    }

    private fun refuse(id: Int, code: String) {
        main.post { saveFailed(id, code) }
    }

    /** On the UI thread. */
    private fun saveFailed(id: Int, code: String, message: String? = null) {
        Toast.makeText(activity, if (code == "too_large") R.string.file_too_large else R.string.save_failed, Toast.LENGTH_LONG).show()
        fail(id, code, message)
    }

    private fun share(id: Int, msg: JSONObject) {
        val title = msg.str("title")
        val text = listOf(msg.str("text"), msg.str("url")).filter { it.isNotBlank() }.joinToString("\n")
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        if (title.isNotBlank()) send.putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TITLE, title)
        activity.startActivity(Intent.createChooser(send, null))
        ok(id, JSONObject().put("shown", true))
    }

    // ── Window ───────────────────────────────────────────────────────────────

    private fun systemBars(id: Int, msg: JSONObject) {
        val top = parseHex(msg.str("top"))
        val bottom = parseHex(msg.str("bottom"))
        if (top == null || bottom == null) return fail(id, "invalid_color")
        activity.setSystemBarColors(top, bottom)
        ok(id, JSONObject().put("applied", true))
    }

    /** `#rrggbb` only: the page composites alpha itself, and the parser throws on anything odd. */
    private fun parseHex(value: String): Int? =
        if (HEX.matches(value)) value.toColorInt() else null

    // ── Push (UnifiedPush) ───────────────────────────────────────────────────

    private fun pushState(): JSONObject = JSONObject()
        .put("permission", activity.notificationPermission())
        .put("subscription", PushStore.subscription(activity)?.toJson() ?: JSONObject.NULL)
        .put("distributor", UnifiedPush.getAckDistributor(activity) ?: JSONObject.NULL)

    /**
     * `embedded`: the page asks for Google's push outright, because the server
     * refused the endpoint the distributor app gave (a self-hosted ntfy).
     */
    private fun pushSubscribe(id: Int, vapid: String, embedded: Boolean) {
        if (vapid.isBlank()) return fail(id, "registration_failed", "missing VAPID key")
        activity.requestNotificationPermission { granted ->
            if (!granted) return@requestNotificationPermission fail(id, "permission_denied")
            if (embedded) {
                if (!hasPlayServices()) return@requestNotificationPermission fail(id, "no_distributor")
                UnifiedPush.saveDistributor(activity, activity.packageName)
                return@requestNotificationPermission register(id, vapid)
            }
            // The app is a distributor itself now (embedded FCM distributor), so
            // "no distributor" means no distributor APP. Without one, Google's push
            // through Play Services; a member who installed Sunup or ntfy keeps it.
            if (UnifiedPush.getDistributors(activity).none { it != activity.packageName }) {
                if (!hasPlayServices()) return@requestNotificationPermission fail(id, "no_distributor")
                UnifiedPush.saveDistributor(activity, activity.packageName)
                return@requestNotificationPermission register(id, vapid)
            }
            UnifiedPush.tryUseCurrentOrDefaultDistributor(activity) { useDefault ->
                main.post {
                    when {
                        useDefault -> register(id, vapid)
                        UnifiedPush.getDistributors(activity).isEmpty() -> fail(id, "no_distributor")
                        // Several distributors and no default: let the member pick one.
                        else -> UnifiedPush.tryPickDistributor(activity) { picked ->
                            main.post { if (picked) register(id, vapid) else fail(id, "registration_failed", "no distributor picked") }
                        }
                    }
                }
            }
        }
    }

    private fun hasPlayServices(): Boolean = runCatching {
        val pm = activity.packageManager
        if (Build.VERSION.SDK_INT >= 33) {
            pm.getPackageInfo(PLAY_SERVICES, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(PLAY_SERVICES, 0)
        }
    }.isSuccess

    private fun register(id: Int, vapid: String) {
        pendingSubscribe += id
        pendingVapid = vapid
        // A distributor app that was never opened, or was force-stopped, gets no
        // broadcasts and never answers: the button spun for the page's whole 60 s
        // and then gave up without a word (2026-11-02). The built-in one answers
        // within a second, so only an app distributor gets the deadline.
        main.removeCallbacks(distributorSilent)
        if (UnifiedPush.getSavedDistributor(activity) != activity.packageName) {
            main.postDelayed(distributorSilent, DISTRIBUTOR_ANSWER_MS)
        }
        try {
            UnifiedPush.register(activity, messageForDistributor = activity.getString(R.string.app_name), vapid = vapid)
        } catch (_: UnifiedPush.VapidNotValidException) {
            pendingSubscribe -= id
            main.removeCallbacks(distributorSilent)
            fail(id, "registration_failed", "invalid VAPID key")
        }
    }

    /** The distributor app did not answer in time: Google's push if possible, else say which app to open. */
    private fun onDistributorSilent() {
        val waiting = pendingSubscribe.toList()
        val vapid = pendingVapid
        if (waiting.isEmpty() || vapid == null) return
        pendingSubscribe.clear()
        if (hasPlayServices()) {
            UnifiedPush.saveDistributor(activity, activity.packageName)
            waiting.drop(1).forEach { pendingSubscribe += it }
            register(waiting.first(), vapid)
            return
        }
        val name = UnifiedPush.getSavedDistributor(activity)?.let(::appLabel) ?: "UnifiedPush"
        waiting.forEach { fail(it, "distributor_silent", name) }
    }

    private fun appLabel(packageName: String): String? = runCatching {
        val pm = activity.packageManager
        val info = if (Build.VERSION.SDK_INT >= 33) {
            pm.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.getApplicationInfo(packageName, 0)
        }
        pm.getApplicationLabel(info).toString()
    }.getOrNull()

    private fun onPushEvent(event: PushStore.Event) {
        main.removeCallbacks(distributorSilent)
        val waiting = pendingSubscribe.toList()
        pendingSubscribe.clear()
        when (event) {
            is PushStore.Event.NewEndpoint -> {
                val subscription = event.subscription.toJson()
                if (waiting.isEmpty()) {
                    // The distributor rotated the endpoint on its own: the page re-registers it.
                    post(JSONObject().put("event", "push-endpoint").put("subscription", subscription))
                } else {
                    waiting.forEach { ok(it, JSONObject().put("subscription", subscription)) }
                }
            }
            is PushStore.Event.Failed -> waiting.forEach { fail(it, "registration_failed", event.reason) }
            PushStore.Event.Unregistered -> {
                waiting.forEach { fail(it, "registration_failed", "unregistered") }
                post(JSONObject().put("event", "push-endpoint").put("subscription", JSONObject.NULL))
            }
        }
    }

    // ── Replies ──────────────────────────────────────────────────────────────

    private fun ok(id: Int, result: JSONObject) =
        post(JSONObject().put("id", id).put("ok", true).put("result", result))

    private fun fail(id: Int, code: String, message: String? = null) =
        post(JSONObject().put("id", id).put("ok", false).put("error", code).apply { message?.let { put("message", it) } })

    private fun post(json: JSONObject) {
        // A proxy only exists once the listener ran, i.e. WEB_MESSAGE_LISTENER is supported.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        val target = proxy ?: return
        main.post { runCatching { target.postMessage(json.toString()) } }
    }

    /** optString turns a JSON null into the string "null"; treat it as absent. */
    private fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key)

    private companion object {
        val HEX = Regex("^#[0-9a-fA-F]{6}$")
        /** A `saveFile` of [Downloads.MAX_SAVE_BYTES] in base64, plus room for the rest of the message. */
        val MAX_MESSAGE_CHARS = Downloads.MAX_SAVE_BYTES / 3 * 4 + 64 * 1024
        /** The end of `JSON.stringify({ ...params, id, type })`. */
        val TAIL_ID = Regex("\"id\":(\\d+),\"type\":\"[^\"]*\"\\}$")
        /** Google Play services: what the embedded FCM distributor registers through. */
        const val PLAY_SERVICES = "com.google.android.gms"
        /** How long a distributor app gets to answer a registration before the fallback. */
        const val DISTRIBUTOR_ANSWER_MS = 10_000L
    }
}
