import { useTranslation } from 'react-i18next'
import { Users, Pencil, Trash2 } from 'lucide-react'
import TeamChip from '../../components/TeamChip'
import ParticipationSummary from '../../components/ParticipationSummary'
import { useAuth } from '../../hooks/useAuth'

import { formatDate, formatWeekday, formatTime, formatDayMonthZurich } from '../../utils/dateHelpers'
import ParticipationWarningBadge from '../../components/ParticipationWarningBadge'
import { getTrainingWarnings } from '../../utils/participationWarnings'
import type { Training, Team, Hall, Member, Participation } from '../../types'
import { asObj, relId, memberDisplayName, teamCoachIds } from '../../utils/relations'
import CancelActivityButton from '../../components/CancelActivityButton'
import ShareActivityButton from '../../components/ShareActivityButton'
import ActivityParticipation from '../../components/ActivityParticipation'
import ExtraHallsSuffix from '../../components/ExtraHallsSuffix'
import { DateRail, RowStripe, RowChip } from '../../components/ActivityRow'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { rsvpTone } from '../../utils/rsvpTone'
import CarpoolChip from '../carpool/CarpoolChip'

type TrainingExpanded = Training & {
  team: Team | string
  hall: Hall | string
  coach: Member | string
}

interface TrainingCardProps {
  training: TrainingExpanded
  /** Pre-fetched participations for this training (from batch query) */
  participations?: Participation[]
  /** Pre-fetched current user's participation (from batch query) */
  myParticipation?: Participation
  onOpenRoster?: (trainingId: string, teamId: string, date: string) => void
  onEdit?: (training: Training) => void
  onDelete?: (trainingId: string) => void
  /** Called after a participation save — parent can refetch */
  onParticipationSaved?: () => void
}

/**
 * Card anatomy (shared with EventCard / GameCard, see ActivityRow.tsx):
 *   rail (weekday / dd.mm / time) ┃ stripe = my RSVP ┃ body (title + status,
 *   chips, details, RSVP, counters) — then ONE tools line under a hairline.
 */
