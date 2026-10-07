import { useTranslation } from 'react-i18next'
import { ClipboardList } from 'lucide-react'
import type { Team } from '../../types'
import { type MyDuty, DUTY_ROLE_LABEL_KEYS } from '../../hooks/useMyDuties'
import { formatDate, formatDayMonthZurich, formatTime, formatWeekday } from '../../utils/dateHelpers'
import { gameNumberLabel, leagueRailLabel } from '../../utils/leagueShort'
import { asObj } from '../../utils/relations'
import { DateRail, RowStripe, RowChip } from '../../components/ActivityRow'

/**
 * Read-only card for a duty the logged-in member is on, shown interleaved with
 * real events on the Events page. A projection of the game's assignment — no
 * RSVP, since the person can't decline a duty (only delegate it on /scorer).
 * Same anatomy as EventCard (rail ┃ stripe ┃ body); "duty" is the amber stripe
 * + chip, not a filled amber box.
 */
export default function DutyEventCard({ duty }: { duty: MyDuty }) {
  const { t } = useTranslation('scorer')
  const g = duty.game
  const team = asObj<Team>(g.kscw_team)
  const roleLabel = t(DUTY_ROLE_LABEL_KEYS[duty.role] ?? 'scorer')

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
      <div className="flex flex-1 items-stretch gap-2.5 p-3 sm:gap-3">
        <DateRail
          eyebrow={g.date ? formatWeekday(g.date) : undefined}
          main={g.date ? <span title={formatDate(g.date)}>{formatDayMonthZurich(g.date)}</span> : '–'}
          sub={g.time ? formatTime(g.time) : undefined}
          extra={leagueRailLabel(g.league) || undefined}
          matchNo={gameNumberLabel(g.game_id) || undefined}
        />
        <RowStripe tone="amber" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-snug text-foreground sm:text-[15px]">
            {g.home_team} – {g.away_team}
          </p>
          <div className="mt-1.5 flex flex-wrap items-stretch gap-1.5">
            <RowChip tone="amber">
              <ClipboardList aria-hidden />
              {t('dutyBadge')}
            </RowChip>
            <RowChip>{roleLabel}</RowChip>
            {team?.name && <RowChip>{team.name}</RowChip>}
          </div>
        </div>
      </div>
    </div>
  )
}
