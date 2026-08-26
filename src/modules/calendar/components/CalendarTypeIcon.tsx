import { CalendarOff, TrafficCone, CircleX, Star, ClipboardList, Cake } from 'lucide-react'
import BasketballIcon from '../../../components/BasketballIcon'
import VolleyballIcon from '../../../components/VolleyballIcon'

/**
 * The calendar's type glyph — one component for every surface that paints an entry.
 *
 * Folded from two near-identical copies (the month grid's and the overflow modal's).
 * They were NOT interchangeable, so both differences are props rather than a picked
 * winner:
 *   - `size`: the grid draws at 3.5, the modal at 3. The fallback dot inverts (the
 *     grid's is smaller than the modal's) — preserved deliberately, not a slip.
 *   - `filled`: the modal draws solid balls, the grid hollow ones.
 *
 * ⚠ A filled ball ignores `className` on purpose. BasketballIcon/VolleyballIcon carry
 * their own brand hex when filled, and a `text-*` class would silently override it.
 */
export default function CalendarTypeIcon({
  type,
  sport,
  className = '',
  size = 'md',
  filled = false,
}: {
  type: string
  sport?: 'volleyball' | 'basketball'
  className?: string
  size?: 'sm' | 'md'
  filled?: boolean
}) {
  const base = size === 'sm' ? 'h-3 w-3 shrink-0' : 'inline-block h-3.5 w-3.5 shrink-0'

  if (type === 'training') {
    return <TrafficCone className={`${base} ${className}`} strokeWidth={2.5} />
  }
  if (type === 'closure') {
    return <CircleX className={`${base} ${className}`} strokeWidth={2.5} />
  }
  if (type === 'game' || type === 'game-home' || type === 'game-away') {
    const Ball = sport === 'basketball' ? BasketballIcon : VolleyballIcon
    return filled
      ? <Ball className={base} filled />
      : <Ball className={`${base} ${className}`} />
  }
  if (type === 'event') {
    return <Star className={`${base} ${className}`} fill="currentColor" strokeWidth={2} />
  }
  if (type === 'absence') {
    return <CalendarOff className={`${base} ${className}`} strokeWidth={2.5} />
  }
  if (type === 'scorer-duty') {
    return <ClipboardList className={`${base} ${className}`} strokeWidth={2.5} />
  }
  if (type === 'birthday') {
    return <Cake className={`${base} ${className}`} strokeWidth={2.5} />
  }
  if (type === 'hall') {
    // Always filled in both original copies, and never coloured by the caller.
    return <BasketballIcon className={base} filled />
  }
  // Fallback dot. The sizes are inverted relative to `base` — that is how the two
  // originals were, and matching them is what keeps this extraction invisible.
  const dot = size === 'sm' ? 'h-2.5 w-2.5' : 'h-2 w-2'
  return <span className={`inline-block ${dot} shrink-0 rounded-full bg-current ${className}`} />
}