export default function TrainingCard({ training, participations, myParticipation, onOpenRoster, onEdit, onDelete, onParticipationSaved }: TrainingCardProps) {
  const { t } = useTranslation('trainings')
  const { t: tc } = useTranslation('common')
  const { user, canParticipateIn, isStaffOnly, getGuestLevel } = useAuth()
  const team = asObj<Team>(training.team)
  const hall = asObj<Hall>(training.hall)
  const coach = asObj<Member>(training.coach)
  const teamId = relId(training.team)
  const myStatus = myParticipation?.status ?? null
  const warnings = getTrainingWarnings(participations ?? [], training.min_participants)
  const isStaff = isStaffOnly(teamId)
  const myGuestLevel = getGuestLevel(teamId)
  const excludedGuestLevels = Array.isArray(training.excluded_guest_levels) ? training.excluded_guest_levels : []
  const guestExcluded = myGuestLevel > 0 && excludedGuestLevels.map((n) => Number(n)).includes(myGuestLevel)
  const cancelled = !!training.cancelled
  const shortened = !cancelled && training.auto_shortened_by_game != null
  const hallName = hall?.name || training.hall_name
  const showCounters = !cancelled && ((participations?.length ?? 0) > 0 || warnings.length > 0)

  return (
    <div className={cn(
      'flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-700 dark:bg-gray-800',
      cancelled && 'opacity-60',
    )}>
      <div className="flex flex-1 items-stretch gap-2.5 p-3 sm:gap-3">
        {/* The rail stays neutral unless cancelled: a red date for "I declined"
            would read as "training cancelled". The RSVP colour lives on the stripe. */}
        <DateRail
          eyebrow={formatWeekday(training.date)}
          main={<span title={formatDate(training.date)}>{formatDayMonthZurich(training.date)}</span>}
          sub={formatTime(training.start_time)}
          extra={training.end_time ? `–${formatTime(training.end_time)}` : undefined}
          tone={cancelled ? 'red' : 'gray'}
        />
        <RowStripe tone={cancelled ? 'red' : user ? rsvpTone(myStatus) : 'gray'} />

        {/* min-w-0: a flex item defaults to min-width:auto and so refuses to shrink
            below its min-content, which the card's overflow-hidden then clips
            instead of wrapping. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {team ? <TeamChip team={team.name} size="sm" /> : <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('title')}</span>}
            </div>
            {cancelled && (
              <span className="mt-0.5 flex shrink-0 items-center">
                <RowChip tone="red">{t('cancelled')}</RowChip>
              </span>
            )}
          </div>

          {(training.is_trial || shortened) && (
            <div className="mt-1.5 flex flex-wrap items-stretch gap-1.5">
              {training.is_trial && <RowChip tone="brand">{t('trialBadge')}</RowChip>}
              {shortened && <RowChip tone="amber">{t('shortenedBadge')}</RowChip>}
            </div>
          )}

          {/* Hall line WRAPS rather than truncating: the extra-halls suffix
              ("+ KWI A (from 18:30)") is exactly the part a truncation would hide. */}
          {(hallName || coach) && (
            <p className="mt-1.5 break-words text-sm leading-snug text-gray-600 dark:text-gray-400">
              {hallName && <span>{hallName}<ExtraHallsSuffix extraHalls={training.extra_halls} /></span>}
              {hallName && coach && ' · '}
              {coach && <span>{memberDisplayName(coach)}</span>}
            </p>
          )}

          {cancelled && training.cancel_reason && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{training.cancel_reason}</p>
          )}
          {shortened && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t('shortenedHint')}</p>
          )}
          {training.notes && !cancelled && (
            <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{training.notes}</p>
          )}

          {!cancelled && user && canParticipateIn(teamId) && (
            <div className="mt-2.5">
              <ActivityParticipation
                kind="training"
                activityId={training.id}
                date={training.date}
                respondBy={training.respond_by}
                activityTime={training.start_time}
                existingParticipation={myParticipation}
                isStaff={isStaff}
                guestExcluded={guestExcluded}
                onSaved={onParticipationSaved}
              />
            </div>
          )}

          {/* Counters in the body, under the RSVP — never on a wrapping
              justify-between line with the action buttons. */}
          {showCounters && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {participations && participations.length > 0 && (
                <ParticipationSummary activityType="training" activityId={training.id} bars participations={participations} coachMemberIds={teamCoachIds(team)} />
              )}
              {warnings.length > 0 && <ParticipationWarningBadge warnings={warnings} namespace="participation" />}
            </div>
          )}
        </div>
      </div>

      {/* Tools line: rendered once at every width, wraps as a whole line.
          `empty:hidden` drops the hairline for a viewer with nothing to do. */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-3 py-2 empty:hidden dark:border-gray-700">
        {/* Car pooling (migration 378). No detail modal behind this card, so the
            chip opens the rides board in its own dialog. */}
        {!cancelled && training.carpool_enabled && user && (
          <CarpoolChip type="training" id={training.id} />
        )}
        {!cancelled && onOpenRoster && (
          <Button
            size="tool"
            variant="outline"
            onClick={() => onOpenRoster(training.id, teamId, training.date)}
            title={t('participation')}
            aria-label={t('participation')}
          >
            <Users aria-hidden />
            {t('participation')}
          </Button>
        )}
        {!cancelled && onEdit && (
          <Button size="tool" variant="outline" onClick={() => onEdit(training)} title={t('editTraining')} aria-label={t('editTraining')}>
            <Pencil aria-hidden />
            {tc('edit')}
          </Button>
        )}
        {!cancelled && onDelete && (
          <Button
            size="tool"
            variant="outline"
            onClick={() => onDelete(training.id)}
            title={t('deleteTraining')}
            aria-label={t('deleteTraining')}
            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
          >
            <Trash2 aria-hidden />
            {tc('delete')}
          </Button>
        )}
        {/* Share sits on the CARD, not in a detail modal, because this card
            has no detail modal — it does RSVP inline and is never clickable
            through to one (unlike EventCard/GameCard). Without this the
            trainings page would be the one surface you cannot share from. */}
        {!cancelled && (
          <ShareActivityButton kind="training" id={training.id} title={team?.name ?? t('title')} iconOnly />
        )}
        <CancelActivityButton
          kind="training"
          activityId={training.id}
          isCancelled={cancelled}
          teamIds={teamId ? [teamId] : []}
          variant="icon"
        />
      </div>
    </div>
  )
}
