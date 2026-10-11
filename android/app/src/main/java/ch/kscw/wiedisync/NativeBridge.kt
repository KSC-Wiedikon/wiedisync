package ch.kscw.wiedisync

import android.content.Intent
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
                    .put("features", JSONArray(listOf("saveFile", "share", "push", "systemBars"))),
            )
            "share" -> share(id, msg)
            "push.state" -> ok(id, pushState())
            "push.subscribe" -> pushSubscribe(id, msg.str("vapidPublicKey"))
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

    private fun pushSubscribe(id: Int, vapid: String) {
        if (vapid.isBlank()) return fail(id, "registration_failed", "missing VAPID key")
        activity.requestNotificationPermission { granted ->
            if (!granted) return@requestNotificationPermission fail(id, "permission_denied")
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

    private fun register(id: Int, vapid: String) {
        pendingSubscribe += id
        try {
            UnifiedPush.register(activity, messageForDistributor = activity.getString(R.string.app_name), vapid = vapid)
        } catch (_: UnifiedPush.VapidNotValidException) {
            pendingSubscribe -= id
            fail(id, "registration_failed", "invalid VAPID key")
        }
    }

    private fun onPushEvent(event: PushStore.Event) {
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
    }
}
