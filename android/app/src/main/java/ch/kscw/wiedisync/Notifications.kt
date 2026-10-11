package ch.kscw.wiedisync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.core.content.edit
import java.security.MessageDigest
import java.security.SecureRandom

object Notifications {
    private const val CHANNEL = "general"
    private const val PREFS = "notifications"
    private const val PREF_TOKEN = "tap_token"
    private const val EXTRA_TOKEN = "ch.kscw.wiedisync.TAP_TOKEN"

    fun show(context: Context, title: String, body: String, url: String?, tag: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.channel_general), NotificationManager.IMPORTANCE_DEFAULT),
        )
        if (!manager.areNotificationsEnabled()) return
        // MainActivity only opens the URL if it is one of our own pages, and only
        // from an intent carrying our token (see isOwnTap).
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_URL, url)
            .putExtra(EXTRA_TOKEN, token(context))
        val tap = PendingIntent.getActivity(
            context,
            tag.hashCode(),
            open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(MainActivity.BRAND)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        // Same tag replaces the previous notification, like the web `tag`.
        manager.notify(tag, 0, notification)
    }

    /**
     * MainActivity is exported, so any app can start it with a URL extra. Our
     * notification taps carry a per-install secret from app-private storage
     * that other apps can't read, and the PendingIntent is immutable.
     */
    fun isOwnTap(context: Context, intent: Intent): Boolean {
        val presented = intent.getStringExtra(EXTRA_TOKEN) ?: return false
        return MessageDigest.isEqual(presented.toByteArray(), token(context).toByteArray())
    }

    @Synchronized
    private fun token(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(PREF_TOKEN, null)?.let { return it }
        val token = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.NO_WRAP)
        prefs.edit { putString(PREF_TOKEN, token) }
        return token
    }
}
