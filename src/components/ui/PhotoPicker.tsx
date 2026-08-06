// ── Profile-photo picker ─────────────────────────────────────────────────────
//
// Upload → preview → store the `directus_files` uuid. Two steps, never one:
// the value written to the record is a plain id string, so a FormData body must
// never be handed to `updateRecord`.
//
// ⚠ The upload goes through `uploadFile()` from src/lib/api.ts — the only
// sanctioned path. It carries `assertWritable()` (which blocks writes while
// impersonating) and `captureApiError`, both of which a hand-rolled
// `fetch(POST /files)` would skip.
//
// The 64px preview is rendered here rather than through the messaging `Avatar`:
// that component's largest size is 56px and is applied as its own utility
// class, so a `className` override would be a Tailwind ordering gamble on a
// control whose whole job is showing the image at a known size.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ImageUp, Loader2, Trash2 } from 'lucide-react'
import { assetUrl, uploadFile } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface PhotoPickerProps {
  /** directus_files uuid, or null. */
  value: string | null | undefined
  onChange: (fileId: string | null) => void
  /** Alt text + avatar initials fallback, e.g. the member's name. */
  alt: string
  disabled?: boolean
  /** directus_files folder uuid. Omit for the root folder (profile photos live there today). */
  folder?: string
  /** Default 5 * 1024 * 1024. */
  maxBytes?: number
  /** Default 'image/jpeg,image/png,image/webp'. */
  accept?: string
  className?: string
}

function initialsFrom(alt: string): string {
  const parts = alt.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const BUTTON_CLASS =
  'inline-flex min-h-[44px] items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50'

export default function PhotoPicker({
  value,
  onChange,
  alt,
  disabled,
  folder,
  maxBytes = 5 * 1024 * 1024,
  accept = 'image/jpeg,image/png,image/webp',
  className,
}: PhotoPickerProps) {
  const { t } = useTranslation('admin')
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // Object URL for the file currently uploading — shown immediately so the
  // picker does not sit empty while the round trip runs.
  const [pending, setPending] = useState<string | null>(null)
  // The finished upload, KEYED BY the id we handed the parent. Keying is what
  // lets the preview be fully derived: if `value` moves off this id (record
  // reloaded, edit discarded) the local image simply stops being used — no
  // effect has to chase the prop and clear it.
  const [uploaded, setUploaded] = useState<{ id: string; url: string } | null>(null)
  // Same trick for a 404/403 asset: remember WHICH id failed, so a later good
  // id is not permanently hidden behind a stale boolean.
  const [brokenId, setBrokenId] = useState<string | null>(null)
  const objectUrl = useRef<string | null>(null)

  function releaseObjectUrl() {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
  }

  // Revoke on unmount — an un-revoked object URL pins the whole image in memory
  // for the life of the document.
  useEffect(() => releaseObjectUrl, [])

  const localUrl = pending ?? (uploaded && uploaded.id === value ? uploaded.url : null)
  const src = localUrl ?? (value && brokenId !== value ? assetUrl(value) : null)
  const hasPhoto = Boolean(value || pending)

  async function handleFile(file: File) {
    const allowed = accept.split(',').map((s) => s.trim()).filter(Boolean)
    // An empty `file.type` (some Android pickers) is let through — the server
    // still validates, and blocking here would reject legitimate images.
    if (file.type && !allowed.includes(file.type)) {
      toast.error(t('explorerFieldsPhotoWrongType'))
      return
    }
    if (file.size > maxBytes) {
      toast.error(t('explorerFieldsPhotoTooLarge', { mb: Math.round(maxBytes / 1024 / 1024) }))
      return
    }
    releaseObjectUrl()
    const url = URL.createObjectURL(file)
    objectUrl.current = url
    setUploaded(null)
    setPending(url)
    setBusy(true)
    try {
      const { id } = await uploadFile(file, folder)
      // Hold the local bitmap under the new id: Directus may not have finished
      // deriving the asset yet, and a 404 flash reads as a failed upload.
      setUploaded({ id, url })
      setPending(null)
      onChange(id)
    } catch {
      // uploadFile already logged + reported; the operator needs the plain fact.
      releaseObjectUrl()
      setPending(null)
      toast.error(t('explorerFieldsPhotoFailed'))
    } finally {
      setBusy(false)
    }
  }

  function handleRemove() {
    releaseObjectUrl()
    setPending(null)
    setUploaded(null)
    onChange(null)
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <span
        className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-lg font-medium text-muted-foreground"
        aria-hidden={src ? undefined : true}
      >
        {src ? (
          <img
            src={src}
            alt={alt}
            className="h-16 w-16 object-cover"
            onError={() => setBrokenId(value ?? null)}
          />
        ) : (
          initialsFrom(alt)
        )}
      </span>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        // The visible button is the accessible affordance; exposing the raw
        // input as well would announce two controls for one action.
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset so re-picking the same file fires `change` again.
          e.target.value = ''
          if (file) void handleFile(file)
        }}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
          {busy
            ? t('explorerFieldsPhotoUploading')
            : hasPhoto
              ? t('explorerFieldsPhotoReplace')
              : t('explorerFieldsPhotoUpload')}
        </button>

        {hasPhoto && (
          <button
            type="button"
            className={cn(BUTTON_CLASS, 'text-destructive hover:bg-destructive/10')}
            disabled={disabled || busy}
            onClick={handleRemove}
          >
            <Trash2 className="h-4 w-4" />
            {t('explorerFieldsPhotoRemove')}
          </button>
        )}
      </div>
    </div>
  )
}
