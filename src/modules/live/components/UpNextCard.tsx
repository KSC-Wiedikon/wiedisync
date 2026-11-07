import { useTranslation } from 'react-i18next'
import { scheduledTimeToday, type LiveGameCandidate } from '../liveGame'
import { teamLabel, toTeams } from '../scoreboard'
import type { BoardState } from '../types'

/**
 * A match set up on the board but not started (see isUpNext). The fixture's names when
 * the game is known (home first, as the league writes them), else the board's, else Home and Away.
 */
export default function UpNextCard({ state, game }: { state: BoardState; game: LiveGameCandidate | null }) {
  const { t } = useTranslation('live')
  const [a, b] = toTeams(state)
  const home = game?.home_team || teamLabel(a, t)
  const away = game?.away_team || teamLabel(b, t)
  const time = scheduledTimeToday(game)
  return (
    <div className="rounded-2xl border border-hairline bg-card p-6 text-center shadow-card sm:p-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('upNext')}</p>
      <p className="mt-2 break-words text-lg font-semibold text-foreground">
        {home} – {away}
        {time && (
          <>
            {' '}
            <span className="whitespace-nowrap font-normal tabular-nums text-muted-foreground">{t('scheduledAt', { time })}</span>
          </>
        )}
      </p>
    </div>
  )
}
