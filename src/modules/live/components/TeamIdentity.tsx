import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { beachPair, readableOn, teamLabel } from '../scoreboard'
import type { LiveSport, TeamView } from '../types'

/**
 * A team's masthead on the scoreboard: the full name (or, for beach, the two players
 * stacked) on a chip in the team's own colour, Home or Away if the board sent no name.
 * Shared by every sport so the two halves of the board always align.
 */
export default function TeamIdentity({
  team,
  align,
  sport,
}: {
  team: TeamView
  align: 'start' | 'end'
  sport: LiveSport
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
          className="inline-flex min-w-0 max-w-full items-center rounded-md px-1.5 py-1 text-[13px] font-bold uppercase leading-tight tracking-normal ring-1 ring-black/10 dark:ring-white/15 sm:px-2 sm:text-lg sm:tracking-wide"
          style={{ backgroundColor: team.color, color: readableOn(team.color) }}
        >
          {/* Never ellipsise a team name — "KSC W…" is useless when both teams are
              KSCW. A long name breaks onto more lines inside the chip instead. */}
          <span className="min-w-0 break-words">
            {players.length > 1
              ? players.map((p) => (
                  <span key={p} className="block">
                    {p}
                  </span>
                ))
              : teamLabel(team, t)}
          </span>
        </span>
      </div>
    </div>
  )
}
