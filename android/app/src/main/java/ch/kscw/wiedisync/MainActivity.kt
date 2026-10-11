package ch.kscw.wiedisync

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.provider.MediaStore
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.edit
import androidx.core.graphics.ColorUtils
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

/**
 * The whole app: one WebView on the live site (BuildConfig.START_URL), plus the
 * few things a WebView can't do on its own — file/camera pickers, downloads,
 * external links, notification permission — and the page bridge ([NativeBridge]).
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var errorView: View
    private lateinit var bridge: NativeBridge
    private val barsBackground = SystemBarsDrawable()

    /**
     * Hosts that stay inside the app; every other link opens outside it. Also the
     * bridge's origins, the only pages an intent may open, and the only download
     * hosts that get the WebView's cookies.
     */
    private val appHosts = BuildConfig.APP_HOSTS.split(',').toSet()

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var permissionCallback: ((Boolean) -> Unit)? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        val photo = cameraUri
        fileCallback = null
        cameraUri = null
        if (result.resultCode != RESULT_OK) {
            callback.onReceiveValue(null)
            return@registerForActivityResult
        }
        val data = result.data
        val clip = data?.clipData
        val picked = data?.data
        val uris = when {
            clip != null -> (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
            picked != null -> listOf(picked)
            // The camera app returns no data: the photo is where we told it to write.
            photo != null -> listOf(photo)
            else -> emptyList()
        }.filter { isPickedFile(it, photo) }
        callback.onReceiveValue(uris.takeIf { it.isNotEmpty() }?.toTypedArray())
    }

    private val requestNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) getSharedPreferences(PREFS, MODE_PRIVATE).edit { putBoolean(PREF_NOTIFICATIONS_DENIED, true) }
        permissionCallback?.invoke(granted)
        permissionCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // The bars start in the colours the page last reported for this theme and
        // follow the page from then on (`ui.systemBars`, NativeBridge).
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        barsBackground.top = prefs.getInt(barPref("top"), pageBackground())
        barsBackground.bottom = prefs.getInt(barPref("bottom"), pageBackground())
        applyBarStyle()
        super.onCreate(savedInstanceState)
        File(cacheDir, CAMERA_DIR).deleteRecursively()
        // chrome://inspect for debug builds only.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        val root = FrameLayout(this).apply { background = barsBackground }
        webView = WebView(this).apply { setBackgroundColor(pageBackground()) }
        errorView = buildErrorView()
        root.addView(webView, FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(errorView, FrameLayout.LayoutParams(MATCH, MATCH))
        setContentView(root)
        // Edge-to-edge is enforced from targetSdk 35: keep the page clear of the
        // system bars and the keyboard; barsBackground fills the bar areas.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            barsBackground.bottomInset = bars.bottom
            WindowInsetsCompat.CONSUMED
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Only our https site is shown: no file:// or content:// pages, no mixed content.
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            // window.open lands in onCreateWindow, which routes it (in-app or browser).
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            // The site detects the app by this token (src/utils/pwa.ts → detectNativeApp).
            userAgentString = "$userAgentString WiedisyncApp/android/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        webView.webViewClient = Client()
        webView.webChromeClient = Chrome()
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            Downloads.enqueue(this, url, userAgent, contentDisposition, mimeType, ownHost = isAppUrl(url.toUri()))
        }
        // Must be installed before the first load so the page sees window.WiedisyncNative.
        bridge = NativeBridge(this, webView, appHosts.map { "https://$it" }.toSet())

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(appUrlFrom(intent) ?: BuildConfig.START_URL)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        appUrlFrom(intent)?.let { webView.loadUrl(it) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        // The session cookie must survive the app being killed in the background.
        CookieManager.getInstance().flush()
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        bridge.dispose()
        webView.destroy()
        super.onDestroy()
    }

    // ── Used by NativeBridge ─────────────────────────────────────────────────

    /** "granted" | "denied" | "default", in the Notification.permission vocabulary. */
    fun notificationPermission(): String = when {
        NotificationManagerCompat.from(this).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || hasPermission(Manifest.permission.POST_NOTIFICATIONS)) -> "granted"
        Build.VERSION.SDK_INT < 33 -> "denied"
        getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_NOTIFICATIONS_DENIED, false) -> "denied"
        else -> "default"
    }

    fun requestNotificationPermission(callback: (Boolean) -> Unit) {
        if (Build.VERSION.SDK_INT < 33 || hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
            callback(NotificationManagerCompat.from(this).areNotificationsEnabled())
            return
        }
        permissionCallback = callback
        requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    // ── Navigation ───────────────────────────────────────────────────────────

    /** For URLs the WebView produced (already canonical): navigations, downloads. */
    private fun isAppUrl(uri: Uri) = uri.scheme == "https" && uri.host in appHosts && uri.port == -1

    /**
     * A notification tap or an App Link — only ever one of our own pages. The
     * activity is exported, so any app can start it with any extras: [EXTRA_URL]
     * only counts on a tap on our own notification ([Notifications.isOwnTap]), an
     * App Link is the VIEW data, and either way the URL must pass [strictAppUrl].
     */
    private fun appUrlFrom(intent: Intent?): String? {
        intent ?: return null
        // A hostile Bundle can throw while it is unparcelled.
        val raw = runCatching {
            intent.getStringExtra(EXTRA_URL)?.takeIf { Notifications.isOwnTap(this, intent) }
                ?: intent.takeIf { it.action == Intent.ACTION_VIEW }?.dataString
        }.getOrNull()
        return raw?.let(::strictAppUrl)
    }

    /**
     * [raw] as one of our pages, or null — for URLs from outside the WebView.
     * android.net.Uri is lenient where Chromium is not (`https://evil\@our.host/`
     * is our host to Uri, evil to Chromium); java.net.URI refuses such input
     * outright, and the WebView loads the URL rebuilt from what was checked.
     */
    private fun strictAppUrl(raw: String): String? {
        val uri = try {
            URI(raw)
        } catch (_: URISyntaxException) {
            return null
        }
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.rawUserInfo != null) return null
        if (uri.port != -1 && uri.port != 443) return null
        val host = uri.host?.lowercase(Locale.ROOT)?.takeIf { it in appHosts } ?: return null
        return buildString {
            append("https://").append(host).append(uri.rawPath.orEmpty().ifEmpty { "/" })
            uri.rawQuery?.let { append('?').append(it) }
            uri.rawFragment?.let { append('#').append(it) }
        }
    }

    /**
     * Hand a link to whatever app handles it: browser, mail, phone, TWINT, …
     * Callers only do this on a tap: a page can't send the member to another app on its own.
     */
    fun openOutside(uri: Uri) {
        when (uri.scheme?.lowercase()) {
            "http", "https", "tel", "sms", "smsto", "geo" -> launch(Intent(Intent.ACTION_VIEW, uri))
            "mailto" -> launch(Intent(Intent.ACTION_SENDTO, uri))
            "intent" -> openIntentLink(uri)
            // Nothing outside the app can open these.
            null, "blob", "data", "javascript", "file", "content", "about" -> Unit
            else -> launch(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        }
    }

    /**
     * `intent:` links, defanged the way Chrome does it: browsable activities only,
     * never an explicit component or selector, never us, and no flags — a
     * URI-permission grant would hand the target app files of ours.
     */
    private fun openIntentLink(uri: Uri) {
        val parsed = try {
            Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
        } catch (_: Exception) {
            // URISyntaxException, but also e.g. NumberFormatException for bad launchFlags.
            return
        }
        val dataScheme = parsed.data?.scheme?.lowercase()
        if (parsed.`package` == packageName || dataScheme == "file" || dataScheme == "content") return
        parsed.component = null
        parsed.selector = null
        parsed.flags = 0
        parsed.addCategory(Intent.CATEGORY_BROWSABLE)
        launch(parsed) {
            val fallback = runCatching { parsed.getStringExtra("browser_fallback_url") }.getOrNull()
                ?.let(Uri::parse)
                ?.takeIf { it.scheme == "https" }
            if (fallback != null) launch(Intent(Intent.ACTION_VIEW, fallback)) else toast(R.string.no_app)
        }
    }

    /** startActivity that never takes the app down: no handler → [onNotFound], any other refusal → a toast. */
    private fun launch(intent: Intent, onNotFound: () -> Unit = { toast(R.string.no_app) }) {
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            onNotFound()
        } catch (e: Exception) {
            // A SecurityException from a handler we may not start, a bad extra, …
            // Only the scheme is logged: the URL may carry a token.
            Log.w(TAG, "Could not open a ${intent.scheme ?: intent.action} link", e)
            toast(R.string.open_failed)
        }
    }

    private fun toast(text: Int) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    // Lint misses the Kotlin override below (androidx.webkit lint, 1.17.1).
    @SuppressLint("MissingOnRenderProcessGone")
    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // Frames (Turnstile, embeds) navigate freely; only the top page is routed.
            if (!request.isForMainFrame || isAppUrl(request.url)) return false
            if (request.hasGesture()) {
                openOutside(request.url)
            } else {
                Log.w(TAG, "Not opening a ${request.url.scheme} link without a tap")
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            errorView.visibility = View.GONE
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) errorView.visibility = View.VISIBLE
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The renderer crashed or was killed for memory: rebuild instead of crashing.
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
            recreate()
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val pick = params.createIntent()
            if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            val chooser = Intent.createChooser(pick, null)
            if (acceptsImages(params)) cameraIntent()?.let { chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(it)) }
            return try {
                pickFiles.launch(chooser)
                true
            } catch (e: Exception) {
                Log.w(TAG, "No file picker", e)
                fileCallback = null
                cameraUri = null
                false
            }
        }

        @SuppressLint("MissingOnRenderProcessGone") // implemented on the catcher below
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            // A throwaway WebView catches the new window's first URL and routes it:
            // our pages load in the app, another app only opens if window.open came from a tap.
            val catcher = WebView(this@MainActivity)
            catcher.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    when {
                        isAppUrl(request.url) -> webView.loadUrl(request.url.toString())
                        isUserGesture -> openOutside(request.url)
                        else -> Log.w(TAG, "Not opening a ${request.url.scheme} window without a tap")
                    }
                    v.post { v.destroy() }
                    return true
                }

                override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                    v.destroy()
                    return true
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = catcher
            resultMsg.sendToTarget()
            return true
        }
    }

    /**
     * Only content:// goes to the page, and of our own provider only the photo we
     * asked the camera for: a picker answering with file:// (or another of our
     * URIs) would have the page upload a file out of the app's private storage.
     */
    private fun isPickedFile(uri: Uri, photo: Uri?): Boolean =
        uri.scheme == ContentResolver.SCHEME_CONTENT && (uri.authority != "$packageName.files" || uri == photo)

    private fun acceptsImages(params: WebChromeClient.FileChooserParams): Boolean {
        val types = params.acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        return types.isEmpty() || types.any { it.startsWith("image/") || it == "*/*" || it in IMAGE_EXTENSIONS }
    }

    private fun cameraIntent(): Intent? {
        val dir = File(cacheDir, CAMERA_DIR).apply { mkdirs() }
        val uri = FileProvider.getUriForFile(this, "$packageName.files", File.createTempFile("photo_", ".jpg", dir))
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (intent.resolveActivity(packageManager) == null) return null
        cameraUri = uri
        return intent
    }

    // ── Views ────────────────────────────────────────────────────────────────

    private fun buildErrorView(): View {
        val pad = (24 * resources.displayMetrics.density).toInt()
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(pageBackground())
            visibility = View.GONE
            isClickable = true
            val fg = if (isNight()) Color.WHITE else Color.BLACK
            addView(TextView(context).apply {
                setText(R.string.offline_title)
                textSize = 20f
                setTextColor(fg)
                gravity = Gravity.CENTER
            })
            addView(TextView(context).apply {
                setText(R.string.offline_body)
                textSize = 16f
                setTextColor(fg)
                gravity = Gravity.CENTER
                setPadding(0, pad / 2, 0, pad)
            })
            addView(Button(context).apply {
                setText(R.string.retry)
                setOnClickListener {
                    if (webView.url == null) webView.loadUrl(BuildConfig.START_URL) else webView.reload()
                }
            })
        }
    }

    /** The page's edge colours (from the bridge): paint the bars and remember them for the next start. */
    fun setSystemBarColors(top: Int, bottom: Int) {
        if (barsBackground.top == top && barsBackground.bottom == bottom) return
        barsBackground.top = top
        barsBackground.bottom = bottom
        applyBarStyle()
        getSharedPreferences(PREFS, MODE_PRIVATE).edit { putInt(barPref("top"), top).putInt(barPref("bottom"), bottom) }
    }

    /** Transparent bars over [barsBackground], with icons that stay readable on it. */
    private fun applyBarStyle() {
        fun style(color: Int) =
            if (ColorUtils.calculateLuminance(color) > 0.5) SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
            else SystemBarStyle.dark(Color.TRANSPARENT)
        enableEdgeToEdge(style(barsBackground.top), style(barsBackground.bottom))
        barsBackground.invalidateSelf()
    }

    /** Light and dark pages have different edges: one remembered pair per theme. */
    private fun barPref(edge: String) = "bar_${edge}_${if (isNight()) "night" else "day"}"

    private fun isNight() =
        resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES

    private fun pageBackground() = if (isNight()) PAGE_DARK else Color.WHITE

    private fun hasPermission(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    companion object {
        const val EXTRA_URL = "ch.kscw.wiedisync.URL"
        private const val TAG = "MainActivity"
        private const val PREFS = "app"
        private const val PREF_NOTIFICATIONS_DENIED = "notifications_denied"
        private const val CAMERA_DIR = "camera"
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private val IMAGE_EXTENSIONS = setOf(".jpg", ".jpeg", ".png", ".heic", ".webp", ".gif")
        val BRAND = Color.rgb(0x4A, 0x55, 0xA2)
        private val PAGE_DARK = Color.rgb(0x0F, 0x17, 0x2A)
    }
}

/**
 * What shows through the transparent system bars, i.e. in the root's inset
 * padding around the page: [top] everywhere, [bottom] along the bottom inset
 * (navigation bar, or the keyboard while it is open).
 */
private class SystemBarsDrawable : Drawable() {
    var top = Color.WHITE
    var bottom = Color.WHITE
    var bottomInset = 0
        set(value) {
            field = value
            invalidateSelf()
        }
    private val paint = Paint()

    override fun draw(canvas: Canvas) {
        val b = bounds
        canvas.drawColor(top)
        if (bottomInset <= 0) return
        paint.color = bottom
        canvas.drawRect(b.left.toFloat(), (b.bottom - bottomInset).toFloat(), b.right.toFloat(), b.bottom.toFloat(), paint)
    }

    override fun setAlpha(alpha: Int) = Unit
    override fun setColorFilter(colorFilter: ColorFilter?) = Unit
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = PixelFormat.OPAQUE
}
