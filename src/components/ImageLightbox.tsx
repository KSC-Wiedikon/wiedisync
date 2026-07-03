import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

interface ImageLightboxProps {
  src: string
  alt: string
  open: boolean
  onClose: () => void
}

export default function ImageLightbox({ src, alt, open, onClose }: ImageLightboxProps) {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLDialogElement>(null)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) dialog.showModal()
      requestAnimationFrame(() => setVisible(true))
      setClosing(false)
    } else if (dialog.open) {
      setClosing(true)
      setVisible(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); handleClose() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  function handleClose() {
    setClosing(true)
    setVisible(false)
  }

  function handleAnimEnd() {
    if (closing) {
      ref.current?.close()
      setClosing(false)
      onClose()
    }
  }

  if (!open && !closing) return null

  return (
    <dialog
      ref={ref}
      aria-label={alt || undefined}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); handleClose() }}
      onClick={(e) => {
        if (e.target === ref.current) handleClose()
      }}
      className={`fixed inset-0 m-0 flex h-dvh w-dvw max-h-none max-w-none items-center justify-center border-0 bg-black/90 p-0 backdrop:bg-transparent ${
        visible ? 'animate-fade-in' : closing ? 'animate-fade-out' : ''
      }`}
      onAnimationEnd={handleAnimEnd}
    >
      <button
        onClick={handleClose}
        aria-label={t('close')}
        className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt}
        className={`max-h-[90dvh] max-w-[95vw] object-contain sm:max-w-[90vw] ${
          visible ? 'animate-modal-enter' : closing ? 'animate-modal-exit' : ''
        }`}
      />
    </dialog>
  )
}
