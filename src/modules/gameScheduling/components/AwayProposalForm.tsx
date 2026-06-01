import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseISO, isBefore, startOfDay } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import LocationCombobox from '@/components/LocationCombobox'
import type { BookingData } from '../hooks/useAvailableSlots'
import { toDateKey, formatDateLocale } from '@/utils/dateUtils'

interface Slot {
  date: Date | null
  time: string
  place: string
}

interface Props {
  existingProposal?: BookingData
  /** Proposals 1 & 2: blocked on events, games(±1) and ANY player absence. */
  blockedStrict: string[]
  /** Proposal 3: blocked on events, games(±1) and only 3+ player absences. */
  blockedLoose: string[]
  onSubmit: (proposals: Array<{ date: string; start_time: string; location: string }>) => Promise<void>
}

export default function AwayProposalForm({ existingProposal, blockedStrict, blockedLoose, onSubmit }: Props) {
  const { t, i18n } = useTranslation('gameScheduling')
  const [submitting, setSubmitting] = useState(false)
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  const [slots, setSlots] = useState<Slot[]>(() =>
    [1, 2, 3].map((n) => {
      const dt = existingProposal?.[`proposed_datetime_${n}` as keyof BookingData] as string | undefined
      const pl = (existingProposal?.[`proposed_place_${n}` as keyof BookingData] as string | undefined) || ''
      const d = dt ? parseISO(dt) : null
      return { date: d && !Number.isNaN(d.getTime()) ? d : null, time: dt ? dt.slice(11, 16) : '', place: pl }
    }),
  )

  const strictSet = useMemo(() => new Set(blockedStrict), [blockedStrict])
  const looseSet = useMemo(() => new Set(blockedLoose), [blockedLoose])
  const today = startOfDay(new Date())

  const update = (i: number, patch: Partial<Slot>) =>
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  // A date already chosen in another proposal can't be reused.
  const otherDates = (i: number) =>
    new Set(
      slots
        .filter((_, idx) => idx !== i)
        .map((s) => (s.date ? toDateKey(s.date) : null))
        .filter((x): x is string => !!x),
    )

  const isDisabled = (i: number) => (date: Date) => {
    const k = toDateKey(date)
    const blocked = i < 2 ? strictSet : looseSet
    return isBefore(date, today) || blocked.has(k) || otherDates(i).has(k)
  }

  const allFilled = slots.every((s) => s.date && s.time && s.place)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const proposals = slots.map((s) => ({
        date: toDateKey(s.date as Date),
        start_time: s.time,
        location: s.place,
      }))
      await onSubmit(proposals)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('awayProposalsHint', {
          defaultValue:
            'Proposals 1 & 2 must be free of any player absence; proposal 3 allows up to 2. Team events and games (±1 day) are always blocked.',
        })}
      </p>

      {slots.map((s, i) => (
        <div key={i} className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700">
          <span className="mb-2 block text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('proposalNumber', { number: i + 1 })}
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Popover open={openIdx === i} onOpenChange={(o) => setOpenIdx(o ? i : null)}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="w-full justify-start gap-2">
                  <CalendarIcon className="h-4 w-4" />
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
                  disabled={isDisabled(i)}
                />
              </PopoverContent>
            </Popover>
            <input
              type="time"
              value={s.time}
              onChange={(e) => update(i, { time: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-500 dark:bg-gray-600 dark:text-gray-100"
              required
            />
            <LocationCombobox value={s.place} onChange={(v) => update(i, { place: v })} placeholder={t('placeholderAwayHall')} />
          </div>
        </div>
      ))}

      {existingProposal && existingProposal.status === 'pending' && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">{t('awaitingConfirmation')}</p>
      )}

      <button
        type="submit"
        disabled={submitting || !allFilled}
        className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? t('submitting') : existingProposal ? t('updateProposals') : t('submitProposals')}
      </button>
    </form>
  )
}
