package ch.kscw.wiedisync

import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * Receives from the member's UnifiedPush distributor (Sunup, ntfy, …). Messages
 * are Web Push sent by the kscw-push worker, already decrypted by the connector;
 * the payload is the same JSON public/sw.js shows: {title, body, url, tag}.
 */
class WiedisyncPushService : PushService() {
    override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
        val keys = endpoint.pubKeySet
        if (keys == null) {
            // A distributor without Web Push encryption can't receive from our worker.
            PushStore.dispatch(PushStore.Event.Failed("distributor gave no Web Push keys"))
            return
        }
        val subscription = PushStore.Subscription(endpoint.url, keys.pubKey, keys.auth)
        PushStore.save(this, subscription)
        PushStore.dispatch(PushStore.Event.NewEndpoint(subscription))
    }

    override fun onMessage(message: PushMessage, instance: String) {
        if (!message.decrypted) return
        val data = runCatching { JSONObject(String(message.content, Charsets.UTF_8)) }.getOrNull() ?: return
        Notifications.show(
            this,
            title = data.optString("title").ifBlank { getString(R.string.app_name) },
            body = data.optString("body"),
            url = data.optString("url").ifBlank { null },
            tag = data.optString("tag").ifBlank { "wiedisync-notification" },
        )
    }

    override fun onRegistrationFailed(reason: FailedReason, instance: String) {
        PushStore.dispatch(PushStore.Event.Failed(reason.name))
    }

    override fun onUnregistered(instance: String) {
        PushStore.clear(this)
        PushStore.dispatch(PushStore.Event.Unregistered)
    }
}
