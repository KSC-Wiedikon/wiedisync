import { captureApiError } from '../lib/sentry'
import { hasNativeBridge, hasNativeFeature, nativeRequest } from '../lib/nativeBridge'

/**
 * Save a file the app generated (CSV, XLSX, PDF, PNG, .ics, …) to the user's device.
 *
 * The single chokepoint for every client-side download. Call sites must not
 * build their own `<a download>` + object URL: the Android app's WebView cannot
 * download `blob:`/`data:` URLs from an anchor click, so inside the app the file
 * goes over the native bridge as base64 and the app writes it to Downloads (and
 * shows its own "Saved" / failure toast — nothing to show here). Everywhere else
 * it is the plain anchor download.
 *
 * Fire-and-forget for callers: the native path runs async and reports its own
 * failures to the error log.
 */
export function saveFile(blob: Blob, filename: string): void {
  if (hasNativeBridge()) {
    saveFileNative(blob, filename).catch((err) => {
      // No filename: some carry a member's name (invoices, receipts).
      captureApiError(err, { operation: 'saveFile.native', payload: { mime: blob.type, size: blob.size } })
    })
    return
  }
  saveFileBrowser(blob, filename)
}

async function saveFileNative(blob: Blob, filename: string): Promise<void> {
  // An app build without the feature: the anchor is all there is.
  if (!(await hasNativeFeature('saveFile'))) {
    saveFileBrowser(blob, filename)
    return
  }
  const base64 = await blobToBase64(blob)
  // Longer than the bridge default: a multi-MB export crosses as one string.
  await nativeRequest('saveFile', { filename, mime: blob.type || 'application/octet-stream', base64 }, 30_000)
}

function saveFileBrowser(blob: Blob, filename: string): void {
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

/** Bare base64 of the blob's bytes — the `data:…;base64,` prefix stripped. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}
