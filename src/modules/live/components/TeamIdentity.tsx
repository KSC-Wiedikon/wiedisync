import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { beachPair, readableOn } from '../scoreboard'
import type { LiveSport, TeamView } from '../types'

/**
 * A team's masthead on the scoreboard: the short code on a chip in the team's own
 * colour, the full name (or, for beach, the two players stacked) underneath, and
 * an optional per-sport indicator slot beside the chip (the volleyball serve dot).
 * Shared by every sport so the two halves of the board always align.
 */
export default function TeamIdentity({
  team,
  align,
  sport,
  indicator,
}: {
  team: TeamView
  align: 'start' | 'end'
  sport: LiveSport
  indicator?: React.ReactNode
}) {
  const { t } = useTranslation('live')
  const end = align === 'end'
  // Beach publishes the pair in one name field — stack the players instead of
  // truncating "Müller / Meier" to something unreadable on a phone.
  const players = sport === 'beach' ? beachPair(team.name) : []

  return (
    <div className={cn('min-w-0', end ? 'text-right' : 'text-left')}>
      <div className={cn('flex items-center gap-2', end && 'flex-row-reverse')}>
        <span
          className="inline-flex min-w-0 items-center rounded-md px-2 py-1 text-base font-bold uppercase tracking-wide ring-1 ring-black/10 dark:ring-white/15 sm:text-lg"
          style={{ backgroundColor: team.color, color: readableOn(team.color) }}
        >
          <span className="truncate">{team.short || t('teamFallback')}</span>
        </span>
        {indicator}
      </div>

      {players.length > 1 ? (
        <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
          {players.map((p) => (
            <span key={p} className="block truncate">
              {p}
            </span>
          ))}
        </p>
      ) : (
        team.name &&
        team.name !== team.short && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{team.name}</p>
        )
      )}
    </div>
  )
}
