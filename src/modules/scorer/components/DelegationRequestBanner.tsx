import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, Check, X } from 'lucide-react'
import type { ScorerDelegation, Member, Game } from '../../../types'
import { formatTime } from '../../../utils/dateHelpers'

interface DelegationRequestBannerProps {
  delegations: ScorerDelegation[]
  members: Member[]
  games: Game[]
  onAccept: (id: string) => void
  onDecline: (id: string) => void
}

function getDateFormatter(locale: string) {
  const loc = locale.startsWith('gsw') || locale === 'de' ? 'de-CH' : locale === 'en' ? 'en-GB' : locale
  return new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short' })
}

const ROLE_LABEL_KEYS: Record<string, string> = {
  scorer: 'scorer',
  scoreboard: 'scoreboard',
  scorer_scoreboard: 'scorerTaefeler',
  bb_scorer: 'bbScorer',
  bb_timekeeper: 'bbTimekeeper',
  bb_24s_official: 'bb24sOfficial',
}

export default function DelegationRequestBanner({
  delegations,
  members,
  games,
  onAccept,
  onDecline,
}: DelegationRequestBannerProps) {
  const { t, i18n } = useTranslation('scorer')
  const dateFormatter = getDateFormatter(i18n.language)

  if (delegations.length === 0) return null

  function getMemberName(id: string): string {
    const m = members.find((mem) => mem.id === id)
    return m ? `${m.first_name} ${m.last_name}` : ''
  }

  return (
    <div className="space-y-3">
      {delegations.map((d) => {
        const game = games.find((g) => g.id === d.game)
        const fromName = getMemberName(d.from_member)
        const roleKey = ROLE_LABEL_KEYS[d.role] ?? d.role
        const dateStr = game?.date ? dateFormatter.format(new Date(game.date + 'T00:00:00')) : ''
        const gameLabel = game ? `${game.home_team} – ${game.away_team}` : ''

        return (
          <div
            key={d.id}
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
          >
            <div className="flex items-start gap-3">
              <ArrowRightLeft className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t('delegateRequestTitle')}
                </p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t('delegateRequestMessage', {
                    from: fromName,
                    role: t(roleKey),
                    game: gameLabel,
                    date: dateStr,
                  })}
                </p>
                {game && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                    {dateStr} · {game.time ? formatTime(game.time) : ''} · {game.league}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => onAccept(d.id)}
                    className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                  >
                    <Check className="h-4 w-4" />
                    {t('delegateAccept')}
                  </button>
                  <button
                    onClick={() => onDecline(d.id)}
                    className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <X className="h-4 w-4" />
                    {t('delegateDecline')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
