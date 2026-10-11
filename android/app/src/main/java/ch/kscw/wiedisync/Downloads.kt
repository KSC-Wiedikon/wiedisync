package ch.kscw.wiedisync

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import androidx.core.net.toUri
import java.io.IOException
import java.util.Locale

object Downloads {
    private const val TAG = "Downloads"

    /** Largest file the page may save over the bridge, decoded. */
    const val MAX_SAVE_BYTES = 25L * 1024 * 1024

    /**
     * What the site's exports save (`saveFile()` callers in src/): CSV, iCal,
     * text, JSON, PDF, XLSX, PPTX, roster PNGs, and FilePreview's stored files —
     * raster images, PDFs, everything else as octet-stream (src/utils/filePreviewKind.ts).
     */
    private val SAVABLE_TYPES = setOf(
        "text/csv",
        "text/calendar",
        "text/plain",
        "application/json",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/avif",
        "image/bmp",
        "image/heic",
        "image/heif",
        "application/octet-stream",
    )

    /** An app package in Downloads is one tap away from an install prompt. */
    private val INSTALLABLE = setOf("apk", "apks", "apkm", "xapk", "aab", "dex")

    /** Path separators, what Android/FAT refuse in a name, control and bidi characters (they can fake an extension). */
    private val UNSAFE = Regex("[\\\\/:*?\"<>|\\p{Cntrl}\\p{Cf}]")
    private const val MAX_NAME = 120

    /** The type to store a page file under (a Blob.type, parameters dropped), or null when the page may not save it. */
    fun savableType(mime: String): String? {
        val type = mime.substringBefore(';').trim().lowercase(Locale.ROOT).ifEmpty { "application/octet-stream" }
        return when (type) {
            "image/jpg", "image/pjpeg" -> "image/jpeg"
            in SAVABLE_TYPES -> type
            else -> null
        }
    }

    /** A safe file name for a page file, or null when it names an app package. */
    fun savableName(filename: String): String? =
        safeName(filename).takeIf { it.substringAfterLast('.', "").lowercase(Locale.ROOT) !in INSTALLABLE }

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

    /**
     * A real https file the page navigated to (e.g. Content-Disposition: attachment).
     * [ownHost]: the URL is on one of our hosts, the only ones that get the WebView's cookies.
     */
    fun enqueue(context: Context, url: String, userAgent: String, contentDisposition: String?, mime: String?, ownHost: Boolean) {
        val uri = url.toUri()
        if (uri.scheme != "https") return
        val name = safeName(URLUtil.guessFileName(url, contentDisposition, mime))
        try {
            val request = DownloadManager.Request(uri)
                .setMimeType(mime)
                .addRequestHeader("User-Agent", userAgent)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            // The download runs outside the WebView, so it needs the WebView's cookies
            // for that URL — our session, so never for anybody else's host.
            if (ownHost) CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
            context.getSystemService(DownloadManager::class.java).enqueue(request)
        } catch (e: Exception) {
            Log.w(TAG, "Download not started", e)
            Toast.makeText(context, R.string.save_failed, Toast.LENGTH_LONG).show()
            return
        }
        Toast.makeText(context, R.string.downloading, Toast.LENGTH_SHORT).show()
    }

    /** No separators, no leading dots (hidden files, ".."), at most [MAX_NAME] chars with the extension kept. */
    private fun safeName(raw: String): String {
        val name = raw.replace(UNSAFE, "_").trim().trimStart('.', ' ').ifBlank { "download" }
        if (name.length <= MAX_NAME) return name
        val ext = name.substringAfterLast('.', "").let { if (it.length in 1..10) ".$it" else "" }
        return name.dropLast(ext.length).take(MAX_NAME - ext.length).trimEnd() + ext
    }
}
