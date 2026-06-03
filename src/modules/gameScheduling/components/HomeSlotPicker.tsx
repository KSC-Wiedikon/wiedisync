import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseISO } from 'date-fns'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import Modal from '@/components/Modal'
import type { SlotData } from '../hooks/useAvailableSlots'
import { toDateKey, formatDateLocale } from '@/utils/dateUtils'

interface Props {
  slots: SlotData[]
  onPickSlot: (slotId: string) => Promise<void>
}

interface TimeOption {
  start_time: string
  end_time: string
  hallLabel: string
  slotId: string
}

const hm = (s: string) => String(s || '').slice(0, 5)

// "KWI A" + "KWI B" -> "KWI A/B"; otherwise join with " / ".
function mergeHalls(names: string[]): string {
  const uniq = [...new Set(names.filter(Boolean))].sort()
  if (uniq.length <= 1) return uniq[0] || ''
  const parts = uniq.map((n) => n.split(' '))
  const prefix = parts[0][0]
  if (parts.every((p) => p[0] === prefix)) {
    return `${prefix} ${parts.map((p) => p.slice(1).join(' ')).join('/')}`
  }
  return uniq.join(' / ')
}

export default function HomeSlotPicker({ slots, onPickSlot }: Props) {
  const { t, i18n } = useTranslation('gameScheduling')
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [modalDate, setModalDate] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  // date (yyyy-MM-dd) -> time options, merging same date+time across halls.
  const byDate = useMemo(() => {
    const dm = new Map<string, Map<string, { start_time: string; end_time: string; members: { hall: string; slotId: string }[] }>>()
    for (const s of slots) {
      if (!dm.has(s.date)) dm.set(s.date, new Map())
      const tm = dm.get(s.date)!
      const tk = `${s.start_time}-${s.end_time}`
      if (!tm.has(tk)) tm.set(tk, { start_time: s.start_time, end_time: s.end_time, members: [] })
      tm.get(tk)!.members.push({ hall: s.hall_name, slotId: s.id })
    }
    const out = new Map<string, TimeOption[]>()
    for (const [dk, tm] of dm) {
      out.set(
        dk,
        [...tm.values()]
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
          .map((v) => {
            // Prefer the lowest-named hall (KWI A before KWI B); book that slot.
            const sorted = [...v.members].sort((a, b) => a.hall.localeCompare(b.hall))
            return {
              start_time: v.start_time,
              end_time: v.end_time,
              hallLabel: mergeHalls(sorted.map((m) => m.hall)),
              slotId: sorted[0].slotId,
            }
          }),
      )
    }
    return out
  }, [slots])

  const availableDates = useMemo(() => new Set(byDate.keys()), [byDate])
  const sortedDates = useMemo(() => [...byDate.keys()].sort(), [byDate])
  // Junior soft-cluster hint: dates another junior team already plays (Sundays).
  const preferredDates = useMemo(
    () => new Set(slots.filter((s) => s.preferred).map((s) => s.date)),
    [slots],
  )
  // Game-Saturday (Spielsamstag) dates — surfaced first so opponents fill the
  // central game-Saturday pool before grabbing other slots.
  const spielsamstagDates = useMemo(
    () => [...new Set(slots.filter((s) => s.source === 'spielsamstag').map((s) => s.date))].sort(),
    [slots],
  )
  const spielsamstagSet = useMemo(() => new Set(spielsamstagDates), [spielsamstagDates])

  if (slots.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t('noSlotsAvailable')}</p>
  }

  const modalOptions = modalDate ? byDate.get(modalDate) ?? [] : []

  const book = async (slotId: string) => {
    setPicking(true)
    try {
      await onPickSlot(slotId)
      setModalDate(null)
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Game Saturdays first — we want the central pool filled before other dates. */}
      {spielsamstagDates.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-900/20">
          <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-200">
            {t('spielsamstagPickFirst', { defaultValue: 'Game Saturdays — please pick one of these first if it works for you.' })}
          </p>
          <div className="flex flex-wrap gap-2">
            {spielsamstagDates.map((dk) => {
              const opts = byDate.get(dk) ?? []
              return (
                <button
                  key={dk}
                  type="button"
                  onClick={() => setModalDate(dk)}
                  className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-amber-900/40"
                >
                  {formatDateLocale(parseISO(dk), 'EEE d. MMM', i18n.language)}
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    {opts.length === 1
                      ? `${hm(opts[0].start_time)}–${hm(opts[0].end_time)}`
                      : t('nTimeOptions', { count: opts.length, defaultValue: `${opts.length} times` })}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex gap-1">
        <Button type="button" size="sm" variant={view === 'calendar' ? 'default' : 'outline'} onClick={() => setView('calendar')}>
          {t('calendarView', { defaultValue: 'Calendar' })}
        </Button>
        <Button type="button" size="sm" variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')}>
          {t('listView', { defaultValue: 'List' })}
        </Button>
      </div>

      {view === 'calendar' ? (
        <div className="flex justify-center">
          <Calendar
            mode="single"
            weekStartsOn={1}
            showOutsideDays={false}
            defaultMonth={parseISO(sortedDates[0])}
            startMonth={parseISO(sortedDates[0])}
            endMonth={parseISO(sortedDates[sortedDates.length - 1])}
            disabled={(date) => !availableDates.has(toDateKey(date))}
            modifiers={{ spielsamstag: (date) => spielsamstagSet.has(toDateKey(date)) }}
            modifiersClassNames={{ spielsamstag: 'bg-amber-100 dark:bg-amber-900/40 font-semibold' }}
            onDayClick={(day, modifiers) => {
              if (modifiers.disabled) return
              setModalDate(toDateKey(day))
            }}
          />
        </div>
      ) : (
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {sortedDates.map((dk) => {
            const opts = byDate.get(dk)!
            return (
              <button
                key={dk}
                type="button"
                onClick={() => setModalDate(dk)}
                className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2.5 text-left text-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                <span className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                  {formatDateLocale(parseISO(dk), 'EEE d. MMM yyyy', i18n.language)}
                  {spielsamstagSet.has(dk) && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                      {t('sourceSpielsamstag')}
                    </span>
                  )}
                  {preferredDates.has(dk) && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                      {t('preferredSunday', { defaultValue: 'Shared Sunday' })}
                    </span>
                  )}
                </span>
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  {opts.length === 1
                    ? `${hm(opts[0].start_time)}–${hm(opts[0].end_time)} · ${opts[0].hallLabel}`
                    : t('nTimeOptions', { count: opts.length, defaultValue: `${opts.length} times` })}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <Modal
        open={!!modalDate}
        onClose={() => setModalDate(null)}
        title={modalDate ? formatDateLocale(parseISO(modalDate), 'EEE d. MMM yyyy', i18n.language) : ''}
        size="sm"
      >
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('pickTimeHint', { defaultValue: 'Choose a time to confirm the home game.' })}</p>
          {modalOptions.map((o) => (
            <button
              key={o.slotId}
              type="button"
              disabled={picking}
              onClick={() => book(o.slotId)}
              className="flex w-full items-center justify-between rounded-md border border-gray-200 px-3 py-3 text-sm hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-blue-900/30"
            >
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {hm(o.start_time)} – {hm(o.end_time)}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{o.hallLabel}</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}
