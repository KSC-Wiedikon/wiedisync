import { useTranslation } from 'react-i18next'
import { scheduledTimeToday, type LiveGameCandidate } from '../liveGame'
import type { BoardState } from '../types'

/**
 * A match set up on the board but not started (see isUpNext). The fixture's names when
 * the game is known (home first, as the league writes them), else the board's.
 */
export default function UpNextCard({ state, game }: { state: BoardState; game: LiveGameCandidate | null }) {
  const { t } = useTranslation('live')
  const home = game?.home_team || state.team_a_name || state.team_a_short
  const away = game?.away_team || state.team_b_name || state.team_b_short
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
