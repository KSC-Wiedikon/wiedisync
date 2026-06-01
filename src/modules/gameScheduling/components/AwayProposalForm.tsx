import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseISO, isBefore, startOfDay } from 'date-fns'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import LocationCombobox from '@/components/LocationCombobox'
import type { BookingData } from '../hooks/useAvailableSlots'
import { toDateKey, formatDateLocale } from '@/utils/dateUtils'

interface Props {
  existingProposal?: BookingData
  /** Dates (yyyy-MM-dd) that conflict with a team event / game(±1) / player
   *  absence — greyed out in the picker (mirrors the propose-away rejection). */
  blockedDates: string[]
  onSubmit: (proposals: Array<{ date: string; start_time: string; location: string }>) => Promise<void>
}

export default function AwayProposalForm({ existingProposal, blockedDates, onSubmit }: Props) {
  const { t, i18n } = useTranslation('gameScheduling')
  const [submitting, setSubmitting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Seed from an existing proposal's stored datetimes (`yyyy-MM-ddTHH:mm`).
  const [dates, setDates] = useState<Date[]>(() => {
    const out: Date[] = []
    ;[1, 2, 3].forEach((n) => {
      const dt = existingProposal?.[`proposed_datetime_${n}` as keyof BookingData] as string | undefined
      if (dt) {
        const d = parseISO(dt)
        if (!Number.isNaN(d.getTime())) out.push(d)
      }
    })
    return out
  })
  const [details, setDetails] = useState<Record<string, { time: string; place: string }>>(() => {
    const out: Record<string, { time: string; place: string }> = {}
    ;[1, 2, 3].forEach((n) => {
      const dt = existingProposal?.[`proposed_datetime_${n}` as keyof BookingData] as string | undefined
      const pl = (existingProposal?.[`proposed_place_${n}` as keyof BookingData] as string | undefined) || ''
      if (dt) {
        const d = parseISO(dt)
        if (!Number.isNaN(d.getTime())) out[toDateKey(d)] = { time: dt.slice(11, 16), place: pl }
      }
    })
    return out
  })

  const blockedSet = useMemo(() => new Set(blockedDates), [blockedDates])
  const today = startOfDay(new Date())

  const handleSelect = (next?: Date[]) => {
    const arr = (next ?? []).slice(0, 3).sort((a, b) => a.getTime() - b.getTime())
    setDates(arr)
    setDetails((prev) => {
      const out: Record<string, { time: string; place: string }> = {}
      for (const d of arr) {
        const k = toDateKey(d)
        out[k] = prev[k] || { time: '', place: '' }
      }
      return out
    })
  }

  const setDetail = (key: string, field: 'time' | 'place', value: string) => {
    setDetails((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }

  const sorted = useMemo(() => [...dates].sort((a, b) => a.getTime() - b.getTime()), [dates])
  const allFilled = sorted.length > 0 && sorted.every((d) => {
    const m = details[toDateKey(d)]
    return m && m.time && m.place
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const proposals = sorted.map((d) => {
        const k = toDateKey(d)
        return { date: k, start_time: details[k].time, location: details[k].place }
      })
      await onSubmit(proposals)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-2">
            <CalendarIcon className="h-4 w-4" />
            {t('pickAwayDates', { defaultValue: 'Pick dates (max 3)' })}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="multiple"
            max={3}
            selected={dates}
            onSelect={handleSelect}
            weekStartsOn={1}
            showOutsideDays={false}
            disabled={(date) => isBefore(date, today) || blockedSet.has(toDateKey(date))}
          />
        </PopoverContent>
      </Popover>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('awayDatesHint', { defaultValue: 'Dates with a team event, game (±1 day) or player absence are greyed out.' })}
      </p>

      {sorted.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('noAwayDates', { defaultValue: 'No dates picked yet.' })}
        </p>
      ) : (
        sorted.map((d) => {
          const k = toDateKey(d)
          const m = details[k] || { time: '', place: '' }
          return (
            <div key={k} className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {formatDateLocale(d, 'EEE d. MMM yyyy', i18n.language)}
                </span>
                <button
                  type="button"
                  onClick={() => handleSelect(dates.filter((x) => toDateKey(x) !== k))}
                  className="rounded text-gray-400 hover:text-red-600"
                  aria-label={t('removeAwayDate', { defaultValue: 'Remove date' })}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">{t('proposalTime', { defaultValue: 'Time' })}</label>
                  <input
                    type="time"
                    value={m.time}
                    onChange={(e) => setDetail(k, 'time', e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-500 dark:bg-gray-600 dark:text-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">{t('proposalPlace')}</label>
                  <LocationCombobox value={m.place} onChange={(v) => setDetail(k, 'place', v)} placeholder={t('placeholderAwayHall')} />
                </div>
              </div>
            </div>
          )
        })
      )}

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
