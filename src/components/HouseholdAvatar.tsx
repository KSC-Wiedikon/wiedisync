import { assetUrl } from '../lib/api'
import { cn } from '@/lib/utils'

/**
 * One identity in the household switcher — photo or initial — carrying the
 * member's stable accent (householdAccents.ts). The accent is the fastest of the
 * "which account am I on?" signals, so it must survive a photo: with one it is a
 * ring, without one it is the initial's background.
 *
 * `accent` is a literal Tailwind pair from ACCENT_CLASSES (`dot` + `ring`), or
 * omitted for the main account (primary colour, no ring).
 */
export default function HouseholdAvatar({ photo, name, accent, size = 'md', className }: {
  photo?: string | null
  name: string
  accent?: { dot: string; ring: string } | null
  size?: 'sm' | 'md'
  className?: string
}) {
  const dim = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm'
  if (photo) {
    return (
      <img
        src={assetUrl(photo)}
        alt=""
        className={cn(dim, 'shrink-0 rounded-full object-cover', accent && ['ring-2 ring-offset-1 ring-offset-background', accent.ring], className)}
      />
    )
  }
  return (
    <span className={cn(dim, 'grid shrink-0 place-items-center rounded-full font-semibold text-white', accent ? accent.dot : 'bg-primary', className)}>
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}
