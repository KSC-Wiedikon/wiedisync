import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, X, Minus, Plus, UserPlus } from 'lucide-react'
import TeamChip from '../../components/TeamChip'
import RichText from '../../components/RichText'
import RsvpAnswerButtons from '../../components/RsvpAnswerButtons'
import IconButton from '../../components/IconButton'
import ParticipationSummary from '../../components/ParticipationSummary'
import SessionParticipationSheet from '../../components/SessionParticipationSheet'
import { Button } from '@/components/ui/button'
import AbsenceForm from '../absences/AbsenceForm'
import { useAuth } from '../../hooks/useAuth'
import { useParticipation } from '../../hooks/useParticipation'
import { useMyCoveringAbsence } from '../../hooks/useMyCoveringAbsence'
import { useRsvpLabels } from '../../hooks/useRsvpLabels'
import { useCollection } from '../../lib/query'
import type { CalendarEntry, BirthdaySource } from '../../types/calendar'
import type { Training, Event as KscwEvent, Game, Absence, Member, Participation, EventSession } from '../../types'
import type { RsvpStatus } from '../../utils/participationColors'
import { formatDate } from '../../utils/dateUtils'
import { formatTime, meetingTimeFromOffset, getDeadlineDate } from '../../utils/dateHelpers'
import { asObj, memberName } from '../../utils/relations'
import { isGuestExcludedFromEvent } from '../events/eventHelpers'
import { eventTypeLabelKey } from './eventTypeLabel'

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
    absence: 'bg-selected text-selected-foreground',
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
        className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm dark:bg-black/70"
        onClick={onClose}
      >
        <div
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-hairline bg-card shadow-2xl sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${typeBadgeStyles[entry.type]}`}>
              {typeLabels[entry.type]}
            </span>
            <IconButton label={t('common:close')} onClick={onClose} className="-mr-2 shrink-0 text-muted-foreground/80 sm:-mr-1">
              <X className="!size-5" />
            </IconButton>
          </div>

          {/* Title */}
          <div className="px-6 py-5">
            <h3 className="break-words text-lg font-bold leading-snug tracking-tight text-foreground">
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
          <div className="space-y-3 border-t border-border px-6 py-4">
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

            {(() => {
              const meeting = entry.type === 'training'
                ? meetingTimeFromOffset((entry.source as Training).start_time, (entry.source as Training).meeting_offset_minutes)
                : entry.type === 'game'
                  ? meetingTimeFromOffset((entry.source as Game).time, (entry.source as Game).meeting_offset_minutes)
                  : entry.type === 'event'
                    ? formatTime((entry.source as KscwEvent).meeting_time ?? '')
                    : ''
              return meeting ? <DetailRow label={t('common:meetingTime')} value={meeting} /> : null
            })()}

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
              <div className="border-t border-border px-6 py-4 space-y-3">
                {guestExcluded ? (
                  <>
                    <p className="text-sm italic text-muted-foreground">{tTrainings('guestExcluded')}</p>
                    <ParticipationSummary activityType="training" activityId={tr.id} bars />
                  </>
                ) : (
                  // Answer buttons carry the totals — no separate counters row.
                  <CalendarRsvp
                    activityType="training"
                    activityId={tr.id}
                    activityDate={tr.date}
                    teamId={tr.team}
                    respondBy={tr.respond_by}
                    activityStartTime={tr.start_time}
                    requireNoteIfAbsent={tr.require_note_if_absent}
                  />
                )}
              </div>
            )
          })()}

          {/* Participation section for events */}
          {entry.type === 'event' && user && (() => {
            const ev = entry.source as KscwEvent
            // Migration 324 — same gate as the event card / detail modal.
            const guestExcluded = isGuestExcludedFromEvent(ev, { memberId: user.id, memberTeamIds, getGuestLevel })
            return (
            <div className="border-t border-border px-6 py-4 space-y-3">
              {guestExcluded ? (
                <>
                  <p className="text-sm italic text-muted-foreground">{tEvents('guestNotInvited')}</p>
                  <ParticipationSummary activityType="event" activityId={ev.id} bars hideExtras />
                </>
              ) : (
                <CalendarRsvp
                  activityType="event"
                  activityId={ev.id}
                  respondBy={ev.respond_by}
                  participationMode={ev.participation_mode}
                  requireNoteIfAbsent={ev.require_note_if_absent}
                  allowMaybe={ev.allow_maybe !== false}
                  hideCoachPresent
                />
              )}
            </div>
            )
          })()}

          {/* Edit button for own absences */}
          {isOwnAbsence && (
            <div className="border-t border-border px-6 py-4">
              <Button type="button" variant="outline" onClick={() => setEditingAbsence(true)}>
                <Pencil aria-hidden />
                {t('common:edit')}
              </Button>
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

  // Shared with the home ticker and the appointments list, so the three cannot
  // disagree on what an event type is called.
  const typeKey = eventTypeLabelKey(event.event_type)

  return (
    <>
      {typeKey && <DetailRow label={t('common:type')} value={t(typeKey)} />}
      {event.description && (
        <div className="flex items-start gap-3 text-sm">
          <span className="w-20 shrink-0 text-muted-foreground">{t('common:details')}</span>
          {/<[a-z][\s\S]*>/i.test(event.description)
            ? <RichText html={event.description} className="min-w-0 flex-1 break-words text-foreground" />
            : <span className="min-w-0 flex-1 break-words text-foreground">{event.description}</span>
          }
        </div>
      )}
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words text-foreground">{value}</span>
    </div>
  )
}

interface CalendarRsvpProps {
  activityType: Extract<Participation['activity_type'], 'training' | 'event'>
  activityId: string
  activityDate?: string
  teamId?: string
  respondBy?: string
  activityStartTime?: string
  participationMode?: KscwEvent['participation_mode']
  requireNoteIfAbsent?: boolean
  allowMaybe?: boolean
  hideCoachPresent?: boolean
}

/**
 * The calendar's RSVP block — RsvpAnswerButtons with the guards the old
 * `ParticipationButton` dropdown carried: respond-by lock, "note required" for
 * No/Maybe (asked inline before the answer is saved), Maybe hidden when the
 * event disallows it, the guest counter, and per-session events routed to
 * SessionParticipationSheet instead of a whole-event answer.
 */
function CalendarRsvp({
  activityType, activityId, activityDate, teamId, respondBy, activityStartTime,
  participationMode, requireNoteIfAbsent = false, allowMaybe = true, hideCoachPresent,
}: CalendarRsvpProps) {
  const { t } = useTranslation('participation')
  const { t: tc } = useTranslation('common')
  const { isStaffOnly } = useAuth()
  const { status: statusLabels } = useRsvpLabels()
  const isStaff = !!teamId && isStaffOnly(teamId)

  // Per-day / per-session events answer per session (participations.session_id).
  // Only the entry point lives here; the sheet itself is untouched.
  const sessionMode = activityType === 'event' && !!participationMode && participationMode !== 'whole'
  const { data: sessionsRaw } = useCollection<EventSession>('event_sessions', {
    filter: { event: { _eq: activityId } },
    sort: ['sort_order', 'date', 'start_time'],
    limit: 100,
    enabled: sessionMode,
  })
  const sessions = sessionsRaw ?? []
  const [sessionSheetOpen, setSessionSheetOpen] = useState(false)

  const { participation, effectiveStatus, setStatus, saveConfirmed, dismissConfirmed, isLoading } = useParticipation(
    activityType, activityId, activityDate, undefined, isStaff,
  )
  const { absence, hasAbsence } = useMyCoveringAbsence(activityType, activityDate)
  const absenceLabel = absence?.type === 'weekly' ? 'declinedUnavailable' : 'absent'

  const serverGuestCount = participation?.guest_count ?? 0
  const [guestCount, setGuestCount] = useState(serverGuestCount)
  const [prevServerGuestCount, setPrevServerGuestCount] = useState(serverGuestCount)
  if (prevServerGuestCount !== serverGuestCount) {
    setPrevServerGuestCount(serverGuestCount)
    setGuestCount(serverGuestCount)
  }
  // Debounced so rapid +/- taps issue one write, not one per tap (which can race).
  const guestWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (guestWriteTimer.current) clearTimeout(guestWriteTimer.current) }, [])

  const [pendingStatus, setPendingStatus] = useState<'declined' | 'tentative' | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteError, setNoteError] = useState(false)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  // Focus the note as soon as it is asked for — it is the only thing left to do.
  useEffect(() => {
    if (pendingStatus) noteInputRef.current?.focus()
  }, [pendingStatus])

  useEffect(() => {
    if (!saveConfirmed) return
    const timer = setTimeout(dismissConfirmed, 2000)
    return () => clearTimeout(timer)
  }, [saveConfirmed, dismissConfirmed])

  const deadlinePassed = respondBy ? getDeadlineDate(respondBy, activityStartTime) < new Date() : false

  if (sessionMode && sessions.length > 0) {
    return (
      <>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setSessionSheetOpen(true)}
          className="bg-brand-100 text-brand-700 hover:bg-brand-200 dark:bg-brand-900/30 dark:text-brand-400 dark:hover:bg-brand-900/50"
        >
          {t('events:sessionParticipation')}
        </Button>
        {sessionSheetOpen && (
          <SessionParticipationSheet
            activityId={activityId}
            sessions={sessions}
            isStaff={isStaff}
            onClose={() => setSessionSheetOpen(false)}
          />
        )}
        <ParticipationSummary activityType={activityType} activityId={activityId} bars hideExtras={hideCoachPresent} />
      </>
    )
  }

  function select(status: RsvpStatus) {
    if (requireNoteIfAbsent && (status === 'declined' || status === 'tentative')) {
      setPendingStatus(status)
      setNoteText(participation?.note ?? '')
      setNoteError(false)
      return
    }
    setPendingStatus(null)
    void setStatus(status, participation?.note ?? '', status === 'declined' ? 0 : guestCount)
  }

  function submitNote() {
    if (!pendingStatus) return
    if (!noteText.trim()) {
      setNoteError(true)
      return
    }
    const status = pendingStatus
    setPendingStatus(null)
    setNoteError(false)
    void setStatus(status, noteText.trim(), status === 'declined' ? 0 : guestCount)
  }

  function changeGuests(delta: number) {
    const next = Math.max(0, guestCount + delta)
    setGuestCount(next)
    if (effectiveStatus && effectiveStatus !== 'declined') {
      const status = effectiveStatus
      const note = participation?.note ?? ''
      if (guestWriteTimer.current) clearTimeout(guestWriteTimer.current)
      guestWriteTimer.current = setTimeout(() => {
        guestWriteTimer.current = null
        void setStatus(status, note, next)
      }, 500)
    }
  }

  return (
    <div className="space-y-2">
      {hasAbsence && (
        <p className="text-xs italic text-muted-foreground">{t(absenceLabel)}</p>
      )}
      <RsvpAnswerButtons
        activityType={activityType}
        activityId={activityId}
        value={effectiveStatus}
        loading={isLoading}
        locked={deadlinePassed}
        saved={saveConfirmed}
        options={allowMaybe ? ['confirmed', 'tentative', 'declined'] : ['confirmed', 'declined']}
        hideCoachPresent={hideCoachPresent}
        onSelect={select}
      />
      {/* "Note required" — asked before a No/Maybe is saved. */}
      {pendingStatus && !deadlinePassed && (
        <div className="space-y-2 rounded-xl border border-hairline bg-surface-sunken p-3">
          <p className="text-xs font-medium text-foreground/85">
            {statusLabels[pendingStatus]} — {t('requireNoteIfAbsentHint')}
          </p>
          <textarea
            value={noteText}
            onChange={(e) => { setNoteText(e.target.value); setNoteError(false) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitNote()
              }
            }}
            placeholder={t('notePlaceholder')}
            rows={2}
            ref={noteInputRef}
            className={`w-full rounded-lg border bg-card px-2 py-1.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/20 ${
              noteError ? 'border-red-400 dark:border-red-500' : 'border-input'
            }`}
          />
          {noteError && (
            <p className="text-[11px] text-red-500 dark:text-red-400">{t('noteRequiredError')}</p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => { setPendingStatus(null); setNoteError(false) }}>
              {tc('cancel')}
            </Button>
            <Button type="button" className="flex-1" onClick={submitNote}>
              {tc('save')}
            </Button>
          </div>
        </div>
      )}
      {/* Guest counter — shown when coming or maybe (as in the old dropdown). */}
      {!deadlinePassed && effectiveStatus && effectiveStatus !== 'declined' && (
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground/80" aria-hidden />
          <span className="text-sm text-muted-foreground">{t('guests')}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <IconButton
              label={t('decreaseGuests', { defaultValue: 'Remove guest' })}
              variant="secondary"
              onClick={() => changeGuests(-1)}
              disabled={guestCount <= 0}
            >
              <Minus />
            </IconButton>
            <span className="min-w-[1.5rem] text-center text-sm font-medium tabular-nums text-foreground" aria-live="polite">
              {guestCount}
            </span>
            <IconButton
              label={t('increaseGuests', { defaultValue: 'Add guest' })}
              variant="secondary"
              onClick={() => changeGuests(1)}
            >
              <Plus />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  )
}
