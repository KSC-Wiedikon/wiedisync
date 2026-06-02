import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { parseISO, isSaturday, isSunday, addDays } from 'date-fns'
import { de } from 'date-fns/locale/de'
import { enUS } from 'date-fns/locale'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import type { Hall, SpielsamstagConfig } from '../../../types'
import { fetchAllItems } from '../../../lib/api'
import { toDateKey, formatDateLocale } from '../../../utils/dateUtils'

// Fixed game-day times (rule C1) — not editable in the UI.
const DEFAULT_TIMES = ['11:00', '13:30', '16:00', '18:30']
const SUNDAY_TIMES = ['11:00', '13:00', '15:00']

interface Props {
  spielsamstage: SpielsamstagConfig[]
  onUpdate: (spielsamstage: SpielsamstagConfig[]) => Promise<void>
  spielsonntage: SpielsamstagConfig[]
  onUpdateSundays: (spielsonntage: SpielsamstagConfig[]) => Promise<void>
}

export default function SpielsamstageEditor({ spielsamstage, onUpdate, spielsonntage, onUpdateSundays }: Props) {
  const { t, i18n } = useTranslation('gameScheduling')
  const [halls, setHalls] = useState<Hall[]>([])
  const [dates, setDates] = useState<string[]>(
    spielsamstage.map(s => s.date).filter(Boolean),
  )
  const [sundayDates, setSundayDates] = useState<string[]>(
    spielsonntage.map(s => s.date).filter(Boolean),
  )
  const [saving, setSaving] = useState(false)
  const [savingSun, setSavingSun] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sundayPickerOpen, setSundayPickerOpen] = useState(false)
  const [events, setEvents] = useState<{ start_date: string; end_date: string | null }[]>([])

  useEffect(() => {
    setDates(spielsamstage.map(s => s.date).filter(Boolean))
  }, [spielsamstage])

  useEffect(() => {
    setSundayDates(spielsonntage.map(s => s.date).filter(Boolean))
  }, [spielsonntage])

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

  const sundaySelectedDates = useMemo(
    () => sundayDates.map(d => parseISO(d)).sort((a, b) => a.getTime() - b.getTime()),
    [sundayDates],
  )

  const handleCalendarSelect = (newDates: Date[] | undefined) => {
    const keys = (newDates ?? []).map(toDateKey)
    setDates(Array.from(new Set(keys)))
  }

  const handleSundaySelect = (newDates: Date[] | undefined) => {
    const keys = (newDates ?? []).map(toDateKey)
    setSundayDates(Array.from(new Set(keys)))
  }

  const removeDate = (d: string) => {
    setDates(dates.filter(x => x !== d))
  }

  const removeSundayDate = (d: string) => {
    setSundayDates(sundayDates.filter(x => x !== d))
  }

  const buildPayload = (ds: string[], times: string[]): SpielsamstagConfig[] =>
    [...ds].sort().map(date => ({
      date,
      slots: times.flatMap(time => kwiHalls.map(h => ({ time, hall_id: String(h.id) }))),
    }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdate(buildPayload(dates, DEFAULT_TIMES))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSundays = async () => {
    setSavingSun(true)
    try {
      await onUpdateSundays(buildPayload(sundayDates, SUNDAY_TIMES))
    } finally {
      setSavingSun(false)
    }
  }

  const slotsPerDay = kwiHalls.length * DEFAULT_TIMES.length
  const sundaySlotsPerDay = kwiHalls.length * SUNDAY_TIMES.length
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

      {/* Spielsonntage — junior teams only (rule A2/C1) */}
      <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('spielsonntage', { defaultValue: 'Game Sundays (junior teams)' })}
        </h2>
        <p className="mt-1 mb-4 text-xs text-gray-500 dark:text-gray-400">
          {t('spielsonntageAutoHint', {
            count: sundaySlotsPerDay,
            times: SUNDAY_TIMES.join(' / '),
            halls: hallNames,
            defaultValue: `Junior teams only. Each selected Sunday auto-generates ${sundaySlotsPerDay} slots — ${SUNDAY_TIMES.join(' / ')} × ${hallNames}.`,
          })}
        </p>

        <Popover open={sundayPickerOpen} onOpenChange={setSundayPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon className="h-4 w-4" />
              {t('pickSundays', { defaultValue: 'Pick Sundays' })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="multiple"
              selected={sundaySelectedDates}
              onSelect={handleSundaySelect}
              locale={locale}
              weekStartsOn={1}
              showOutsideDays={false}
              captionLayout="dropdown"
              disabled={(date) => !isSunday(date) || eventDays.has(toDateKey(date))}
              startMonth={new Date(new Date().getFullYear() - 1, 0)}
              endMonth={new Date(new Date().getFullYear() + 2, 11)}
            />
          </PopoverContent>
        </Popover>

        {sundaySelectedDates.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {sundaySelectedDates.map(d => {
              const key = toDateKey(d)
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
                >
                  {formatDateLocale(d, 'd. MMM yyyy', lang)}
                  <button
                    type="button"
                    onClick={() => removeSundayDate(key)}
                    className="ml-1 rounded hover:text-violet-600 dark:hover:text-white"
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
            {t('noSpielsonntage', { defaultValue: 'No game Sundays yet.' })}
          </p>
        )}

        <Button
          onClick={handleSaveSundays}
          disabled={savingSun || kwiHalls.length === 0}
          size="sm"
          className="mt-4"
        >
          {savingSun ? '...' : t('common:save')}
        </Button>
      </div>
    </div>
  )
}
