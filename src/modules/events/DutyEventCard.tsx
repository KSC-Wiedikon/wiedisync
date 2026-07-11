import { useTranslation } from 'react-i18next'
import { ClipboardList } from 'lucide-react'
import type { Team } from '../../types'
import { type MyDuty, DUTY_ROLE_LABEL_KEYS } from '../../hooks/useMyDuties'
import { formatDate, formatTime } from '../../utils/dateHelpers'
import { asObj } from '../../utils/relations'

/**
 * Read-only card for a duty the logged-in member is on, shown interleaved with
 * real events on the Events page. A projection of the game's assignment — no
 * RSVP, since the person can't decline a duty (only delegate it on /scorer).
 */
export default function DutyEventCard({ duty }: { duty: MyDuty }) {
  const { t } = useTranslation('scorer')
  const g = duty.game
  const team = asObj<Team>(g.kscw_team)
  const roleLabel = t(DUTY_ROLE_LABEL_KEYS[duty.role] ?? 'scorer')

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-900/15">
      <div className="flex items-start gap-3">
        <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-800/50 dark:text-amber-200">
              {t('dutyBadge')}
            </span>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{roleLabel}</span>
          </div>
          <p className="mt-1 break-words text-sm text-gray-800 dark:text-gray-200">
            {g.home_team} – {g.away_team}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {g.date ? formatDate(g.date) : ''}
            {g.time ? ` · ${formatTime(g.time)}` : ''}
            {team?.name ? ` · ${team.name}` : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
