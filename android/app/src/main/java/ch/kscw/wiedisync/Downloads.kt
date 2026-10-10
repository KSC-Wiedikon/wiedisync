package ch.kscw.wiedisync

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import androidx.core.net.toUri
import java.io.IOException

object Downloads {
    /** Writes a file the page generated into the public Downloads folder. Returns the file name. */
    fun save(context: Context, filename: String, mime: String, bytes: ByteArray): String {
        val name = safeName(filename)
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("MediaStore refused the download")
        try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException("No output stream")
            resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return name
    }

    /** A real https file the page navigated to (e.g. Content-Disposition: attachment). */
    fun enqueue(context: Context, url: String, userAgent: String, contentDisposition: String?, mime: String?) {
        val uri = url.toUri()
        if (uri.scheme != "https") return
        val name = safeName(URLUtil.guessFileName(url, contentDisposition, mime))
        val request = DownloadManager.Request(uri)
            .setMimeType(mime)
            .addRequestHeader("User-Agent", userAgent)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        // The download runs outside the WebView, so it needs the WebView's cookies for that URL.
        CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
        context.getSystemService(DownloadManager::class.java).enqueue(request)
        Toast.makeText(context, R.string.downloading, Toast.LENGTH_SHORT).show()
    }

    private fun safeName(raw: String): String =
        raw.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().take(120).ifBlank { "download" }
}
