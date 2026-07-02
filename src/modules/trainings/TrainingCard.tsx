import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MessageSquare, Users, Pencil, Trash2 } from 'lucide-react'
import TeamChip from '../../components/TeamChip'
import ParticipationSummary from '../../components/ParticipationSummary'
import { rsvpButtonClass } from '../../utils/participationColors'
import { useAuth } from '../../hooks/useAuth'
import { useMutation } from '../../hooks/useMutation'
import { useMyCoveringAbsence } from '../../hooks/useMyCoveringAbsence'
import { useAbsenceNoteText } from '../../hooks/useAbsenceNoteText'

import { formatDate, formatWeekday, formatTime, getDeadlineDate } from '../../utils/dateHelpers'
import ParticipationWarningBadge from '../../components/ParticipationWarningBadge'
import { getTrainingWarnings } from '../../utils/participationWarnings'
import type { Training, Team, Hall, Member, Participation } from '../../types'
import { asObj, relId, memberName, teamCoachIds } from '../../utils/relations'
import CancelActivityButton from '../../components/CancelActivityButton'

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
  const { user, canParticipateIn } = useAuth()
  const team = asObj<Team>(training.team)
  const hall = asObj<Hall>(training.hall)
  const coach = asObj<Member>(training.coach)
  const teamId = relId(training.team)
  const myStatus = myParticipation?.status ?? null
  const warnings = getTrainingWarnings(participations ?? [], training.min_participants)

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
              <TrainingParticipation training={training} existingParticipation={myParticipation} onSaved={onParticipationSaved} />
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

