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
      className="group flex items-center gap-2 rounded-full focus-visible:outline-none"
    >
      {(labelLeft || labelRight) && (
        <span className={cn(isMd ? 'text-base' : 'text-sm', 'text-foreground')}>
          {enabled ? labelRight : labelLeft}
        </span>
      )}
      {/* Same finish as ui/switch (svrz): slim track, white knob. The `before:`
          pseudo keeps the ~44px touch target around the small visual track. */}
      <div
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-background",
          isMd ? 'h-6 w-11' : 'h-5 w-9',
          // Distinct on/off track colour so state reads without relying on the
          // knob position alone.
          enabled ? 'bg-primary' : 'bg-stone-300 dark:bg-input',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center justify-center overflow-hidden rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
            isMd ? 'h-5 w-5' : 'h-4 w-4',
          )}
          style={{
            transform: `translateX(${enabled ? (isMd ? '1.375rem' : '1.125rem') : '0.125rem'})`,
          }}
        >
          <span className={cn('flex items-center justify-center text-stone-500 [&_svg]:h-full [&_svg]:w-full', isMd ? 'h-3.5 w-3.5' : 'h-3 w-3')}>
            {enabled ? iconOn : iconOff}
          </span>
        </span>
      </div>
    </button>
  )
}
