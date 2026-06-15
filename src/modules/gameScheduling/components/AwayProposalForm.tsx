import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseISO, isBefore, isAfter, startOfDay } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import type { BookingData } from '../hooks/useAvailableSlots'
import { toDateKey, formatDateLocale } from '@/utils/dateUtils'

interface Slot {
  date: Date | null
  time: string
}

interface Props {
  existingProposal?: BookingData
  /** Proposals 1 & 2: blocked on events, games(±1) and ANY player absence. */
  blockedStrict: string[]
  /** Proposal 3: blocked on events, games(±1) and only 3+ player absences. */
  blockedLoose: string[]
  /** Selectable window (Sep 1 → Mar 31), or null for no bound. */
  seasonWindow: { start: string; end: string } | null
  onSubmit?: (proposals: Array<{ date: string; start_time: string; location: string }>) => Promise<void>
  /** Report the current proposals (3 filled) or null while incomplete, so a
   *  parent can drive a single combined submit. */
  onChange?: (proposals: Array<{ date: string; start_time: string; location: string }> | null) => void
  /** Hide the form's own submit button (parent owns submission). */
  hideSubmit?: boolean
}

export default function AwayProposalForm({ existingProposal, blockedStrict, blockedLoose, seasonWindow, onSubmit, onChange, hideSubmit }: Props) {
  const { t, i18n } = useTranslation('gameScheduling')
  const [submitting, setSubmitting] = useState(false)
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  const [slots, setSlots] = useState<Slot[]>(() =>
    [1, 2, 3].map((n) => {
      const dt = existingProposal?.[`proposed_datetime_${n}` as keyof BookingData] as string | undefined
      const d = dt ? parseISO(dt) : null
      return { date: d && !Number.isNaN(d.getTime()) ? d : null, time: dt ? dt.slice(11, 16) : '' }
    }),
  )

  const strictSet = useMemo(() => new Set(blockedStrict), [blockedStrict])
  const looseSet = useMemo(() => new Set(blockedLoose), [blockedLoose])
  const today = startOfDay(new Date())
  const winStart = seasonWindow ? parseISO(seasonWindow.start) : null
  const winEnd = seasonWindow ? parseISO(seasonWindow.end) : null

  const update = (i: number, patch: Partial<Slot>) =>
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  const otherDates = (i: number) =>
    new Set(
      slots
        .filter((_, idx) => idx !== i)
        .map((s) => (s.date ? toDateKey(s.date) : null))
        .filter((x): x is string => !!x),
    )

  const isDisabled = (i: number) => (date: Date) => {
    if (isBefore(date, today)) return true
    if (winStart && isBefore(date, winStart)) return true
    if (winEnd && isAfter(date, winEnd)) return true
    const k = toDateKey(date)
    return (i < 2 ? strictSet : looseSet).has(k) || otherDates(i).has(k)
  }

  // At least one fully-filled slot (date + time) is enough to submit — partial
  // rows are ignored. The backend accepts 1–3 proposals.
  const filledSlots = slots.filter((s) => s.date && s.time)
  const canSubmit = filledSlots.length >= 1
  const toProposals = () => filledSlots.map((s) => ({ date: toDateKey(s.date as Date), start_time: s.time, location: '' }))

  // Report the current proposals upward (for a parent-owned combined submit).
  useEffect(() => {
    onChange?.(canSubmit ? toProposals() : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, canSubmit, onChange])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hideSubmit || !canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit?.(toProposals())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {slots.map((s, i) => (
        <div key={i} className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700">
          <span className="mb-2 block text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('proposalNumber', { number: i + 1 })}
            {i === 0 && <span className="ml-1 text-green-700 dark:text-green-300">· {t('slotReserved')}</span>}
          </span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Popover open={openIdx === i} onOpenChange={(o) => setOpenIdx(o ? i : null)}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-10 w-full justify-start gap-2 sm:flex-1">
                  <CalendarIcon className="h-4 w-4 shrink-0" />
                  {s.date ? formatDateLocale(s.date, 'EEE d. MMM yyyy', i18n.language) : t('proposalDate')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={s.date ?? undefined}
                  onSelect={(d) => {
                    update(i, { date: d ?? null })
                    setOpenIdx(null)
                  }}
                  weekStartsOn={1}
                  showOutsideDays={false}
                  startMonth={winStart ?? undefined}
                  endMonth={winEnd ?? undefined}
                  disabled={isDisabled(i)}
                  modifiers={{ outOfSeason: (date) => (!!winStart && isBefore(date, winStart)) || (!!winEnd && isAfter(date, winEnd)) }}
                  modifiersClassNames={{ outOfSeason: '!bg-black !text-white/40' }}
                />
                <p className="flex items-center gap-1.5 border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <span className="inline-block h-3 w-3 rounded-sm bg-black" />
                  {t('outsideSeasonLabel')}
                </p>
              </PopoverContent>
            </Popover>
            <input
              type="time"
              value={s.time}
              onChange={(e) => update(i, { time: e.target.value })}
              className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm dark:border-gray-500 dark:bg-gray-600 dark:text-gray-100 sm:w-36"
              required
            />
          </div>
        </div>
      ))}

      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        {t('firstChoiceReservedNote')}
      </p>
      {existingProposal && existingProposal.status === 'pending' && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">{t('awaitingConfirmation')}</p>
      )}

      {!hideSubmit && (
        <button
          type="submit"
          disabled={submitting || !canSubmit}
          className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? t('submitting') : existingProposal ? t('updateProposals') : t('submitProposals')}
        </button>
      )}
    </form>
  )
}
