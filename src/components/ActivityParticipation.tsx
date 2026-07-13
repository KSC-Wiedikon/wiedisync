import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MessageSquare } from 'lucide-react'
import { formatDate, formatTime, getDeadlineDate } from '../utils/dateHelpers'
import { rsvpButtonClass } from '../utils/participationColors'
import { useAuth } from '../hooks/useAuth'
import { useMutation } from '../hooks/useMutation'
import { useMyCoveringAbsence } from '../hooks/useMyCoveringAbsence'
import { useAbsenceNoteText } from '../hooks/useAbsenceNoteText'
import type { Participation } from '../types'

interface ActivityParticipationProps {
  /** Which activity this RSVP control drives. Determines the i18n namespace,
   *  the covering-absence lookup, the created participation's `activity_type`,
   *  and the tour-anchor / click-propagation behaviour (games render inside a
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
}

/**
 * Shared RSVP / participation control for a game or training card.
 *
 * Extracted from the near-identical `GameCardParticipation` and
 * `TrainingParticipation` blocks. Both use the same optimistic-write flow
 * (`useMutation('participations')` + pre-fetched `existingParticipation`),
 * sizing and layout — they differed only in: the i18n namespace, the
 * activity-type/date/time fields, the tour anchors, and (games only)
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
    return <p className="text-xs italic text-gray-500 dark:text-gray-400">{text}</p>
  }

  return (
    <div data-tour={kind === 'game' ? 'game-rsvp' : undefined} className="space-y-1.5">
      {hasAbsence && (
        <p className="text-xs italic text-gray-500 dark:text-gray-400">{t(absenceLabel)}</p>
      )}
      <div
        data-tour={kind === 'training' ? 'rsvp-buttons' : undefined}
        className="relative flex flex-wrap items-center gap-1.5"
      >
        {(['confirmed', 'tentative', 'declined'] as const)
          // When deadline has passed: only render the user's selected choice (if any) in its color.
          .filter((s) => !isLocked || displayStatus === s)
          .map((status) => {
            const active = displayStatus === status
            const label = { confirmed: t('yes'), tentative: t('maybe'), declined: t('no') }
            return (
              <button
                key={status}
                onClick={(e) => { if (stopProp) e.stopPropagation(); if (!isLocked) setStatus(status) }}
                disabled={isLocked}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition ${isLocked ? 'cursor-not-allowed' : ''} ${rsvpButtonClass(status, active)}`}
              >
                {label[status]}
              </button>
            )
          })}

        {/* Inline guest counter — coaches/TR only */}
        {displayStatus && isStaff && (
          <div
            className="flex items-center gap-1 ml-1 border-l border-gray-200 pl-2 dark:border-gray-600"
            onClick={stopProp ? (e) => e.stopPropagation() : undefined}
          >
            <button
              onClick={(e) => { if (stopProp) e.stopPropagation(); handleGuestChange(-1) }}
              disabled={guestCount <= 0}
              className="flex h-5 w-5 items-center justify-center rounded text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              −
            </button>
            <span className="min-w-[1rem] text-center text-xs font-medium text-gray-700 dark:text-gray-300">
              {guestCount}
            </span>
            <button
              onClick={(e) => { if (stopProp) e.stopPropagation(); handleGuestChange(1) }}
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
      {respondBy && (
        deadlinePassed ? (
          <p className="text-[10px] leading-tight text-red-500 dark:text-red-400">
            {t('deadlinePassed')}
          </p>
        ) : (
          <p
            data-tour={kind === 'training' ? 'rsvp-deadline' : undefined}
            className="text-[10px] leading-tight text-gray-400 dark:text-gray-500"
          >
            {tKind('respondBy')}: {formatDate(respondBy)}, {formatTime(respondBy) || formatTime(activityTime)}
          </p>
        )
      )}

      {/* Note input */}
      {displayStatus && (
        <div
          data-tour={kind === 'training' ? 'training-note' : undefined}
          className="relative flex items-center gap-1.5"
          onClick={stopProp ? (e) => e.stopPropagation() : undefined}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <input
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={saveNoteOnBlur ? saveNote : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveNote()
            }}
            onClick={stopProp ? (e) => e.stopPropagation() : undefined}
            placeholder={t('notePlaceholder')}
            className="min-w-0 flex-1 rounded-md border border-gray-200 bg-transparent px-2 py-0.5 text-xs text-gray-700 placeholder:text-gray-400 focus:border-brand-400 focus:outline-none dark:border-gray-600 dark:text-gray-300 dark:placeholder:text-gray-500 dark:focus:border-brand-500"
          />
          <button
            onClick={(e) => { if (stopProp) e.stopPropagation(); saveNote() }}
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
