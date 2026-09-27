import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * The card-level RSVP pill (Yes / Maybe / No, "Per day", the calendar's RSVP
 * trigger). ONE height for every card RSVP control, on the Button `tool` scale:
 * 44px on a phone (touch target), 32px from sm — so the answer pills and the
 * card's tools line step together instead of a 20px pill sitting next to a
 * 44px button. Colours come from the caller (`rsvpButtonClass`, brand, …).
 */
const RsvpPill = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-11 min-w-11 items-center justify-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
        'sm:h-8 sm:min-w-0 sm:px-3 sm:text-xs',
        className,
      )}
      {...props}
    />
  ),
)
RsvpPill.displayName = 'RsvpPill'

export default RsvpPill

/** Skeleton with the pill's exact footprint (no reflow when the real pills land). */
export function RsvpPillSkeleton({ className }: { className?: string }) {
  return <span className={cn('inline-block h-11 animate-pulse rounded-full bg-gray-200 sm:h-8 dark:bg-gray-700', className)} aria-hidden />
}