/** Participation buttons using pre-fetched data — only writes trigger API calls */
function TrainingParticipation({ training, existingParticipation, onSaved }: { training: TrainingExpanded; existingParticipation?: Participation; onSaved?: () => void }) {
  const { t } = useTranslation('participation')
  const { t: tTrainings } = useTranslation('trainings')
  const { user, isStaffOnly, getGuestLevel } = useAuth()
  const isStaff = isStaffOnly(relId(training.team))
  const myGuestLevel = getGuestLevel(relId(training.team))
  const excludedGuestLevels = Array.isArray(training.excluded_guest_levels) ? training.excluded_guest_levels : []
  const guestExcluded = myGuestLevel > 0 && excludedGuestLevels.map((n) => Number(n)).includes(myGuestLevel)
  const { create, update } = useMutation<Participation>('participations')
  const { absence, hasAbsence } = useMyCoveringAbsence('training', training.date)
  const absenceLabel = absence?.type === 'weekly' ? 'declinedUnavailable' : 'absent'
  const absenceNoteText = useAbsenceNoteText(absence)

  const deadlinePassed = training.respond_by
    ? getDeadlineDate(training.respond_by, training.start_time) < new Date()
    : false

  const [optimisticStatus, setOptimisticStatus] = useState<Participation['status'] | null>(null)
  const [saveConfirmed, setSaveConfirmed] = useState(false)
  const [guestCount, setGuestCount] = useState(existingParticipation?.guest_count ?? 0)
  const [noteText, setNoteText] = useState(existingParticipation?.note ?? '')
  const [noteSaved, setNoteSaved] = useState(false)
  const noteInitRef = useRef(existingParticipation?.note ?? '')

  // Sync guest count when participation data changes
  useEffect(() => {
    setGuestCount(existingParticipation?.guest_count ?? 0)
  }, [existingParticipation?.guest_count])

  // Sync note when participation data changes. When there is no server-saved
  // note but a covering absence applies, prefill with the absence-derived
  // label (Vacation / Weekly unavailability / etc.) so the user sees and can
  // edit the implicit reason.
  const serverNote = existingParticipation?.note ?? ''
  const effectiveSync = serverNote || absenceNoteText
  if (effectiveSync !== noteInitRef.current) {
    noteInitRef.current = effectiveSync
    setNoteText(effectiveSync)
  }

  const serverStatus = existingParticipation?.status ?? null
  const displayStatus = optimisticStatus ?? serverStatus

  // Auto-dismiss confirmation after 2s
  useEffect(() => {
    if (!saveConfirmed) return
    const timer = setTimeout(() => setSaveConfirmed(false), 2000)
    return () => clearTimeout(timer)
  }, [saveConfirmed])

  // Auto-dismiss note confirmation after 2s
  useEffect(() => {
    if (!noteSaved) return
    const timer = setTimeout(() => setNoteSaved(false), 2000)
    return () => clearTimeout(timer)
  }, [noteSaved])

  const setStatus = useCallback(async (status: Participation['status'], guests?: number, note?: string) => {
    if (!user) return
    const gc = guests ?? guestCount
    const n = note ?? noteText
    setOptimisticStatus(status)
    setSaveConfirmed(false)
    try {
      if (existingParticipation) {
        await update(existingParticipation.id, { status, guest_count: gc, note: n })
      } else {
        await create({
          member: user.id,
          activity_type: 'training' as const,
          activity_id: training.id,
          status,
          note: n,
          guest_count: gc,
          is_staff: isStaff,
        })
      }
      setSaveConfirmed(true)
      onSaved?.()
    } catch {
      setOptimisticStatus(null)
    }
  }, [user, existingParticipation, training.id, isStaff, guestCount, noteText, create, update, onSaved])

  const saveNote = () => {
    if (noteText !== serverNote && displayStatus) {
      setStatus(displayStatus, guestCount, noteText)
      setNoteSaved(true)
    }
  }

  async function handleGuestChange(delta: number) {
    const newCount = Math.max(0, guestCount + delta)
    setGuestCount(newCount)
    if (displayStatus) {
      await setStatus(displayStatus, newCount)
    }
  }

  const isLocked = deadlinePassed

  if (guestExcluded) {
    return <p className="text-xs italic text-gray-500 dark:text-gray-400">{tTrainings('guestExcluded')}</p>
  }

  return (
    <div className="space-y-1.5">
      {hasAbsence && (
        <p className="text-xs italic text-gray-500 dark:text-gray-400">{t(absenceLabel)}</p>
      )}
      <div data-tour="rsvp-buttons" className="relative flex flex-wrap items-center gap-1.5">
        {(['confirmed', 'tentative', 'declined'] as const)
          // When deadline has passed: only render the user's selected choice (if any) in its color.
          .filter((s) => !isLocked || displayStatus === s)
          .map((status) => {
            const active = displayStatus === status
            const label = { confirmed: t('yes'), tentative: t('maybe'), declined: t('no') }
            return (
              <button
                key={status}
                onClick={() => !isLocked && setStatus(status)}
                disabled={isLocked}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition ${isLocked ? 'cursor-not-allowed' : ''} ${rsvpButtonClass(status, active)}`}
              >
                {label[status]}
              </button>
            )
          })}

        {/* Inline guest counter — coaches/TR only */}
        {displayStatus && isStaff && (
          <div className="flex items-center gap-1 ml-1 border-l border-gray-200 pl-2 dark:border-gray-600">
            <button
              onClick={() => handleGuestChange(-1)}
              disabled={guestCount <= 0}
              className="flex h-5 w-5 items-center justify-center rounded text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              −
            </button>
            <span className="min-w-[1rem] text-center text-xs font-medium text-gray-700 dark:text-gray-300">
              {guestCount}
            </span>
            <button
              onClick={() => handleGuestChange(1)}
              className="flex h-5 w-5 items-center justify-center rounded text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              +
            </button>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('guests')}</span>
          </div>
        )}

        {/* Save confirmation popover */}
        {saveConfirmed && (
          <span className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 whitespace-nowrap rounded-md bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white shadow-lg animate-fade-in">
            <Check className="h-3 w-3" />
            {t('saved')}
          </span>
        )}
      </div>

      {/* Deadline info */}
      {training.respond_by && (
        deadlinePassed ? (
          <p className="text-[10px] leading-tight text-red-500 dark:text-red-400">
            {t('deadlinePassed')}
          </p>
        ) : (
          <p data-tour="rsvp-deadline" className="text-[10px] leading-tight text-gray-400 dark:text-gray-500">
            {tTrainings('respondBy')}: {formatDate(training.respond_by)}, {formatTime(training.respond_by) || formatTime(training.start_time)}
          </p>
        )
      )}

      {/* Note input */}
      {displayStatus && (
        <div data-tour="training-note" className="relative flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <input
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveNote()
            }}
            placeholder={t('notePlaceholder')}
            className="min-w-0 flex-1 rounded-md border border-gray-200 bg-transparent px-2 py-0.5 text-xs text-gray-700 placeholder:text-gray-400 focus:border-brand-400 focus:outline-none dark:border-gray-600 dark:text-gray-300 dark:placeholder:text-gray-500 dark:focus:border-brand-500"
          />
          <button
            onClick={saveNote}
            disabled={noteText === serverNote}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-green-600 disabled:opacity-30 dark:hover:bg-gray-700 dark:hover:text-green-400"
          >
            <Check className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
