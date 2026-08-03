import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Cropper, { type Area } from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { Loader2, RotateCcw, RotateCw, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Crop + rotate an identity photo before it is encrypted.
 *
 * A phone camera shot of an ID is nearly always sideways, or a small card on a big table —
 * without this the coach shows a referee a rotated thumbnail of a desk. Cropping also means
 * the bytes we encrypt are only the document, so a stray background never reaches the store.
 *
 * Everything runs on a local object URL and a canvas. Nothing leaves the browser; the result
 * goes back as a File and straight into encryptDocument().
 */

/** ID-1 (bank/ID card) is 85.6 × 54 mm. Passport data pages are much closer to 4:3. */
const ASPECTS = [
  { key: 'card', value: 85.6 / 54 },
  { key: 'landscape', value: 4 / 3 },
  { key: 'portrait', value: 3 / 4 },
] as const

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Bounding box of the image once rotated — the space `croppedAreaPixels` is expressed in. */
function rotatedSize(width: number, height: number, rotation: number) {
  const rad = toRad(rotation)
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  }
}

/**
 * Draw the selected region at the chosen rotation and hand back JPEG bytes.
 *
 * Two canvases on purpose: react-easy-crop reports the crop in the coordinates of the
 * ROTATED bounding box, so the image has to be rotated into a canvas of exactly that size
 * before the region can be cut out of it. Sizing the first canvas any other way (a square of
 * the diagonal, say) shifts the origin and the crop lands off-target.
 */
async function renderCrop(src: string, crop: Area, rotation: number): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode failed'))
    img.src = src
  })

  const box = rotatedSize(image.width, image.height, rotation)
  const rotated = document.createElement('canvas')
  rotated.width = Math.ceil(box.width)
  rotated.height = Math.ceil(box.height)
  const rctx = rotated.getContext('2d')
  if (!rctx) throw new Error('no 2d context')
  rctx.translate(rotated.width / 2, rotated.height / 2)
  rctx.rotate(toRad(rotation))
  rctx.translate(-image.width / 2, -image.height / 2)
  rctx.drawImage(image, 0, 0)

  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(crop.width))
  out.height = Math.max(1, Math.round(crop.height))
  const octx = out.getContext('2d')
  if (!octx) throw new Error('no 2d context')
  // A white bed, not transparency: the crop can sit partly outside the photo, and a
  // transparent PNG-style gap turns black once JPEG-encoded.
  octx.fillStyle = '#ffffff'
  octx.fillRect(0, 0, out.width, out.height)
  octx.drawImage(
    rotated,
    Math.round(crop.x),
    Math.round(crop.y),
    out.width,
    out.height,
    0,
    0,
    out.width,
    out.height,
  )

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.92)
  })
}

interface Props {
  file: File
  onCancel: () => void
  onConfirm: (file: File) => void
}

export default function IdentityCropDialog({ file, onCancel, onConfirm }: Props) {
  const { t } = useTranslation('auth')

  // Lazy initialiser, not an effect: `file` is fixed for this dialog's lifetime (the parent
  // mounts it per pick), and a setState in the effect body cascades a render.
  const [src] = useState(() => URL.createObjectURL(file))
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [aspect, setAspect] = useState<number>(ASPECTS[0].value)
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // Revoked on unmount — an ID left in a live blob URL is exactly what this feature exists
  // to avoid leaving lying around.
  useEffect(() => () => URL.revokeObjectURL(src), [src])

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), [])

  const handleConfirm = async () => {
    if (!src || !area) return
    setBusy(true)
    setFailed(false)
    try {
      const blob = await renderCrop(src, area, rotation)
      onConfirm(new File([blob], 'identity.jpg', { type: 'image/jpeg' }))
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  // Portalled to <body> on purpose. The caller sits inside ProfileEditForm's <form>, and an
  // overlay nested in a form is one stray Enter (or one type-less button) away from silently
  // submitting the profile and navigating out from under the picker — the exact bug this
  // editor was added alongside.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={t('idCropTitle')}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <h2 className="text-sm font-semibold">{t('idCropTitle')}</h2>
        <p className="hidden text-xs text-white/70 sm:block">{t('idCropHint')}</p>
      </div>

      <div className="relative flex-1">
        {src && (
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            minZoom={1}
            maxZoom={5}
            zoomSpeed={0.2}
            objectFit="contain"
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
          />
        )}
      </div>

      <div className="space-y-3 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <p className="text-xs text-muted-foreground sm:hidden">{t('idCropHint')}</p>

        <div className="flex items-center gap-3">
          <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="range"
            min={1}
            max={5}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label={t('idCropZoom')}
            className="h-11 flex-1 accent-primary"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
            disabled={busy}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('idCropRotateLeft')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            disabled={busy}
          >
            <RotateCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('idCropRotateRight')}
          </Button>

          <div className="ml-auto flex gap-1" role="group" aria-label={t('idCropShape')}>
            {ASPECTS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setAspect(a.value)}
                aria-pressed={aspect === a.value}
                className={cn(
                  'min-h-[44px] rounded-md border px-3 text-xs',
                  aspect === a.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground',
                )}
              >
                {t(`idCropAspect_${a.key}`)}
              </button>
            ))}
          </div>
        </div>

        {failed && <p className="text-xs text-destructive">{t('idCropFailed')}</p>}

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
            {t('idCropCancel')}
          </Button>
          <Button type="button" className="flex-1" onClick={() => void handleConfirm()} disabled={busy || !area}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('idCropConfirm')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
