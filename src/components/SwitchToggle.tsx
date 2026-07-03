import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SwitchToggleProps {
  enabled: boolean
  onChange: () => void
  labelLeft?: string
  labelRight?: string
  iconOff: ReactNode
  iconOn: ReactNode
  size?: 'sm' | 'md'
  ariaLabel?: string
}

export default function SwitchToggle({
  enabled,
  onChange,
  labelLeft,
  labelRight,
  iconOff,
  iconOn,
  size = 'sm',
  ariaLabel,
}: SwitchToggleProps) {
  const isMd = size === 'md'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel ?? (enabled ? labelRight : labelLeft)}
      onClick={onChange}
      className="flex items-center gap-2"
    >
      {(labelLeft || labelRight) && (
        <span className={cn(isMd ? 'text-base' : 'text-sm', 'text-gray-600 dark:text-gray-400')}>
          {enabled ? labelRight : labelLeft}
        </span>
      )}
      <div
        className={cn(
          'relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors',
          isMd ? 'h-[2.7rem] w-[4.75rem]' : 'h-[2.475rem] w-[4.05rem]',
          // Distinct on/off track colour so state reads without relying on the
          // knob position alone.
          enabled ? 'bg-brand-500 dark:bg-brand-500' : 'bg-gray-300 dark:bg-gray-600',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center justify-center overflow-hidden rounded-full bg-white shadow-sm transition-transform',
            isMd ? 'h-8 w-8' : 'h-7 w-7',
          )}
          style={{
            transform: `translateX(${enabled ? (isMd ? '2.375rem' : '1.8rem') : '0.3rem'})`,
          }}
        >
          <span className={cn('flex items-center justify-center', isMd ? 'h-7 w-7' : 'h-5 w-5', 'text-gray-600')}>
            {enabled ? iconOn : iconOff}
          </span>
        </span>
      </div>
    </button>
  )
}
