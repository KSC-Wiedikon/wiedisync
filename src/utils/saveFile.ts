/**
 * Save a file the app generated (CSV, XLSX, PDF, PNG, .ics, …) to the user's device.
 *
 * The single chokepoint for every client-side download. Call sites must not
 * build their own `<a download>` + object URL: the native apps (Android WebView,
 * Tauri) cannot download `blob:`/`data:` URLs from an anchor click and will hook
 * in here instead.
 */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Deferred: revoking synchronously can abort a larger download before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
