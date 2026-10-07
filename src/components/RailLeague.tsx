import { cn } from '@/lib/utils'
import { leagueRailLabel } from '../utils/leagueShort'

/**
 * ♂ and ♀, drawn instead of typed (as in svrz_rc): Inter's subsets do not
 * cover U+2640/U+2642, so the typed glyph falls back to a system font and sits
 * below the line beside its own digits. An em-sized SVG sits where icons sit
 * and carries a label a screen reader can read out.
 */
export function GenderMark({ mark, label }: { mark: '♂' | '♀'; label?: string }) {
  const common = {
    className: cn('inline-block h-[1em] w-[1em] align-[-0.125em]', mark === '♂' ? 'text-sky-600 dark:text-sky-400' : 'text-pink-500 dark:text-pink-400'),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    role: 'img' as const,
    'aria-label': label ?? (mark === '♂' ? 'Men' : 'Women'),
  }
  return mark === '♂' ? (
    <svg {...common}>
      <circle cx="10" cy="14.5" r="5.5" />
      <path d="M14.2 10.6 20 4.8" />
      <path d="M14.6 4.4H20.4V10.2" />
    </svg>
  ) : (
    <svg {...common}>
      <circle cx="12" cy="8" r="6" />
      <path d="M12 14v7.5" />
      <path d="M8.3 18.4h7.4" />
    </svg>
  )
}

/** The league in a game's date rail — "4L ♀ A" — with the gender mark drawn. */
export function RailLeague({ league }: { league: string | null | undefined }) {
  const text = leagueRailLabel(league)
  if (!text) return null
  return (
    <>
      {text.split(/(♂|♀)/).map((part, i) =>
        part === '♂' || part === '♀' ? <GenderMark key={i} mark={part} /> : <span key={i}>{part}</span>,
      )}
    </>
  )
}
