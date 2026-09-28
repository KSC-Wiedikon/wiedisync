import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MessageSquare, Minus, Plus } from 'lucide-react'
import { formatDate, formatTime, getDeadlineDate } from '../utils/dateHelpers'
import { useAuth } from '../hooks/useAuth'
import { useMutation } from '../hooks/useMutation'
import { useMyCoveringAbsence } from '../hooks/useMyCoveringAbsence'
import { useAbsenceNoteText } from '../hooks/useAbsenceNoteText'
import type { Participation } from '../types'
import RsvpAnswerButtons from './RsvpAnswerButtons'
import IconButton from './IconButton'

interface ActivityParticipationProps {
  /** Which activity this RSVP control drives. Determines the i18n namespace,
   *  the covering-absence lookup, the created participation's `activity_type`,
   *  and the click-propagation behaviour (games render inside a
   *  clickable card, trainings do not). */
  kind: 'game' | 'training'
  activityId: string
  date: string
  /** Response deadline (empty = no deadline). */
  respondBy: string
  /** Time-of-day used for deadline calc + the respond-by fallback display
   *  (game.time / training.start_time). */
  activityTime: string
  /** Pre-fetched current user's participation (from batch query). */
  existingParticipation?: Participation
  /** Coach/TR — enables the inline guest counter. */
  isStaff: boolean
  /** True when the current user's guest tier is excluded from this activity —
   *  renders an explanatory note instead of the controls. */
  guestExcluded: boolean
  /** Called after a participation save — parent can refetch. */
  onSaved?: () => void
  /** Pre-fetched rows for this activity (from the page's batch query) — the
   *  totals inside the answer buttons come from these, so the card opens no
   *  fetch / realtime subscription of its own. */
  participations?: Participation[]
  /** Coach member ids → "Coach present" for player-coaches. */
  coachMemberIds?: string[]
}

/**
 * Shared RSVP / participation control for a game or training card.
 *
 * Extracted from the near-identical `GameCardParticipation` and
 * `TrainingParticipation` blocks. Both use the same optimistic-write flow
 * (`useMutation('participations')` + pre-fetched `existingParticipation`),
 * sizing and layout — they differed only in: the i18n namespace, the
 * activity-type/date/time fields, and (games only)
 * click-propagation stopping + save-on-blur because a game card is itself
 * clickable. Those variations are keyed off `kind`.
 *
 * NOTE: `TrainingDetailModal`'s participation block is intentionally NOT
 * consolidated here — it uses the `useParticipation` hook (not raw
 * `useMutation`), larger modal sizing, a "Your status" label, `require_note`
 * validation and a bottom-placed guest counter, so sharing this component
 * would change its rendered output.
 */
export default function ActivityParticipation({
  kind,
  activityId,
  date,
  respondBy,
  activityTime,
  existingParticipation,
  isStaff,
  guestExcluded,
  onSaved,
  participations,
  coachMemberIds,
}: ActivityParticipationProps) {
  const { t } = useTranslation('participation')
  const { t: tKind } = useTranslation(kind === 'game' ? 'games' : 'trainings')
  const { user } = useAuth()
  const { create, update } = useMutation<Participation>('participations')
  const { absence, hasAbsence } = useMyCoveringAbsence(kind, date)
  const absenceLabel = absence?.type === 'weekly' ? 'declinedUnavailable' : 'absent'
  const absenceNoteText = useAbsenceNoteText(absence)

  // Games render inside a clickable card, so they stop click propagation and
  // save the note on blur. Trainings do neither.
  const stopProp = kind === 'game'
  const saveNoteOnBlur = kind === 'game'

  const deadlinePassed = respondBy
    ? getDeadlineDate(respondBy, activityTime) < new Date()
    : false

  const [optimisticStatus, setOptimisticStatus] = useState<Participation['status'] | null>(null)
  const [saveConfirmed, setSaveConfirmed] = useState(false)
  const [guestCount, setGuestCount] = useState(existingParticipation?.guest_count ?? 0)
  const [noteText, setNoteText] = useState(existingParticipation?.note ?? '')
  const [noteSaved, setNoteSaved] = useState(false)
  const noteInitRef = useRef(existingParticipation?.note ?? '')

  // Sync guest count when participation data changes. Adjusting state during
  // render (React's sanctioned pattern) rather than in an effect — the previous
  // `useEffect` did exactly this and only ever fired on a `guest_count` change.
  const serverGuestCount = existingParticipation?.guest_count ?? 0
  const [prevGuestCount, setPrevGuestCount] = useState(serverGuestCount)
  if (prevGuestCount !== serverGuestCount) {
    setPrevGuestCount(serverGuestCount)
    setGuestCount(serverGuestCount)
  }

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
          activity_type: kind,
          activity_id: activityId,
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
  }, [user, existingParticipation, activityId, kind, isStaff, guestCount, noteText, create, update, onSaved])

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
    const text = kind === 'game' ? tKind('guestsCannotParticipate') : tKind('guestExcluded')
    return <p className="text-xs italic text-muted-foreground">{text}</p>
  }

  // The answer buttons carry the team totals (RsvpAnswerButtons, compact card
  // mode): they replace the old pills AND the separate counters row. The
  // household "Answering for …" caption renders under them; "Deadline passed"
  // is printed by the component itself when locked.
  return (
    <div
      className="space-y-1.5"
      onClick={stopProp ? (e) => e.stopPropagation() : undefined}
    >
      {hasAbsence && (
        <p className="text-xs italic text-muted-foreground">{t(absenceLabel)}</p>
      )}
      <RsvpAnswerButtons
        compact
        activityType={kind}
        activityId={activityId}
        participations={participations ?? []}
        coachMemberIds={coachMemberIds}
        value={displayStatus}
        onSelect={(status) => { void setStatus(status) }}
        locked={isLocked}
        saved={saveConfirmed}
      />

      {/* Guest counter — coaches/TR only. Steppers on the IconButton scale. */}
      {displayStatus && isStaff && (
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">{t('guests')}</span>
          <IconButton
            size="sm"
            label={t('decreaseGuests', { defaultValue: 'Remove guest' })}
            onClick={() => handleGuestChange(-1)}
            disabled={guestCount <= 0}
            className="text-muted-foreground"
          >
            <Minus />
          </IconButton>
          <span className="min-w-[1rem] text-center text-xs font-medium tabular-nums text-foreground/85" aria-live="polite">
            {guestCount}
          </span>
          <IconButton
            size="sm"
            label={t('increaseGuests', { defaultValue: 'Add guest' })}
            onClick={() => handleGuestChange(1)}
            className="text-muted-foreground"
          >
            <Plus />
          </IconButton>
        </div>
      )}

      {/* Respond-by hint (the locked state is announced by the buttons). */}
      {respondBy && !deadlinePassed && (
        <p className="text-[10px] leading-tight text-muted-foreground/80">
          {tKind('respondBy')}: {formatDate(respondBy)}, {formatTime(respondBy) || formatTime(activityTime)}
        </p>
      )}

      {/* Note input */}
      {displayStatus && (
        <div className="relative flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
          <input
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={saveNoteOnBlur ? saveNote : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveNote()
            }}
            placeholder={t('notePlaceholder')}
            className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 text-xs sm:h-8 text-foreground/85 placeholder:text-muted-foreground/70 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <IconButton
            size="sm"
            label={t('save', { ns: 'common' })}
            onClick={saveNote}
            disabled={noteText === serverNote}
            className="text-muted-foreground/80 hover:text-green-600 dark:hover:text-green-400"
          >
            <Check />
          </IconButton>
        </div>
      )}
    </div>
  )
}
