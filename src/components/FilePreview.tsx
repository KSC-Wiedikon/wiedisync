// src/components/FilePreview.tsx
//
// One document previewer for the whole app. Every stored file a user can open
// — registration documents, invoice attachments, expense receipts, E2EE ID
// scans, mailbox attachments — renders through here so PDFs preview inline
// instead of bouncing the user into a new tab or a download.
//
// Two source modes:
//   • `url`   — fetched credentialed (private Directus assets and /kscw file
//               endpoints only resolve with the session cookie, and a bare
//               <img>/<iframe> src carries that cookie only same-site, which is
//               dead on wiedisync.pages.dev → directus-dev).
//   • `blob`  — bytes already in hand (E2EE documents decrypted client-side,
//               attachments streamed through an endpoint).
//
// Either way the preview renders from a same-origin blob: URL, which also
// sidesteps any frame-ancestors CSP the API sends on /assets.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, Download, ExternalLink, FileText, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { sanitizeUrl } from '../utils/sanitizeUrl'
import { captureApiError } from '../lib/sentry'

type PreviewKind = 'image' | 'pdf' | 'other'

/** Classify by mime type. Anything we can't render inline is 'other'. */
function classify(mime: string | null | undefined): PreviewKind {
  const type = (mime || '').split(';')[0].trim().toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type === 'application/pdf') return 'pdf'
  return 'other'
}

/** Extension for the download name when the caller's filename has none. */
function extFor(mime: string, kind: PreviewKind): string {
  if (kind === 'other') return 'bin'
  const sub = mime.split('/')[1]?.split(';')[0]?.trim() ?? ''
  return sub === 'jpeg' ? 'jpg' : (sub || 'bin')
}

// Accepts absolute https URLs and the app's own relative API prefix ('/directus'
// in proxy mode — sanitizeUrl alone rejects those because they have no scheme,
// which is why the old inline previewer silently rendered nothing there).
// Protocol-relative '//host' is rejected: it is a scheme sink like any other.
function safeSource(url: string): string {
  if (url.startsWith('//')) return ''
  if (url.startsWith('/')) return url
  return sanitizeUrl(url)
}

export interface FilePreviewProps {
  /** Credentialed fetch source (private asset / file endpoint). */
  url?: string | null
  /** Bytes already in hand. Takes precedence over `url`. */
  blob?: Blob | null
  /** Accessible label — iframe title and image alt text. */
  label?: string
  /** Filename for the download button. Omit to hide it. */
  filename?: string
  /** Height of the PDF frame. */
  frameClassName?: string
}

/**
 * Inline preview of a single file: images as images, PDFs in the browser's
 * native viewer, everything else as a labelled placeholder. Always offers the
 * escape hatches (new tab / download) underneath.
 */
export function FilePreview({
  url,
  blob,
  label,
  filename,
  frameClassName = 'h-[60vh] sm:h-[70vh]',
}: FilePreviewProps) {
  const { t } = useTranslation('common')
  const [preview, setPreview] = useState<{ url: string; kind: PreviewKind; ext: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const src = url ? safeSource(url) : ''

  useEffect(() => {
    if (!blob && !src) return
    let objectUrl = ''
    let cancelled = false

    const publish = (bytes: BlobPart, mime: string | null) => {
      const kind = classify(mime)
      // Re-wrap with the type WE classified on, never the raw server one: a file
      // whose stored mimetype lies (an .html uploaded as a PDF) then lands in the
      // PDF viewer and fails there instead of executing as same-origin HTML in
      // the iframe. These are user-uploaded documents.
      objectUrl = URL.createObjectURL(
        new Blob([bytes], { type: kind === 'other' ? 'application/octet-stream' : (mime as string) }),
      )
      if (cancelled) {
        URL.revokeObjectURL(objectUrl)
        return
      }
      setPreview({ url: objectUrl, kind, ext: extFor(mime || '', kind) })
    }

    void (async () => {
      try {
        if (blob) {
          const bytes = await blob.arrayBuffer()
          if (!cancelled) publish(bytes, blob.type)
          return
        }
        const res = await fetch(src, { credentials: 'include' })
        if (!res.ok) throw new Error(`Preview ${res.status}`)
        const mime = res.headers.get('content-type')
        const bytes = await res.arrayBuffer()
        if (!cancelled) publish(bytes, mime)
      } catch (err) {
        if (cancelled) return
        setFailed(true)
        captureApiError(err, { operation: 'filePreview' })
      }
    })()

    return () => {
      cancelled = true
      // Deferred revoke: "Open in new tab" hands this same URL to a fresh tab, and
      // closing the preview must not cancel a load still in flight over there.
      if (objectUrl) {
        const stale = objectUrl
        setTimeout(() => URL.revokeObjectURL(stale), 60_000)
      }
    }
  }, [src, blob])

  if (!blob && !src) return null

  return (
    <div className="flex flex-col items-center gap-3">
      {failed ? (
        <div className="flex flex-col items-center gap-3 py-8 text-gray-500 dark:text-gray-400">
          <CircleAlert className="h-12 w-12" />
          <p className="text-sm">{t('filePreviewFailed')}</p>
        </div>
      ) : !preview ? (
        <div className="flex flex-col items-center gap-3 py-8 text-gray-500 dark:text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">{t('filePreviewLoading')}</p>
        </div>
      ) : preview.kind === 'image' ? (
        <img
          src={preview.url}
          alt={label || t('filePreviewAlt')}
          className="max-h-[70vh] w-auto rounded-md border border-gray-200 dark:border-gray-700"
        />
      ) : preview.kind === 'pdf' ? (
        <iframe
          src={preview.url}
          title={label || t('filePreviewAlt')}
          className={`w-full rounded-md border border-gray-200 bg-white dark:border-gray-700 ${frameClassName}`}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 text-gray-500 dark:text-gray-400">
          <FileText className="h-12 w-12" />
          <p className="text-sm">{t('filePreviewNone')}</p>
        </div>
      )}

      {(preview || src) && (
        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href={preview?.url || src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('filePreviewOpenTab')}
          </a>
          {filename && preview && (
            <a
              href={preview.url}
              download={filename.includes('.') ? filename : `${filename}.${preview.ext}`}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              <Download className="h-3.5 w-3.5" />
              {t('filePreviewDownload')}
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export interface FilePreviewDialogProps extends FilePreviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog heading — defaults to `label`. */
  title?: string
}

/** The preview in a modal. Keyed internally so each file gets a fresh fetch. */
export function FilePreviewDialog({ open, onOpenChange, title, ...preview }: FilePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-8 break-words">{title || preview.label}</DialogTitle>
        </DialogHeader>
        {open && <FilePreview {...preview} />}
      </DialogContent>
    </Dialog>
  )
}

export default FilePreview
