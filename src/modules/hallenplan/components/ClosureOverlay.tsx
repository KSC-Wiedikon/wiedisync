import { useTranslation } from 'react-i18next'

interface ClosureOverlayProps {
  reason: string
  hallName?: string
}

export default function ClosureOverlay({ reason, hallName }: ClosureOverlayProps) {
  const { t } = useTranslation('hallenplan')
  const label = hallName ? `${hallName}: ${reason}` : reason

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-1"
      style={{
        backgroundColor: 'rgba(31, 41, 55, 0.25)',
        backgroundImage:
          'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(31, 41, 55, 0.2) 8px, rgba(31, 41, 55, 0.2) 16px)',
        borderLeft: '3px dashed #991b1b',
        borderRight: '3px dashed #991b1b',
      }}
    >
      <span
        className="max-h-full max-w-full overflow-hidden rounded px-2 py-1 text-center text-xs font-medium italic leading-tight"
        style={{ backgroundColor: '#1f2937', color: '#f87171' }}
      >
        {t('closed')}: {label}
      </span>
    </div>
  )
}
