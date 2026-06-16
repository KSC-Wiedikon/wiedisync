import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface HallOption {
  id: string | number
  name: string
}

/** One selectable game of a multi-game pairing (id null = legacy single-game). */
export interface ManualFixtureOption {
  id: string | null
  label: string
  /** A confirmed booking already exists for this game (saving overwrites it). */
  booked: boolean
  /** Current values of the existing confirmed booking — pre-filled into the form
   *  when this fixture is selected, so an overwrite is "tweak the time", not retype. */
  prefill?: {
    date?: string        // YYYY-MM-DD
    start_time?: string  // HH:MM (game start)
    hall?: string        // hall id (home leg only)
    place?: string       // away leg only
  }
}

interface Props {
  /** Halls offered for the home leg (KSCW halls). */
  halls: HallOption[]
  /** Hall id of this team's currently-open slots — pre-selected for a brand-new
   *  home game and floated to the top of the hall dropdown. */
  defaultHomeHall?: string | number | null
  /** Selectable games per leg — a pairing can be played 2-3× per season. A
   *  single entry hides the picker; its `booked` flag drives the overwrite hint. */
  homeFixtures: ManualFixtureOption[]
  awayFixtures: ManualFixtureOption[]
  /** Season offer window (YYYY-MM-DD) — bounds the date inputs so an out-of-season
   *  typo (e.g. 10.02.2026 for a 2026/27 season) can't be entered. */
  minDate?: string
  maxDate?: string
  onSave: (legs: {
    home?: { date: string; start_time: string; end_time?: string; hall: number | string; svrz_game_id?: string }
    away?: { date: string; start_time?: string; place?: string; svrz_game_id?: string }
  }) => Promise<void>
}

