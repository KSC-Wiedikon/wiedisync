import { useTranslation } from 'react-i18next'
import { Users, Pencil, Trash2 } from 'lucide-react'
import TeamChip from '../../components/TeamChip'
import ParticipationSummary from '../../components/ParticipationSummary'
import { useAuth } from '../../hooks/useAuth'

import { formatDate, formatWeekday, formatTime } from '../../utils/dateHelpers'
import ParticipationWarningBadge from '../../components/ParticipationWarningBadge'
import { getTrainingWarnings } from '../../utils/participationWarnings'
import type { Training, Team, Hall, Member, Participation } from '../../types'
import { asObj, relId, memberName, teamCoachIds } from '../../utils/relations'
import CancelActivityButton from '../../components/CancelActivityButton'
import ActivityParticipation from '../../components/ActivityParticipation'

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

const statusBorderColor: Record<string, string> = {
  confirmed: 'bg-green-500 dark:bg-green-400',
  tentative: 'bg-yellow-500 dark:bg-yellow-400',
  declined: 'bg-red-500 dark:bg-red-400',
  waitlisted: 'bg-orange-500 dark:bg-orange-400',
  absent: 'bg-gray-400 dark:bg-gray-500',
}

export default function TrainingCard({ training, participations, myParticipation, onOpenRoster, onEdit, onDelete, onParticipationSaved }: TrainingCardProps) {
  const { t } = useTranslation('trainings')
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

  return (
    <div className={`flex items-stretch overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-card ${training.cancelled ? 'opacity-60' : ''}`}>
      {/* Participation status vertical banner */}
      {user && myStatus && (
        <div className={`w-1 shrink-0 ${statusBorderColor[myStatus] ?? ''}`} />
      )}
      <div className="flex-1 p-3">
      {/* Top row: team chip + date + counters */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {team && <TeamChip team={team.name} size="sm" />}
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {formatWeekday(training.date)}, {formatDate(training.date)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!training.cancelled && warnings.length > 0 && (
            <ParticipationWarningBadge warnings={warnings} namespace="participation" />
          )}
          {training.is_trial && (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
              {t('trialBadge')}
            </span>
          )}
          {training.cancelled && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              {t('cancelled')}
            </span>
          )}
          <CancelActivityButton
            kind="training"
            activityId={training.id}
            isCancelled={!!training.cancelled}
            teamIds={teamId ? [teamId] : []}
            variant="icon"
          />
        </div>
      </div>

      {/* Details */}
      <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
        {formatTime(training.start_time)} – {formatTime(training.end_time)}
        {(hall || training.hall_name) && <span> · {hall?.name || training.hall_name}</span>}
        {coach && <span> · {memberName(coach)}</span>}
      </p>

      {training.cancelled && training.cancel_reason && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{training.cancel_reason}</p>
      )}
      {training.notes && !training.cancelled && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{training.notes}</p>
      )}

      {/* Bottom row: RSVP + bars + actions */}
      {!training.cancelled && (
        <div className="mt-2.5 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            {user && canParticipateIn(teamId) && (
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
            )}
          </div>
          {participations && participations.length > 0 && (
            <div data-tour="participation-dots">
              <ParticipationSummary activityType="training" activityId={training.id} bars participations={participations} coachMemberIds={teamCoachIds(team)} />
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {onOpenRoster && (
              <button
                onClick={() => onOpenRoster(training.id, teamId, training.date)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                title={t('participation')}
                aria-label={t('participation')}
              >
                <Users className="h-4 w-4" />
              </button>
            )}
            {onEdit && (
              <button
                data-tour="edit-training"
                onClick={() => onEdit(training)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                title={t('editTraining')}
                aria-label={t('editTraining')}
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {onDelete && (
              <button
                data-tour="delete-training"
                onClick={() => onDelete(training.id)}
                className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                title={t('deleteTraining')}
                aria-label={t('deleteTraining')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
