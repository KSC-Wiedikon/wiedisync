package ch.kscw.wiedisync

import android.content.Context
import androidx.core.content.edit
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

/**
 * This device's UnifiedPush subscription (endpoint + Web Push keys), and the
 * in-process hand-off from [WiedisyncPushService] to a live [NativeBridge].
 */
object PushStore {
    data class Subscription(val endpoint: String, val p256dh: String, val auth: String) {
        /** Same shape as a browser PushSubscription.toJSON(). */
        fun toJson(): JSONObject = JSONObject()
            .put("endpoint", endpoint)
            .put("keys", JSONObject().put("p256dh", p256dh).put("auth", auth))
    }

    sealed interface Event {
        data class NewEndpoint(val subscription: Subscription) : Event
        data class Failed(val reason: String) : Event
        data object Unregistered : Event
    }

    private val listeners = CopyOnWriteArraySet<(Event) -> Unit>()

    fun addListener(listener: (Event) -> Unit) = listeners.add(listener)
    fun removeListener(listener: (Event) -> Unit) = listeners.remove(listener)
    fun dispatch(event: Event) = listeners.forEach { it(event) }

    private fun prefs(context: Context) = context.getSharedPreferences("push", Context.MODE_PRIVATE)

    fun save(context: Context, s: Subscription) = prefs(context).edit {
        putString("endpoint", s.endpoint)
        putString("p256dh", s.p256dh)
        putString("auth", s.auth)
    }

    fun subscription(context: Context): Subscription? {
        val p = prefs(context)
        return Subscription(
            p.getString("endpoint", null) ?: return null,
            p.getString("p256dh", null) ?: return null,
            p.getString("auth", null) ?: return null,
        )
    }

    fun clear(context: Context) = prefs(context).edit { clear() }
}