// Add 90 minutes to an HH:MM string (default game length) for a sensible end time.
function plus90(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const total = (h * 60 + m + 90) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// First game without a confirmed booking, else the first game — the default
// pick for a leg's fixture select.
const defaultFixture = (opts: ManualFixtureOption[]): string =>
  String((opts.find((o) => !o.booked) ?? opts[0])?.id ?? '')

// Manually record an already-agreed matchup (date settled by email/phone outside
// the tool), skipping the opponent's propose/choose flow. Collapsed by default;
// the admin fills the home leg, the away leg, or both.
export default function ManualBookingForm({ halls, defaultHomeHall, homeFixtures, awayFixtures, minDate, maxDate, onSave }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [homeOn, setHomeOn] = useState(false)
  const [homeFixtureId, setHomeFixtureId] = useState(() => defaultFixture(homeFixtures))
  const [homeDate, setHomeDate] = useState('')
  const [homeStart, setHomeStart] = useState('')
  const [homeHall, setHomeHall] = useState<string>('')

  const [awayOn, setAwayOn] = useState(false)
  const [awayFixtureId, setAwayFixtureId] = useState(() => defaultFixture(awayFixtures))
  const [awayDate, setAwayDate] = useState('')
  const [awayStart, setAwayStart] = useState('')
  const [awayPlace, setAwayPlace] = useState('')

  const reset = () => {
    setHomeOn(false); setHomeDate(''); setHomeStart(''); setHomeHall('')
    setAwayOn(false); setAwayDate(''); setAwayStart(''); setAwayPlace('')
    setHomeFixtureId(defaultFixture(homeFixtures))
    setAwayFixtureId(defaultFixture(awayFixtures))
  }

  // Pre-fill a leg from the selected fixture: its existing confirmed booking when
  // overwriting (req 1), else — for the home leg — the team's open-slot gym (req 2).
  const applyHomePrefill = (fx?: ManualFixtureOption) => {
    setHomeDate(fx?.prefill?.date || '')
    setHomeStart(fx?.prefill?.start_time || '')
    setHomeHall(String(fx?.prefill?.hall ?? defaultHomeHall ?? ''))
  }
  const applyAwayPrefill = (fx?: ManualFixtureOption) => {
    setAwayDate(fx?.prefill?.date || '')
    setAwayStart(fx?.prefill?.start_time || '')
    setAwayPlace(fx?.prefill?.place || '')
  }

  // The fixture options load lazily (per-team SVRZ fetch) and can arrive after
  // mount — re-pick the default whenever the current selection isn't offered.
  useEffect(() => {
    if (!homeFixtures.some((o) => String(o.id ?? '') === homeFixtureId)) setHomeFixtureId(defaultFixture(homeFixtures))
  }, [homeFixtures, homeFixtureId])
  useEffect(() => {
    if (!awayFixtures.some((o) => String(o.id ?? '') === awayFixtureId)) setAwayFixtureId(defaultFixture(awayFixtures))
  }, [awayFixtures, awayFixtureId])

  const selectedHome = homeFixtures.find((o) => String(o.id ?? '') === homeFixtureId)
  const selectedAway = awayFixtures.find((o) => String(o.id ?? '') === awayFixtureId)

  // Float this team's open-slot gym to the top of the hall dropdown (req 2) so
  // the pre-selected default is also the first option offered.
  const defaultHallKey = defaultHomeHall != null ? String(defaultHomeHall) : ''
  const orderedHalls = defaultHallKey
    ? [...halls.filter((h) => String(h.id) === defaultHallKey), ...halls.filter((h) => String(h.id) !== defaultHallKey)]
    : halls

  // True if a date falls outside the season offer window (typo guard).
  const outOfWindow = (date: string) => !!date && ((minDate && date < minDate) || (maxDate && date > maxDate))
  const fmtWin = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}.${m}.${y}` }

  const handleSave = async () => {
    const legs: Parameters<typeof onSave>[0] = {}
    if ((homeOn && outOfWindow(homeDate)) || (awayOn && outOfWindow(awayDate))) {
      toast.error(t('manualDateOutOfWindow', { start: fmtWin(minDate || ''), end: fmtWin(maxDate || '') }))
      return
    }
    if (homeOn) {
      if (!homeDate || !homeStart || !homeHall) { toast.error(t('manualHomeIncomplete')); return }
      legs.home = {
        // End time is derived (start + 90 min) — the admin only enters a start.
        date: homeDate, start_time: homeStart, end_time: plus90(homeStart), hall: homeHall,
        ...(homeFixtureId ? { svrz_game_id: homeFixtureId } : {}),
      }
    }
    if (awayOn) {
      if (!awayDate) { toast.error(t('manualAwayIncomplete')); return }
      legs.away = {
        date: awayDate, start_time: awayStart || undefined, place: awayPlace || undefined,
        ...(awayFixtureId ? { svrz_game_id: awayFixtureId } : {}),
      }
    }
    if (!legs.home && !legs.away) { toast.error(t('manualNothingToSave')); return }
    setSaving(true)
    try {
      await onSave(legs)
      toast.success(t('manualSaved'))
      reset(); setOpen(false)
    } catch (err) {
      toast.error((err as { body?: { error?: string } })?.body?.error || (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'

  if (!open) {
    return (
      <div className="mt-3 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('manualEnterAgreed')}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('manualBookingHint')}</p>

      {/* Home leg */}
      <div className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          <input
            type="checkbox" checked={homeOn}
            onChange={(e) => { setHomeOn(e.target.checked); if (e.target.checked) applyHomePrefill(selectedHome) }}
          />
          {t('manualHomeGame')}{selectedHome?.booked ? ` (${t('manualOverwrite')})` : ''}
        </label>
        {homeOn && homeFixtures.length > 1 && (
          <label className="mt-2 block">
            <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualWhichGame')}</span>
            <select
              value={homeFixtureId}
              onChange={(e) => { setHomeFixtureId(e.target.value); applyHomePrefill(homeFixtures.find((o) => String(o.id ?? '') === e.target.value)) }}
              className={`${inputCls} dark:bg-gray-800`}
            >
              {homeFixtures.map((o) => (
                <option key={String(o.id ?? '')} value={String(o.id ?? '')}>
                  {o.label}{o.booked ? ` (${t('manualOverwrite')})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {homeOn && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualDate')}</span>
              <input type="date" value={homeDate} min={minDate} max={maxDate} onChange={(e) => setHomeDate(e.target.value)} className={inputCls} />
            </label>
            <label>
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualStart')}</span>
              <input type="time" value={homeStart} onChange={(e) => setHomeStart(e.target.value)} className={inputCls} />
            </label>
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualHall')}</span>
              <select value={homeHall} onChange={(e) => setHomeHall(e.target.value)} className={`${inputCls} dark:bg-gray-800`}>
                <option value="">{t('manualSelectHall')}</option>
                {orderedHalls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}{defaultHallKey && String(h.id) === defaultHallKey ? ` (${t('manualOpenSlotHall')})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Away leg */}
      <div className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          <input
            type="checkbox" checked={awayOn}
            onChange={(e) => { setAwayOn(e.target.checked); if (e.target.checked) applyAwayPrefill(selectedAway) }}
          />
          {t('manualAwayGame')}{selectedAway?.booked ? ` (${t('manualOverwrite')})` : ''}
        </label>
        {awayOn && awayFixtures.length > 1 && (
          <label className="mt-2 block">
            <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualWhichGame')}</span>
            <select
              value={awayFixtureId}
              onChange={(e) => { setAwayFixtureId(e.target.value); applyAwayPrefill(awayFixtures.find((o) => String(o.id ?? '') === e.target.value)) }}
              className={`${inputCls} dark:bg-gray-800`}
            >
              {awayFixtures.map((o) => (
                <option key={String(o.id ?? '')} value={String(o.id ?? '')}>
                  {o.label}{o.booked ? ` (${t('manualOverwrite')})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {awayOn && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualDate')}</span>
              <input type="date" value={awayDate} min={minDate} max={maxDate} onChange={(e) => setAwayDate(e.target.value)} className={inputCls} />
            </label>
            <label>
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualStart')}</span>
              <input type="time" value={awayStart} onChange={(e) => setAwayStart(e.target.value)} className={inputCls} />
            </label>
            <label className="col-span-2">
              <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400">{t('manualPlace')}</span>
              <input type="text" value={awayPlace} onChange={(e) => setAwayPlace(e.target.value)} placeholder={t('manualPlacePlaceholder')} className={inputCls} />
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? t('saving') : t('manualSave')}
        </button>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false) }}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
