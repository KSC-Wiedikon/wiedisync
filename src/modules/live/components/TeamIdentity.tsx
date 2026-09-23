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
  // squeezing "Müller / Meier" onto one line on a phone.
  const players = sport === 'beach' ? beachPair(team.name) : []

  return (
    <div className={cn('min-w-0', end ? 'text-right' : 'text-left')}>
      <div className={cn('flex items-center gap-2', end && 'flex-row-reverse')}>
        <span
          className="inline-flex min-w-0 max-w-full items-center rounded-md px-2 py-1 text-sm font-bold uppercase leading-tight tracking-normal ring-1 ring-black/10 dark:ring-white/15 sm:text-lg sm:tracking-wide"
          style={{ backgroundColor: team.color, color: readableOn(team.color) }}
        >
          {/* Never ellipsise the team code — "KSCW…" is useless when both teams are
              KSCW. A long code breaks onto a second line inside the chip instead. */}
          <span className="min-w-0 break-words">{team.short || t('teamFallback')}</span>
        </span>
        {indicator}
      </div>

      {players.length > 1 ? (
        <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
          {players.map((p) => (
            <span key={p} className="block break-words">
              {p}
            </span>
          ))}
        </p>
      ) : (
        team.name &&
        team.name !== team.short && (
          <p className="mt-0.5 break-words text-xs leading-tight text-muted-foreground">{team.name}</p>
        )
      )}
    </div>
  )
}
