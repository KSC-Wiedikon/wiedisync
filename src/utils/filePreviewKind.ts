// src/utils/filePreviewKind.ts
//
// How FilePreview may render a stored file, decided by mime type. Kept out of
// the component so the allow-list is unit-tested on its own.

export type PreviewKind = 'image' | 'pdf' | 'other'

// Raster formats only. SVG is deliberately NOT here (audit 2026-09-28 F67): it
// is an XML document that can carry <script> and event handlers, and a blob:
// URL inherits the APP's origin — "Open in new tab" (or the browser's own
// "Open image in new tab" on the <img>) would navigate to it as a same-origin
// document, with only the script-src CSP between an uploaded file and the
// session. An allow-list, not `startsWith('image/')`, so the next scriptable
// image/* subtype is refused by default too.
const RASTER_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/heic',
  'image/heif',
])

/**
 * Classify by mime type. Anything we can't render inline SAFELY is 'other' —
 * that includes SVG, which is then re-wrapped as application/octet-stream and
 * can only be downloaded, never rendered as a document on the app origin.
 */
export function classify(mime: string | null | undefined): PreviewKind {
  const type = (mime || '').split(';')[0].trim().toLowerCase()
  if (RASTER_IMAGE_TYPES.has(type)) return 'image'
  if (type === 'application/pdf') return 'pdf'
  return 'other'
}

/**
 * The type to stamp on a blob: URL built from bytes whose mime came from a
 * client or the server. Raster images keep their (normalised) type, PDFs stay
 * PDFs, everything else — SVG included — becomes application/octet-stream, so
 * the blob can never be navigated to as a same-origin document. An <img> still
 * sniffs raster bytes out of an octet-stream blob, so a mislabelled photo keeps
 * rendering; an SVG does not.
 */
export function safeBlobType(mime: string | null | undefined): string {
  const kind = classify(mime)
  if (kind === 'other') return 'application/octet-stream'
  return (mime as string).split(';')[0].trim().toLowerCase()
}
