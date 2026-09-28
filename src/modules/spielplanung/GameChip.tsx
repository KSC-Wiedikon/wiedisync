import { Home as HomeIcon, Plane, Trophy, Medal } from 'lucide-react'
import TeamChip from '../../components/TeamChip'
import type { Game } from '../../types'
import { cn } from '../../lib/utils'
import { formatTime } from '../../utils/dateHelpers'
import { detectCupMatch, opponentName } from './gameChipUtils'

interface GameChipProps {
  game: Game
  teamName: string
  onClick?: (game: Game) => void
}

export default function GameChip({ game, teamName, onClick }: GameChipProps) {
  const isHome = game.type === 'home'
  const opponent = opponentName(game)
  const cup = detectCupMatch(game.league)
  const isManual = game.source === 'manual'
  const time = game.time ? formatTime(game.time) : ''

  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(game) : undefined}
      aria-label={`${teamName}, ${isHome ? 'home' : 'away'}${time ? `, ${time}` : ''}, ${opponent}`}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm border-l-[3px] bg-muted/40 px-1.5 py-0.5 text-left text-[10px] leading-tight transition-colors',
        onClick && 'cursor-pointer hover:bg-muted',
        !onClick && 'cursor-default',
        isHome
          ? 'border-emerald-500 dark:border-emerald-400'
          : 'border-blue-500 dark:border-blue-400',
        isManual && 'outline outline-1 outline-dashed outline-muted-foreground/50 outline-offset-[-1px]',
      )}
    >
      <TeamChip team={teamName} size="xs" className="shrink-0 !px-1.5 !py-0 !text-[9px]" />
      {isHome ? (
        <HomeIcon
          className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
      ) : (
        <Plane
          className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400"
          aria-hidden
        />
      )}
      {time && <span className="shrink-0 font-semibold text-foreground">{time}</span>}
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={opponent}>{opponent}</span>
      {cup === 'gold' && <Trophy className="h-3 w-3 shrink-0 text-yellow-500" aria-hidden />}
      {cup === 'silver' && <Medal className="h-3 w-3 shrink-0 text-muted-foreground/80" aria-hidden />}
    </button>
  )
}
