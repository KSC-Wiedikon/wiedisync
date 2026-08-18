import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import TeamChip from '../../components/TeamChip'
import RichText from '../../components/RichText'
import ParticipationButton from '../../components/ParticipationButton'
import ParticipationSummary from '../../components/ParticipationSummary'
import AbsenceForm from '../absences/AbsenceForm'
import { useAuth } from '../../hooks/useAuth'
import type { CalendarEntry, BirthdaySource } from '../../types/calendar'
import type { Training, Event as KscwEvent, Absence, Member } from '../../types'
import { formatDate } from '../../utils/dateUtils'
import { asObj, memberName } from '../../utils/relations'
import { isGuestExcludedFromEvent } from '../events/eventHelpers'

interface CalendarEntryModalProps {
  entry: CalendarEntry | null
  onClose: () => void
  onRefresh?: () => void
}

export default function CalendarEntryModal({ entry, onClose, onRefresh }: CalendarEntryModalProps) {
  const { t } = useTranslation('calendar')
  const { t: tTrainings } = useTranslation('trainings')
  const { t: tEvents } = useTranslation('events')
  const { user, getGuestLevel, memberTeamIds } = useAuth()
  const [editingAbsence, setEditingAbsence] = useState(false)

  useEffect(() => {
    if (!entry) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [entry, onClose])

  // Reset absence edit state when entry changes — React's sanctioned
  // adjust-state-during-render pattern (same commit, no cascading effect render).
  const [prevEntryId, setPrevEntryId] = useState(entry?.id)
  if (prevEntryId !== entry?.id) {
    setPrevEntryId(entry?.id)
    setEditingAbsence(false)
  }

  if (!entry) return null

  const typeLabels: Record<CalendarEntry['type'], string> = {
    game: t('typeGame'),
    training: t('typeTraining'),
    closure: t('typeClosure'),
    event: t('typeEvent'),
    hall: t('typeHall'),
    absence: t('typeAbsence'),
    'scorer-duty': t('typeScorerDuty'),
    birthday: t('typeBirthday'),
  }

  const typeBadgeStyles: Record<CalendarEntry['type'], string> = {
    game: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300',
    training: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    closure: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    event: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
    hall: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
    absence: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
    'scorer-duty': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
    birthday: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  }

  const dateStr = formatDate(entry.date, 'EEEE, d. MMMM yyyy')

  const isOwnAbsence = entry.type === 'absence' && user && (entry.source as Absence).member === user.id

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry.title}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <div
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-gray-800"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b dark:border-gray-700 px-6 py-4">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${typeBadgeStyles[entry.type]}`}>
              {typeLabels[entry.type]}
            </span>
            <button
              onClick={onClose}
              aria-label={t('common:close')}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 sm:min-h-0 sm:min-w-0 sm:p-1 dark:hover:bg-gray-700"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {/* Title */}
          <div className="px-6 py-5">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {entry.title}
            </h3>
            {entry.teamNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {entry.teamNames.map((name) => (
                  <TeamChip key={name} team={name} size="sm" />
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="space-y-3 border-t dark:border-gray-700 px-6 py-4">
            <DetailRow label={entry.endDate ? t('common:from') : t('common:date')} value={dateStr} />
            {entry.endDate && (
              <DetailRow label={t('common:to')} value={formatDate(entry.endDate, 'EEEE, d. MMMM yyyy')} />
            )}

            {entry.allDay && !entry.endDate ? (
              <DetailRow label={t('common:type')} value={t('common:allDay')} />
            ) : !entry.allDay && entry.startTime ? (
              <DetailRow
                label={t('common:from')}
                value={entry.endTime ? `${entry.startTime} – ${entry.endTime}` : entry.startTime}
              />
            ) : null}

            {entry.location && (
              <DetailRow label={t('common:hall')} value={entry.location} />
            )}

            {/* Trainings are excluded too: `renderTrainingDetails` below already
                renders both the notes and the cancellation reason, and the
                generic row was printing whichever of the two twice. */}
            {entry.description && entry.type !== 'event' && entry.type !== 'absence' && entry.type !== 'training' && (
              <DetailRow label={t('common:details')} value={entry.description} />
            )}

            {/* Training-specific fields */}
            {entry.type === 'training' && renderTrainingDetails(entry.source as Training, t)}

            {/* Event-specific fields */}
            {entry.type === 'event' && renderEventDetails(entry.source as KscwEvent, t)}

            {/* Absence-specific fields */}
            {entry.type === 'absence' && renderAbsenceDetails(entry.source as Absence, t)}

            {/* Birthday-specific fields */}
            {entry.type === 'birthday' && (entry.source as BirthdaySource).age > 0 && (
              <DetailRow label={t('turnsLabel')} value={String((entry.source as BirthdaySource).age)} />
            )}
          </div>

          {/* Participation section for trainings */}
          {entry.type === 'training' && user && !(entry.source as Training).cancelled && (() => {
            const tr = entry.source as Training
            const myGuestLevel = getGuestLevel(tr.team)
            const excluded = Array.isArray(tr.excluded_guest_levels) ? tr.excluded_guest_levels : []
            const guestExcluded = myGuestLevel > 0 && excluded.map((n) => Number(n)).includes(myGuestLevel)
            return (
              <div className="border-t dark:border-gray-700 px-6 py-4 space-y-3">
                {guestExcluded ? (
                  <p className="text-sm italic text-gray-500 dark:text-gray-400">{tTrainings('guestExcluded')}</p>
                ) : (
                  <ParticipationButton
                    activityType="training"
                    activityId={tr.id}
                    activityDate={tr.date}
                    teamId={tr.team}
                    respondBy={tr.respond_by}
                    activityStartTime={tr.start_time}
                    requireNoteIfAbsent={tr.require_note_if_absent}
                  />
                )}
                <ParticipationSummary
                  activityType="training"
                  activityId={tr.id}
                  compact
                />
              </div>
            )
          })()}

          {/* Participation section for events */}
          {entry.type === 'event' && user && (() => {
            const ev = entry.source as KscwEvent
            // Migration 324 — same gate as the event card / detail modal.
            const guestExcluded = isGuestExcludedFromEvent(ev, { memberId: user.id, memberTeamIds, getGuestLevel })
            return (
            <div className="border-t dark:border-gray-700 px-6 py-4 space-y-3">
              {guestExcluded ? (
                <p className="text-sm italic text-gray-500 dark:text-gray-400">{tEvents('guestNotInvited')}</p>
              ) : (
              <ParticipationButton
                activityType="event"
                activityId={entry.source.id}
                respondBy={(entry.source as KscwEvent).respond_by}
                participationMode={(entry.source as KscwEvent).participation_mode}
                maxPlayers={(entry.source as KscwEvent).max_players}
                requireNoteIfAbsent={(entry.source as KscwEvent).require_note_if_absent}
                allowMaybe={(entry.source as KscwEvent).allow_maybe !== false}
              />
              )}
              <ParticipationSummary
                activityType="event"
                activityId={entry.source.id}
                bars
                hideExtras
              />
            </div>
            )
          })()}

          {/* Edit button for own absences */}
          {isOwnAbsence && (
            <div className="border-t dark:border-gray-700 px-6 py-4">
              <button
                onClick={() => setEditingAbsence(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('common:edit')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Absence edit form */}
      {editingAbsence && (
        <AbsenceForm
          open
          absence={entry.source as Absence}
          onSave={() => {
            setEditingAbsence(false)
            onRefresh?.()
            onClose()
          }}
          onCancel={() => setEditingAbsence(false)}
        />
      )}
    </>
  )
}

function renderTrainingDetails(training: Training, t: (key: string) => string) {
  if (!training) return null
  // `coach` is a M2O relation to Member. useCalendarData expands it to
  // { first_name, last_name }; guard so a bare id / unexpanded value never
  // renders. Falls back to omitting the row when no name resolves.
  const coachName = memberName(asObj<Member>(training.coach))
  return (
    <>
      {training.cancelled && (
        // The automatic cancels (migration 191 hall-block, 261 own game day)
        // set no `cancel_reason` — they'd otherwise read as a bare "Cancelled"
        // with no hint that a game is the reason, which is the question every
        // member asks when they see it struck through next to a fixture.
        <DetailRow
          label={t('common:status')}
          value={training.cancel_reason || (training.auto_shortened_by_game ? t('cancelledGameDay') : t('cancelled'))}
        />
      )}
      {coachName && (
        <DetailRow label={t('coach')} value={coachName} />
      )}
      {training.notes && !training.cancelled && (
        <DetailRow label={t('common:notes')} value={training.notes} />
      )}
    </>
  )
}

function renderAbsenceDetails(absence: Absence, t: (key: string) => string) {
  if (!absence) return null

  const reasonLabels: Record<string, string> = {
    injury: t('common:injury'),
    vacation: t('common:vacation'),
    work: t('common:work'),
    personal: t('common:personal'),
    other: t('common:other'),
  }

  return (
    <>
      <DetailRow label={t('common:reason')} value={reasonLabels[absence.reason] ?? absence.reason} />
      {absence.reason_detail && (
        <DetailRow label={t('common:details')} value={absence.reason_detail} />
      )}
    </>
  )
}

function renderEventDetails(event: KscwEvent, t: (key: string) => string) {
  if (!event) return null

  const eventTypeKeys: Record<string, string> = {
    verein: 'eventTypeVerein',
    social: 'eventTypeSocial',
    meeting: 'eventTypeMeeting',
    tournament: 'eventTypeTournament',
    trainingsweekend: 'eventTypeTrainingsweekend',
    friendly: 'eventTypeFriendly',
    other: 'eventTypeOther',
  }

  return (
    <>
      {event.event_type && (
        <DetailRow label={t('common:type')} value={t(eventTypeKeys[event.event_type] ?? 'eventTypeOther')} />
      )}
      {event.description && (
        <div className="flex items-start gap-3 text-sm">
          <span className="w-20 shrink-0 text-gray-500 dark:text-gray-400">{t('common:details')}</span>
          {/<[a-z][\s\S]*>/i.test(event.description)
            ? <RichText html={event.description} className="text-gray-900 dark:text-gray-100" />
            : <span className="text-gray-900 dark:text-gray-100">{event.description}</span>
          }
        </div>
      )}
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="w-20 shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  )
}
