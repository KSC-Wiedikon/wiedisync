import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { parseISO, isSaturday, addDays } from 'date-fns'
import { de } from 'date-fns/locale/de'
import { enUS } from 'date-fns/locale'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import type { Hall, SpielsamstagConfig } from '../../../types'
import { fetchAllItems } from '../../../lib/api'
import { toDateKey, formatDateLocale } from '../../../utils/dateUtils'

// Fixed game-Saturday times (rule C1) — not editable. Juniors may also play on
// any Sunday at fixed times (11:00/13:00/15:00); those slots are generated for
// every Sunday automatically, so there is no Sunday picker here.
const DEFAULT_TIMES = ['11:00', '13:30', '16:00', '18:30']

interface Props {
  spielsamstage: SpielsamstagConfig[]
  onUpdate: (spielsamstage: SpielsamstagConfig[]) => Promise<void>
}

export default function SpielsamstageEditor({ spielsamstage, onUpdate }: Props) {
  const { t, i18n } = useTranslation('gameScheduling')
  const [halls, setHalls] = useState<Hall[]>([])
  const [dates, setDates] = useState<string[]>(
    spielsamstage.map(s => s.date).filter(Boolean),
  )
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [events, setEvents] = useState<{ start_date: string; end_date: string | null }[]>([])

  useEffect(() => {
    setDates(spielsamstage.map(s => s.date).filter(Boolean))
  }, [spielsamstage])

  useEffect(() => {
    fetchAllItems<Hall>('halls', { sort: ['name'] }).then(setHalls).catch(() => {})
  }, [])

  // Saturdays that fall on any event get greyed out in the picker, so a game
  // day isn't booked onto an event. Zurich-local dates (matches the server).
  useEffect(() => {
    fetchAllItems<{ start_date: string; end_date: string | null }>('events', {
      fields: ['id', 'start_date', 'end_date'],
    })
      .then(setEvents)
      .catch(() => {})
  }, [])

  const eventDays = useMemo(() => {
    const set = new Set<string>()
    const zkey = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date(ts))
    for (const e of events) {
      if (!e.start_date) continue
      let d = parseISO(zkey(e.start_date))
      const last = parseISO(zkey(e.end_date || e.start_date))
      let guard = 0
      while (d <= last && guard++ < 400) {
        set.add(toDateKey(d))
        d = addDays(d, 1)
      }
    }
    return set
  }, [events])

  const lang = i18n.language
  const locale = lang === 'de' ? de : enUS

  const kwiHalls = useMemo(
    () => halls.filter(h => h.name.toLowerCase().includes('kwi')),
    [halls],
  )

  const selectedDates = useMemo(
    () => dates.map(d => parseISO(d)).sort((a, b) => a.getTime() - b.getTime()),
    [dates],
  )

  const handleCalendarSelect = (newDates: Date[] | undefined) => {
    const keys = (newDates ?? []).map(toDateKey)
    setDates(Array.from(new Set(keys)))
  }

  const removeDate = (d: string) => {
    setDates(dates.filter(x => x !== d))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: SpielsamstagConfig[] = [...dates]
        .sort()
        .map(date => ({
          date,
          slots: DEFAULT_TIMES.flatMap(time =>
            kwiHalls.map(h => ({ time, hall_id: String(h.id) })),
          ),
        }))
      await onUpdate(payload)
    } finally {
      setSaving(false)
    }
  }

  const slotsPerDay = kwiHalls.length * DEFAULT_TIMES.length
  const hallNames = kwiHalls.map(h => h.name).join(' / ') || 'KWI'

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t('spielsamstage')}
      </h2>
      <p className="mt-1 mb-4 text-xs text-gray-500 dark:text-gray-400">
        {t('spielsamstageAutoHint', {
          count: slotsPerDay,
          times: DEFAULT_TIMES.join(' / '),
          halls: hallNames,
          defaultValue: `Each selected Saturday auto-generates ${slotsPerDay} slots — ${DEFAULT_TIMES.join(' / ')} × ${hallNames}.`,
        })}
      </p>

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <CalendarIcon className="h-4 w-4" />
            {t('pickSaturdays', { defaultValue: 'Pick Saturdays' })}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="multiple"
            selected={selectedDates}
            onSelect={handleCalendarSelect}
            locale={locale}
            weekStartsOn={1}
            showOutsideDays={false}
            captionLayout="dropdown"
            disabled={(date) => !isSaturday(date) || eventDays.has(toDateKey(date))}
            startMonth={new Date(new Date().getFullYear() - 1, 0)}
            endMonth={new Date(new Date().getFullYear() + 2, 11)}
          />
        </PopoverContent>
      </Popover>

      {selectedDates.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedDates.map(d => {
            const key = toDateKey(d)
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
              >
                {formatDateLocale(d, 'd. MMM yyyy', lang)}
                <button
                  type="button"
                  onClick={() => removeDate(key)}
                  className="ml-1 rounded hover:text-blue-600 dark:hover:text-white"
                  aria-label={t('removeSpielssamstag')}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {t('noSpielsamstage', { defaultValue: 'No game Saturdays yet.' })}
        </p>
      )}

      {kwiHalls.length === 0 && halls.length > 0 && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          {t('noKwiHalls', {
            defaultValue: 'No KWI halls found — add halls named "KWI A/B/C" to enable auto-slot generation.',
          })}
        </p>
      )}

      <Button
        onClick={handleSave}
        disabled={saving || kwiHalls.length === 0}
        size="sm"
        className="mt-4"
      >
        {saving ? '...' : t('common:save')}
      </Button>
    </div>
  )
}
